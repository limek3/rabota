-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — перевод стажёра в операторы супервайзером
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  У стажёра стартовая страница аккаунта — «/learn». При переводе в операторы её надо
--  сменить на «/me», но чужие аккаунты меняет только РОП (политика accounts_update и
--  триггер accounts_guard). Эта функция даёт супервайзеру с правом «управлять операторами»
--  сменить именно стартовую, и только у операторов своих групп. Остальное в аккаунте
--  (роль, почта, привязки) по-прежнему меняет только РОП.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create or replace function public.crm_trainee_home(p_operator_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (
    public.crm_is_head()
    or (public.crm_role() = 'supervisor'
        and public.crm_flag('supervisor', 'manageOperators', true)
        and p_operator_id = any (coalesce(public.crm_touch_ops(), '{}'::text[])))
  ) then
    raise exception 'Нет прав на этого сотрудника' using errcode = '42501';
  end if;
  update public.accounts
     set prefs = jsonb_set(prefs, '{homePage}', '"/me"'), updated_at = now()
   where operator_id = p_operator_id
     and role = 'operator'
     and deleted_at is null
     and prefs ->> 'homePage' = '/learn';
end
$$;

revoke all on function public.crm_trainee_home(text) from public, anon;
grant execute on function public.crm_trainee_home(text) to authenticated;
