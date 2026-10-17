-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — города проекта и отметки формы у лида (100 up)
--
--  projects.regions — свои города проекта: в окне лида это список «Город клиента» (100 up — города
--                     автосалонов). Пусто — как раньше, регионы «Основа» / «Регионы» из настроек (авто.ру).
--  leads.checks     — какие пункты чек-листа проекта оператор отметил при записи (для 100 up — что
--                     заполнено в форме). В карточке лида они видны галочками.
--
--  Заодно проставляет «100 up» его города, если их ещё не задали руками.
--  Выполнять после 20261017000002_project_form.sql.
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Колонки без not null: старые копии (crm_replace_all) вставят null — приложение читает его как «нет».
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.projects add column if not exists regions jsonb default '[]'::jsonb;
alter table public.leads add column if not exists checks jsonb;

update public.projects
set regions = '["Москва", "Краснодар", "Самара", "Сургут", "Липецк", "Тольятти", "Екатеринбург", "Тюмень"]'::jsonb,
    updated_at = now()
where deleted_at is null
  and regexp_replace(lower(name), '[^a-z0-9а-я]', '', 'g') = '100up'
  and coalesce(regions, '[]'::jsonb) = '[]'::jsonb;
