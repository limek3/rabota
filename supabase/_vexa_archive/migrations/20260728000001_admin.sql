-- ============================================================================
-- Админ-панель разработчика (superadmin).
--
-- Клиент — статический экспорт с anon-ключом, поэтому вся власть живёт здесь:
-- таблица platform_admins недоступна клиентам вообще (RLS без политик), а все
-- админ-операции идут через SECURITY DEFINER RPC, где первая строка — проверка
-- is_superadmin(). Флаг isSuperAdmin в UI — только косметика (показать пункт
-- меню), защитой он не является.
-- ============================================================================

-- ─────────────────────────── platform_admins ───────────────────────────
-- Кто разработчик. RLS включён, политик нет: клиент не может ни прочитать,
-- ни узнать о существовании таблицы. Definer-функции RLS обходят.

create table platform_admins (
  user_id    uuid        primary key references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

create or replace function is_superadmin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from platform_admins where user_id = auth.uid()
  );
$$;

-- ─────────────────────────── workspaces: флаги ───────────────────────────
-- features: отсутствие ключа = включено; храним только {key: false}.
-- Ключи (см. lib/features.ts): parser, chat, analytics, sheetsSync,
-- addonsStore, resumeParsing.
-- suspended: полная блокировка воркспейса (экран «приостановлен»).

alter table workspaces
  add column if not exists features  jsonb   not null default '{}'::jsonb,
  add column if not exists suspended boolean not null default false;

-- Члены воркспейса видят features/suspended через существующий ws_read — это
-- не секрет, а команда приложению, что скрывать. Писать эти колонки клиент
-- напрямую не может: ws_update требует is_owner, а owner'у мы их менять
-- не даём триггером ниже (иначе владелец снимет себе блокировку).

create or replace function guard_admin_columns()
returns trigger language plpgsql as $$
begin
  if (new.features is distinct from old.features
      or new.suspended is distinct from old.suspended)
     and not is_superadmin() then
    raise exception 'features/suspended can only be changed by platform admin'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger t_guard_admin_columns
  before update of features, suspended on workspaces
  for each row execute function guard_admin_columns();

-- ─────────────────────────── realtime ───────────────────────────
-- Стор подписывается на UPDATE своего воркспейса: выключенная фича или
-- suspend прилетают юзерам без refresh. Чужие строки отсекает RLS (ws_read).
-- Guard: alter publication не умеет if not exists.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspaces'
  ) then
    alter publication supabase_realtime add table workspaces;
  end if;
end $$;

-- ─────────────────────────── RPC: список воркспейсов ───────────────────────────

create or replace function admin_list_workspaces()
returns table (
  id          uuid,
  name        text,
  plan        plan_id,
  suspended   boolean,
  features    jsonb,
  owner_email text,
  members     integer,
  candidates  integer,
  matches     integer,
  sources     integer,
  searches    integer,
  created_at  timestamptz
) language plpgsql security definer stable set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  return query
  select
    w.id, w.name, w.plan, w.suspended, w.features,
    p.email,
    (select count(*)::int from workspace_members m where m.workspace_id = w.id),
    (select count(*)::int from candidates        c where c.workspace_id = w.id),
    (select count(*)::int from matches           mt where mt.workspace_id = w.id),
    (select count(*)::int from sources           s where s.workspace_id = w.id),
    (select count(*)::int from searches          q where q.workspace_id = w.id),
    w.created_at
  from workspaces w
  left join profiles p on p.id = w.owner_id
  order by w.created_at desc;
end $$;

-- ─────────────────────────── RPC: правка воркспейса ───────────────────────────
-- coalesce-patch: null = не трогать. Смена тарифа не подрезает уже созданные
-- сверх лимита строки — триггеры лимитов работают только на insert; это ок.

create or replace function admin_update_workspace(
  p_ws        uuid,
  p_features  jsonb   default null,
  p_suspended boolean default null,
  p_plan      plan_id default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  update workspaces set
    features   = coalesce(p_features,  features),
    suspended  = coalesce(p_suspended, suspended),
    plan       = coalesce(p_plan,      plan),
    updated_at = now()
  where workspaces.id = p_ws;
  if not found then
    raise exception 'workspace not found';
  end if;
end $$;

-- ─────────────────────────── seed ───────────────────────────
-- Толерантно к свежей БД: профиля ещё нет → 0 строк, без ошибки.
-- Тогда после первой регистрации выполнить этот insert руками.

insert into platform_admins (user_id)
select id from profiles where email = 'b.o.trofimovich@gmail.com'
on conflict (user_id) do nothing;
