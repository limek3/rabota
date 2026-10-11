-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — время выхода оператора на смену (9:00, 10:00, 11:00, с обеда…)
--
--  Видно в графике справа от ФИО, меняется там же или в карточке оператора.
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Колонка без not null: импорт и восстановление копии (crm_replace_all) вставляют
--  операторов через jsonb_populate_recordset, у старых копий поля нет — придёт null.
--  Пусто в приложении = «не указано».
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.operators add column if not exists start_time text default '';

alter table public.operators drop constraint if exists operators_start_time_check;
alter table public.operators add constraint operators_start_time_check
  check (start_time is null or start_time = '' or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
