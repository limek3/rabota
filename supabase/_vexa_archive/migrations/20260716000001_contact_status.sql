-- ═══════════════════════════════════════════════════════════════════════
-- Рабочий статус контакта (candidates.status)
--
-- Статус живёт рядом со стадией воронки: стадия — где сделка в процессе,
-- статус — что с человеком фактически происходит (отклик → в работе →
-- в офис → устроен → адапт → оплачен; минус / есть знакомый — тупики).
-- Проставляется прямо из таблицы «База контактов» выпадающим списком.
--
-- null = статус не проставлен.
-- Применить к базе: выполнить этот файл в Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table candidates
  add column if not exists status text
    check (status in ('paid','adapt','employed','office','working','response','minus','referral'));

comment on column candidates.status is
  'Рабочий статус контакта: paid|adapt|employed|office|working|response|minus|referral. null — не проставлен.';

-- фильтр «по статусу» в базе контактов — самый частый запрос по таблице
create index if not exists candidates_status_idx on candidates (workspace_id, status);
