-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Ручной обзвон» в графике и группа у плановых смен
--
--  1) Новый вид дня type = 'manual' (ручной обзвон): считается как смена — часы ставит
--     функция shift-hours из Скорозвона, идут в оплату и конверсию; в графике синий.
--  2) Смены с сегодняшнего дня берут текущую группу оператора. Раньше при переводе в другую
--     группу план наперёд оставался за старой, и её супервайзер видел в графике чужих людей.
--     Прошлые смены не трогаем — это история группы.
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'shifts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%training%'
  loop
    execute format('alter table public.shifts drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.shifts
  add constraint shifts_type_check check (type in ('work', 'manual', 'off', 'training', 'platform', 'vacation', 'sick'));

-- дата смены — текст 'YYYY-MM-DD', «сегодня» — по Москве
update public.shifts s
set group_id = o.group_id, updated_at = now()
from public.operators o
where s.operator_id = o.id
  and s.date >= to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD')
  and s.group_id is distinct from o.group_id;
