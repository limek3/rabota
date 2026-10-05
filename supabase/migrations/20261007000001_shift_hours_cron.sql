-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — часы в график из Скорозвона, каждый день в 21:01 по Москве
--
--  Перед запуском:
--    1. Задеплоить функцию supabase/functions/shift-hours (Edge Functions → Deploy).
--    2. Edge Functions → Secrets: CRON_SECRET = любая длинная случайная строка.
--    3. Ниже вместо ВСТАВЬТЕ_CRON_SECRET вписать ту же строку.
--  Потом: Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен —
--  задание пересоздаётся. Ключ ниже — публичный (тот же, что в приложении), он только пропускает
--  запрос к функции; часы пишет функция, если совпал CRON_SECRET.
--
--  Время cron — UTC: '1 18 * * *' = 18:01 UTC = 21:01 МСК.
--  Проверить, что задание есть:        select jobname, schedule from cron.job;
--  Последние запуски и ответы функции: select * from cron.job_run_details order by start_time desc limit 5;
--                                      select status_code, content from net._http_response order by created desc limit 5;
--  Выключить:                          select cron.unschedule('shift-hours-daily');
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'shift-hours-daily';

select cron.schedule(
  'shift-hours-daily',
  '1 18 * * *',
  $$
  select net.http_post(
    url := 'https://biexnhtaeyytmoarwswh.supabase.co/functions/v1/shift-hours',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpZXhuaHRhZXl5dG1vYXJ3c3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNTIwNTQsImV4cCI6MjA5OTYyODA1NH0.bVptA2iT2jWhNjgUbKea6moXwLqa85mWjo93OkL1LcM',
      'x-cron-secret', 'ВСТАВЬТЕ_CRON_SECRET'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
