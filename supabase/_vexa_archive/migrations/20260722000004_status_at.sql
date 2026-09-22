-- Момент последней смены статуса.
--
-- Баг. Классификатор с 20260716000001 — это `status`, а триггер time-in-stage
-- из init остался на старой колонке `stage` и двигает `stage_at`. Статус
-- меняют каждый день, `stage` не трогают вовсе — значит `stage_at` в live
-- застыл на дате создания карточки.
--
-- Клиент читает его как statusTs (см. lib/db.ts, там об этом стоит честная
-- пометка), и от него считаются три числа на экране аналитики: «зависли > 7
-- дней в статусе», «ср. дней в статусе» и «время до сделки». Все три в live
-- врут — и врут правдоподобно, что хуже пустого места: на них смотрят и
-- принимают решения.
--
-- Заводим свою колонку под нынешний классификатор и триггер к ней. Задним
-- числом историю восстановить неоткуда, поэтому засеваем ближайшим известным
-- моментом: stage_at (создание карточки). Со следующей смены статуса число
-- станет настоящим.
alter table public.candidates
  add column if not exists status_at timestamptz not null default now();

update public.candidates set status_at = coalesce(stage_at, created_at, now());

create or replace function public.touch_status_at()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end $$;

drop trigger if exists candidates_status_at on public.candidates;

create trigger candidates_status_at
  before update on public.candidates
  for each row execute function public.touch_status_at();

comment on column public.candidates.status_at is
  'Когда статус менялся в последний раз. Основа для time-in-status и «зависших».';
