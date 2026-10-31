-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Лавка»: украшения профиля за искры
--
--  Для базы, где уже стоят 20261030000001_pixel_canvas.sql и 20261030000003_canvas_speed.sql
--  (нужны crm_pixel_month и crm_paint_grade). Supabase → SQL Editor → вставить файл
--  целиком → Run. Повторный запуск безопасен.
--
--  Искры не хранятся, а считаются:
--    10 за каждый свой лид, одобренный («доведён») с 1 октября 2026;
--    +50 за каждый день с Грейдом IV (11+ доведённых за день);
--    СВ — 10 за каждые 5 одобренных лидов своих групп, РОП — за каждые 10 по отделу;
--    минус всё купленное этим аккаунтом (себе и в подарок).
--  Цены — в crm_shop_catalog: тот же список и в том же порядке, что CATALOG в lib/shop.ts.
--  «Скидка дня» (−30%) — по кругу среди не легендарных и не сезонных вещей.
--  Легендарные вещи открывает лучший грейд дня за месяц (как цвета холста), их не дарят.
--
--  Писать в таблицу можно только через функции ниже. Те же правила в приложении — lib/shop.ts.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.shop_items (
  id          bigint generated always as identity primary key,
  -- без внешних ключей: импорт (crm_replace_all) пересоздаёт аккаунты, покупки должны пережить это
  account_id  text not null,            -- чьё
  item        text not null,
  slot        text not null check (slot in ('frame', 'name', 'trail')),
  price       integer not null check (price >= 0),
  buyer_id    text not null,            -- кто заплатил (в подарок — не владелец)
  buyer_name  text not null default '',
  equipped    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (account_id, item)
);

create index if not exists shop_items_buyer_idx on public.shop_items (buyer_id);

alter table public.shop_items enable row level security;
drop policy if exists shop_items_select on public.shop_items;
-- украшения видят все, у кого есть аккаунт CRM
create policy shop_items_select on public.shop_items for select to authenticated
  using ((select public.crm_account_id()) is not null);

revoke all on public.shop_items from anon, authenticated;
grant select on public.shop_items to authenticated;

-- каталог: порядок (ord) важен для «Скидки дня»
create or replace function public.crm_shop_catalog()
returns table (ord integer, item text, slot text, price integer, rarity text, grade integer, season boolean)
language sql immutable set search_path = public as $$
  select * from (values
    (0,  'f_neon',      'frame', 150,  'common', null::int, false),
    (1,  'f_ice',       'frame', 200,  'common', null, false),
    (2,  'f_fire',      'frame', 400,  'rare',   null, false),
    (3,  'f_cat',       'frame', 350,  'rare',   null, false),
    (4,  'f_pixel',     'frame', 400,  'rare',   null, false),
    (5,  'f_rainbow',   'frame', 700,  'epic',   null, false),
    (6,  'f_orbit',     'frame', 800,  'epic',   null, false),
    (7,  'f_halo',      'frame', 900,  'epic',   null, false),
    (8,  'f_crown',     'frame', 2000, 'legend', 4,    false),
    (9,  'f_pumpkin',   'frame', 300,  'rare',   null, true),
    (10, 'f_web',       'frame', 350,  'rare',   null, true),
    (11, 'n_sunset',    'name',  150,  'common', null, false),
    (12, 'n_ocean',     'name',  150,  'common', null, false),
    (13, 'n_mint',      'name',  150,  'common', null, false),
    (14, 'n_toxic',     'name',  300,  'rare',   null, false),
    (15, 'n_glitch',    'name',  600,  'epic',   null, false),
    (16, 'n_rainbow',   'name',  700,  'epic',   null, false),
    (17, 'n_gold',      'name',  1500, 'legend', 3,    false),
    (18, 'n_ghost',     'name',  300,  'rare',   null, true),
    (19, 't_bubbles',   'trail', 250,  'common', null, false),
    (20, 't_hearts',    'trail', 400,  'rare',   null, false),
    (21, 't_snow',      'trail', 400,  'rare',   null, false),
    (22, 't_pixels',    'trail', 450,  'rare',   null, false),
    (23, 't_stars',     'trail', 800,  'epic',   null, false),
    (24, 't_money',     'trail', 900,  'epic',   null, false),
    (25, 't_fireworks', 'trail', 2500, 'legend', 4,    false),
    (26, 't_bats',      'trail', 600,  'epic',   null, true)
  ) as c (ord, item, slot, price, rarity, grade, season)
$$;

-- сегодня по Москве
create or replace function public.crm_shop_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

-- вещь «Скидки дня»: номер дня от 2026-01-01 по кругу среди не легендарных и не сезонных
create or replace function public.crm_shop_deal() returns text
language sql stable set search_path = public as $$
  with pool as (
    select item, row_number() over (order by ord) - 1 as i, count(*) over () as n
    from public.crm_shop_catalog() where rarity <> 'legend' and not season
  )
  select item from pool
  where i = (((public.crm_shop_today() - date '2026-01-01') % n) + n) % n
$$;

-- цена сегодня; null — не продаётся (нет такой вещи или сезон прошёл: 24 октября — 7 ноября)
create or replace function public.crm_shop_price(p_item text) returns integer
language sql stable set search_path = public as $$
  select case
    when c.season and not (public.crm_shop_today() >= date '2026-10-24' and public.crm_shop_today() < date '2026-11-08') then null
    when c.item = public.crm_shop_deal() then (round(c.price * 70 / 100.0 / 10.0) * 10)::int
    else c.price
  end
  from public.crm_shop_catalog() c where c.item = p_item
$$;

-- сколько искр заработал вошедший (всего, с 1 октября 2026)
create or replace function public.crm_shop_earned() returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_op text := public.crm_op_id();
  v_role text := public.crm_role();
  v_groups text[];
  v_from timestamptz := timestamp '2026-10-01 00:00' at time zone 'Europe/Moscow';
  v_day text := '2026-10-01';
  v_own integer := 0;
  v_g4 integer := 0;
  v_team integer := 0;
begin
  if v_op is not null then
    select count(*) into v_own from public.leads l
    where l.operator_id = v_op and l.status = 'done'
      and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    select count(*) into v_g4 from (
      select 1 from public.leads
      where operator_id = v_op and status = 'done' and at >= v_day
      group by left(at, 10) having count(*) >= 11
    ) d;
  end if;

  if v_role = 'head' then
    select count(*) into v_team from public.leads l
    where l.status = 'done' and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    return v_own * 10 + v_g4 * 50 + (v_team / 10) * 10;
  end if;

  if v_role = 'supervisor' then
    v_groups := coalesce(public.crm_sup_groups(), '{}');
    if cardinality(v_groups) > 0 then
      select count(*) into v_team from public.leads l
      where l.status = 'done' and l.group_id = any (v_groups)
        and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    end if;
    return v_own * 10 + v_g4 * 50 + (v_team / 5) * 10;
  end if;

  return v_own * 10 + v_g4 * 50;
end $$;

-- купить себе (p_to null) или в подарок коллеге
create or replace function public.crm_shop_buy(p_item text, p_to text default null) returns public.shop_items
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_owner text := coalesce(nullif(p_to, ''), v_acc);
  v_c record;
  v_price integer;
  v_left integer;
  v_row public.shop_items;
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  select * into v_c from public.crm_shop_catalog() c where c.item = p_item;
  if not found then
    raise exception 'Такой вещи нет' using errcode = '22023';
  end if;
  v_price := public.crm_shop_price(p_item);
  if v_price is null then
    raise exception 'Хэллоуин закончился — эта вещь больше не продаётся' using errcode = '22023';
  end if;
  if v_owner <> v_acc then
    if not exists (select 1 from public.accounts where id = v_owner and deleted_at is null) then
      raise exception 'Нет такого коллеги' using errcode = '22023';
    end if;
    if v_c.grade is not null then
      raise exception 'Легендарные вещи не дарят — их открывает грейд' using errcode = '22023';
    end if;
  end if;
  if v_c.grade is not null and v_c.grade > public.crm_paint_grade(public.crm_pixel_month()) then
    raise exception 'Откроется на Грейде %', case v_c.grade when 4 then 'IV' else 'III' end using errcode = '22023';
  end if;

  -- два клика подряд не должны потратить искры дважды
  perform pg_advisory_xact_lock(hashtext('shop|' || v_acc));

  if exists (select 1 from public.shop_items where account_id = v_owner and item = p_item) then
    raise exception '%', case when v_owner = v_acc then 'Уже есть' else 'У коллеги это уже есть' end using errcode = '22023';
  end if;
  v_left := public.crm_shop_earned() - coalesce((select sum(price)::int from public.shop_items where buyer_id = v_acc), 0);
  if v_left < v_price then
    raise exception 'Не хватает % ✦', v_price - v_left using errcode = '22023';
  end if;

  insert into public.shop_items (account_id, item, slot, price, buyer_id, buyer_name)
  values (v_owner, p_item, v_c.slot, v_price, v_acc, coalesce((select name from public.accounts where id = v_acc), ''))
  returning * into v_row;
  return v_row;
end $$;

-- надеть свою вещь в слот (p_item null — снять)
create or replace function public.crm_shop_equip(p_slot text, p_item text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  if p_item is not null and not exists (
    select 1 from public.shop_items where account_id = v_acc and item = p_item and slot = p_slot
  ) then
    raise exception 'Сначала купите эту вещь' using errcode = '22023';
  end if;
  -- меняем только то, что действительно меняется: меньше событий Realtime
  update public.shop_items set equipped = (item is not distinct from p_item)
  where account_id = v_acc and slot = p_slot and equipped is distinct from (item is not distinct from p_item);
  return true;
end $$;

revoke all on function public.crm_shop_catalog() from public, anon;
revoke all on function public.crm_shop_today() from public, anon;
revoke all on function public.crm_shop_deal() from public, anon;
revoke all on function public.crm_shop_price(text) from public, anon;
revoke all on function public.crm_shop_earned() from public, anon;
revoke all on function public.crm_shop_buy(text, text) from public, anon;
revoke all on function public.crm_shop_equip(text, text) from public, anon;
grant execute on function public.crm_shop_catalog() to authenticated;
grant execute on function public.crm_shop_today() to authenticated;
grant execute on function public.crm_shop_deal() to authenticated;
grant execute on function public.crm_shop_price(text) to authenticated;
grant execute on function public.crm_shop_earned() to authenticated;
grant execute on function public.crm_shop_buy(text, text) to authenticated;
grant execute on function public.crm_shop_equip(text, text) to authenticated;

-- realtime: покупки и «надел/снял» коллег видны сразу
do $$
begin
  execute 'alter publication supabase_realtime add table public.shop_items';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
