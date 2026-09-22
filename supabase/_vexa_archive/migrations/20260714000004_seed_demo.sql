-- ============================================================================
-- Vexa — демо-наполнение нового воркспейса + RPC для DM-каналов.
-- Данные повторяют lib/crmData.ts и lib/data.ts, но с датами «от сегодня».
-- ============================================================================

-- ─── DM-канал 1:1 (создаётся при первом сообщении) ───
create or replace function ensure_dm_channel(p_ws uuid, p_other uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare me uuid := auth.uid(); ch uuid; other_name text;
begin
  if not is_member(p_ws) then raise exception 'not a member'; end if;

  -- уже есть канал ровно с этими двумя участниками?
  select c.id into ch
    from chat_channels c
   where c.workspace_id = p_ws and c.scope = 'dm'
     and (select count(*) from chat_channel_members m where m.channel_id = c.id) = 2
     and exists (select 1 from chat_channel_members m where m.channel_id = c.id and m.user_id = me)
     and exists (select 1 from chat_channel_members m where m.channel_id = c.id and m.user_id = p_other)
   limit 1;
  if ch is not null then return ch; end if;

  select coalesce(display_name, email, 'Direct message') into other_name from profiles where id = p_other;

  insert into chat_channels (workspace_id, scope, name, created_by)
  values (p_ws, 'dm', other_name, me)
  returning id into ch;

  -- триггер seed_channel_members сажает в канал всю команду только для
  -- scope='channel'/'candidate', поэтому для DM участников вписываем руками
  insert into chat_channel_members (channel_id, user_id)
  values (ch, me), (ch, p_other)
  on conflict do nothing;

  return ch;
end $$;

-- ============================================================================
-- seed_demo_workspace — заливает демо-данные в пустой воркспейс.
-- Всё вешается на владельца: в новом воркспейсе он пока один.
-- ============================================================================

create or replace function seed_demo_workspace(p_ws uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  me uuid := auth.uid();
  j1 uuid; j2 uuid; j3 uuid; j4 uuid; j5 uuid; j6 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid; c9 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid;
  s8 uuid; s9 uuid; s10 uuid; s11 uuid; s12 uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid;
  e2 uuid;
  d  date := current_date;
begin
  if not is_member(p_ws) then raise exception 'not a member'; end if;
  if exists (select 1 from candidates where workspace_id = p_ws) then return; end if;  -- уже засеян

  -- демо не влезает в лимиты Free (1 поиск / 3 источника) — ставим Pro
  update workspaces set plan = 'pro' where id = p_ws and plan = 'free';
  update subscriptions set plan = 'pro' where workspace_id = p_ws;

  /* ── вакансии ── */
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'Senior Frontend Developer', 'Разработка',    'open',   now() - interval '24 days') returning id into j1;
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'Product Designer',          'Продукт',       'open',   now() - interval '19 days') returning id into j2;
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'QA Engineer (Middle)',      'Разработка',    'open',   now() - interval '11 days') returning id into j3;
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'Sales Manager B2B',         'Продажи',       'paused', now() - interval '9 days')  returning id into j4;
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'DevOps Engineer',           'Инфраструктура','open',   now() - interval '16 days') returning id into j5;
  insert into jobs (workspace_id, title, dept, status, created_at) values
    (p_ws, 'HR Generalist',             'Люди',          'closed', now() - interval '29 days') returning id into j6;

  /* ── кандидаты ── */
  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, phone, tg, location, salary, exp, skills, source, rating, note, resume_text, reminder_at, reminder_label, created_at, stage_at, updated_at)
  values (p_ws, 'Дмитрий Соколов', 'Senior Frontend Developer', 'interview', me, j1,
    'd.sokolov@gmail.com', '+7 921 384-55-10', '@dsokolov_dev', 'Санкт-Петербург · удалённо', '320–360 т₽', '7 лет',
    array['React','TypeScript','Next.js','Node.js'], 'HR Jobs Chat · Telegram', 5,
    'Сильный кандидат. Второе техническое прошёл отлично, ждёт финал с CTO.',
    E'ДМИТРИЙ СОКОЛОВ — Senior Frontend Developer\nСанкт-Петербург · d.sokolov@gmail.com · @dsokolov_dev\n\nОПЫТ — 7 лет\n2021–2026 · Ozon Tech — Senior Frontend (React/TS, микрофронтенды, команда 6 чел.)\n2019–2021 · Sberdevices — Frontend Developer (SmartApp платформа)\n\nСТЕК: React, TypeScript, Next.js, Redux/RTK, Node.js, Vitest, CI/CD',
    now() + interval '1 day', 'Финал с CTO — завтра 15:00',
    now() - interval '9 days', now() - interval '7 days', now() - interval '7 days')
  returning id into c1;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, phone, tg, location, salary, exp, skills, source, rating, note, resume_text, reminder_at, reminder_label, created_at, stage_at, updated_at)
  values (p_ws, 'Алина Морозова', 'Product Designer', 'offer', me, j2,
    'alina.mrz@ya.ru', '+7 903 771-22-84', '@alinamrz', 'Москва', '250 т₽', '5 лет',
    array['Figma','UX-research','Design systems'], 'Дизайн-вакансии · Telegram', 4,
    'Оффер отправлен. Ответ обещала до пятницы.',
    E'АЛИНА МОРОЗОВА — Product Designer\nМосква · alina.mrz@ya.ru · @alinamrz\n\nОПЫТ — 5 лет\n2022–2026 · Яндекс Маркет — продуктовый дизайнер (конверсия +12%)\n2020–2022 · Тинькофф — дизайнер интерфейсов',
    now() + interval '6 hours', 'Дожать ответ по офферу',
    now() - interval '13 days', now() - interval '3 days', now() - interval '3 days')
  returning id into c2;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, phone, tg, location, salary, exp, skills, source, rating, resume_text, reminder_at, reminder_label, created_at, stage_at, updated_at)
  values (p_ws, 'Игорь Ветров', 'QA Engineer (Middle)', 'screening', me, j3,
    'vetrov.qa@mail.ru', '+7 911 205-90-33', '@vetrov_qa', 'Казань · удалённо', '160 т₽', '3 года',
    array['Playwright','Postman','SQL'], 'Отклик · hh.ru', 3,
    E'ИГОРЬ ВЕТРОВ — QA Engineer\nКазань · vetrov.qa@mail.ru\n\nОПЫТ — 3 года\n2023–2026 · KazanExpress — QA (ручное + авто, Playwright)',
    now() + interval '2 hours', 'Телефонный скрининг',
    now() - interval '5 days', now() - interval '5 days', now() - interval '5 days')
  returning id into c3;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, tg, location, salary, exp, skills, source, rating, resume_text, created_at, stage_at, updated_at)
  values (p_ws, 'Мария Лебедева', 'Sales Manager B2B', 'applied', null, j4,
    'm.lebedeva.sales@gmail.com', '@mlebedeva', 'Москва', '120 т₽ + %', '4 года',
    array['B2B-продажи','CRM','Холодные звонки'], 'Работа в IT · VK', 0,
    E'МАРИЯ ЛЕБЕДЕВА — Sales Manager B2B\nМосква · m.lebedeva.sales@gmail.com\n\nОПЫТ — 4 года\n2023–2026 · SaaS-стартап Jetter — менеджер по продажам (план 105–130%)',
    now() - interval '2 days', now() - interval '2 days', now() - interval '2 days')
  returning id into c4;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, phone, tg, location, salary, exp, skills, source, rating, note, resume_text, created_at, stage_at, updated_at)
  values (p_ws, 'Павел Гринёв', 'DevOps Engineer', 'interview', me, j5,
    'pgrinev@proton.me', '+7 981 456-78-21', '@pgrinev', 'Минск · удалённо', '$3500', '6 лет',
    array['Kubernetes','Terraform','AWS','CI/CD'], 'Резюме · Авито Работа', 4,
    'Сравниваем с внешним кандидатом от агентства.',
    E'ПАВЕЛ ГРИНЁВ — DevOps Engineer\nМинск · pgrinev@proton.me\n\nОПЫТ — 6 лет\n2022–2026 · EPAM — Lead DevOps (K8s, Terraform, AWS)\n\nСЕРТИФИКАТЫ: CKA, AWS SA Associate',
    now() - interval '10 days', now() - interval '7 days', now() - interval '7 days')
  returning id into c5;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, phone, location, salary, exp, skills, source, rating, note, resume_text, created_at, stage_at, updated_at)
  values (p_ws, 'Ольга Крылова', 'HR Generalist', 'hired', me, j6,
    'o.krylova@hh.ru', '+7 926 512-30-77', 'Москва', '140 т₽', '5 лет',
    array['Подбор','Адаптация','КДП'], 'Рекомендация', 5,
    'Выходит через неделю. Оформление через СЗ.',
    E'ОЛЬГА КРЫЛОВА — HR Generalist\nМосква · o.krylova@hh.ru\n\nОПЫТ — 5 лет\n2022–2026 · Skyeng — HR BP (команды до 60 чел.)',
    now() - interval '21 days', now() - interval '11 days', now() - interval '11 days')
  returning id into c6;

  insert into candidates (workspace_id, name, position, stage, assignee, email, tg, location, salary, exp, skills, source, rating, resume_text, created_at, stage_at, updated_at)
  values (p_ws, 'Тимур Ахметов', 'Backend Developer (Go)', 'screening', me,
    'takhmetov.dev@gmail.com', '@takhmetov', 'Алматы · удалённо', '$2800', '4 года',
    array['Go','PostgreSQL','gRPC','Kafka'], 'Go Jobs · Telegram', 3,
    E'ТИМУР АХМЕТОВ — Backend Developer (Go)\nАлматы · takhmetov.dev@gmail.com\n\nОПЫТ — 4 года\n2023–2026 · Kaspi.kz — Go-разработчик (платёжный шлюз)',
    now() - interval '3 days', now() - interval '3 days', now() - interval '3 days')
  returning id into c7;

  insert into candidates (workspace_id, name, position, stage, assignee, job_id, email, location, salary, exp, skills, source, rating, note, reject_reason, created_at, stage_at, updated_at)
  values (p_ws, 'Ксения Павлова', 'Senior Frontend Developer', 'rejected', me, j1,
    'ks.pavlova@gmail.com', 'Новосибирск', '400 т₽', '8 лет',
    array['Vue','Nuxt','TypeScript'], 'HR Jobs Chat · Telegram', 2,
    'Отказ: ожидания по вилке выше бюджета, стек Vue вместо React.',
    'Ожидания по вилке выше бюджета; основной стек Vue вместо React',
    now() - interval '16 days', now() - interval '14 days', now() - interval '14 days')
  returning id into c8;

  insert into candidates (workspace_id, name, position, stage, assignee, email, tg, location, salary, exp, skills, source, rating, resume_text, created_at, stage_at, updated_at)
  values (p_ws, 'Роман Зайцев', 'Product Manager', 'applied', null,
    'rzaitsev.pm@gmail.com', '@rzaitsev', 'Москва', '280 т₽', '6 лет',
    array['Discovery','Unit-экономика','SQL'], 'Habr Карьера · сайт', 0,
    E'РОМАН ЗАЙЦЕВ — Product Manager\nМосква · rzaitsev.pm@gmail.com\n\nОПЫТ — 6 лет\n2022–2026 · Авито — PM (вертикаль «Услуги», GMV +40% г/г)',
    now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')
  returning id into c9;

  /* ── история и комментарии ── */
  insert into candidate_activity (workspace_id, candidate_id, actor_id, text, created_at) values
    (p_ws, c1, me, 'Кандидат добавлен из лида (HR Jobs Chat)', now() - interval '9 days'),
    (p_ws, c1, me, 'Стадия: Скрининг → Интервью',              now() - interval '7 days'),
    (p_ws, c1, me, 'Тех. интервью №2 пройдено — фидбек положительный', now() - interval '2 days'),
    (p_ws, c2, me, 'Кандидат добавлен вручную',                now() - interval '13 days'),
    (p_ws, c2, me, 'Стадия: Интервью → Оффер',                 now() - interval '3 days'),
    (p_ws, c3, me, 'Кандидат добавлен из лида (QA Jobs)',      now() - interval '5 days'),
    (p_ws, c4, me, 'Кандидат добавлен из лида',                now() - interval '2 days'),
    (p_ws, c5, me, 'Стадия: Скрининг → Интервью',              now() - interval '7 days'),
    (p_ws, c6, me, 'Стадия: Оффер → Нанят',                    now() - interval '11 days'),
    (p_ws, c7, me, 'Кандидат добавлен из лида (Go Jobs)',      now() - interval '3 days'),
    (p_ws, c8, me, 'Стадия: Скрининг → Отказ (вилка/стек)',    now() - interval '14 days'),
    (p_ws, c9, me, 'Кандидат добавлен из лида (PM Jobs)',      now() - interval '1 day');

  insert into candidate_comments (workspace_id, candidate_id, author_id, text, created_at) values
    (p_ws, c1, me, 'Смотрела его код на собесе — очень чисто, хуки без каши. Рекомендую двигать быстрее.', now() - interval '4 days'),
    (p_ws, c1, me, 'CTO свободен в пятницу 15:00 — ставлю финал.', now() - interval '2 days'),
    (p_ws, c2, me, 'Оффер отправлен. Конкурирует с оффером от Купера — держим темп.', now() - interval '3 days'),
    (p_ws, c5, me, 'Команда за. Смущает только вилка — на границе бюджета.', now() - interval '1 day');

  /* ── календарь ── */
  insert into crm_events (workspace_id, title, day, start_min, end_min, kind, candidate_id, assignee) values
    (p_ws, 'Синк команды найма',            d,              600,  630, 'sync',      null, me);
  insert into crm_events (workspace_id, title, day, start_min, end_min, kind, candidate_id, assignee)
  values (p_ws, 'Интервью — Павел Гринёв',  d,              780,  840, 'interview', c5,   me)
  returning id into e2;
  insert into crm_events (workspace_id, title, day, start_min, end_min, kind, candidate_id, assignee) values
    (p_ws, 'Звонок по офферу — Алина Морозова', d + 1,      660,  690, 'call',      c2,   me),
    (p_ws, 'Скрининг — Тимур Ахметов',          d + 3,      750,  795, 'screening', c7,   me),
    (p_ws, 'Онбординг-план — Ольга Крылова',    d + 4,      960, 1020, 'other',     c6,   me);

  /* ── задачи ── */
  insert into crm_tasks (workspace_id, title, due_at, due_all_day, candidate_id, assignee, event_id, done, created_at) values
    (p_ws, 'Финальное интервью с CTO — Дмитрий Соколов', (d + 1)::timestamptz + interval '15 hours', false, c1, me, null, false, now() - interval '3 days'),
    (p_ws, 'Дожать ответ по офферу — Алина Морозова',    (d)::timestamptz     + interval '18 hours', false, c2, me, null, false, now() - interval '2 days'),
    (p_ws, 'Интервью — Павел Гринёв',                    (d)::timestamptz     + interval '13 hours', false, c5, me, e2,   false, now() - interval '1 day'),
    (p_ws, 'Собрать фидбек команды по Павлу Гринёву',    (d + 3)::timestamptz,                       true,  c5, me, null, false, now() - interval '1 day'),
    (p_ws, 'Подготовить онбординг-план — Ольга Крылова', (d + 7)::timestamptz,                       true,  c6, me, null, false, now() - interval '9 days'),
    (p_ws, 'Обновить шаблон отказа (вежливый + причина)', null,                                      true,  null, me, null, true, now() - interval '17 days');

  /* ── источники ── */
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, warning, last_checked_at) values
    (p_ws, 'HR Jobs Chat',                't.me/hr_jobs_chat',                          'tg',   'CHAT',    'CONNECTED', 'N/A', 98, '#1E3A2C', null, now() - interval '4 minutes')  returning id into s1;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Remote IT Vacancies',         't.me/remote_it_vac',                         'tg',   'CHANNEL', 'CONNECTED', 'OFF', 96, '#1C2E42', now() - interval '12 minutes') returning id into s2;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Маркетинг и продажи',         't.me/marketing_sales',                       'tg',   'CHAT',    'CONNECTED', 'N/A', 92, '#3A2A1E', now() - interval '26 minutes') returning id into s3;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, warning, last_checked_at) values
    (p_ws, 'Startup Founders RU',         't.me/startup_ru',                            'tg',   'CHAT',    'LIMITED',   'N/A', 61, '#2E2440',
      'Slow mode enabled by admins — history sync limited to last 100 messages.', now() - interval '1 hour') returning id into s4;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Дизайн-биржа',                't.me/design_birzha',                         'tg',   'CHANNEL', 'CONNECTED', 'ON',  94, '#40242C', now() - interval '2 hours') returning id into s5;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, warning) values
    (p_ws, 'Product Jobs RU',             't.me/product_jobs',                          'tg',   'CHANNEL', 'PENDING',   'OFF',  0, '#26292C',
      'Join request sent. Waiting for admin approval — usually under 24h.') returning id into s6;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, warning) values
    (p_ws, 'Тусовка продактов',           't.me/+K7hFq2',                               'tg',   'CHAT',    'PRIVATE',   'N/A',  0, '#26292C',
      'Private chat. The monitoring account must be invited by a member.') returning id into s7;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Работа в IT · VK',            'vk.com/it_jobs_ru',                          'vk',   'CHAT',    'CONNECTED', 'ON',  93, '#16283E', now() - interval '18 minutes') returning id into s8;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Авито · Вакансии IT, СПб',    'avito.ru/sankt-peterburg/vakansii/it',       'avito','CHANNEL', 'CONNECTED', 'N/A', 89, '#173222', now() - interval '31 minutes') returning id into s9;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'hh.ru · Python, Москва',      'hh.ru/search/vacancy?text=python',           'hh',   'CHANNEL', 'CONNECTED', 'N/A', 97, '#3A1D20', now() - interval '9 minutes') returning id into s10;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, last_checked_at) values
    (p_ws, 'Habr Карьера',                'career.habr.com/vacancies',                  'web',  'CHANNEL', 'CONNECTED', 'N/A', 90, '#26292C', now() - interval '1 hour') returning id into s11;
  insert into sources (workspace_id, name, handle, platform, type, access, comments, health, avatar_bg, warning, last_checked_at) values
    (p_ws, 'Авито · Услуги, дизайн',      'avito.ru/rossiya/predlozheniya_uslug/dizayn','avito','CHANNEL', 'LIMITED',   'N/A', 58, '#173222',
      'Rate limit reached on this category — scans throttled to every 15 min.', now() - interval '2 hours') returning id into s12;

  /* ── поиски ── */
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Рекрутеры RU',            array['нужен рекрутер','ищем hr'],            array['курсы','обучение'],   'both',      80, true,  me) returning id into q1;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Python вакансии',         array['python вакансия','python remote'],     array['junior','стажировка'],'bot',       75, true,  me) returning id into q2;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Разработчики на проект',  array['ищу разработчика','нужен программист'],array['бесплатно'],          'bot',       70, true,  me) returning id into q3;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Дизайн-заказы',           array['дизайнер на проект','нужен дизайнер'], array[]::text[],             'dashboard', 65, true,  me) returning id into q4;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Leadgen requests',        array['lead generation','лидогенерация'],     array['вебинар'],            'both',      70, true,  me) returning id into q5;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'QA инженеры',             array['qa вакансия','ищу тестировщика'],      array['курсы qa'],           'bot',       75, false, me) returning id into q6;
  insert into searches (workspace_id, name, kws, minus, delivery, threshold, active, created_by) values
    (p_ws, 'Маркетологи',             array['ищу маркетолога','нужен smm'],         array['бартер'],             'dashboard', 60, true,  me) returning id into q7;

  insert into search_sources (search_id, source_id) values
    (q1, s1), (q1, s3), (q1, s4), (q1, s8),
    (q2, s2), (q2, s10), (q2, s11),
    (q3, s2), (q3, s4), (q3, s6), (q3, s8), (q3, s9),
    (q4, s5), (q4, s12),
    (q5, s3), (q5, s8), (q5, s9),
    (q6, s2), (q6, s10),
    (q7, s3), (q7, s8), (q7, s11);

  /* ── лиды ── */
  insert into matches (workspace_id, source_id, search_id, src_type, kw, pre, post, rel, status, sender, author, phone, summary, link, minus_checked, is_new, posted_at) values
    (p_ws, s1, q1, 'CHAT', 'нужен рекрутер', 'Коллеги, срочно ', ' на IT-позиции, удалёнка, полная занятость. Бюджет обсуждаем в лс', 94, 'sent', '@elena_hr_spb', 'Елена Смирнова', '+7 921 445-12-08',
      'Ищут: рекрутера на IT-позиции · Формат: удалёнка, фуллтайм · Бюджет: в ЛС', 't.me/hr_jobs_chat/48211', 2, false, now() - interval '2 hours'),
    (p_ws, s2, q2, 'CHANNEL', 'python вакансия', 'Открыта ', ': Senior Backend Engineer, до 450к на руки, релокация не требуется. CV в бот.', 91, 'sent', '@remote_it_hr', 'Дмитрий Орлов', '+7 916 230-77-41',
      'Вакансия: Senior Backend (Python) · До 450к на руки · Без релокации', 't.me/remote_it_vac/1204', 2, false, now() - interval '3 hours'),
    (p_ws, s4, q3, 'CHAT', 'ищу разработчика', 'Привет всем! ', ' на MVP маркетплейса. Стек обсуждаем, оплата по milestone. Кто свободен?', 88, 'saved', '@d_volkov', 'Денис Волков', '+7 903 512-64-19',
      'Ищут: разработчика на MVP маркетплейса · Оплата: по milestone', 't.me/startup_ru/9917', 1, false, now() - interval '4 hours'),
    (p_ws, s3, q5, 'CHAT', 'lead generation', 'Кто может настроить ', ' через LinkedIn + cold email для B2B SaaS? Бюджет есть, пишите в личку.', 76, 'sent', '@sales_pavel', 'Павел Егоров', '+7 926 884-05-33',
      'Нужна: лидогенерация LinkedIn + cold email · B2B SaaS · Бюджет есть', 't.me/marketing_sales/3302', 1, false, now() - interval '5 hours'),
    (p_ws, s5, q4, 'COMMENTS', 'дизайнер на проект', 'Нужен ', ': лендинг + фирменный стиль, срок 2 недели, оплата сразу. Портфолио в комменты.', 83, 'saved', '@yana_prod', 'Яна Прокопенко', '+7 911 673-92-14',
      'Заказ: лендинг + фирстиль · Срок: 2 недели · Оплата сразу', 't.me/design_birzha/771?comment=45', 1, false, now() - interval '6 hours'),
    (p_ws, s4, q1, 'CHAT', 'ищем hr', 'Мы seed-стартап, ', ' generalist в команду из 12 человек. Опыт в IT обязателен.', 90, 'new', '@a_fedorov', 'Артём Фёдоров', '+7 999 214-38-07',
      'Ищут: HR generalist в seed-стартап (12 чел) · Опыт в IT обязателен', 't.me/startup_ru/9902', 2, true, now() - interval '7 hours'),
    (p_ws, s1, q1, 'CHAT', 'нужен рекрутер', 'может кто посоветует агентство? ', ' под массовый найм курьеров, 200+ человек в месяц', 54, 'noise', '@logist_kirill', 'Кирилл Логинов', '+7 963 771-40-92',
      'Запрос: агентство под массовый найм курьеров · 200+ человек/мес', 't.me/hr_jobs_chat/48102', 2, false, now() - interval '8 hours'),
    (p_ws, s2, q6, 'CHANNEL', 'qa вакансия', 'Новая ', ': Middle QA Automation (Python), удалёнка, от 250к. Писать @hr_dasha.', 87, 'sent', '@remote_it_hr', 'Дарья Носова', '+7 906 348-27-51',
      'Вакансия: Middle QA Automation (Python) · Удалёнка · От 250к', 't.me/remote_it_vac/1198', 1, false, now() - interval '1 day'),
    (p_ws, s10, q2, 'CHANNEL', 'python remote', 'Обновлено резюме: ', ' Senior Python Developer, 5 лет опыта, рассматривает офферы от 380к, Москва/гибрид.', 89, 'new', 'hh.ru', 'Сергей Владимиров', '+7 915 204-88-31',
      'Резюме: Python-разработчик, 5 лет · Ждёт офферов · Москва, гибрид', 'hh.ru/resume/a1b2c3', 1, true, now() - interval '90 minutes'),
    (p_ws, s8, q4, 'CHAT', 'нужен дизайнер', 'Команда финтех-стартапа, ', ' продуктовый дизайнер (web+mobile), удалёнка, от 200к. Портфолио в ЛС.', 84, 'new', 'vk.com/it_jobs_ru', 'Ольга Ситникова', '+7 926 517-42-90',
      'Пост: ищут продуктового дизайнера в финтех · Удалёнка · От 200к', 'vk.com/wall-2233_9911', 1, true, now() - interval '150 minutes');

  /* ── получатели бота + одна проваленная доставка (для баннера Retry) ── */
  insert into bot_recipients (workspace_id, handle, name, muted) values
    (p_ws, '@anna_k',  'Anna K.',  false),
    (p_ws, '@maxim_k', 'Maxim K.', true);

  insert into match_deliveries (workspace_id, match_id, recipient_id, status, error, attempts)
  select p_ws, m.id, r.id, 'failed', 'Telegram API: 429 Too Many Requests', 2
    from matches m
    join bot_recipients r on r.workspace_id = p_ws and r.handle = '@anna_k'
   where m.workspace_id = p_ws and m.link = 't.me/marketing_sales/3302';
end $$;
