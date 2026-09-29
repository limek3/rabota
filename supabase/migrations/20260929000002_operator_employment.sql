-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — оформление оператора (самозанятый / оформляется / не оформлен)
--
--  Для базы, где схема 20260921000001_crm_schema.sql уже стоит. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Колонка без not null: импорт и восстановление копии (crm_replace_all) вставляют
--  операторов через jsonb_populate_recordset, и у копий, сделанных до этой миграции,
--  поля нет — пришёл бы null. Пусто в приложении = «не оформлен».
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.operators add column if not exists employment text default 'none';

alter table public.operators drop constraint if exists operators_employment_check;
alter table public.operators add constraint operators_employment_check
  check (employment is null or employment in ('none', 'pending', 'smz'));
