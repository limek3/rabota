-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — ссылка на лид и время лида по Москве
--
--  Для базы, где схема 20260921000001_crm_schema.sql уже стоит. Supabase → SQL Editor →
--  вставить файл целиком → Run. Повторный запуск безопасен, данные не трогаются.
--
--    1. leads.link — ссылка на лид (обязательна для новых лидов, проверяет CRM).
--    2. Триггер лидов: у оператора время лида ставит сервер — «сейчас» по Москве,
--       при правке время не меняется. Часы на компьютере оператора больше не влияют.
--
--  Тот же код уже есть в основной схеме — на новом проекте этот файл не нужен.
--  Добавление колонки коротко блокирует таблицу leads; если CRM открыта и запрос
--  упал по lock_timeout — просто запустите ещё раз.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.leads add column if not exists link text not null default '';

create or replace function public.crm_leads_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_role text := public.crm_role();
  v_status_changed boolean;
  v_fields_changed boolean;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.crm_is_head() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'work';
    new.status_reason := '';
    new.status_at := null;
    new.status_by := null;
    -- оператор время не выбирает: лид получает «сейчас» по Москве по часам сервера,
    -- а не по часам его компьютера
    if v_role = 'operator' then
      new.at := to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD"T"HH24:MI');
    end if;
    return new;
  end if;

  -- время передачи оператор при правке не меняет
  if v_role = 'operator' then
    new.at := old.at;
  end if;

  v_status_changed := (new.status, new.status_reason, new.status_at, new.status_by)
                      is distinct from (old.status, old.status_reason, old.status_at, old.status_by);
  v_fields_changed := (new.at, new.client, new.phone, new.project_id, new.operator_id, new.group_id, new.direction, new.link, new.comment, new.source, new.created_at)
                      is distinct from (old.at, old.client, old.phone, old.project_id, old.operator_id, old.group_id, old.direction, old.link, old.comment, old.source, old.created_at);

  if v_status_changed and not public.crm_can_review(old.operator_id, old.group_id) then
    raise exception 'Статус этого лида может поставить только супервайзер его группы или руководитель' using errcode = '42501';
  end if;
  if v_fields_changed and v_role = 'supervisor' and not public.crm_flag('supervisor', 'editLeads', true) then
    raise exception 'Править лиды супервайзерам запрещено в настройках доступа' using errcode = '42501';
  end if;
  return new;
end $$;
