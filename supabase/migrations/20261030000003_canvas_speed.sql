-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Холст» и его чат: быстрые функции (исправляет «statement timeout»)
--
--  Для базы, где уже стоят 20261030000001_pixel_canvas.sql и 20261030000002_canvas_chat.sql.
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Было: crm_op_id() / crm_sup_groups() стояли прямо в условии отбора лидов, и база
--  вызывала их заново на каждую строку (у каждого вызова — свои запросы к аккаунтам и
--  группам). На тысячах лидов запрос не успевал и обрывался по таймауту.
--  Стало: «кто я» считаем один раз в переменные, лиды отбираем по индексам
--  (operator_id, диапазон дат вместо to_char по каждой строке). Правила те же.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- для «одобрено в этом месяце»: время смены статуса
create index if not exists leads_status_at_idx on public.leads (status_at) where status = 'done';
-- для «не чаще сообщения в секунду»
create index if not exists canvas_chat_author_idx on public.canvas_chat (account_id, created_at desc);
-- для «что сейчас в клетке»
create index if not exists pixels_cell_idx on public.pixels (month, x, y, created_at desc);

-- сколько краски заработал вошедший за месяц (правила — в 20261030000001_pixel_canvas.sql)
create or replace function public.crm_paint_earned(p_month text) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_op text := public.crm_op_id();
  v_role text := public.crm_role();
  v_groups text[];
  v_from timestamptz := (p_month || '-01')::timestamp at time zone 'Europe/Moscow';
  v_to timestamptz := ((p_month || '-01')::date + interval '1 month')::timestamp at time zone 'Europe/Moscow';
  v_day_from text := p_month || '-01';
  v_day_to text := to_char((p_month || '-01')::date + interval '1 month', 'YYYY-MM-DD');
  v_own integer := 0;
  v_team integer := 0;
begin
  if v_op is not null then
    select count(*) into v_own from public.leads l
    where l.operator_id = v_op and l.status = 'done'
      and ((l.status_at >= v_from and l.status_at < v_to)
        or (l.status_at is null and l.at >= v_day_from and l.at < v_day_to));
  end if;

  if v_role = 'head' then
    select count(*) into v_team from public.leads l
    where l.status = 'done'
      and ((l.status_at >= v_from and l.status_at < v_to)
        or (l.status_at is null and l.at >= v_day_from and l.at < v_day_to));
    return v_own + v_team / 10;
  end if;

  if v_role = 'supervisor' then
    v_groups := coalesce(public.crm_sup_groups(), '{}');
    if cardinality(v_groups) > 0 then
      select count(*) into v_team from public.leads l
      where l.status = 'done' and l.group_id = any (v_groups)
        and ((l.status_at >= v_from and l.status_at < v_to)
          or (l.status_at is null and l.at >= v_day_from and l.at < v_day_to));
    end if;
    return v_own + v_team / 5;
  end if;

  return v_own;
end $$;

-- лучший грейд дня за месяц; РОП и СВ — 4
create or replace function public.crm_paint_grade(p_month text) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_op text;
  v_n integer;
begin
  if public.crm_role() in ('head', 'supervisor') then
    return 4;
  end if;
  v_op := public.crm_op_id();
  if v_op is null then
    return 1;
  end if;
  select coalesce(max(c), 0) into v_n from (
    select count(*) as c from public.leads
    where operator_id = v_op and status = 'done'
      and at >= p_month || '-01' and at < to_char((p_month || '-01')::date + interval '1 month', 'YYYY-MM-DD')
    group by left(at, 10)
  ) d;
  return case when v_n >= 11 then 4 when v_n >= 8 then 3 when v_n >= 6 then 2 else 1 end;
end $$;

-- поставить пиксель: те же проверки, грейд и цвет — по одному разу
create or replace function public.crm_paint(p_x integer, p_y integer, p_color text) returns public.pixels
language plpgsql security definer set search_path = public as $$
declare
  v_size constant integer := 32;
  v_acc text := public.crm_account_id();
  v_month text := public.crm_pixel_month();
  v_color text := lower(coalesce(p_color, ''));
  v_need integer;
  v_top public.pixels;
  v_left integer;
  v_row public.pixels;
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  if p_x is null or p_y is null or p_x < 0 or p_y < 0 or p_x >= v_size or p_y >= v_size then
    raise exception 'Мимо холста' using errcode = '22023';
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Непонятный цвет' using errcode = '22023';
  end if;
  v_need := public.crm_paint_color_grade(v_color);
  if v_need > 1 and v_need > public.crm_paint_grade(v_month) then
    raise exception 'Этот цвет откроется на Грейде %', (array['I', 'II', 'III', 'IV'])[v_need] using errcode = '22023';
  end if;

  -- два клика подряд не должны потратить одну краску дважды
  perform pg_advisory_xact_lock(hashtext('paint|' || v_acc));

  select * into v_top from public.pixels
  where month = v_month and x = p_x and y = p_y and erased_at is null
  order by created_at desc, id desc limit 1;
  if v_top.id is not null then
    if v_top.color = v_color then
      raise exception 'Пиксель уже этого цвета' using errcode = '22023';
    end if;
    if v_top.account_id <> v_acc and v_top.created_at > now() - interval '5 minutes' then
      raise exception 'Пиксель только что поставили — перекрасить можно через % мин',
        greatest(1, ceil(extract(epoch from (v_top.created_at + interval '5 minutes' - now())) / 60)::int)
        using errcode = '22023';
    end if;
  end if;

  v_left := public.crm_paint_earned(v_month)
    - (select count(*)::int from public.pixels where account_id = v_acc and month = v_month);
  if v_left < 1 then
    raise exception 'Краска закончилась: 1 пиксель — за 1 одобренный лид' using errcode = '22023';
  end if;

  insert into public.pixels (month, x, y, color, account_id, author_name)
  values (v_month, p_x, p_y, v_color, v_acc, coalesce((select name from public.accounts where id = v_acc), ''))
  returning * into v_row;
  return v_row;
end $$;

-- сообщение в чат: «кто я» — один раз
create or replace function public.crm_canvas_say(p_text text) returns public.canvas_chat
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_role text := public.crm_role();
  v_op text := public.crm_op_id();
  v_text text := btrim(coalesce(p_text, ''));
  v_today text := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD');
  v_done integer;
  v_grade smallint;
  v_groups text[];
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

  -- грейд дня — у оператора с карточкой
  if v_op is not null and v_role = 'operator' then
    select count(*) into v_done from public.leads
    where operator_id = v_op and status = 'done' and at >= v_today and at < v_today || 'U';
    v_grade := case when v_done >= 11 then 4 when v_done >= 8 then 3 when v_done >= 6 then 2 else 1 end;
  end if;

  -- у супервайзера — его группа («Группа 1») или сколько их
  if v_role = 'supervisor' then
    v_groups := coalesce(public.crm_sup_groups(), '{}');
    select count(*), min(g.name) into v_n, v_team from public.groups g
    where g.id = any (v_groups) and g.deleted_at is null;
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

-- удалить сообщение: роль — один раз
create or replace function public.crm_canvas_unsay(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_mod boolean := coalesce(public.crm_role(), '') in ('head', 'supervisor');
begin
  update public.canvas_chat set deleted_at = now()
  where id = p_id and deleted_at is null and (account_id = v_acc or v_mod);
  return found;
end $$;

-- стереть пиксели (модерация): роль — один раз
create or replace function public.crm_paint_erase(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_n integer;
begin
  if coalesce(public.crm_role(), '') not in ('head', 'supervisor') then
    raise exception 'Стирать чужие пиксели могут РОП и супервайзер' using errcode = '42501';
  end if;
  update public.pixels set erased_at = now(), erased_by = v_acc
  where id = any (coalesce(p_ids, '{}')) and erased_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- отменить свой пиксель: аккаунт — один раз
create or replace function public.crm_paint_undo(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
begin
  delete from public.pixels
  where id = p_id and account_id = v_acc and erased_at is null
    and created_at > now() - interval '15 seconds';
  return found;
end $$;

-- права на функции — как были (create or replace их не сбрасывает, но на случай чистой базы)
revoke all on function public.crm_paint_earned(text) from public, anon;
revoke all on function public.crm_paint_grade(text) from public, anon;
revoke all on function public.crm_paint(integer, integer, text) from public, anon;
revoke all on function public.crm_canvas_say(text) from public, anon;
revoke all on function public.crm_canvas_unsay(bigint) from public, anon;
revoke all on function public.crm_paint_erase(bigint[]) from public, anon;
revoke all on function public.crm_paint_undo(bigint) from public, anon;
grant execute on function public.crm_paint_earned(text) to authenticated;
grant execute on function public.crm_paint_grade(text) to authenticated;
grant execute on function public.crm_paint(integer, integer, text) to authenticated;
grant execute on function public.crm_canvas_say(text) to authenticated;
grant execute on function public.crm_canvas_unsay(bigint) to authenticated;
grant execute on function public.crm_paint_erase(bigint[]) to authenticated;
grant execute on function public.crm_paint_undo(bigint) to authenticated;
