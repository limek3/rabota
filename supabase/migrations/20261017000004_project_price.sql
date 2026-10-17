-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — своя цена лида и апрув у проекта (100 up — 750 ₽ за лид)
--
--  projects.lead_price  — цена лида у заказчика, ₽. Больше 0 — все лиды проекта считаются по ней,
--                         без деления «основа / регионы»; 0 или пусто — цены из настроек (авто.ру).
--  projects.approve_pct — апрув проекта по умолчанию, %: если за месяц апрув проекта не проставлен.
--                         Пусто — общий апрув по умолчанию. Апрув за месяц, как раньше, — в «Зарплате».
--
--  Заодно ставит «100 up» цену 750 ₽ (если цену ещё не задали руками); апрув не трогает — он пока неизвестен.
--  Выполнять после 20261017000002_project_form.sql.
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Колонки без not null: старые копии (crm_replace_all) вставят null — приложение читает его как «нет».
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.projects add column if not exists lead_price numeric default 0;
alter table public.projects add column if not exists approve_pct numeric;

alter table public.projects drop constraint if exists projects_lead_price_check;
alter table public.projects add constraint projects_lead_price_check check (lead_price is null or lead_price >= 0);
alter table public.projects drop constraint if exists projects_approve_pct_check;
alter table public.projects add constraint projects_approve_pct_check check (approve_pct is null or (approve_pct >= 0 and approve_pct <= 100));

update public.projects
set lead_price = 750, updated_at = now()
where deleted_at is null
  and regexp_replace(lower(name), '[^a-z0-9а-я]', '', 'g') = '100up'
  and coalesce(lead_price, 0) = 0;
