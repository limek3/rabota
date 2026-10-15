-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — Vexi: у каждой команды свой Telegram-чат
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Нужна применённая 20260923000001_telegram_link.sql.
--
--  Бот теперь подключается к чату каждой команды (`/connect СЕКРЕТ` в чате → выбрать группу):
--  в telegram_bot_state появляются ключи `telegram_chat_id:group:<id группы>`, права бота — по
--  чату: `tag_rights:<id чата>`. Общий чат отдела — по-прежнему `telegram_chat_id` (может не быть).
--
--  Блок Telegram в CRM показывает чат команды оператора: «чат подключён» — если подключён чат
--  его группы или общий чат отдела, «права на теги» — в этом чате. Остальное — как было.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- чат, где Vexi ставит тег оператору: чат его группы, без него — общий чат отдела
create or replace function public.telegram_operator_chat(p_operator_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(s.value), '') from public.telegram_bot_state s
       join public.operators o on o.id = p_operator_id
      where o.group_id is not null and s.key = 'telegram_chat_id:group:' || o.group_id),
    (select nullif(btrim(s.value), '') from public.telegram_bot_state s where s.key = 'telegram_chat_id')
  )
$$;

revoke all on function public.telegram_operator_chat(text) from public, anon, authenticated;

create or replace function public.crm_telegram_status(p_operator_id text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_op      text := coalesce(nullif(btrim(p_operator_id), ''), public.crm_op_id());
  r         public.operator_telegram;
  v_linked  boolean;
  v_pending timestamptz;
  v_chat    text;
begin
  if public.crm_account_id() is null then
    raise exception 'Нет доступа к CRM' using errcode = '42501';
  end if;
  if v_op is null then
    return jsonb_build_object('operator_id', null, 'linked', false, 'bot_username', public.telegram_bot_username());
  end if;
  if not public.crm_telegram_can_see(v_op) then
    raise exception 'Нет доступа к этой карточке' using errcode = '42501';
  end if;

  select * into r from public.operator_telegram t where t.operator_id = v_op;
  v_linked := found;

  select c.expires_at into v_pending from public.telegram_link_codes c
   where c.operator_id = v_op and c.used_at is null and c.revoked_at is null and c.expires_at > now()
   order by c.created_at desc limit 1;

  v_chat := public.telegram_operator_chat(v_op);

  return jsonb_build_object(
    'operator_id', v_op,
    'linked', v_linked,
    'username', case when v_linked then r.telegram_username end,
    'first_name', case when v_linked then r.telegram_first_name end,
    'last_name', case when v_linked then r.telegram_last_name end,
    'linked_at', case when v_linked then r.telegram_linked_at end,
    'tag', case when v_linked then r.tag_synced end,
    'tag_synced_at', case when v_linked then r.tag_synced_at end,
    'chat_status', case when v_linked then r.chat_status else 'unknown' end,
    'chat_checked_at', case when v_linked then r.chat_checked_at end,
    'pending_code_expires_at', v_pending,
    'bot_username', public.telegram_bot_username(),
    'chat_connected', v_chat is not null,
    -- права в чате команды; бот прежней версии писал один общий ключ — тогда берём его
    'tag_rights', coalesce(
      (select nullif(s.value, '') from public.telegram_bot_state s where v_chat is not null and s.key = 'tag_rights:' || v_chat),
      (select nullif(s.value, '') from public.telegram_bot_state s where s.key = 'tag_rights')
    )
  );
end $$;
