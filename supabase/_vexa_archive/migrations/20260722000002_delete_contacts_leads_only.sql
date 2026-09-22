-- Удалять контакты вправе только руководители.
--
-- Заводить контакт может любой сотрудник: это наполнение базы, и трение там
-- вредит. Удаление — другая история: оно необратимо для всех, кроме того, кто
-- нажал, и сотрудник, стирая «свой» контакт, стирает его из базы команды.
--
-- До сих пор политика cands_delete (20260715000001) пускала к удалению
-- ответственного за сделку. Клиентский запрет без этой правки не значил бы
-- ничего: запрос в БД уходит напрямую, и заблокировать его может только RLS.
create or replace function is_manager(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'lead')
  );
$$;

drop policy if exists cands_delete on candidates;

create policy cands_delete on candidates for delete to authenticated
  using (is_member(workspace_id) and is_manager(workspace_id));
