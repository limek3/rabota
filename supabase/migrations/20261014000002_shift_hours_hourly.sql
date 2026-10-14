-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — часы из Скорозвона каждый час, а не раз в день
--
--  Было: задание shift-hours-daily в 21:01 МСК (20261007000001_shift_hours_cron.sql).
--  Стало: shift-hours-hourly — каждый час в :05 по Москве. В 00:05 — последний прогон за вчера
--  (день смены = дата МСК десять минут назад), остальные — за сегодня. CRM считает сегодняшние
--  смены с часами из Скорозвона сразу, поэтому показатели на всех страницах — «на сейчас».
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Секрет вписывать не нужно: адрес, ключ и x-cron-secret берутся из уже настроенного задания
--  shift-hours-daily (или shift-hours-hourly при повторном запуске). Если ни одного нет — сначала
--  выполните 20261007000001_shift_hours_cron.sql со своим CRON_SECRET, потом этот файл.
--  Перед запуском задеплойте обновлённую supabase/functions/shift-hours (не пишет смены без изменений
--  и не засоряет журнал ежечасными записями).
--
--  Проверить:  select jobname, schedule, command from cron.job;
--  Запуски:    select * from cron.job_run_details order by start_time desc limit 5;
--  Выключить:  select cron.unschedule('shift-hours-hourly');
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_cmd text;
begin
  select command into v_cmd from cron.job
   where jobname in ('shift-hours-hourly', 'shift-hours-daily')
   order by (jobname = 'shift-hours-hourly') desc
   limit 1;
  if v_cmd is null then
    raise exception 'Нет задания shift-hours-daily: сначала выполните 20261007000001_shift_hours_cron.sql со своим CRON_SECRET';
  end if;
  if v_cmd like '%ВСТАВЬТЕ_CRON_SECRET%' then
    raise exception 'В задании shift-hours-daily не вписан CRON_SECRET — выполните 20261007000001_shift_hours_cron.sql со своим секретом';
  end if;

  -- день смены: дата по Москве десять минут назад — в 00:05 это вчера, в остальное время сегодня
  v_cmd := regexp_replace(
    v_cmd,
    'body\s*:=\s*[^,]*?::jsonb',
    'body := jsonb_build_object(''date'', to_char((now() at time zone ''Europe/Moscow'') - interval ''10 minutes'', ''YYYY-MM-DD''))'
  );

  perform cron.unschedule(jobid) from cron.job where jobname in ('shift-hours-daily', 'shift-hours-hourly');
  -- '5 * * * *' — каждый час в :05 UTC; у Москвы сдвиг на целые часы, значит и в :05 МСК
  perform cron.schedule('shift-hours-hourly', '5 * * * *', v_cmd);
end
$$;
