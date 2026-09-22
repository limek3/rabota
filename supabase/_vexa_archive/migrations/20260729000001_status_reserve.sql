-- ═══════════════════════════════════════════════════════════════════════
-- Статус «Резерв» (candidates.status = 'reserve')
--
-- Годится, но места сейчас нет. Это не отказ: в минусе лежат те, с кем не
-- срослось, и смешивать их — значит через месяц не отличить людей, к которым
-- стоит вернуться, от тех, к кому не стоит.
--
-- status — text с CHECK, а не enum, поэтому расширение = пересоздание
-- ограничения. Имя ограничения БД сгенерировала сама (candidates_status_check),
-- отсюда drop по имени с if exists.
--
-- Применить к базе: выполнить этот файл в Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table candidates drop constraint if exists candidates_status_check;

alter table candidates
  add constraint candidates_status_check
    check (status in ('paid','adapt','employed','office','working','response','minus','referral','reserve'));

comment on column candidates.status is
  'Рабочий статус контакта: paid|adapt|employed|office|working|response|minus|referral|reserve. null — не проставлен.';
