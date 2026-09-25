-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — ссылка на лид: обязательна и не теряется
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен,
--  данные не трогаются. Нужна колонка leads.link (20260925000001_lead_link_time.sql).
--
--  Проверка в самой базе, а не только в CRM: лиды пишут и старые версии десктоп-
--  приложения, которые про ссылку не знают.
--    1. Новый лид без ссылки не сохраняется. Лиды со временем передачи раньше
--       2026-09-25 (история, перенос из браузера, импорт) — пропускаются.
--    2. Непустую ссылку нельзя заменить пустой: клиент со старой копией лида
--       (например, супервайзер ставит статус) больше не затирает ссылку оператора.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.crm_leads_link_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- upsert уже существующего лида (INSERT … ON CONFLICT) сначала проходит здесь: его
    -- пропускаем — ветка UPDATE ниже сохранит ссылку, если клиент прислал строку без неё
    if btrim(coalesce(new.link, '')) = '' and coalesce(new.at, '') >= '2026-09-25'
       and not exists (select 1 from public.leads where id = new.id) then
      raise exception 'Лид без ссылки не сохраняется — вставьте ссылку на лид (обновите приложение, если поля для ссылки нет)'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- правка: пустая ссылка вместо непустой — это устаревшая копия, а не намерение
  if btrim(coalesce(new.link, '')) = '' and btrim(coalesce(old.link, '')) <> '' then
    new.link := old.link;
  end if;
  return new;
end $$;

-- имя после leads_guard: триггеры BEFORE идут по алфавиту, время лида к этому моменту уже выставлено
drop trigger if exists leads_link_guard on public.leads;
create trigger leads_link_guard before insert or update on public.leads
  for each row execute function public.crm_leads_link_guard();
