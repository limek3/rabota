-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — убрать «Перевод на менеджера» (Переведён / Обрыв / Менеджер не взял)
--
--  Отметку перевода в лиде отменили. Если в Supabase уже запускали прежний файл
--  20261008000001_lead_drops.sql (любую его версию) — этот убирает всё, что тот добавил:
--  колонки, триггеры и функции. Если не запускали — ничего не меняет.
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Лиды, их статусы и остальные поля не трогаются.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

drop trigger if exists leads_transfer_sync on public.leads;
drop trigger if exists leads_drops_guard on public.leads;
drop function if exists public.crm_leads_transfer_sync();
drop function if exists public.crm_leads_drop_guard();
drop function if exists public.crm_lead_set_transfer(text, text, text);
drop function if exists public.crm_lead_set_transfer(text, text);
drop function if exists public.crm_lead_transfer(text, text);
drop function if exists public.crm_lead_drop_reason(text, text);
drop function if exists public.crm_lead_drop_review(text, text, text, text);

drop index if exists public.leads_transfer_idx;
drop index if exists public.leads_transfer_open_idx;
drop index if exists public.leads_drop_at_idx;
alter table public.leads drop constraint if exists leads_transfer_check;

alter table public.leads drop column if exists transfer;
alter table public.leads drop column if exists transfer_reason;
alter table public.leads drop column if exists transfer_attempts;
alter table public.leads drop column if exists transfer_limit;
alter table public.leads drop column if exists transfer_next_at;
alter table public.leads drop column if exists drop_at;
alter table public.leads drop column if exists drop_reason;
alter table public.leads drop column if exists retry_result;
alter table public.leads drop column if exists transfer_log;
alter table public.leads drop column if exists drop_review_by;
alter table public.leads drop column if exists drop_review_at;
