-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — убрать «Морской бой» из базы
--
--  Раздел убран из CRM. Нужно, только если в базе запускали 20261030000004_sea_battle.sql:
--  удаляет таблицы sea_games и sea_fleets (все сыгранные партии) и функции crm_sea_*.
--  Если ту миграцию не запускали — запускать нечего, но и вреда не будет.
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

drop function if exists public.crm_sea_reveal(bigint);
drop function if exists public.crm_sea_emote(bigint, text);
drop function if exists public.crm_sea_fire(bigint, integer, integer);
drop function if exists public.crm_sea_place(bigint, jsonb);
drop function if exists public.crm_sea_claim(bigint);
drop function if exists public.crm_sea_leave(bigint);
drop function if exists public.crm_sea_answer(bigint, boolean);
drop function if exists public.crm_sea_invite(text);
drop function if exists public.crm_sea_top();
drop function if exists public.crm_sea_players();
drop function if exists public.crm_sea_mine(bigint);
drop function if exists public.crm_sea_fleet_ok(jsonb);

-- таблицы уходят и из публикации Realtime вместе с собой
drop table if exists public.sea_fleets;
drop table if exists public.sea_games;
