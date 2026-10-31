-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Лавка»: новые цены, значки и фоны профиля, бонус за Грейд III
--
--  Для базы, где уже стоит 20261031000001_shop.sql. Supabase → SQL Editor → вставить файл
--  целиком → Run. Повторный запуск безопасен.
--
--  • Цены выше: обычная вещь — примерно неделя работы, редкая — 3–4 недели,
--    эпическая — пара месяцев, легендарная — полгода и нужный грейд.
--  • Новые места для украшений: badge — значок рядом с именем, banner — фон профиля.
--  • Искры: +20 за каждый день с Грейдом III (8–10 доведённых за день), Грейд IV — по-прежнему +50.
--  Уже купленное остаётся по той цене, за которую покупали.
--  Каталог — тот же список и в том же порядке, что CATALOG в lib/shop.ts.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.shop_items drop constraint if exists shop_items_slot_check;
alter table public.shop_items add constraint shop_items_slot_check
  check (slot in ('frame', 'name', 'trail', 'badge', 'banner'));

create or replace function public.crm_shop_catalog()
returns table (ord integer, item text, slot text, price integer, rarity text, grade integer, season boolean)
language sql immutable set search_path = public as $$
  select * from (values
    (0, 'f_neon', 'frame', 300, 'common', null::int, false),
    (1, 'f_ice', 'frame', 400, 'common', null, false),
    (2, 'f_fire', 'frame', 900, 'rare', null, false),
    (3, 'f_cat', 'frame', 800, 'rare', null, false),
    (4, 'f_pixel', 'frame', 900, 'rare', null, false),
    (5, 'f_rainbow', 'frame', 1800, 'epic', null, false),
    (6, 'f_orbit', 'frame', 2000, 'epic', null, false),
    (7, 'f_halo', 'frame', 2200, 'epic', null, false),
    (8, 'f_crown', 'frame', 6000, 'legend', 4, false),
    (9, 'f_pumpkin', 'frame', 700, 'rare', null, true),
    (10, 'f_web', 'frame', 800, 'rare', null, true),
    (11, 'n_sunset', 'name', 300, 'common', null, false),
    (12, 'n_ocean', 'name', 300, 'common', null, false),
    (13, 'n_mint', 'name', 300, 'common', null, false),
    (14, 'n_toxic', 'name', 700, 'rare', null, false),
    (15, 'n_glitch', 'name', 1500, 'epic', null, false),
    (16, 'n_rainbow', 'name', 1800, 'epic', null, false),
    (17, 'n_gold', 'name', 4500, 'legend', 3, false),
    (18, 'n_ghost', 'name', 700, 'rare', null, true),
    (19, 't_bubbles', 'trail', 500, 'common', null, false),
    (20, 't_hearts', 'trail', 1000, 'rare', null, false),
    (21, 't_snow', 'trail', 1000, 'rare', null, false),
    (22, 't_pixels', 'trail', 1100, 'rare', null, false),
    (23, 't_stars', 'trail', 2000, 'epic', null, false),
    (24, 't_money', 'trail', 2400, 'epic', null, false),
    (25, 't_fireworks', 'trail', 7000, 'legend', 4, false),
    (26, 't_bats', 'trail', 1500, 'epic', null, true),
    (27, 'b_headset', 'badge', 300, 'common', null, false),
    (28, 'b_coffee', 'badge', 300, 'common', null, false),
    (29, 'b_clover', 'badge', 400, 'common', null, false),
    (30, 'b_fire', 'badge', 700, 'rare', null, false),
    (31, 'b_rocket', 'badge', 900, 'rare', null, false),
    (32, 'b_alien', 'badge', 900, 'rare', null, false),
    (33, 'b_unicorn', 'badge', 1800, 'epic', null, false),
    (34, 'b_diamond', 'badge', 2400, 'epic', null, false),
    (35, 'b_trophy', 'badge', 5000, 'legend', 4, false),
    (36, 'b_ghost', 'badge', 600, 'rare', null, true),
    (37, 'bn_sunset', 'banner', 500, 'common', null, false),
    (38, 'bn_ocean', 'banner', 500, 'common', null, false),
    (39, 'bn_sakura', 'banner', 1200, 'rare', null, false),
    (40, 'bn_aurora', 'banner', 1800, 'epic', null, false),
    (41, 'bn_space', 'banner', 2000, 'epic', null, false),
    (42, 'bn_matrix', 'banner', 2200, 'epic', null, false),
    (43, 'bn_gold', 'banner', 5000, 'legend', 3, false),
    (44, 'bn_night', 'banner', 900, 'rare', null, true)
  ) as c (ord, item, slot, price, rarity, grade, season)
$$;

-- искры: + бонус за дни с Грейдом III (8–10 доведённых), Грейд IV (11+) — как было
create or replace function public.crm_shop_earned() returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_op text := public.crm_op_id();
  v_role text := public.crm_role();
  v_groups text[];
  v_from timestamptz := timestamp '2026-10-01 00:00' at time zone 'Europe/Moscow';
  v_day text := '2026-10-01';
  v_own integer := 0;
  v_g3 integer := 0;
  v_g4 integer := 0;
  v_team integer := 0;
  v_bonus integer;
begin
  if v_op is not null then
    select count(*) into v_own from public.leads l
    where l.operator_id = v_op and l.status = 'done'
      and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    select count(*) filter (where n >= 11), count(*) filter (where n between 8 and 10) into v_g4, v_g3 from (
      select count(*) as n from public.leads
      where operator_id = v_op and status = 'done' and at >= v_day
      group by left(at, 10)
    ) d;
  end if;
  v_bonus := v_own * 10 + v_g3 * 20 + v_g4 * 50;

  if v_role = 'head' then
    select count(*) into v_team from public.leads l
    where l.status = 'done' and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    return v_bonus + (v_team / 10) * 10;
  end if;

  if v_role = 'supervisor' then
    v_groups := coalesce(public.crm_sup_groups(), '{}');
    if cardinality(v_groups) > 0 then
      select count(*) into v_team from public.leads l
      where l.status = 'done' and l.group_id = any (v_groups)
        and (l.status_at >= v_from or (l.status_at is null and l.at >= v_day));
    end if;
    return v_bonus + (v_team / 5) * 10;
  end if;

  return v_bonus;
end $$;

revoke all on function public.crm_shop_catalog() from public, anon;
revoke all on function public.crm_shop_earned() from public, anon;
grant execute on function public.crm_shop_catalog() to authenticated;
grant execute on function public.crm_shop_earned() to authenticated;
