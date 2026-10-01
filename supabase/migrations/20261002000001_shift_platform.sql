-- Новый вид дня в графике: «Обучение на платформе» (type = 'platform').
-- Часы отмечаются для учёта, но не оплачиваются и не идут в часы и конверсию — это решает клиент.
-- Пересоздаём проверку допустимых значений shifts.type (у встроенной проверки имя shifts_type_check).

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
  add constraint shifts_type_check check (type in ('work', 'off', 'training', 'platform', 'vacation', 'sick'));
