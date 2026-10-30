-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Морской бой»: партии один на один, ходами, в своём темпе
--
--  Для базы, где стоит схема CRM. Supabase → SQL Editor → вставить файл целиком → Run.
--  Повторный запуск безопасен.
--
--  Поле 10×10, флот по классике: 1×4, 2×3, 3×2, 4×1, корабли не касаются даже углами.
--  Попал — ходишь ещё, промах — ход сопернику. Партия: вызов → расстановка → бой → итог.
--
--  Честность: расстановка лежит в sea_fleets, и каждый видит только свою. Попал ли выстрел,
--  решает база (crm_sea_fire), флот соперника открывается только после конца партии.
--  sea_games — открытая часть партии (ходы, чей ход, итог): её видят оба игрока, Realtime
--  присылает изменения. Писать — только через функции ниже.
--
--  Не больше 5 незаконченных партий на человека и одной — с одним и тем же соперником.
--  Соперник молчит больше суток в свой ход — победу можно забрать (crm_sea_claim).
--  Те же правила в приложении — lib/sea.ts.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.sea_games (
  id         bigint generated always as identity primary key,
  -- без внешних ключей: импорт (crm_replace_all) пересоздаёт аккаунты, партии должны пережить это
  a_id       text not null,             -- кто вызвал
  b_id       text not null,             -- кого вызвали
  a_name     text not null default '',
  b_name     text not null default '',
  status     text not null default 'invite' check (status in ('invite', 'setup', 'play', 'done', 'declined', 'cancelled')),
  a_ready    boolean not null default false,
  b_ready    boolean not null default false,
  -- выстрелы: [[x, y, r], …], r: 0 — мимо, 1 — попал, 2 — корабль потоплен
  a_shots    jsonb not null default '[]',   -- куда стрелял A (по флоту B)
  b_shots    jsonb not null default '[]',
  turn       text,
  winner     text,
  ended_by   text check (ended_by in ('win', 'resign', 'timeout')),
  emote      text,
  emote_by   text,
  emote_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moved_at   timestamptz not null default now()
);

create index if not exists sea_games_a_idx on public.sea_games (a_id, status);
create index if not exists sea_games_b_idx on public.sea_games (b_id, status);

-- расстановка: [[[x, y], …], …] — корабли и их клетки
create table if not exists public.sea_fleets (
  game_id    bigint not null references public.sea_games (id) on delete cascade,
  account_id text not null,
  cells      jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, account_id)
);

alter table public.sea_games enable row level security;
alter table public.sea_fleets enable row level security;
drop policy if exists sea_games_select on public.sea_games;
create policy sea_games_select on public.sea_games for select to authenticated
  using (a_id = (select public.crm_account_id()) or b_id = (select public.crm_account_id()));
drop policy if exists sea_fleets_select on public.sea_fleets;
-- свою расстановку — да, чужую — никогда
create policy sea_fleets_select on public.sea_fleets for select to authenticated
  using (account_id = (select public.crm_account_id()));

revoke all on public.sea_games from anon, authenticated;
revoke all on public.sea_fleets from anon, authenticated;
grant select on public.sea_games to authenticated;
grant select on public.sea_fleets to authenticated;

-- ── правила ─────────────────────────────────────────────────────────────

-- флот по правилам: 10 кораблей 4-3-3-2-2-2-1-1-1-1, прямые, в поле, не касаются
create or replace function public.crm_sea_fleet_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  s jsonb;
  c jsonb;
  xs int[];
  ys int[];
  n int;
  k int := 0;
  sizes int[] := '{}';
  cx int[] := '{}';
  cy int[] := '{}';
  cs int[] := '{}';
  i int;
  j int;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) <> 10 then
    return false;
  end if;
  for s in select value from jsonb_array_elements(p) loop
    k := k + 1;
    if jsonb_typeof(s) <> 'array' then return false; end if;
    xs := '{}';
    ys := '{}';
    for c in select value from jsonb_array_elements(s) loop
      if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) <> 2
         or jsonb_typeof(c -> 0) <> 'number' or jsonb_typeof(c -> 1) <> 'number' then
        return false;
      end if;
      xs := xs || (c ->> 0)::numeric::int;
      ys := ys || (c ->> 1)::numeric::int;
    end loop;
    n := coalesce(array_length(xs, 1), 0);
    if n < 1 or n > 4 then return false; end if;
    if exists (select 1 from unnest(xs) v where v < 0 or v > 9) or exists (select 1 from unnest(ys) v where v < 0 or v > 9) then
      return false;
    end if;
    -- прямой и без дыр: одна координата общая, другая идёт подряд
    if (select count(distinct v) from unnest(xs) v) = 1 then
      if (select count(distinct v) from unnest(ys) v) <> n or (select max(v) - min(v) + 1 from unnest(ys) v) <> n then return false; end if;
    elsif (select count(distinct v) from unnest(ys) v) = 1 then
      if (select count(distinct v) from unnest(xs) v) <> n or (select max(v) - min(v) + 1 from unnest(xs) v) <> n then return false; end if;
    else
      return false;
    end if;
    sizes := sizes || n;
    for i in 1..n loop
      cx := cx || xs[i];
      cy := cy || ys[i];
      cs := cs || k;
    end loop;
  end loop;
  if (select array_agg(v order by v desc) from unnest(sizes) v) <> '{4,3,3,2,2,2,1,1,1,1}'::int[] then
    return false;
  end if;
  -- разные корабли не касаются ни сторонами, ни углами
  for i in 1..array_length(cx, 1) loop
    for j in i + 1..array_length(cx, 1) loop
      if cs[i] <> cs[j] and abs(cx[i] - cx[j]) <= 1 and abs(cy[i] - cy[j]) <= 1 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
exception
  when others then
    return false;
end $$;

-- партия, в которой участвует вошедший, — или ошибка
create or replace function public.crm_sea_mine(p_id bigint) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games;
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  select * into v_g from public.sea_games where id = p_id for update;
  if v_g.id is null or v_acc not in (v_g.a_id, v_g.b_id) then
    raise exception 'Партия не найдена' using errcode = '22023';
  end if;
  return v_g;
end $$;

-- ── игроки и рейтинг ────────────────────────────────────────────────────

-- кого можно вызвать: все активные аккаунты, кроме себя (оператор других аккаунтов не видит — отсюда функция)
create or replace function public.crm_sea_players()
returns table (id text, name text, role text, seen timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.role, a.last_seen_at
  from public.accounts a
  where a.active and a.deleted_at is null and a.id <> public.crm_account_id()
    and public.crm_account_id() is not null
  order by a.name
$$;

-- адмиралы: победы и партии за 90 дней
create or replace function public.crm_sea_top()
returns table (id text, name text, wins int, games int)
language sql stable security definer set search_path = public as $$
  with fin as (
    select a_id, b_id, winner from public.sea_games
    where status = 'done' and winner is not null and updated_at > now() - interval '90 days'
  ), p as (
    select a_id as id, winner from fin union all select b_id, winner from fin
  )
  select p.id, coalesce(max(a.name), ''), count(*) filter (where p.winner = p.id)::int, count(*)::int
  from p left join public.accounts a on a.id = p.id
  where public.crm_account_id() is not null
  group by p.id
  order by 3 desc, 4 asc
  limit 20
$$;

-- ── партия ──────────────────────────────────────────────────────────────

create or replace function public.crm_sea_invite(p_to text) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_to public.accounts;
  v_row public.sea_games;
begin
  if v_acc is null then
    raise exception 'Нет аккаунта CRM' using errcode = '42501';
  end if;
  select * into v_to from public.accounts where id = p_to and active and deleted_at is null;
  if v_to.id is null or v_to.id = v_acc then
    raise exception 'Такого соперника нет' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('sea|' || least(v_acc, p_to) || '|' || greatest(v_acc, p_to)));
  if exists (select 1 from public.sea_games
             where status in ('invite', 'setup', 'play')
               and ((a_id = v_acc and b_id = p_to) or (a_id = p_to and b_id = v_acc))) then
    raise exception 'С этим соперником уже идёт партия' using errcode = '22023';
  end if;
  if (select count(*) from public.sea_games
      where status in ('invite', 'setup', 'play') and v_acc in (a_id, b_id)) >= 5 then
    raise exception 'У вас уже 5 незаконченных партий — доиграйте одну' using errcode = '22023';
  end if;
  insert into public.sea_games (a_id, b_id, a_name, b_name)
  values (v_acc, p_to, coalesce((select name from public.accounts where id = v_acc), ''), v_to.name)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.crm_sea_answer(p_id bigint, p_accept boolean) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_g public.sea_games := public.crm_sea_mine(p_id);
begin
  if v_g.status <> 'invite' or v_g.b_id <> public.crm_account_id() then
    raise exception 'Вызов уже неактуален' using errcode = '22023';
  end if;
  update public.sea_games
  set status = case when p_accept then 'setup' else 'declined' end, updated_at = now(), moved_at = now()
  where id = p_id returning * into v_g;
  return v_g;
end $$;

-- выйти: отменить свой вызов или сдаться
create or replace function public.crm_sea_leave(p_id bigint) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
  v_other text := case when v_g.a_id = v_acc then v_g.b_id else v_g.a_id end;
begin
  if v_g.status = 'invite' then
    update public.sea_games
    set status = case when v_g.a_id = v_acc then 'cancelled' else 'declined' end, updated_at = now()
    where id = p_id returning * into v_g;
  elsif v_g.status in ('setup', 'play') then
    update public.sea_games
    set status = 'done', winner = v_other, ended_by = 'resign', turn = null, updated_at = now()
    where id = p_id returning * into v_g;
  else
    raise exception 'Партия уже закончилась' using errcode = '22023';
  end if;
  return v_g;
end $$;

-- забрать победу: соперник молчит больше суток в свой ход (или не расставил флот)
create or replace function public.crm_sea_claim(p_id bigint) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
  v_mine_ready boolean := case when v_g.a_id = v_acc then v_g.a_ready else v_g.b_ready end;
  v_their_ready boolean := case when v_g.a_id = v_acc then v_g.b_ready else v_g.a_ready end;
begin
  if v_g.moved_at > now() - interval '24 hours'
     or not ((v_g.status = 'play' and v_g.turn <> v_acc) or (v_g.status = 'setup' and v_mine_ready and not v_their_ready)) then
    raise exception 'Забрать победу можно, если соперник молчит больше суток' using errcode = '22023';
  end if;
  update public.sea_games
  set status = 'done', winner = v_acc, ended_by = 'timeout', turn = null, updated_at = now()
  where id = p_id returning * into v_g;
  return v_g;
end $$;

create or replace function public.crm_sea_place(p_id bigint, p_cells jsonb) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
begin
  if v_g.status <> 'setup' then
    raise exception 'Расставлять флот уже поздно' using errcode = '22023';
  end if;
  if exists (select 1 from public.sea_fleets where game_id = p_id and account_id = v_acc) then
    raise exception 'Флот уже расставлен' using errcode = '22023';
  end if;
  if not public.crm_sea_fleet_ok(p_cells) then
    raise exception 'Флот расставлен не по правилам' using errcode = '22023';
  end if;
  insert into public.sea_fleets (game_id, account_id, cells) values (p_id, v_acc, p_cells);
  update public.sea_games
  set a_ready = a_ready or a_id = v_acc,
      b_ready = b_ready or b_id = v_acc,
      updated_at = now(), moved_at = now()
  where id = p_id returning * into v_g;
  -- оба готовы — в бой; первым стреляет случайный
  if v_g.a_ready and v_g.b_ready then
    update public.sea_games
    set status = 'play', turn = case when random() < 0.5 then a_id else b_id end, updated_at = now(), moved_at = now()
    where id = p_id returning * into v_g;
  end if;
  return v_g;
end $$;

-- выстрел: r = 0 мимо, 1 попал, 2 потопил; попал — ходишь ещё
create or replace function public.crm_sea_fire(p_id bigint, p_x integer, p_y integer) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
  v_is_a boolean := v_g.a_id = v_acc;
  v_other text := case when v_g.a_id = v_acc then v_g.b_id else v_g.a_id end;
  v_shots jsonb := case when v_g.a_id = v_acc then v_g.a_shots else v_g.b_shots end;
  v_fleet jsonb;
  v_ship jsonb;
  v_cell jsonb := jsonb_build_array(p_x, p_y);
  v_sunk boolean;
  v_hits int;
begin
  if v_g.status <> 'play' then
    raise exception 'Партия не идёт' using errcode = '22023';
  end if;
  if v_g.turn <> v_acc then
    raise exception 'Сейчас ход соперника' using errcode = '22023';
  end if;
  if p_x is null or p_y is null or p_x < 0 or p_y < 0 or p_x > 9 or p_y > 9 then
    raise exception 'Мимо поля' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_shots) e where (e ->> 0)::int = p_x and (e ->> 1)::int = p_y) then
    raise exception 'Сюда уже стреляли' using errcode = '22023';
  end if;

  select cells into v_fleet from public.sea_fleets where game_id = p_id and account_id = v_other;
  -- клетки сравниваем точно: @> у массивов не смотрит на порядок, и [0, 2] совпал бы с [2, 0]
  select s.value into v_ship from jsonb_array_elements(v_fleet) s
  where exists (select 1 from jsonb_array_elements(s.value) c where c.value = v_cell)
  limit 1;

  if v_ship is null then
    v_shots := v_shots || jsonb_build_array(jsonb_build_array(p_x, p_y, 0));
  else
    v_shots := v_shots || jsonb_build_array(jsonb_build_array(p_x, p_y, 1));
    -- потоплен, если все клетки корабля подбиты
    select bool_and(exists (
      select 1 from jsonb_array_elements(v_shots) e
      where e -> 0 = c -> 0 and e -> 1 = c -> 1 and (e ->> 2)::int > 0
    )) into v_sunk
    from jsonb_array_elements(v_ship) c;
    if v_sunk then
      select jsonb_agg(case when exists (select 1 from jsonb_array_elements(v_ship) c where c.value = jsonb_build_array(e -> 0, e -> 1))
                            then jsonb_build_array(e -> 0, e -> 1, 2) else e end order by ord)
      into v_shots
      from jsonb_array_elements(v_shots) with ordinality t(e, ord);
    end if;
  end if;

  select count(*) into v_hits from jsonb_array_elements(v_shots) e where (e ->> 2)::int > 0;

  update public.sea_games
  set a_shots = case when v_is_a then v_shots else a_shots end,
      b_shots = case when v_is_a then b_shots else v_shots end,
      status = case when v_hits >= 20 then 'done' else status end,
      winner = case when v_hits >= 20 then v_acc else winner end,
      ended_by = case when v_hits >= 20 then 'win' else ended_by end,
      turn = case when v_hits >= 20 then null when v_ship is null then v_other else v_acc end,
      updated_at = now(), moved_at = now()
  where id = p_id returning * into v_g;
  return v_g;
end $$;

-- эмоция сопернику (из короткого списка)
create or replace function public.crm_sea_emote(p_id bigint, p_emote text) returns public.sea_games
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
begin
  if p_emote is null or not (p_emote = any (array['👍', '😎', '😱', '🔥', '😂', '🎯', '💀', '🤝', '🙏', '👋'])) then
    raise exception 'Нет такой эмоции' using errcode = '22023';
  end if;
  if v_g.emote_by = v_acc and v_g.emote_at > now() - interval '2 seconds' then
    raise exception 'Не так быстро' using errcode = '22023';
  end if;
  update public.sea_games set emote = p_emote, emote_by = v_acc, emote_at = now(), updated_at = now()
  where id = p_id returning * into v_g;
  return v_g;
end $$;

-- флот соперника — только когда партия закончена
create or replace function public.crm_sea_reveal(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_acc text := public.crm_account_id();
  v_g public.sea_games := public.crm_sea_mine(p_id);
begin
  if v_g.status <> 'done' then
    raise exception 'Флот соперника откроется после партии' using errcode = '22023';
  end if;
  return (select cells from public.sea_fleets
          where game_id = p_id and account_id = case when v_g.a_id = v_acc then v_g.b_id else v_g.a_id end);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'crm_sea_fleet_ok(jsonb)', 'crm_sea_mine(bigint)', 'crm_sea_players()', 'crm_sea_top()',
    'crm_sea_invite(text)', 'crm_sea_answer(bigint, boolean)', 'crm_sea_leave(bigint)', 'crm_sea_claim(bigint)',
    'crm_sea_place(bigint, jsonb)', 'crm_sea_fire(bigint, integer, integer)', 'crm_sea_emote(bigint, text)', 'crm_sea_reveal(bigint)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- realtime: ходы соперника сразу видны (каждому — только свои партии, RLS)
do $$
begin
  execute 'alter publication supabase_realtime add table public.sea_games';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
