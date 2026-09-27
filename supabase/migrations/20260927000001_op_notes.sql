-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — заметки супервайзера об операторе
--
--  Для базы, где схема 20260921000001_crm_schema.sql уже стоит. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Заметка — «о чём поговорил с оператором и за чем следить» (лиды в час, часы или лиды
--  за смену). CRM сама сравнивает показатель до и после дня заметки. Видят и пишут РОП
--  и супервайзер — только по своим операторам (crm_touch_ops). Операторам не видны.
--
--  Как и в 20260924000001_candidates.sql, трогаем только новую таблицу и функцию импорта:
--  повторный запуск всей схемы при открытых CRM ловит deadlock.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.notes (
  id          text primary key,
  -- без внешнего ключа: импорт (crm_replace_all) пересоздаёт операторов, заметки должны пережить это
  operator_id text not null,
  date        text not null default '',
  text        text not null default '',
  metric      text not null default 'lph' check (metric in ('lph', 'hours', 'leads')),
  author_id   text not null default '',
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists notes_operator_idx on public.notes (operator_id, date);

alter table public.notes enable row level security;
drop policy if exists notes_all on public.notes;
-- РОП — все; супервайзер — заметки об операторах своих групп. То же правило в приложении —
-- lib/crm/access.ts (canTouchOp).
create policy notes_all on public.notes for all to authenticated
  using (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  )
  with check (
    (select public.crm_is_head())
    or ((select public.crm_role()) = 'supervisor' and operator_id = any (coalesce((select public.crm_touch_ops()), '{}')))
  );

revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;

-- импорт и восстановление копии: заметки заменяются вместе с остальными данными
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
  delete from public.notes;
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
  insert into public.notes       select * from jsonb_populate_recordset(null::public.notes,       coalesce(p -> 'notes', '[]'));
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

-- realtime: заметки коллег сразу видны в открытых CRM
do $$
begin
  execute 'alter publication supabase_realtime add table public.notes';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
