-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — ссылка на лид только из Скорозвона
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен,
--  данные не трогаются. Заменяет функцию из 20260926000001_lead_link_required.sql —
--  всё, что она делала, остаётся, добавлена проверка адреса.
--
--  Ссылка должна вести в Скорозвон: https://app.skorozvon.ru/#/leads/<номер>/…
--  Проверяется у нового лида и когда ссылку меняют; старые лиды с другими ссылками
--  правятся как раньше (статус, клиент), пока ссылку не трогают. То же правило —
--  в приложении (lib/crm/format.ts, isSkorozvonLink): база страхует старые версии
--  десктоп-приложения, которые про него не знают.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.crm_leads_link_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_link text := btrim(coalesce(new.link, ''));
  v_bad  constant text := 'Нужна ссылка на лид из Скорозвона: https://app.skorozvon.ru/#/leads/… (обновите приложение, если оно пропускает другие)';
begin
  -- служебные роли (восстановление копии crm_replace_all, SQL Editor) — без проверки:
  -- копия должна подниматься целиком, как есть
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- upsert уже существующего лида (INSERT … ON CONFLICT) сначала проходит здесь: его
    -- пропускаем — ветка UPDATE ниже сохранит ссылку, если клиент прислал строку без неё
    if not exists (select 1 from public.leads where id = new.id) then
      if v_link = '' and coalesce(new.at, '') >= '2026-09-25' then
        raise exception 'Лид без ссылки не сохраняется — вставьте ссылку на лид (обновите приложение, если поля для ссылки нет)'
          using errcode = '23514';
      end if;
      if v_link <> '' and v_link !~* '^https://app\.skorozvon\.ru/#/leads/[0-9]+' then
        raise exception '%', v_bad using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- правка: пустая ссылка вместо непустой — это устаревшая копия, а не намерение
  if v_link = '' and btrim(coalesce(old.link, '')) <> '' then
    new.link := old.link;
    return new;
  end if;
  -- ссылку поменяли — новая тоже должна быть из Скорозвона
  if v_link <> '' and v_link is distinct from btrim(coalesce(old.link, ''))
     and v_link !~* '^https://app\.skorozvon\.ru/#/leads/[0-9]+' then
    raise exception '%', v_bad using errcode = '23514';
  end if;
  return new;
end $$;

-- триггер уже есть (…_lead_link_required.sql); пересоздаём на случай, если того файла не запускали
drop trigger if exists leads_link_guard on public.leads;
create trigger leads_link_guard before insert or update on public.leads
  for each row execute function public.crm_leads_link_guard();
