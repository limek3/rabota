-- ═══════════════════════════════════════════════════════════════════════
-- CRM ownership model (deals + linked records)
--
-- Руководитель (workspace_members.role = 'owner') видит и ведёт все сделки
-- воркспейса. Сотрудник (role = 'member') видит и меняет только те сделки,
-- где он ответственный (candidates.assignee = auth.uid()), а также связанные
-- с ними задачи/события/активность.
--
-- Передать сделку может только текущий ответственный (или руководитель):
-- `using` пускает к строке лишь владельца сделки/руководителя, а `with check`
-- на UPDATE не ограничивает нового assignee — поэтому ответственный может
-- отдать сделку кому угодно, но «забрать» чужую сделку посторонний не может.
--
-- Это серверный слой прав (RLS). В приложении есть зеркальный клиентский слой
-- (store: visibleCandidates / canManageDeal), но именно RLS — источник правды.
-- Применить к базе: выполнить этот файл в Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

-- helper: видна ли сделка текущему пользователю (свой — или он руководитель)
create or replace function owns_candidate(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from candidates c
     where c.id = cid
       and (is_owner(c.workspace_id) or c.assignee = auth.uid())
  );
$$;

-- ── candidates (сделки) ────────────────────────────────────────────────
drop policy if exists cands_all    on candidates;
drop policy if exists cands_select on candidates;
drop policy if exists cands_insert on candidates;
drop policy if exists cands_update on candidates;
drop policy if exists cands_delete on candidates;

create policy cands_select on candidates for select to authenticated
  using (is_member(workspace_id) and (is_owner(workspace_id) or assignee = auth.uid()));

create policy cands_insert on candidates for insert to authenticated
  with check (is_member(workspace_id) and (is_owner(workspace_id) or assignee = auth.uid()));

-- using = кого пускаем к строке (только ответственный/руководитель);
-- with check = какие новые значения ок (любой assignee → разрешаем передачу).
create policy cands_update on candidates for update to authenticated
  using (is_member(workspace_id) and (is_owner(workspace_id) or assignee = auth.uid()))
  with check (is_member(workspace_id));

create policy cands_delete on candidates for delete to authenticated
  using (is_member(workspace_id) and (is_owner(workspace_id) or assignee = auth.uid()));

-- ── candidate_activity ─────────────────────────────────────────────────
drop policy if exists cact_all on candidate_activity;
create policy cact_all on candidate_activity for all to authenticated
  using (is_member(workspace_id) and owns_candidate(candidate_id))
  with check (is_member(workspace_id) and owns_candidate(candidate_id));

-- ── candidate_comments ─────────────────────────────────────────────────
drop policy if exists ccom_all on candidate_comments;
create policy ccom_all on candidate_comments for all to authenticated
  using (is_member(workspace_id) and owns_candidate(candidate_id))
  with check (is_member(workspace_id) and owns_candidate(candidate_id) and author_id = auth.uid());

-- ── crm_events (свои события + события своих сделок) ────────────────────
drop policy if exists cev_all on crm_events;
create policy cev_all on crm_events for all to authenticated
  using (
    is_member(workspace_id)
    and (is_owner(workspace_id) or assignee = auth.uid() or (candidate_id is not null and owns_candidate(candidate_id)))
  )
  with check (is_member(workspace_id));

-- ── crm_tasks (свои задачи + задачи своих сделок) ──────────────────────
drop policy if exists ctask_all on crm_tasks;
create policy ctask_all on crm_tasks for all to authenticated
  using (
    is_member(workspace_id)
    and (is_owner(workspace_id) or assignee = auth.uid() or (candidate_id is not null and owns_candidate(candidate_id)))
  )
  with check (is_member(workspace_id));
