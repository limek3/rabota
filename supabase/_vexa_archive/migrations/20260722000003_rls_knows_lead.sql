-- Роль «руководитель» доходит до RLS.
--
-- Баг. Миграция 20260716000005 завела роль 'lead' и описала её как «видит и
-- ведёт любые сделки», но политики так и остались на is_owner(), а это строго
-- role = 'owner'. Клиент при этом считает isManager = owner || lead и рисует
-- руководителю всю базу.
--
-- Получилось расхождение, которое в демо не видно вовсе, а в live выглядит
-- как пропажа данных: интерфейс обещает «все сделки команды», сервер отдаёт
-- только те, где lead сам ответственный. Причём молча — RLS не возвращает
-- ошибку, он возвращает меньше строк.
--
-- is_manager() уже заведён в 20260722000002 под удаление; здесь распространяем
-- его на чтение и правку. owns_candidate переписываем следом — через него
-- ходят активность, комментарии, задачи и события.

-- Видна ли сделка: своя — или смотрящий руководитель.
create or replace function owns_candidate(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from candidates c
     where c.id = cid
       and (is_manager(c.workspace_id) or c.assignee = auth.uid())
  );
$$;

-- ── candidates ─────────────────────────────────────────────────────────
drop policy if exists cands_select on candidates;
drop policy if exists cands_insert on candidates;
drop policy if exists cands_update on candidates;

create policy cands_select on candidates for select to authenticated
  using (is_member(workspace_id) and (is_manager(workspace_id) or assignee = auth.uid()));

create policy cands_insert on candidates for insert to authenticated
  with check (is_member(workspace_id) and (is_manager(workspace_id) or assignee = auth.uid()));

-- using = к каким строкам пускаем; with check = во что их можно превратить.
-- Второе намеренно шире: ответственный вправе передать сделку кому угодно.
create policy cands_update on candidates for update to authenticated
  using (is_member(workspace_id) and (is_manager(workspace_id) or assignee = auth.uid()))
  with check (is_member(workspace_id));

-- ── crm_events / crm_tasks ─────────────────────────────────────────────
drop policy if exists cev_all on crm_events;
create policy cev_all on crm_events for all to authenticated
  using (
    is_member(workspace_id)
    and (is_manager(workspace_id) or assignee = auth.uid() or (candidate_id is not null and owns_candidate(candidate_id)))
  )
  with check (is_member(workspace_id));

drop policy if exists ctask_all on crm_tasks;
create policy ctask_all on crm_tasks for all to authenticated
  using (
    is_member(workspace_id)
    and (is_manager(workspace_id) or assignee = auth.uid() or (candidate_id is not null and owns_candidate(candidate_id)))
  )
  with check (is_member(workspace_id));
