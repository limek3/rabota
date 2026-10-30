-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Холст»: общий пиксель-арт отдела
--
--  Для базы, где схема 20260921000001_crm_schema.sql уже стоит. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Один холст на месяц, 32×32. Краска — за одобренные лиды: лид, который супервайзер
--  перевёл в «доведён» в этом месяце (status_at), даёт оператору 1 пиксель. СВ получает
--  1 пиксель за каждые 5 одобренных лидов своих групп, РОП — за каждые 10 по отделу. Лид ушёл
--  из «доведён» — пиксель забирается: баланс уходит в минус, пока новые лиды его не закроют.
--  Особые цвета оператору открывает лучший грейд дня за месяц: пастель — II, неон — III,
--  золото — IV. РОПу и СВ открыто всё.
--  Баланс не хранится, а считается: одобренные лиды месяца минус поставленные пиксели.
--
--  Писать в таблицу можно только через функции ниже: они проверяют баланс, границы, цвет
--  и защиту свежего пикселя (5 минут его не перекрасить другому). Свой пиксель можно
--  отменить 10 секунд — краска вернётся. РОП и супервайзер стирают чужое (модерация) —
--  запись остаётся в журнале с отметкой erased_at, краска нарушителю не возвращается.
--
--  Те же правила в приложении — lib/pixels.ts.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.pixels (
  id          bigint generated always as identity primary key,
  month       text not null,            -- 'YYYY-MM' по Москве
  x           smallint not null,
  y           smallint not null,
  color       text not null check (color ~ '^#[0-9a-f]{6}$'),
  -- без внешних ключей: импорт (crm_replace_all) пересоздаёт аккаунты, холст должен пережить это
  account_id  text not null,
  author_name text not null default '',
  created_at  timestamptz not null default now(),
  erased_at   timestamptz,
  erased_by   text
);

create index if not exists pixels_month_idx on public.pixels (month, created_at);
create index if not exists pixels_author_idx on public.pixels (account_id, month);

alter table public.pixels enable row level security;
drop policy if exists pixels_select on public.pixels;
-- холст общий: видят все, у кого есть аккаунт CRM
create policy pixels_select on public.pixels for select to authenticated
  using ((select public.crm_account_id()) is not null);

revoke all on public.pixels from anon, authenticated;
grant select on public.pixels to authenticated;

-- месяц холста — по Москве, как время лидов
create or replace function public.crm_pixel_month() returns text
language sql stable set search_path = public as $$
  select to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM')
$$;

-- сколько краски заработал вошедший за месяц: его лиды, одобренные в этом месяце,
-- плюс у СВ 1 пиксель за каждые 5 одобренных лидов своих групп, у РОПа — за каждые 10 по отделу
create or replace function public.crm_paint_earned(p_month text) returns integer
language sql stable security definer set search_path = public as $$
  with done as (
    select l.operator_id, l.group_id from public.leads l
    where l.status = 'done'
      and case when l.status_at is not null
               then to_char(l.status_at at time zone 'Europe/Moscow', 'YYYY-MM')
               else left(l.at, 7) end = p_month
  )
  select (select count(*) from done where operator_id = public.crm_op_id())::int
    + case public.crm_role()
        when 'head' then (select count(*) from done)::int / 10
        when 'supervisor' then (select count(*) from done where group_id = any (coalesce(public.crm_sup_groups(), '{}')))::int / 5
        else 0
      end
$$;

-- лучший грейд дня за месяц (пороги Vexi: 6 / 8 / 11 доведённых за день); РОП и СВ — 4
create or replace function public.crm_paint_grade(p_month text) returns integer
language sql stable security definer set search_path = public as $$
  select case
    when public.crm_role() in ('head', 'supervisor') then 4
    else (select case when n >= 11 then 4 when n >= 8 then 3 when n >= 6 then 2 else 1 end
          from (select coalesce(max(c), 0) as n from (
            select count(*) as c from public.leads
            where operator_id = public.crm_op_id() and status = 'done' and left(at, 7) = p_month
            group by left(at, 10)) d) m)
  end
$$;

-- какой грейд нужен для цвета: пастель — II, неон — III, золото — IV (списки — lib/pixels.ts)
create or replace function public.crm_paint_color_grade(p_color text) returns integer
language sql immutable set search_path = public as $$
  select case
    when p_color = '#e8b923' then 4
    when p_color = any (array['#ff073a','#ff5f1f','#fff01f','#ccff00','#39ff14','#00ff9f','#0ff0fc','#1f51ff','#bc13fe','#ff00ff','#fe019a','#ff6ec7']) then 3
    when p_color = any (array['#ffd1dc','#ffdac1','#ffe5b4','#fdfd96','#e2f0cb','#c1f0c1','#b5ead7','#d4f0f0','#aec6cf','#c7ceea','#c3b1e1','#e0bbe4','#f8c8dc','#fcd5ce','#f1e3d3','#dbe7c9']) then 2
    else 1
  end
$$;

-- поставить пиксель на холст текущего месяца
create or replace function public.crm_paint(p_x integer, p_y integer, p_color text) returns public.pixels
language plpgsql security definer set search_path = public as $$
declare
  v_size constant integer := 32;
  v_acc text := public.crm_account_id();
  v_month text := public.crm_pixel_month();
  v_color text := lower(coalesce(p_color, ''));
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
  if public.crm_paint_color_grade(v_color) > public.crm_paint_grade(v_month) then
    raise exception 'Этот цвет откроется на Грейде %',
      (array['I', 'II', 'III', 'IV'])[public.crm_paint_color_grade(v_color)] using errcode = '22023';
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

-- отменить свой только что поставленный пиксель — краска возвращается
-- (в приложении — 10 секунд; здесь с запасом на задержку сети)
create or replace function public.crm_paint_undo(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pixels
  where id = p_id and account_id = public.crm_account_id() and erased_at is null
    and created_at > now() - interval '15 seconds';
  return found;
end $$;

-- стереть пиксели (модерация): РОП и супервайзер. Под ними снова виден прежний цвет клетки.
create or replace function public.crm_paint_erase(p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if coalesce(public.crm_role(), '') not in ('head', 'supervisor') then
    raise exception 'Стирать чужие пиксели могут РОП и супервайзер' using errcode = '42501';
  end if;
  update public.pixels set erased_at = now(), erased_by = public.crm_account_id()
  where id = any (coalesce(p_ids, '{}')) and erased_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.crm_pixel_month() from public, anon;
revoke all on function public.crm_paint_earned(text) from public, anon;
revoke all on function public.crm_paint_grade(text) from public, anon;
revoke all on function public.crm_paint_color_grade(text) from public, anon;
grant execute on function public.crm_paint_grade(text) to authenticated;
grant execute on function public.crm_paint_color_grade(text) to authenticated;
revoke all on function public.crm_paint(integer, integer, text) from public, anon;
revoke all on function public.crm_paint_undo(bigint) from public, anon;
revoke all on function public.crm_paint_erase(bigint[]) from public, anon;
grant execute on function public.crm_pixel_month() to authenticated;
grant execute on function public.crm_paint_earned(text) to authenticated;
grant execute on function public.crm_paint(integer, integer, text) to authenticated;
grant execute on function public.crm_paint_undo(bigint) to authenticated;
grant execute on function public.crm_paint_erase(bigint[]) to authenticated;

-- realtime: пиксели коллег сразу видны на открытом холсте
do $$
begin
  execute 'alter publication supabase_realtime add table public.pixels';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
