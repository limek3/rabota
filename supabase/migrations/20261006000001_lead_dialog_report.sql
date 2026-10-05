-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — разбор разговора (сводка и чек-лист) в карточке лида
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  После 20261005000001_lead_dialogs.sql.
--
--  Разбор делает Memo AI по своему шаблону отчёта (supabase/README.md, пункт 12) и отдаёт
--  текстом; функция lead-dialog кладёт его сюда как есть, карточка лида разбирает строки.
--  Пока файл не выполнен, расшифровка работает как раньше, только без разбора.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.lead_dialogs add column if not exists report_status text not null default 'none';
alter table public.lead_dialogs add column if not exists report text not null default '';

alter table public.lead_dialogs drop constraint if exists lead_dialogs_report_status_check;
alter table public.lead_dialogs add constraint lead_dialogs_report_status_check
  check (report_status in ('none', 'processing', 'done', 'failed', 'missing'));
