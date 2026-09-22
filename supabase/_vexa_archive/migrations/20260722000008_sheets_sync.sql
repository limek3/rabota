-- Настоящая выгрузка в Google Sheets.
--
-- До сих пор экран «Синхронизация» был макетом: «Подключить» ждало полторы
-- секунды через setTimeout и рисовало «доступ выдан», а «Синхронизировать»
-- только переставляло отметку времени. Ни одного запроса к Google не уходило —
-- в коде это честно и написано.
--
-- Пишет в таблицу Edge Function sync-sheet: приложение собрано статикой
-- (next.config.mjs, output: "export"), сервера нет, а ключ сервисного аккаунта
-- в браузере означал бы, что его скачал каждый.
--
-- Таблица у каждого воркспейса своя: crm_sheets уже привязан к workspace_id, и
-- один робот обслуживает их все — каждый по своей ссылке.

alter table public.crm_sheets
  -- id из ссылки. Держим отдельно от url, потому что ссылку человек вставляет
  -- в любом виде (с /edit, с #gid, с ?usp=sharing), а в API уходит только id.
  add column if not exists spreadsheet_id text not null default '',
  -- Имя листа. Отдельный лист под выгрузку — чтобы человек мог держать рядом
  -- свои вкладки со сводными, и мы бы их не затирали.
  add column if not exists tab_name text not null default 'Контакты',
  -- Итог последней попытки. Пустая строка = успех.
  --
  -- Без этого «не синхронизировалось» не имеет ответа: последняя отметка
  -- времени просто не меняется, и непонятно, то ли не запускалось, то ли
  -- Google отказал. Текст ошибки от Google кладём сюда как есть.
  add column if not exists last_error text not null default '',
  add column if not exists last_rows integer not null default 0;

comment on column public.crm_sheets.spreadsheet_id is
  'ID таблицы из ссылки. Пусто = не подключено.';
comment on column public.crm_sheets.last_error is
  'Ошибка последней синхронизации; пусто — прошла успешно.';

-- Политику на crm_sheets заводим явно: до сих пор строка создавалась вместе с
-- воркспейсом и правилась только клиентом, теперь её же пишет функция.
drop policy if exists csheet_select on crm_sheets;
create policy csheet_select on crm_sheets for select to authenticated
  using (is_member(workspace_id));

-- Подключает и отключает таблицу руководитель: это общий для команды канал
-- наружу, и адрес, куда уезжает вся база контактов, не должен менять любой.
drop policy if exists csheet_write on crm_sheets;
create policy csheet_write on crm_sheets for all to authenticated
  using (is_member(workspace_id) and is_manager(workspace_id))
  with check (is_member(workspace_id) and is_manager(workspace_id));

-- ── расписание ────────────────────────────────────────────────────────────
--
-- «Автосинк при каждом изменении», обещанный в интерфейсе, в лоб делать нельзя:
-- у Sheets API порядка 60 запросов в минуту на пользователя, и команда из пяти
-- человек, двигающая карточки, выбьет лимит за минуту. Поэтому автосинк —
-- это расписание раз в 10 минут, а кнопка «Синхронизировать» остаётся для
-- «прямо сейчас».
--
-- ВНИМАНИЕ, деплой руками:
--   1) supabase functions deploy sync-sheet
--   2) supabase secrets set GOOGLE_SERVICE_ACCOUNT='<весь JSON-ключ одной строкой>'
--   3) выполнить блок ниже, подставив URL проекта и service_role ключ.
--
-- Пример построчным комментарием, а не блочным: в cron-строке есть
-- «звёздочка со слешем», внутри /* */ она закрыла бы комментарий раньше времени.
--
-- select cron.schedule(
--   'sync-sheets',
--   '*/10 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/sync-sheet',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{"all":true}'::jsonb
--   );
--   $$
-- );
--
-- Снять расписание: select cron.unschedule('sync-sheets');
