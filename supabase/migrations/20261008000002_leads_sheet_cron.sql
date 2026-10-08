-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — лиды в таблицу ОКК каждый день в 13:00 и 19:00 по Москве (и в выходные)
--
--  Перед запуском:
--    1. Задеплоить функцию supabase/functions/leads-sheet (Edge Functions → Deploy).
--    2. Edge Functions → Secrets: CRON_SECRET — уже есть, если настроены часы из Скорозвона
--       (shift-hours); если нет — любая длинная случайная строка.
--    3. Ниже вместо ВСТАВЬТЕ_CRON_SECRET вписать ту же строку.
--    4. В CRM: Настройки → Данные → «Таблица лидов для ОКК» — ссылка /exec, секрет и
--       переключатель «Выгружать автоматически». Выключен — расписание ничего не делает.
--  Потом: Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен —
--  задание пересоздаётся. Ключ ниже — публичный (тот же, что в приложении), он только пропускает
--  запрос к функции; выгружает функция, если совпал CRON_SECRET.
--
--  Время cron — UTC: '0 10,16 * * *' = 10:00 и 16:00 UTC = 13:00 и 19:00 МСК.
--  Проверить, что задание есть:        select jobname, schedule from cron.job;
--  Последние запуски и ответы функции: select * from cron.job_run_details order by start_time desc limit 5;
--                                      select status_code, content from net._http_response order by created desc limit 5;
--  Выключить:                          select cron.unschedule('leads-sheet-daily');
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'leads-sheet-daily';

select cron.schedule(
  'leads-sheet-daily',
  '0 10,16 * * *',
  $$
  select net.http_post(
    url := 'https://lfwheilgsoyuxidwldhv.supabase.co/functions/v1/leads-sheet',
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
