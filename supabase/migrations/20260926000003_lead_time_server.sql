-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — время лида ставит только сервер, по Москве
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен,
--  данные не трогаются.
--
--  Раньше сервер ставил время только лидам операторов, а супервайзер и руководитель
--  могли выбрать его в форме — и время лидов «гуляло». Теперь для всех ролей и любой
--  версии приложения (в том числе старого десктопа, который считал по часам компьютера):
--    1. Новый лид получает время «сейчас» по Москве — по часам сервера, что бы ни
--       прислал клиент.
--    2. При правке время лида не меняется.
--  Не трогаются: служебные роли (восстановление копии, SQL Editor) и перенос истории
--  из браузера — у старых лидов created_at старше суток, их время сохраняется как было.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.crm_leads_at_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- upsert уже существующего лида (INSERT … ON CONFLICT) — время решает ветка UPDATE
    if not exists (select 1 from public.leads where id = new.id)
       and coalesce(new.created_at, now()) > now() - interval '1 day' then
      new.at := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD"T"HH24:MI');
    end if;
    return new;
  end if;

  new.at := old.at;
  return new;
end $$;

-- имя раньше leads_guard по алфавиту: время выставлено до остальных проверок
drop trigger if exists leads_at_guard on public.leads;
create trigger leads_at_guard before insert or update on public.leads
  for each row execute function public.crm_leads_at_guard();
