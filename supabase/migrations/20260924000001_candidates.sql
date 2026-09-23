-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — раздел «Найм»: таблица кандидатов
--
--  Для базы, где схема 20260921000001_crm_schema.sql уже стоит. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Почему отдельным файлом: повторный запуск всей схемы пересоздаёт политики на всех
--  таблицах, и при открытой CRM (запросы, realtime) Postgres ловит deadlock — два процесса
--  ждут блокировок друг друга. Здесь трогается только новая таблица candidates и функция
--  импорта crm_replace_all; таблицы, с которыми работают открытые CRM, не блокируются.
--
--  То же самое уже есть в основной схеме — на новом проекте этот файл не нужен.
-- ════════════════════════════════════════════════════════════════════════

-- долго ждать чужую блокировку не будем: лучше понятная ошибка, чем зависший запрос
set local lock_timeout = '10s';

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

create index if not exists candidates_group_idx on public.candidates (group_id);

alter table public.candidates enable row level security;
drop policy if exists candidates_all on public.candidates;
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

revoke all on public.candidates from anon;
grant select, insert, update, delete on public.candidates to authenticated;

-- импорт и восстановление копии: кандидаты заменяются вместе с остальными данными
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

revoke all on function public.crm_replace_all(jsonb) from public, anon;
grant execute on function public.crm_replace_all(jsonb) to authenticated;

-- realtime: новые и изменённые кандидаты сразу видны в открытых CRM
do $$
begin
  execute 'alter publication supabase_realtime add table public.candidates';
exception
  when duplicate_object then null;  -- уже добавлена
  when undefined_object then null;  -- нет публикации (не Supabase)
end $$;
