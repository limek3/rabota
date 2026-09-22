-- Точечный фикс: у search_sources включён RLS, но не было политики → вставки
-- запрещались, из-за чего падал сид. Выполнить один раз в SQL Editor.

create policy ss_all on search_sources for all to authenticated
  using (exists (select 1 from searches s where s.id = search_id and is_member(s.workspace_id)))
  with check (exists (select 1 from searches s where s.id = search_id and is_member(s.workspace_id)));
