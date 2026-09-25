-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — схема базы для Supabase (Postgres)
--
--  Как применить: Supabase → SQL Editor → New query → вставить файл целиком → Run.
--  Повторный запуск безопасен: таблицы создаются «если нет», функции и политики
--  пересоздаются.
--
--  Что внутри:
--    1. Таблицы — один в один с сущностями приложения (lib/crm/types.ts):
--       operators, groups, projects, leads, shifts, plans, adjustments,
--       accounts, learn, approves, candidates, audit + kv (настройки системы).
--    2. Функции прав: кто сейчас вошёл (по почте из сессии), его роль, группы.
--    3. RLS — те же права, что в приложении (lib/crm/access.ts), но на сервере:
--         РОП (head)        — всё;
--         супервайзер        — свои группы; что можно — настраивает РОП
--                              (настройки → «Роли и доступ»);
--         оператор           — только своё.
--    4. Защита полей триггерами: статус лида ставит только РОП/супервайзер,
--       оператор не меняет себе роль и т.п.
--    5. RPC: crm_bootstrap() — первый вошедший становится РОПом,
--       crm_replace_all() — импорт/восстановление одной транзакцией.
--    6. Realtime — изменения прилетают всем открытым CRM сразу.
--
--  Аккаунт в CRM привязан к почте: поле accounts.login = почта, с которой
--  человек регистрируется. Оставьте включённым подтверждение почты
--  (Authentication → Sign In / Providers → Email → Confirm email), иначе
--  кто угодно зарегистрируется на чужую почту.
-- ════════════════════════════════════════════════════════════════════════

-- в новом проекте не должно быть чужих таблиц с теми же именами (старая схема Vexa)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'leads')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'operator_id') then
    raise exception 'В базе уже есть таблица leads другой схемы (похоже, от Vexa). Используйте новый пустой проект Supabase.';
  end if;
end $$;

-- ── 1. Таблицы ─────────────────────────────────────────────────────────

-- Группы. supervisor_id ссылается на operators — внешний ключ добавлен ниже.
create table if not exists public.groups (
  id              text primary key,
  name            text not null,
  supervisor_id   text,
  supervisor_name text not null default '',
  monthly_plan    numeric not null default 0,
  active          boolean not null default true,
  color           text not null default 'gray',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Операторы (карточки сотрудников). Удаление — мягкое (deleted_at): история остаётся.
create table if not exists public.operators (
  id           text primary key,
  name         text not null,
  group_id     text references public.groups (id) on delete set null deferrable initially deferred,
  role         text not null default 'operator' check (role in ('operator', 'senior', 'supervisor', 'trainee')),
  status       text not null default 'active' check (status in ('active', 'pause', 'fired')),
  hire_date    text not null default '',   -- 'YYYY-MM-DD' или ''
  fire_date    text not null default '',
  monthly_plan numeric,                    -- null — план по умолчанию из настроек
  norm_hours   numeric,                    -- null — норма по умолчанию
  pay_type     text not null default 'tiered'
               check (pay_type in ('salary', 'hourly', 'salary_bonus', 'hourly_bonus', 'tiered', 'salary_tiered', 'sv_volume')),
  salary       numeric not null default 0,
  hourly_rate  numeric not null default 0,
  lead_bonus   numeric,
  rate_grid_id text,
  grade        text not null default 'mid' check (grade in ('jr', 'mid', 'sr')),
  track        text not null default 're' check (track in ('re', 'auto')),
  contact      text not null default '',
  comment      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'groups_supervisor_fk') then
    alter table public.groups
      add constraint groups_supervisor_fk foreign key (supervisor_id)
      references public.operators (id) on delete set null deferrable initially deferred;
  end if;
end $$;

-- Проекты (Авто, Недвижимость…).
create table if not exists public.projects (
  id         text primary key,
  name       text not null,
  active     boolean not null default true,
  color      text not null default 'gray',
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Лиды. at — локальное время передачи 'YYYY-MM-DDTHH:mm' (без часового пояса, как в приложении).
-- Статус: оператор записал — work; супервайзер ставит done / failed (причина обязательна).
create table if not exists public.leads (
  id            text primary key,
  at            text not null,
  client        text not null default '',
  phone         text not null default '',
  project_id    text references public.projects (id) on delete set null deferrable initially deferred,
  operator_id   text not null references public.operators (id) deferrable initially deferred,
  group_id      text references public.groups (id) on delete set null deferrable initially deferred,
  direction     text not null default '',
  link          text not null default '',   -- ссылка на лид (CRM заказчика, запись звонка)
  comment       text not null default '',
  source        text not null default 'Скорозвон',
  status        text not null default 'work' check (status in ('work', 'done', 'failed')),
  status_reason text not null default '',
  status_at     timestamptz,
  status_by     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leads_failed_needs_reason check (status <> 'failed' or btrim(status_reason) <> '')
);

-- колонка появилась позже — в уже созданную таблицу добавляем
alter table public.leads add column if not exists link text not null default '';
-- регион лида: «Основа» / «Регионы» (списки и экономика — в настройках CRM)
alter table public.leads add column if not exists region text not null default '';

-- Смены: одна запись на оператора в день, id = 'YYYY-MM-DD|<operator_id>'.
create table if not exists public.shifts (
  id          text primary key,
  date        text not null,
  operator_id text not null references public.operators (id) deferrable initially deferred,
  group_id    text references public.groups (id) on delete set null deferrable initially deferred,
  hours       numeric not null default 0,
  type        text not null default 'work' check (type in ('work', 'off', 'training', 'vacation', 'sick')),
  comment     text not null default '',
  updated_at  timestamptz not null default now()
);

-- Планы и условия месяца: id = 'YYYY-MM|team' | 'YYYY-MM|group|<id>' | 'YYYY-MM|operator|<id>'.
create table if not exists public.plans (
  id          text primary key,
  month       text not null,
  scope       text not null check (scope in ('team', 'group', 'operator')),
  target_id   text,
  plan        numeric not null default 0,
  norm_hours  numeric,
  pay_type    text,
  salary      numeric,
  hourly_rate numeric,
  lead_bonus  numeric,
  tiers       jsonb,          -- снимок тарифной сетки на месяц
  grade       text,
  track       text,
  approve_pct numeric,
  growth      boolean,
  auto        boolean,        -- создано автоматической фиксацией месяца
  updated_at  timestamptz not null default now()
);

-- Начисления и удержания.
create table if not exists public.adjustments (
  id          text primary key,
  month       text not null,
  operator_id text not null references public.operators (id) deferrable initially deferred,
  type        text not null check (type in ('accrual', 'bonus', 'compensation', 'correction', 'deduction', 'advance', 'payout')),
  amount      numeric not null default 0,
  date        text not null default '',
  comment     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Аккаунты CRM. login — почта, с которой человек входит.
create table if not exists public.accounts (
  id           text primary key,
  name         text not null,
  login        text not null default '',
  role         text not null check (role in ('head', 'supervisor', 'operator')),
  operator_id  text references public.operators (id) on delete set null deferrable initially deferred,
  group_ids    text[] not null default '{}',
  active       boolean not null default true,
  prefs        jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  deleted_at   timestamptz
);

-- Прогресс обучения: одна запись на материал и аккаунт, id = '<account_id>|<item_id>'.
create table if not exists public.learn (
  id         text primary key,
  account_id text not null,
  course_id  text not null default '',
  item_id    text not null default '',
  done       boolean not null default false,
  "right"    integer,
  total      integer,
  last       numeric,
  best       numeric,
  tries      integer,
  pass       boolean,
  at         text,
  checks     text[],
  note       text,
  fav        boolean,
  cert       jsonb,
  updated_at timestamptz not null default now()
);

-- Апрув заказчика по месяцам: id = 'YYYY-MM|<project_id|all>', project_id '' — на весь месяц.
create table if not exists public.approves (
  id         text primary key,
  month      text not null,
  project_id text not null default '',
  pct        numeric not null default 0,
  comment    text not null default '',
  updated_at timestamptz not null default now()
);

-- Кандидаты (раздел «Найм»): воронка до карточки оператора. Даты этапов — 'YYYY-MM-DD' или ''.
-- При приёме CRM заводит оператора и ставит сюда operator_id. Удаление — мягкое (deleted_at).
create table if not exists public.candidates (
  id           text primary key,
  name         text not null,
  contact      text not null default '',
  source       text not null default '',
  group_id     text references public.groups (id) on delete set null deferrable initially deferred,
  stage        text not null default 'new' check (stage in ('new', 'interview', 'training', 'hired', 'rejected', 'declined')),
  applied_at   text not null default '',
  interview_at text not null default '',
  training_at  text not null default '',
  closed_at    text not null default '',
  operator_id  text references public.operators (id) on delete set null deferrable initially deferred,
  reason       text not null default '',
  comment      text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Журнал изменений.
create table if not exists public.audit (
  id           text primary key,
  at           timestamptz not null default now(),
  account_id   text not null default '',
  account_name text not null default '',
  entity       text not null default '',
  entity_id    text not null default '',
  summary      text not null default '',
  -- что поменялось: [{ f, from, to }] — было → стало человеческими словами
  changes      jsonb
);
alter table public.audit add column if not exists changes jsonb;

-- Настройки системы: key = 'settings' (всё, кроме секретов), 'sheets' (выгрузка в Google — только РОП),
-- 'frozenMonths' (зафиксированные месяцы).
create table if not exists public.kv (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ── индексы ─────────────────────────────────────────────────────────────
create index if not exists leads_at_idx          on public.leads (at);
create index if not exists leads_operator_idx    on public.leads (operator_id);
create index if not exists leads_group_idx       on public.leads (group_id);
create index if not exists leads_status_idx      on public.leads (status);
create index if not exists leads_phone_idx       on public.leads (phone);
create index if not exists shifts_date_idx       on public.shifts (date);
create index if not exists shifts_operator_idx   on public.shifts (operator_id);
create index if not exists shifts_group_idx      on public.shifts (group_id);
create index if not exists plans_month_idx       on public.plans (month);
create index if not exists plans_target_idx      on public.plans (scope, target_id);
create index if not exists adjustments_op_idx    on public.adjustments (operator_id, month);
create index if not exists operators_group_idx   on public.operators (group_id);
create index if not exists learn_account_idx     on public.learn (account_id);
create index if not exists audit_at_idx          on public.audit (at);
create index if not exists candidates_group_idx  on public.candidates (group_id);
-- одна почта — один живой аккаунт
create unique index if not exists accounts_login_uniq on public.accounts (lower(login)) where login <> '' and deleted_at is null;

-- ── 2. Функции прав ─────────────────────────────────────────────────────
-- security definer: читают таблицы в обход RLS, иначе политики зациклятся.

-- почта из сессии Supabase
create or replace function public.crm_email() returns text
language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- аккаунт того, кто вошёл
create or replace function public.crm_account_id() returns text
language sql stable security definer set search_path = public as $$
  select a.id from public.accounts a
  where a.login <> '' and lower(a.login) = public.crm_email() and a.active and a.deleted_at is null
  order by a.created_at
  limit 1
$$;

create or replace function public.crm_role() returns text
language sql stable security definer set search_path = public as $$
  select a.role from public.accounts a where a.id = public.crm_account_id()
$$;

create or replace function public.crm_is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_role() = 'head', false)
$$;

-- карточка сотрудника, привязанная к аккаунту (у оператора обязательна)
create or replace function public.crm_op_id() returns text
language sql stable security definer set search_path = public as $$
  select a.operator_id from public.accounts a
  join public.operators o on o.id = a.operator_id
  where a.id = public.crm_account_id()
$$;

-- группа оператора
create or replace function public.crm_op_group() returns text
language sql stable security definer set search_path = public as $$
  select o.group_id from public.operators o where o.id = public.crm_op_id()
$$;

-- флаг из настроек доступа: settings.access.<supervisor|operator>.<flag>
create or replace function public.crm_flag(p_role text, p_flag text, p_default boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value -> 'access' -> p_role ->> p_flag)::boolean from public.kv where key = 'settings'), p_default)
$$;

-- сколько часов оператор может править свой лид
create or replace function public.crm_op_edit_hours() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value -> 'access' -> 'operator' ->> 'editOwnLeadsHours')::numeric from public.kv where key = 'settings'), 24)
$$;

-- группы супервайзера: из аккаунта + где он руководитель в карточке группы
create or replace function public.crm_sup_groups() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g.id), '{}')
  from public.groups g
  where g.deleted_at is null
    and public.crm_role() = 'supervisor'
    and (
      g.id = any (coalesce((select a.group_ids from public.accounts a where a.id = public.crm_account_id()), '{}'))
      or (g.supervisor_id is not null and g.supervisor_id = public.crm_op_id())
    )
$$;

-- видит весь отдел: РОП или супервайзер с «видеть все группы»
create or replace function public.crm_sees_all() returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_head()
      or (public.crm_role() = 'supervisor' and public.crm_flag('supervisor', 'seeAllGroups', false))
$$;

-- операторы, чьи данные можно менять: null — все (РОП)
create or replace function public.crm_touch_ops() returns text[]
language sql stable security definer set search_path = public as $$
  select case public.crm_role()
    when 'head' then null
    when 'supervisor' then array(
      select o.id from public.operators o
      where o.deleted_at is null and o.group_id = any (public.crm_sup_groups())
      union
      select public.crm_op_id() where public.crm_op_id() is not null
    )
    when 'operator' then array(select public.crm_op_id() where public.crm_op_id() is not null)
    else '{}'::text[]
  end
$$;

-- лид в зоне супервайзера: его оператор или его группа
create or replace function public.crm_lead_in_zone(p_operator text, p_group text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_head()
      or (public.crm_role() = 'supervisor'
          and (p_operator = any (coalesce(public.crm_touch_ops(), '{}')) or p_group = any (public.crm_sup_groups())))
$$;

-- статус лида ставит РОП и супервайзер своей зоны; свои лиды супервайзер не проверяет
create or replace function public.crm_can_review(p_operator text, p_group text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_head()
      or (public.crm_role() = 'supervisor'
          and p_operator is distinct from public.crm_op_id()
          and public.crm_lead_in_zone(p_operator, p_group))
$$;

-- ── 3. RLS ──────────────────────────────────────────────────────────────

alter table public.groups      enable row level security;
alter table public.operators   enable row level security;
alter table public.projects    enable row level security;
alter table public.leads       enable row level security;
alter table public.shifts      enable row level security;
alter table public.plans       enable row level security;
alter table public.adjustments enable row level security;
alter table public.accounts    enable row level security;
alter table public.learn       enable row level security;
alter table public.approves    enable row level security;
alter table public.candidates  enable row level security;
alter table public.audit       enable row level security;
alter table public.kv          enable row level security;

-- снять старые политики, чтобы повторный запуск не падал
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('groups', 'operators', 'projects', 'leads', 'shifts', 'plans', 'adjustments', 'accounts', 'learn', 'approves', 'candidates', 'audit', 'kv')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- группы: видит весь отдел — все; супервайзер — свои; оператор — свою. Меняет только РОП.
create policy groups_read on public.groups for select to authenticated using (
  (select public.crm_sees_all())
  or id = any ((select public.crm_sup_groups())::text[])
  or id = (select public.crm_op_group())
);
create policy groups_write on public.groups for all to authenticated
  using ((select public.crm_is_head())) with check ((select public.crm_is_head()));

-- операторы: супервайзер видит своих и тех, чья история есть в его группах; оператор — себя
create policy operators_read on public.operators for select to authenticated using (
  (select public.crm_sees_all())
  or id = any (coalesce((select public.crm_touch_ops()), '{}'))
  or (
    (select public.crm_role()) = 'supervisor'
    and (
      -- свои группы: нужно и для только что созданной карточки (upsert проверяет видимость новой строки)
      group_id = any ((select public.crm_sup_groups())::text[])
      or exists (select 1 from public.leads l where l.operator_id = operators.id and l.group_id = any ((select public.crm_sup_groups())::text[]))
      or exists (select 1 from public.shifts s where s.operator_id = operators.id and s.group_id = any ((select public.crm_sup_groups())::text[]))
    )
  )
);
create policy operators_insert on public.operators for insert to authenticated with check (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageOperators', true))
      and group_id = any ((select public.crm_sup_groups())::text[]))
);
create policy operators_update on public.operators for update to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageOperators', true))
        and (group_id = any ((select public.crm_sup_groups())::text[]) or id = (select public.crm_op_id())))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageOperators', true))
        and (group_id = any ((select public.crm_sup_groups())::text[]) or id = (select public.crm_op_id())))
  );
create policy operators_delete on public.operators for delete to authenticated using ((select public.crm_is_head()));

-- проекты: видят все (нужны в форме лида); меняет РОП или супервайзер с правом «проекты»
create policy projects_read on public.projects for select to authenticated using ((select public.crm_account_id()) is not null);
create policy projects_insert on public.projects for insert to authenticated with check (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageProjects', false)))
);
create policy projects_update on public.projects for update to authenticated
  using ((select public.crm_is_head()) or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageProjects', false))))
  with check ((select public.crm_is_head()) or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageProjects', false))));
create policy projects_delete on public.projects for delete to authenticated using ((select public.crm_is_head()));

-- лиды
create policy leads_read on public.leads for select to authenticated using (
  (select public.crm_sees_all())
  or operator_id = (select public.crm_op_id())
  or ((select public.crm_role()) = 'supervisor'
      and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
);
create policy leads_insert on public.leads for insert to authenticated with check (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'createLeads', true))
      and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  or ((select public.crm_role()) = 'operator' and (select public.crm_flag('operator', 'createOwnLeads', true))
      and operator_id = (select public.crm_op_id()))
);
-- правка: что именно можно менять (поля или только статус) — проверяет триггер leads_guard
create policy leads_update on public.leads for update to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor'
        and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
    or ((select public.crm_role()) = 'operator' and operator_id = (select public.crm_op_id())
        and (select public.crm_op_edit_hours()) > 0
        and created_at > now() - make_interval(secs => (select public.crm_op_edit_hours()) * 3600))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor'
        and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
    or ((select public.crm_role()) = 'operator' and operator_id = (select public.crm_op_id()))
  );
create policy leads_delete on public.leads for delete to authenticated using (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editLeads', true))
      and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
  or ((select public.crm_role()) = 'operator' and operator_id = (select public.crm_op_id())
      and (select public.crm_flag('operator', 'deleteOwnLeads', false))
      and (select public.crm_op_edit_hours()) > 0
      and created_at > now() - make_interval(secs => (select public.crm_op_edit_hours()) * 3600))
);

-- смены (график)
create policy shifts_read on public.shifts for select to authenticated using (
  (select public.crm_sees_all())
  or operator_id = (select public.crm_op_id())
  or ((select public.crm_role()) = 'supervisor'
      and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
);
create policy shifts_write on public.shifts for all to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editShifts', true))
        and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
    or ((select public.crm_role()) = 'operator' and (select public.crm_flag('operator', 'editOwnShifts', false))
        and operator_id = (select public.crm_op_id()))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editShifts', true))
        and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
    or ((select public.crm_role()) = 'operator' and (select public.crm_flag('operator', 'editOwnShifts', false))
        and operator_id = (select public.crm_op_id()))
  );

-- планы и условия месяца
create policy plans_read on public.plans for select to authenticated using (
  (select public.crm_sees_all())
  or (scope = 'group' and (target_id = any ((select public.crm_sup_groups())::text[]) or target_id = (select public.crm_op_group())))
  or (scope = 'operator' and (target_id = (select public.crm_op_id())
      or ((select public.crm_role()) = 'supervisor' and exists (select 1 from public.operators o where o.id = plans.target_id))))
);
create policy plans_write on public.plans for all to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editPlans', true))
        and ((scope = 'group' and target_id = any ((select public.crm_sup_groups())::text[]))
          or (scope = 'operator' and target_id = any (coalesce((select public.crm_touch_ops()), '{}')))))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editPlans', true))
        and ((scope = 'group' and target_id = any ((select public.crm_sup_groups())::text[]))
          or (scope = 'operator' and target_id = any (coalesce((select public.crm_touch_ops()), '{}')))))
  );

-- начисления: деньги — РОП, супервайзер с правом «зарплата» по своим, оператор — свои (если разрешено)
create policy adjustments_read on public.adjustments for select to authenticated using (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'viewPayroll', true))
      and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  or ((select public.crm_role()) = 'operator' and (select public.crm_flag('operator', 'viewOwnPay', true))
      and operator_id = (select public.crm_op_id()))
);
create policy adjustments_write on public.adjustments for all to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'viewPayroll', true))
        and (select public.crm_flag('supervisor', 'editPayroll', false))
        and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'viewPayroll', true))
        and (select public.crm_flag('supervisor', 'editPayroll', false))
        and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  );

-- аккаунты: РОП — все; остальные — только свой (и в нём меняют лишь имя и личные настройки — см. триггер)
create policy accounts_read on public.accounts for select to authenticated
  using ((select public.crm_is_head()) or id = (select public.crm_account_id()));
create policy accounts_insert on public.accounts for insert to authenticated with check ((select public.crm_is_head()));
create policy accounts_update on public.accounts for update to authenticated
  using ((select public.crm_is_head()) or id = (select public.crm_account_id()))
  with check ((select public.crm_is_head()) or id = (select public.crm_account_id()));
create policy accounts_delete on public.accounts for delete to authenticated using ((select public.crm_is_head()));

-- обучение: читают все вошедшие (прогресс команды), пишут свой; РОП — любой (сброс)
create policy learn_read on public.learn for select to authenticated using ((select public.crm_account_id()) is not null);
create policy learn_write on public.learn for all to authenticated
  using ((select public.crm_is_head()) or account_id = (select public.crm_account_id()))
  with check ((select public.crm_is_head()) or account_id = (select public.crm_account_id()));

-- апрув заказчика: читают РОП и супервайзеры; меняет РОП или супервайзер с правом править зарплату
create policy approves_read on public.approves for select to authenticated
  using ((select public.crm_role()) in ('head', 'supervisor'));
create policy approves_write on public.approves for all to authenticated
  using ((select public.crm_is_head()) or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editPayroll', false))))
  with check ((select public.crm_is_head()) or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'editPayroll', false))));

-- журнал: пишет каждый от своего имени (только insert, без upsert — читать его могут не все);
-- читает РОП и супервайзер с правом править зарплату
create policy audit_read on public.audit for select to authenticated using (
  (select public.crm_is_head())
  or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'viewPayroll', true))
      and (select public.crm_flag('supervisor', 'editPayroll', false)))
);
create policy audit_insert on public.audit for insert to authenticated
  with check (account_id = (select public.crm_account_id()));
create policy audit_delete on public.audit for delete to authenticated using ((select public.crm_is_head()));

-- кандидаты: РОП — все; супервайзер с правом вести операторов — только кандидаты своих групп.
-- То же правило в приложении — lib/crm/access.ts (canTouchCandidate). Операторам не видны.
create policy candidates_all on public.candidates for all to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageOperators', true))
        and group_id = any ((select public.crm_sup_groups())::text[]))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and (select public.crm_flag('supervisor', 'manageOperators', true))
        and group_id = any ((select public.crm_sup_groups())::text[]))
  );

-- настройки: читают все вошедшие, кроме секретов выгрузки; меняет РОП
create policy kv_read on public.kv for select to authenticated using (
  (select public.crm_account_id()) is not null and (key <> 'sheets' or (select public.crm_is_head()))
);
create policy kv_write on public.kv for all to authenticated
  using ((select public.crm_is_head())) with check ((select public.crm_is_head()));

-- ── права на таблицы: только вошедшим, анонимам — ничего ─────────────────
revoke all on public.groups, public.operators, public.projects, public.leads, public.shifts, public.plans,
              public.adjustments, public.accounts, public.learn, public.approves, public.candidates, public.audit, public.kv from anon;
grant select, insert, update, delete on public.groups, public.operators, public.projects, public.leads, public.shifts,
              public.plans, public.adjustments, public.accounts, public.learn, public.approves, public.candidates, public.audit, public.kv to authenticated;

-- ── 4. Защита полей ─────────────────────────────────────────────────────

-- Лиды: новый лид — «в работе» (статус при создании ставит только РОП — импорт);
-- статус меняют РОП и супервайзер своей зоны; поля лида супервайзер меняет, только если РОП разрешил.
-- security invoker: current_user — тот, кто пишет (authenticated / postgres из SQL Editor и RPC)
create or replace function public.crm_leads_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_role text := public.crm_role();
  v_status_changed boolean;
  v_fields_changed boolean;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.crm_is_head() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'work';
    new.status_reason := '';
    new.status_at := null;
    new.status_by := null;
    -- оператор время не выбирает: лид получает «сейчас» по Москве по часам сервера,
    -- а не по часам его компьютера
    if v_role = 'operator' then
      new.at := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD"T"HH24:MI');
    end if;
    return new;
  end if;

  -- время передачи оператор при правке не меняет
  if v_role = 'operator' then
    new.at := old.at;
  end if;

  v_status_changed := (new.status, new.status_reason, new.status_at, new.status_by)
                      is distinct from (old.status, old.status_reason, old.status_at, old.status_by);
  v_fields_changed := (new.at, new.client, new.phone, new.project_id, new.operator_id, new.group_id, new.direction, new.link, new.comment, new.source, new.created_at)
                      is distinct from (old.at, old.client, old.phone, old.project_id, old.operator_id, old.group_id, old.direction, old.link, old.comment, old.source, old.created_at);

  if v_status_changed and not public.crm_can_review(old.operator_id, old.group_id) then
    raise exception 'Статус этого лида может поставить только супервайзер его группы или руководитель' using errcode = '42501';
  end if;
  if v_fields_changed and v_role = 'supervisor' and not public.crm_flag('supervisor', 'editLeads', true) then
    raise exception 'Править лиды супервайзерам запрещено в настройках доступа' using errcode = '42501';
  end if;
  return new;
end $$;

-- Время лида ставит только сервер (по Москве), при правке не меняется. То же — в 20260926000003_lead_time_server.sql.
create or replace function public.crm_leads_at_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- upsert уже существующего лида (INSERT … ON CONFLICT) — время решает ветка UPDATE
    if not exists (select 1 from public.leads where id = new.id)
       and coalesce(new.created_at, now()) > now() - interval '1 day' then
      new.at := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD"T"HH24:MI');
    end if;
    return new;
  end if;

  new.at := old.at;
  return new;
end $$;

-- имя раньше leads_guard по алфавиту: время выставлено до остальных проверок
drop trigger if exists leads_at_guard on public.leads;
create trigger leads_at_guard before insert or update on public.leads
  for each row execute function public.crm_leads_at_guard();

drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before insert or update on public.leads
  for each row execute function public.crm_leads_guard();

-- Ссылка на лид: новый лид без неё не сохраняется (история до 2026-09-25 — пропускается),
-- непустую ссылку нельзя заменить пустой. То же — в 20260926000001_lead_link_required.sql.
create or replace function public.crm_leads_link_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- служебные роли (восстановление копии crm_replace_all, SQL Editor) — без проверки:
  -- копия должна подниматься целиком, как есть
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- upsert уже существующего лида (INSERT … ON CONFLICT) сначала проходит здесь: его
    -- пропускаем — ветка UPDATE ниже сохранит ссылку, если клиент прислал строку без неё
    if btrim(coalesce(new.link, '')) = '' and coalesce(new.at, '') >= '2026-09-25'
       and not exists (select 1 from public.leads where id = new.id) then
      raise exception 'Лид без ссылки не сохраняется — вставьте ссылку на лид (обновите приложение, если поля для ссылки нет)'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- правка: пустая ссылка вместо непустой — это устаревшая копия, а не намерение
  if btrim(coalesce(new.link, '')) = '' and btrim(coalesce(old.link, '')) <> '' then
    new.link := old.link;
  end if;
  return new;
end $$;

-- имя после leads_guard: триггеры BEFORE идут по алфавиту, время лида к этому моменту уже выставлено
drop trigger if exists leads_link_guard on public.leads;
create trigger leads_link_guard before insert or update on public.leads
  for each row execute function public.crm_leads_link_guard();

-- Аккаунты: не-РОП в своём аккаунте меняет только имя, личные настройки и время входа.
create or replace function public.crm_accounts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.crm_is_head() then
    return new;
  end if;
  if (new.id, new.login, new.role, new.operator_id, new.group_ids, new.active, new.deleted_at, new.created_at)
     is distinct from (old.id, old.login, old.role, old.operator_id, old.group_ids, old.active, old.deleted_at, old.created_at) then
    raise exception 'Роль, почту и привязки аккаунта меняет только руководитель' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists accounts_guard on public.accounts;
create trigger accounts_guard before update on public.accounts
  for each row execute function public.crm_accounts_guard();

-- ── 5. RPC ──────────────────────────────────────────────────────────────

-- Первый вход в пустую базу: вошедший становится РОПом. Если РОП уже есть — ничего не делает.
-- Возвращает id аккаунта вошедшего (или null, если его почты нет в CRM).
create or replace function public.crm_bootstrap(p_name text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.crm_email();
  v_id text;
begin
  if v_email = '' then
    raise exception 'Нет сессии' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm_bootstrap'));
  select id into v_id from public.accounts
    where login <> '' and lower(login) = v_email and active and deleted_at is null
    order by created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  if exists (select 1 from public.accounts where role = 'head' and login <> '' and active and deleted_at is null) then
    return null;
  end if;
  v_id := 'acc_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.accounts (id, name, login, role, operator_id, group_ids, active, prefs, created_at, updated_at, last_seen_at)
  values (v_id, coalesce(nullif(btrim(p_name), ''), split_part(v_email, '@', 1)), v_email, 'head', null, '{}', true, '{}'::jsonb, now(), now(), now());
  return v_id;
end $$;

-- Полная замена данных (импорт из файла, восстановление копии, очистка) — одной транзакцией.
-- Только РОП. Аккаунт вызывающего сохраняется и остаётся РОПом — иначе можно запереть себя снаружи.
-- p: { "operators": [...], "groups": [...], ..., "settings": {...}, "sheets": {...}, "frozenMonths": [...] }
create or replace function public.crm_replace_all(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public.crm_email();
  v_me public.accounts;
begin
  if not public.crm_is_head() then
    raise exception 'Заменить все данные может только руководитель' using errcode = '42501';
  end if;
  select * into v_me from public.accounts where id = public.crm_account_id();

  delete from public.audit;
  delete from public.candidates;
  delete from public.learn;
  delete from public.approves;
  delete from public.adjustments;
  delete from public.plans;
  delete from public.shifts;
  delete from public.leads;
  delete from public.accounts;
  update public.groups set supervisor_id = null;
  delete from public.operators;
  delete from public.groups;
  delete from public.projects;

  insert into public.groups      select * from jsonb_populate_recordset(null::public.groups,      coalesce(p -> 'groups', '[]'));
  insert into public.projects    select * from jsonb_populate_recordset(null::public.projects,    coalesce(p -> 'projects', '[]'));
  insert into public.operators   select * from jsonb_populate_recordset(null::public.operators,   coalesce(p -> 'operators', '[]'));
  insert into public.accounts    select * from jsonb_populate_recordset(null::public.accounts,    coalesce(p -> 'accounts', '[]'));
  insert into public.leads       select * from jsonb_populate_recordset(null::public.leads,       coalesce(p -> 'leads', '[]'));
  insert into public.shifts      select * from jsonb_populate_recordset(null::public.shifts,      coalesce(p -> 'shifts', '[]'));
  insert into public.plans       select * from jsonb_populate_recordset(null::public.plans,       coalesce(p -> 'plans', '[]'));
  insert into public.adjustments select * from jsonb_populate_recordset(null::public.adjustments, coalesce(p -> 'adjustments', '[]'));
  insert into public.learn       select * from jsonb_populate_recordset(null::public.learn,       coalesce(p -> 'learn', '[]'));
  insert into public.approves    select * from jsonb_populate_recordset(null::public.approves,    coalesce(p -> 'approves', '[]'));
  insert into public.candidates  select * from jsonb_populate_recordset(null::public.candidates,  coalesce(p -> 'candidates', '[]'));
  insert into public.audit       select * from jsonb_populate_recordset(null::public.audit,       coalesce(p -> 'audit', '[]'));

  -- свой аккаунт: если в данных его нет — возвращаем; в любом случае остаёмся РОПом
  if v_me.id is not null then
    if not exists (select 1 from public.accounts where login <> '' and lower(login) = v_email and deleted_at is null) then
      delete from public.accounts where id = v_me.id;
      insert into public.accounts values (v_me.*);
    end if;
    update public.accounts set role = 'head', active = true, deleted_at = null
      where login <> '' and lower(login) = v_email and deleted_at is null;
  end if;

  if p ? 'settings' then
    insert into public.kv (key, value, updated_at) values ('settings', p -> 'settings', now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p ? 'sheets' then
    insert into public.kv (key, value, updated_at) values ('sheets', p -> 'sheets', now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  insert into public.kv (key, value, updated_at) values ('frozenMonths', coalesce(p -> 'frozenMonths', '[]'), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function public.crm_bootstrap(text), public.crm_replace_all(jsonb) from public, anon;
grant execute on function public.crm_bootstrap(text), public.crm_replace_all(jsonb) to authenticated;
grant execute on function public.crm_email(), public.crm_account_id(), public.crm_role(), public.crm_is_head(),
  public.crm_op_id(), public.crm_op_group(), public.crm_flag(text, text, boolean), public.crm_op_edit_hours(),
  public.crm_sup_groups(), public.crm_sees_all(), public.crm_touch_ops(), public.crm_lead_in_zone(text, text),
  public.crm_can_review(text, text) to authenticated;

-- ── 6. Realtime: изменения прилетают в открытые CRM сразу (права RLS соблюдаются) ──
do $$
declare t text;
begin
  foreach t in array array['groups', 'operators', 'projects', 'leads', 'shifts', 'plans', 'adjustments', 'accounts', 'learn', 'approves', 'candidates', 'audit', 'kv'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- уже добавлена
      when undefined_object then null;  -- нет публикации (не Supabase)
    end;
  end loop;
end $$;
