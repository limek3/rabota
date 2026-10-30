-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — чат «Холста»: обсуждать картину прямо на странице
--
--  Для базы, где уже стоит 20261030000001_pixel_canvas.sql. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Пишут все, у кого есть аккаунт CRM, — только через crm_canvas_say: имя и отличие
--  (РОП, «СВ · Группа 1», грейд дня по доведённым за сегодня — пороги Vexi 6 / 8 / 11)
--  ставит база, подделать «Грейд IV» нельзя. Не чаще сообщения в секунду, до 500 символов.
--  Удалить сообщение может автор, а также РОП и супервайзер (модерация) — оно скрывается.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.canvas_chat (
  id          bigint generated always as identity primary key,
  -- без внешних ключей: импорт (crm_replace_all) пересоздаёт аккаунты, переписка должна пережить это
  account_id  text not null,
  author_name text not null default '',
  role        text not null default 'operator',
  grade       smallint,
  team        text,
  text        text not null check (char_length(text) between 1 and 500),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists canvas_chat_time_idx on public.canvas_chat (created_at desc);

alter table public.canvas_chat enable row level security;
drop policy if exists canvas_chat_select on public.canvas_chat;
create policy canvas_chat_select on public.canvas_chat for select to authenticated
  using ((select public.crm_account_id()) is not null);

revoke all on public.canvas_chat from anon, authenticated;
grant select on public.canvas_chat to authenticated;

create or replace function public.crm_canvas_say(p_text text) returns public.canvas_chat
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_role text := public.crm_role();
  v_text text := btrim(coalesce(p_text, ''));
  v_today text := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD');
  v_done integer;
  v_grade smallint;
  v_team text;
  v_n integer;
  v_row public.canvas_chat;
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Пустое сообщение' using errcode = '22023';
  end if;
  if char_length(v_text) > 500 then
    raise exception 'Слишком длинно — до 500 символов' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('chat|' || v_acc));
  if exists (select 1 from public.canvas_chat where account_id = v_acc and created_at > now() - interval '1 second') then
    raise exception 'Не так быстро' using errcode = '22023';
  end if;

  -- грейд дня — у того, кто сам звонит (есть карточка оператора)
  if public.crm_op_id() is not null and v_role = 'operator' then
    select count(*) into v_done from public.leads
    where operator_id = public.crm_op_id() and status = 'done' and left(at, 10) = v_today;
    v_grade := case when v_done >= 11 then 4 when v_done >= 8 then 3 when v_done >= 6 then 2 else 1 end;
  end if;

  -- у супервайзера — его группа («Группа 1») или сколько их
  if v_role = 'supervisor' then
    select count(*), min(g.name) into v_n, v_team from public.groups g
    where g.id = any (coalesce(public.crm_sup_groups(), '{}')) and g.deleted_at is null;
    if v_n > 1 then
      v_team := v_n || ' ' || case when v_n % 100 between 11 and 14 then 'групп'
                                   when v_n % 10 between 2 and 4 then 'группы'
                                   else 'групп' end;
    end if;
  end if;

  insert into public.canvas_chat (account_id, author_name, role, grade, team, text)
  values (v_acc, coalesce((select name from public.accounts where id = v_acc), ''), coalesce(v_role, 'operator'), v_grade, v_team, v_text)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.crm_canvas_unsay(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.canvas_chat set deleted_at = now()
  where id = p_id and deleted_at is null
    and (account_id = public.crm_account_id() or coalesce(public.crm_role(), '') in ('head', 'supervisor'));
  return found;
end $$;

revoke all on function public.crm_canvas_say(text) from public, anon;
revoke all on function public.crm_canvas_unsay(bigint) from public, anon;
grant execute on function public.crm_canvas_say(text) to authenticated;
grant execute on function public.crm_canvas_unsay(bigint) to authenticated;

-- realtime: сообщения сразу видны у всех на странице
do $$
begin
  execute 'alter publication supabase_realtime add table public.canvas_chat';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
