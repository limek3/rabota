-- Напоминания, которые доходят при закрытом приложении.
--
-- Сторож напоминаний живёт в клиенте (lib/store.tsx, setInterval раз в минуту).
-- Значит напоминание существует ровно до тех пор, пока открыта вкладка: закрыл
-- ноутбук в 18:00 — «позвонить в 19:00» не придёт ни во сколько, а утром
-- всплывёт как просроченное. Для напоминания это отказ, а не задержка.
--
-- Серверная часть: расписание в БД дёргает Edge Function send-due-reminders,
-- та шлёт в Telegram. Клиентский сторож остаётся — он отвечает за колокол в
-- открытой вкладке, и дублирования не будет: канал у них разный.

-- ── кому слать ────────────────────────────────────────────────────────────
--
-- Переиспользуем bot_recipients, а не заводим вторую привязку. Там уже есть
-- chat_id, который бот проставляет после /start, и второй такой же механизм
-- означал бы, что человек делает /start дважды и не понимает зачем.
--
-- Не хватало только связи «эта строка — вот этот сотрудник»: лиды парсер шлёт
-- всей команде, а напоминание адресное — оно про твою сделку.
alter table public.bot_recipients
  add column if not exists user_id uuid references profiles (id) on delete set null;

create index if not exists bot_recipients_user_idx on public.bot_recipients (user_id) where user_id is not null;

comment on column public.bot_recipients.user_id is
  'Чей это телеграм. Нужен для адресных напоминаний; лиды шлются всем подряд и его не смотрят.';

-- ── что уже отправлено ────────────────────────────────────────────────────
--
-- Отдельная таблица, а не флаг на самой сущности: у задачи и у контакта срок
-- может сдвинуться, и «уже слали» относится к паре «сущность + срок», а не к
-- сущности. Перенёс напоминание на завтра — завтра оно придёт снова, и это
-- правильно; не двинул — второй раз не придёт даже если функция отработает
-- дважды (ретрай крона, ручной вызов, перекрывшиеся запуски).
create table if not exists reminder_deliveries (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  kind         text        not null check (kind in ('reminder', 'task')),
  ref_id       uuid        not null,
  -- Срок, к которому относится отправка. Часть ключа идемпотентности.
  due_at       timestamptz not null,
  chat_id      bigint,
  sent_at      timestamptz not null default now(),
  -- Пустая строка = доставлено. Иначе текст ошибки Telegram — чтобы «почему не
  -- пришло» имело ответ, а не оставалось догадкой.
  error        text        not null default ''
);

create unique index if not exists reminder_deliveries_once_idx
  on reminder_deliveries (kind, ref_id, due_at);

alter table reminder_deliveries enable row level security;

-- Читают члены воркспейса, пишет только функция (service_role обходит RLS).
drop policy if exists rdel_select on reminder_deliveries;
create policy rdel_select on reminder_deliveries for select to authenticated
  using (is_member(workspace_id));

-- ── расписание ────────────────────────────────────────────────────────────
--
-- pg_cron дёргает функцию через pg_net. Раз в пять минут, а не раз в минуту:
-- напоминание — это «позвонить в 15:00», и пять минут погрешности здесь ничего
-- не значат, а нагрузка и счёт за вызовы отличаются впятеро.
--
-- ВНИМАНИЕ, деплой руками (значения тут неоткуда взять):
--   1) supabase functions deploy send-due-reminders
--   2) supabase secrets set TELEGRAM_BOT_TOKEN=...   (токен того же бота)
--   3) выполнить блок ниже, подставив URL проекта и service_role ключ.
--
-- Ключ намеренно НЕ хранится в этой миграции: миграции лежат в git.
--
-- Расширения включаем здесь, но если роль миграций их создавать не вправе —
-- включить тумблерами в Database → Extensions и перезапустить.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Пример ниже — построчным комментарием, а не блочным, намеренно: в cron-строке
-- есть «звёздочка со слешем», и внутри /* */ она закрыла бы комментарий раньше
-- времени, а остаток примера ушёл бы в базу как настоящий SQL.
--
-- Выполнить один раз в SQL-редакторе проекта, подставив свои значения:
--
-- select cron.schedule(
--   'send-due-reminders',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-due-reminders',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- Снять расписание:   select cron.unschedule('send-due-reminders');
-- Посмотреть запуски: select * from cron.job_run_details order by start_time desc limit 20;
