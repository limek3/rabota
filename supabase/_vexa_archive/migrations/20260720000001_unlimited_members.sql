-- ============================================================================
-- Команда без потолка + руководитель заводит сотрудников
-- ----------------------------------------------------------------------------
-- Раньше состав команды упирался в тариф: триггер t_seat_limit считал
-- plan.seats + extra_seats и не давал добавить сверх. Плюс завести участника
-- (insert в workspace_members) мог только владелец.
--
-- Теперь:
--   • лимита на число участников нет вовсе (тариф больше не про места);
--   • сотрудников заводит и убирает и владелец, и руководитель (lead);
--   • раздача ролей по-прежнему только у владельца (см. wm_update в role_lead).
--
-- Тарифы НЕ трогаем на уровне данных — их прячем только в UI. Триггеры лимитов
-- на поиски/источники тоже остаются: речь была только про людей.
-- ============================================================================

-- 1. Снять лимит мест ---------------------------------------------------------
-- service_role (Edge Function) обходит RLS, но НЕ триггеры — поэтому без дропа
-- триггера заведение сотрудника всё равно упиралось бы в потолок.
drop trigger  if exists t_seat_limit on workspace_members;
drop function if exists enforce_seat_limit();

-- 2. Руководитель = менеджер состава ------------------------------------------
-- SECURITY DEFINER, как is_owner/is_member: политика на workspace_members сама
-- читает workspace_members, иначе рекурсия RLS.
create or replace function is_manager(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'lead')
  );
$$;

-- Завести участника: владелец или руководитель, но не второго владельца.
drop policy if exists wm_write on workspace_members;
create policy wm_write on workspace_members for insert to authenticated
  with check (is_manager(workspace_id) and role <> 'owner');

-- Убрать участника: владелец или руководитель, кроме строки владельца.
drop policy if exists wm_delete on workspace_members;
create policy wm_delete on workspace_members for delete to authenticated
  using (is_manager(workspace_id) and role <> 'owner');
