-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — супервайзер заводит аккаунты операторам своих групп
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Нужна применённая 20261001000001_team_learning.sql (функция crm_team_op_ids).
--  Потом: Edge Functions → crm-users → вставить свежий functions/crm-users/index.ts → Deploy
--  (без этого супервайзер создаст аккаунт, но пароль для входа задать не сможет).
--
--  Право — «Настройки → Роли и доступ → Супервайзер → Создаёт аккаунты операторам»
--  (settings.access.supervisor.opAccounts, по умолчанию включено). Что можно:
--    — аккаунт с ролью «оператор», привязанный к карточке оператора из своих групп (не к своей);
--    — создать, сменить почту, пароль, имя, включить/выключить, удалить такой аккаунт.
--  Чего нельзя: аккаунты РОПа и супервайзеров, роль кроме «оператор», группы под управлением,
--  перепривязать аккаунт к карточке не из своих групп. То же правило в приложении —
--  lib/crm/access.ts (canManageAccount).
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- аккаунт (роль и карточка) может вести вошедший: РОП — любой; супервайзер с правом — оператора своих групп
create or replace function public.crm_can_manage_account(p_role text, p_operator_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_head()
      or (public.crm_role() = 'supervisor'
          and public.crm_flag('supervisor', 'opAccounts', true)
          and p_role = 'operator'
          and p_operator_id is not null
          and p_operator_id is distinct from public.crm_op_id()
          and p_operator_id = any (coalesce(public.crm_touch_ops(), '{}'::text[]))
          and not exists (select 1 from public.operators o where o.id = p_operator_id and o.role = 'supervisor'))
$$;

-- задать пароль для почты может: РОП — любой; супервайзер — только почте живого аккаунта своего оператора,
-- и только если эта почта никогда не была у аккаунта РОПа или супервайзера (иначе можно перехватить чужой вход)
create or replace function public.crm_can_set_login(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_head()
      or (exists (select 1 from public.accounts a
                   where lower(a.login) = lower(btrim(p_email)) and a.login <> '' and a.deleted_at is null
                     and public.crm_can_manage_account(a.role, a.operator_id))
          and not exists (select 1 from public.accounts a
                           where lower(a.login) = lower(btrim(p_email)) and a.login <> '' and a.role <> 'operator'))
$$;

revoke all on function public.crm_can_manage_account(text, text), public.crm_can_set_login(text) from public, anon;
grant execute on function public.crm_can_manage_account(text, text), public.crm_can_set_login(text) to authenticated;

-- ── права на строки аккаунтов ──────────────────────────────────────────
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (
  (select public.crm_is_head())
  or id = (select public.crm_account_id())
  or public.crm_can_manage_account(role, operator_id)
  -- «Обучение команды»: руководитель видит аккаунты операторов своей зоны (20261001000001_team_learning.sql)
  or (role = 'operator' and operator_id is not null and operator_id = any (coalesce((select public.crm_team_op_ids()), '{}'::text[])))
);

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select public.crm_is_head()) or (public.crm_can_manage_account(role, operator_id) and group_ids = '{}'));

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts for update to authenticated
  using ((select public.crm_is_head()) or id = (select public.crm_account_id()) or public.crm_can_manage_account(role, operator_id))
  with check ((select public.crm_is_head()) or id = (select public.crm_account_id()) or public.crm_can_manage_account(role, operator_id));

drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts for delete to authenticated using (public.crm_can_manage_account(role, operator_id));

-- ── защита полей ───────────────────────────────────────────────────────
-- свой аккаунт (не РОП): только имя, личные настройки и время входа;
-- аккаунт своего оператора (супервайзер): всё, кроме роли и групп под управлением, и карточка — только из своих групп
create or replace function public.crm_accounts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.crm_is_head() then
    return new;
  end if;
  if old.id is not distinct from public.crm_account_id() then
    if (new.id, new.login, new.role, new.operator_id, new.group_ids, new.active, new.deleted_at, new.created_at)
       is distinct from (old.id, old.login, old.role, old.operator_id, old.group_ids, old.active, old.deleted_at, old.created_at) then
      raise exception 'Роль, почту и привязки аккаунта меняет только руководитель' using errcode = '42501';
    end if;
    return new;
  end if;
  if not (public.crm_can_manage_account(old.role, old.operator_id) and public.crm_can_manage_account(new.role, new.operator_id))
     or new.group_ids <> '{}' or new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'Супервайзер ведёт только аккаунты операторов своих групп' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists accounts_guard on public.accounts;
create trigger accounts_guard before update on public.accounts
  for each row execute function public.crm_accounts_guard();
