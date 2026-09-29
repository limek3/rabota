-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — наставник (старший оператор)
--
--  Для базы, где схема 20260921000001_crm_schema.sql и заметки 20260927000001_op_notes.sql
--  уже стоят. Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Наставник — аккаунт с ролью «оператор», у которого в карточке сотрудника роль
--  «старший оператор» (operators.role = 'senior') и есть группа. Он видит свою группу
--  целиком: операторов, их лиды, смены и планы, заметки СВ — и сам пишет заметки о её
--  операторах. Менять чужие лиды, смены, планы и карточки не может; деньги группы
--  (начисления) ему не видны — политика adjustments не меняется, оператору там только своё.
--  То же правило в приложении — lib/crm/access.ts (isMentor, canNote, canSeePay).
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- группа наставника: null — вошедший не наставник
create or replace function public.crm_mentor_group() returns text
language sql stable security definer set search_path = public as $$
  select o.group_id from public.operators o
  where o.id = public.crm_op_id()
    and o.role = 'senior'
    and o.deleted_at is null
    and o.group_id is not null
    and public.crm_role() = 'operator'
$$;

-- операторы группы наставника. security definer — читает таблицу в обход RLS: политика
-- operators_read сама смотрит в leads и shifts, и если их политики полезут в operators
-- напрямую, Postgres поймает бесконечную рекурсию политик
create or replace function public.crm_mentor_ops() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(o.id), '{}')
  from public.operators o
  where public.crm_mentor_group() is not null
    and o.group_id = public.crm_mentor_group()
$$;

revoke all on function public.crm_mentor_group(), public.crm_mentor_ops() from public, anon;
grant execute on function public.crm_mentor_group(), public.crm_mentor_ops() to authenticated;

-- операторы: + вся группа наставника и те, чья история есть в ней
drop policy if exists operators_read on public.operators;
create policy operators_read on public.operators for select to authenticated using (
  (select public.crm_sees_all())
  or id = any (coalesce((select public.crm_touch_ops()), '{}'))
  or (
    (select public.crm_role()) = 'supervisor'
    and (
      group_id = any ((select public.crm_sup_groups())::text[])
      or exists (select 1 from public.leads l where l.operator_id = operators.id and l.group_id = any ((select public.crm_sup_groups())::text[]))
      or exists (select 1 from public.shifts s where s.operator_id = operators.id and s.group_id = any ((select public.crm_sup_groups())::text[]))
    )
  )
  or (
    (select public.crm_mentor_group()) is not null
    and (
      group_id = (select public.crm_mentor_group())
      or exists (select 1 from public.leads l where l.operator_id = operators.id and l.group_id = (select public.crm_mentor_group()))
      or exists (select 1 from public.shifts s where s.operator_id = operators.id and s.group_id = (select public.crm_mentor_group()))
    )
  )
);

-- лиды: + лиды группы наставника (только чтение — insert/update/delete не меняются)
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated using (
  (select public.crm_sees_all())
  or operator_id = (select public.crm_op_id())
  or ((select public.crm_role()) = 'supervisor'
      and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
  or ((select public.crm_mentor_group()) is not null
      and (group_id = (select public.crm_mentor_group()) or operator_id = any ((select public.crm_mentor_ops())::text[])))
);

-- смены (график): + смены группы наставника (только чтение)
drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts for select to authenticated using (
  (select public.crm_sees_all())
  or operator_id = (select public.crm_op_id())
  or ((select public.crm_role()) = 'supervisor'
      and (operator_id = any (coalesce((select public.crm_touch_ops()), '{}')) or group_id = any ((select public.crm_sup_groups())::text[])))
  or ((select public.crm_mentor_group()) is not null
      and (group_id = (select public.crm_mentor_group()) or operator_id = any ((select public.crm_mentor_ops())::text[])))
);

-- планы: + личные планы операторов группы наставника (план группы оператор и так видит)
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (
  (select public.crm_sees_all())
  or (scope = 'group' and (target_id = any ((select public.crm_sup_groups())::text[]) or target_id = (select public.crm_op_group())))
  or (scope = 'operator' and (target_id = (select public.crm_op_id())
      or ((select public.crm_role()) = 'supervisor' and exists (select 1 from public.operators o where o.id = plans.target_id))
      or target_id = any ((select public.crm_mentor_ops())::text[])))
);

-- заметки: наставник читает заметки об операторах своей группы (кроме заметок о себе),
-- пишет новые о них, правит и удаляет только свои. Политика РОП/СВ (notes_all) не меняется.
drop policy if exists notes_mentor_read on public.notes;
create policy notes_mentor_read on public.notes for select to authenticated using (
  operator_id <> coalesce((select public.crm_op_id()), '')
  and operator_id = any ((select public.crm_mentor_ops())::text[])
);
drop policy if exists notes_mentor_insert on public.notes;
create policy notes_mentor_insert on public.notes for insert to authenticated with check (
  author_id = (select public.crm_account_id())
  and operator_id <> coalesce((select public.crm_op_id()), '')
  and operator_id = any ((select public.crm_mentor_ops())::text[])
);
drop policy if exists notes_mentor_update on public.notes;
create policy notes_mentor_update on public.notes for update to authenticated
  using ((select public.crm_mentor_group()) is not null and author_id = (select public.crm_account_id()))
  with check (
    author_id = (select public.crm_account_id())
    and operator_id <> coalesce((select public.crm_op_id()), '')
    and operator_id = any ((select public.crm_mentor_ops())::text[])
  );
drop policy if exists notes_mentor_delete on public.notes;
create policy notes_mentor_delete on public.notes for delete to authenticated
  using ((select public.crm_mentor_group()) is not null and author_id = (select public.crm_account_id()));
