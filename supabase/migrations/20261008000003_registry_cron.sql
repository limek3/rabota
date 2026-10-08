-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — реестры выплат YouDo сами, каждый день в 10:00 по Москве
--
--  Функция registry-sheet смотрит график выплат: за 2 дня до периода создаёт «План ОКЦ/СВ»,
--  в день реестра — «Факт ОКЦ/СВ» в таблицах бухгалтера и пишет итог в Telegram.
--  В остальные дни ничего не делает. Уже созданный лист второй раз не трогает.
--
--  Перед запуском:
--    1. Задеплоить supabase/functions/registry-sheet/index.ts (Edge Functions → registry-sheet → Deploy).
--    2. Edge Functions → Secrets: CRON_SECRET — уже есть (тот же, что у shift-hours и leads-sheet);
--       TELEGRAM_BOT_TOKEN — токен бота Vexi; TELEGRAM_CHAT_ID — ваш Telegram ID.
--    3. Ниже вместо ВСТАВЬТЕ_ANON_KEY и ВСТАВЬТЕ_CRON_SECRET — те же значения, что в
--       20261008000002_leads_sheet_cron.sql (Authorization: Bearer … и x-cron-secret).
--    4. В CRM: Настройки → Данные → «Реестры выплат YouDo» — ссылка /exec, секрет, суммы плана и
--       переключатель «Создавать реестры автоматически». Выключен — расписание ничего не делает.
--  Потом: Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен —
--  задание пересоздаётся.
--
--  Время cron — UTC: '0 7 * * *' = 07:00 UTC = 10:00 МСК.
--  Проверить, что задание есть:        select jobname, schedule from cron.job;
--  Последние запуски и ответы функции: select * from cron.job_run_details order by start_time desc limit 5;
--                                      select status_code, content from net._http_response order by created desc limit 5;
--  Выключить:                          select cron.unschedule('registry-daily');
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'registry-daily';

select cron.schedule(
  'registry-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://lfwheilgsoyuxidwldhv.supabase.co/functions/v1/registry-sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxmd2hlaWxnc295dXhpZHdsZGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTcyOTcsImV4cCI6MjEwNTU3MzI5N30.gNp8zIIgyCWic_6ZjLGxP-zP-KBwsy7M_5EYAg9d0AA',
      'x-cron-secret', 'ВСТАВЬТЕ_CRON_SECRET'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
