-- ════════════════════════════════════════════════════════════════════════
--  LEADUP · Vexi — привязка Telegram оператора и дневные грейд-теги
--
--  Применять ПОСЛЕ 20260921000001_crm_schema.sql (и sql/001_vexi_bot.sql бота —
--  если его ещё не запускали, нужные таблицы бота создаются и здесь).
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен:
--  таблицы — «если нет», функции и политики пересоздаются, данные не трогаются.
--
--  Что внутри:
--    operator_telegram       — привязка карточки оператора к Telegram (1:1).
--                              Отдельная таблица, а не колонки в operators: operators
--                              целиком перезаписывает CRM (upsert всех полей), её
--                              читают и правят супервайзеры, она уходит в резервные
--                              копии. Telegram ID там подменялся бы и утекал.
--    telegram_link_codes     — одноразовые коды привязки (в базе только хэш).
--    telegram_link_attempts  — попытки /link: ограничение перебора кодов.
--    telegram_unlinks        — архив отвязок + очередь «снять тег в чате» для бота.
--    telegram_secrets        — соль хэша кодов; не видна никому, кроме функций.
--
--    RPC для CRM (вошедший пользователь):
--      crm_telegram_link_create()      — новый код (старый активный код гаснет);
--      crm_telegram_status([operator]) — статус привязки без Telegram ID;
--      crm_telegram_unlink([operator]) — отвязать.
--    RPC для бота (только service_role):
--      telegram_link_consume(code, telegram_user_id, username, first, last).
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. Таблицы бота (обычно уже есть после sql/001_vexi_bot.sql) ─────────
create table if not exists public.telegram_bot_state (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.telegram_bot_events (
  event_key  text primary key,
  event_type text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.telegram_bot_state  enable row level security;
alter table public.telegram_bot_events enable row level security;
revoke all on table public.telegram_bot_state, public.telegram_bot_events from anon, authenticated;
grant all on table public.telegram_bot_state, public.telegram_bot_events to service_role;

-- ── 1. Привязка ─────────────────────────────────────────────────────────
-- Внешнего ключа на operators нет намеренно: crm_replace_all (импорт/восстановление)
-- удаляет и заново вставляет операторов — каскад молча отвязал бы всех, а обычный
-- ключ сорвал бы восстановление. Привязка к удалённой карточке считается неактивной:
-- бот снимает тег, а Telegram ID можно привязать заново (см. telegram_link_consume).
create table if not exists public.operator_telegram (
  operator_id         text primary key,
  telegram_user_id    bigint not null,
  telegram_username   text,
  telegram_first_name text,
  telegram_last_name  text,
  telegram_linked_at  timestamptz not null default now(),
  -- состояние тега, которое пишет бот: последний подтверждённый в чате тег ('' — снят)
  tag_synced          text,
  tag_chat_id         bigint,
  tag_synced_at       timestamptz,
  chat_status         text not null default 'unknown',
  chat_checked_at     timestamptz,
  last_error          text,
  updated_at          timestamptz not null default now(),
  constraint operator_telegram_user_positive check (telegram_user_id > 0),
  constraint operator_telegram_chat_status_chk
    check (chat_status in ('unknown', 'member', 'not_member', 'admin', 'no_chat', 'no_rights', 'error'))
);
-- один человек в Telegram — одна карточка
create unique index if not exists operator_telegram_user_uniq on public.operator_telegram (telegram_user_id);

-- ── 2. Одноразовые коды ─────────────────────────────────────────────────
create table if not exists public.telegram_link_codes (
  id          uuid primary key default gen_random_uuid(),
  operator_id text not null references public.operators (id) on delete cascade,
  account_id  text,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     bigint,
  revoked_at  timestamptz
);
-- живой код: не использован и не отозван. Один живой код на оператора и уникальный хэш среди живых.
create unique index if not exists telegram_link_codes_live_hash on public.telegram_link_codes (code_hash)
  where used_at is null and revoked_at is null;
create unique index if not exists telegram_link_codes_live_op on public.telegram_link_codes (operator_id)
  where used_at is null and revoked_at is null;
create index if not exists telegram_link_codes_hash_idx on public.telegram_link_codes (code_hash, created_at desc);
create index if not exists telegram_link_codes_op_idx on public.telegram_link_codes (operator_id, created_at desc);

-- попытки привязки (для ограничения перебора)
create table if not exists public.telegram_link_attempts (
  id               bigint generated always as identity primary key,
  telegram_user_id bigint not null,
  ok               boolean not null,
  reason           text not null default '',
  created_at       timestamptz not null default now()
);
create index if not exists telegram_link_attempts_user_idx on public.telegram_link_attempts (telegram_user_id, created_at desc);

-- архив отвязок и очередь «снять тег» (processed_at is null — бот ещё не обработал)
create table if not exists public.telegram_unlinks (
  id                bigint generated always as identity primary key,
  operator_id       text not null,
  telegram_user_id  bigint not null,
  telegram_username text,
  linked_at         timestamptz,
  unlinked_at       timestamptz not null default now(),
  reason            text not null default 'unlink' check (reason in ('unlink', 'relink', 'operator_removed')),
  account_id        text,
  processed_at      timestamptz,
  cleanup_result    text
);
create index if not exists telegram_unlinks_pending_idx on public.telegram_unlinks (unlinked_at) where processed_at is null;

-- соль хэша: код из 6 цифр без соли перебирается по хэшу мгновенно
create table if not exists public.telegram_secrets (
  key   text primary key,
  value text not null
);
insert into public.telegram_secrets (key, value)
values ('link_pepper', encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'hex'))
on conflict (key) do nothing;

-- ── 3. Права на таблицы ─────────────────────────────────────────────────
alter table public.operator_telegram      enable row level security;
alter table public.telegram_link_codes    enable row level security;
alter table public.telegram_link_attempts enable row level security;
alter table public.telegram_unlinks       enable row level security;
alter table public.telegram_secrets       enable row level security;

revoke all on table public.operator_telegram, public.telegram_link_codes, public.telegram_link_attempts,
                    public.telegram_unlinks, public.telegram_secrets from anon, authenticated;
revoke all on table public.telegram_secrets from service_role;
grant all on table public.operator_telegram, public.telegram_link_codes, public.telegram_link_attempts,
                   public.telegram_unlinks to service_role;
-- CRM читает только свою строку привязки (нужно для realtime); писать напрямую нельзя — только RPC
grant select on table public.operator_telegram to authenticated;

drop policy if exists operator_telegram_read_own on public.operator_telegram;
create policy operator_telegram_read_own on public.operator_telegram for select to authenticated
  using (operator_id = (select public.crm_op_id()));

-- ── 4. Служебные функции ────────────────────────────────────────────────
create or replace function public.telegram_code_hash(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce((select s.value from public.telegram_secrets s where s.key = 'link_pepper'), '') || ':' || p_code, 'UTF8')), 'hex')
$$;

-- 6 цифр из криптостойкого генератора (gen_random_uuid → pg_strong_random), без смещения
create or replace function public.telegram_random_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  b bytea;
  n bigint;
begin
  loop
    b := uuid_send(gen_random_uuid());
    n := (get_byte(b, 0)::bigint << 24) | (get_byte(b, 1)::bigint << 16) | (get_byte(b, 2)::bigint << 8) | get_byte(b, 3)::bigint;
    exit when n < 4294000000;  -- 4294 × 10^6: остаток ниже делится поровну
  end loop;
  return lpad((n % 1000000)::text, 6, '0');
end $$;

create or replace function public.telegram_bot_username() returns text
language sql stable security definer set search_path = public as $$
  select nullif(btrim(ltrim(s.value, '@')), '') from public.telegram_bot_state s where s.key = 'bot_username'
$$;

-- кто вправе смотреть/отвязывать Telegram оператора: он сам, РОП, супервайзер его зоны
create or replace function public.crm_telegram_can_see(p_operator text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_operator is not null and (
    p_operator = public.crm_op_id()
    or public.crm_is_head()
    or (public.crm_role() = 'supervisor' and p_operator = any (coalesce(public.crm_touch_ops(), '{}')))
  )
$$;

-- ── 5. RPC для CRM ──────────────────────────────────────────────────────

-- Новый код для своей карточки. Предыдущий живой код гаснет. Код возвращается один раз —
-- в базе остаётся только хэш.
create or replace function public.crm_telegram_link_create() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acc  text := public.crm_account_id();
  v_op   text := public.crm_op_id();
  v_ttl  constant integer := 900;
  v_exp  timestamptz := now() + make_interval(secs => v_ttl);
  v_code text;
  v_try  integer := 0;
begin
  if v_acc is null then
    raise exception 'Нет доступа к CRM' using errcode = '42501';
  end if;
  if v_op is null then
    raise exception 'Аккаунт не привязан к карточке оператора — попросите руководителя связать их' using errcode = '42501';
  end if;
  if not exists (select 1 from public.operators o where o.id = v_op and o.deleted_at is null and o.status <> 'fired') then
    raise exception 'Карточка оператора удалена или уволена' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telegram_link:' || v_op));

  if (select count(*) from public.telegram_link_codes c
      where c.operator_id = v_op and c.created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Слишком много кодов подряд — подождите несколько минут' using errcode = 'P0001';
  end if;

  -- гасим свой прошлый код и чужие просроченные (чтобы значение кода можно было выдать снова)
  update public.telegram_link_codes c set revoked_at = now()
   where c.used_at is null and c.revoked_at is null and (c.operator_id = v_op or c.expires_at <= now());

  loop
    v_code := public.telegram_random_code();
    begin
      insert into public.telegram_link_codes (operator_id, account_id, code_hash, expires_at)
      values (v_op, v_acc, public.telegram_code_hash(v_code), v_exp);
      exit;
    exception when unique_violation then
      -- такой же код прямо сейчас живёт у другого оператора — берём другой
      v_try := v_try + 1;
      if v_try >= 10 then raise; end if;
    end;
  end loop;

  return jsonb_build_object(
    'code', v_code,
    'expires_at', v_exp,
    'ttl_seconds', v_ttl,
    'bot_username', public.telegram_bot_username()
  );
end $$;

-- Статус привязки. Telegram ID наружу не отдаётся.
create or replace function public.crm_telegram_status(p_operator_id text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_op      text := coalesce(nullif(btrim(p_operator_id), ''), public.crm_op_id());
  r         public.operator_telegram;
  v_linked  boolean;
  v_pending timestamptz;
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
    'chat_connected', exists (select 1 from public.telegram_bot_state s where s.key = 'telegram_chat_id' and btrim(s.value) <> ''),
    'tag_rights', (select nullif(s.value, '') from public.telegram_bot_state s where s.key = 'tag_rights')
  );
end $$;

-- Отвязать: свою карточку — оператор; чужую — РОП или супервайзер её зоны.
create or replace function public.crm_telegram_unlink(p_operator_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op text := coalesce(nullif(btrim(p_operator_id), ''), public.crm_op_id());
  r    public.operator_telegram;
begin
  if public.crm_account_id() is null then
    raise exception 'Нет доступа к CRM' using errcode = '42501';
  end if;
  if v_op is null then
    raise exception 'Аккаунт не привязан к карточке оператора' using errcode = '42501';
  end if;
  if not public.crm_telegram_can_see(v_op) then
    raise exception 'Нет доступа к этой карточке' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('telegram_link:' || v_op));

  update public.telegram_link_codes c set revoked_at = now()
   where c.operator_id = v_op and c.used_at is null and c.revoked_at is null;

  delete from public.operator_telegram t where t.operator_id = v_op returning * into r;
  if r.operator_id is null then
    return jsonb_build_object('ok', true, 'was_linked', false);
  end if;

  insert into public.telegram_unlinks (operator_id, telegram_user_id, telegram_username, linked_at, reason, account_id)
  values (r.operator_id, r.telegram_user_id, r.telegram_username, r.telegram_linked_at, 'unlink', public.crm_account_id());

  return jsonb_build_object('ok', true, 'was_linked', true);
end $$;

-- ── 6. RPC для бота ─────────────────────────────────────────────────────
-- Привязка по коду из /link или /start link_XXXXXX. Всё в одной транзакции:
-- код проверяется и гасится под блокировкой строки, дважды его не использовать.
-- Ответ: {ok, reason, operator_id, operator_name, repeat, previous_telegram_user_id}
create or replace function public.telegram_link_consume(
  p_code text,
  p_telegram_user_id bigint,
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code   text := btrim(coalesce(p_code, ''));
  v_hash   text;
  v_fails  integer;
  v_reason text;
  c        public.telegram_link_codes;
  o        public.operators;
  v_prev   public.operator_telegram;
  v_other  public.operator_telegram;
  v_had_prev boolean;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_user');
  end if;

  delete from public.telegram_link_attempts a where a.created_at < now() - interval '1 day';
  select count(*) into v_fails from public.telegram_link_attempts a
   where a.telegram_user_id = p_telegram_user_id and not a.ok and a.created_at > now() - interval '15 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if v_code !~ '^[0-9]{6}$' then
    insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, false, 'bad_format');
    return jsonb_build_object('ok', false, 'reason', 'bad_format');
  end if;

  v_hash := public.telegram_code_hash(v_code);

  select * into c from public.telegram_link_codes x
   where x.code_hash = v_hash and x.used_at is null and x.revoked_at is null
   for update;

  if not found then
    select * into c from public.telegram_link_codes x where x.code_hash = v_hash order by x.created_at desc limit 1;
    if not found then
      v_reason := 'not_found';
    elsif c.used_at is not null then
      -- повторное нажатие той же ссылки тем же человеком — не ошибка
      if c.used_by = p_telegram_user_id and exists (
        select 1 from public.operator_telegram t where t.operator_id = c.operator_id and t.telegram_user_id = p_telegram_user_id
      ) then
        select * into o from public.operators x where x.id = c.operator_id;
        insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, true, 'repeat');
        return jsonb_build_object('ok', true, 'repeat', true, 'operator_id', c.operator_id, 'operator_name', o.name);
      end if;
      v_reason := 'used';
    elsif c.expires_at <= now() then
      v_reason := 'expired';
    else
      v_reason := 'revoked';
    end if;
    insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, false, v_reason);
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  if c.expires_at <= now() then
    insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, false, 'expired');
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into o from public.operators x where x.id = c.operator_id;
  if not found or o.deleted_at is not null or o.status = 'fired' then
    insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, false, 'operator_inactive');
    return jsonb_build_object('ok', false, 'reason', 'operator_inactive');
  end if;

  perform pg_advisory_xact_lock(hashtext('telegram_link:' || c.operator_id));
  perform pg_advisory_xact_lock(hashtext('telegram_user:' || p_telegram_user_id::text));

  -- этот Telegram уже у другой карточки?
  select * into v_other from public.operator_telegram t
   where t.telegram_user_id = p_telegram_user_id and t.operator_id <> c.operator_id;
  if found then
    if exists (select 1 from public.operators x where x.id = v_other.operator_id and x.deleted_at is null and x.status <> 'fired') then
      -- код не гасим: человек может войти в нужный Telegram и повторить
      insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, false, 'telegram_taken');
      return jsonb_build_object('ok', false, 'reason', 'telegram_taken');
    end if;
    -- привязка осталась от удалённой/уволенной карточки — освобождаем
    delete from public.operator_telegram t where t.operator_id = v_other.operator_id;
    insert into public.telegram_unlinks (operator_id, telegram_user_id, telegram_username, linked_at, reason, processed_at, cleanup_result)
    values (v_other.operator_id, v_other.telegram_user_id, v_other.telegram_username, v_other.telegram_linked_at, 'operator_removed', now(), 'relinked');
  end if;

  -- у карточки был другой Telegram — в архив, бот снимет с него тег
  select * into v_prev from public.operator_telegram t where t.operator_id = c.operator_id;
  v_had_prev := found and v_prev.telegram_user_id <> p_telegram_user_id;
  if v_had_prev then
    insert into public.telegram_unlinks (operator_id, telegram_user_id, telegram_username, linked_at, reason)
    values (v_prev.operator_id, v_prev.telegram_user_id, v_prev.telegram_username, v_prev.telegram_linked_at, 'relink');
  end if;

  insert into public.operator_telegram as t (
    operator_id, telegram_user_id, telegram_username, telegram_first_name, telegram_last_name, telegram_linked_at,
    tag_synced, tag_chat_id, tag_synced_at, chat_status, chat_checked_at, last_error, updated_at
  ) values (
    c.operator_id, p_telegram_user_id,
    left(nullif(btrim(ltrim(coalesce(p_username, ''), '@')), ''), 64),
    left(nullif(btrim(coalesce(p_first_name, '')), ''), 128),
    left(nullif(btrim(coalesce(p_last_name, '')), ''), 128),
    now(), null, null, null, 'unknown', null, null, now()
  )
  on conflict (operator_id) do update set
    telegram_user_id    = excluded.telegram_user_id,
    telegram_username   = excluded.telegram_username,
    telegram_first_name = excluded.telegram_first_name,
    telegram_last_name  = excluded.telegram_last_name,
    telegram_linked_at  = excluded.telegram_linked_at,
    tag_synced = null, tag_chat_id = null, tag_synced_at = null,
    chat_status = 'unknown', chat_checked_at = null, last_error = null,
    updated_at = now();

  update public.telegram_link_codes x set used_at = now(), used_by = p_telegram_user_id where x.id = c.id;
  insert into public.telegram_link_attempts (telegram_user_id, ok, reason) values (p_telegram_user_id, true, 'linked');

  return jsonb_build_object(
    'ok', true,
    'repeat', false,
    'operator_id', c.operator_id,
    'operator_name', o.name,
    'previous_telegram_user_id', case when v_had_prev then v_prev.telegram_user_id end
  );
exception when unique_violation then
  -- гонка: тот же Telegram в эту же секунду привязали к другой карточке
  return jsonb_build_object('ok', false, 'reason', 'telegram_taken');
end $$;

-- ── 7. Права на функции ─────────────────────────────────────────────────
-- Supabase по умолчанию выдаёт execute на новые функции anon/authenticated — забираем явно.
revoke all on function public.telegram_code_hash(text), public.telegram_random_code(), public.telegram_bot_username(),
  public.crm_telegram_can_see(text), public.crm_telegram_link_create(), public.crm_telegram_status(text),
  public.crm_telegram_unlink(text), public.telegram_link_consume(text, bigint, text, text, text)
  from public, anon, authenticated;

grant execute on function public.crm_telegram_link_create(), public.crm_telegram_status(text), public.crm_telegram_unlink(text)
  to authenticated;
grant execute on function public.telegram_link_consume(text, bigint, text, text, text) to service_role;

-- ── 8. Realtime: CRM сразу видит, что привязка прошла (RLS — только своя строка) ──
do $$
begin
  begin
    alter publication supabase_realtime add table public.operator_telegram;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
