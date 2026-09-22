-- Vexa — весь SQL одним файлом. Вставь целиком в Supabase → SQL Editor → Run.

-- ==================== supabase/migrations/20260714000001_init.sql ====================
-- ============================================================================
-- Vexa — schema init
-- Модель повторяет lib/types.ts + PersistedSlice из lib/store.tsx.
-- Значения enum'ов совпадают со строками в TS 1-в-1 (маппинг не нужен).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ─────────────────────────── enums ───────────────────────────

create type plan_id         as enum ('free', 'lite', 'pro', 'team');
create type member_role     as enum ('owner', 'member');
create type currency_code   as enum ('RUB', 'USD', 'KZT');
create type theme_mode      as enum ('dark', 'light');

create type platform        as enum ('tg', 'vk', 'avito', 'hh', 'web');
create type source_kind     as enum ('CHAT', 'CHANNEL');
create type source_access   as enum ('CONNECTED', 'LIMITED', 'PENDING', 'PRIVATE', 'UNAVAILABLE');
create type comments_state  as enum ('ON', 'OFF', 'N/A');

create type src_type        as enum ('CHAT', 'CHANNEL', 'COMMENTS');
create type match_status    as enum ('new', 'sent', 'saved', 'noise');
create type match_crm_stage as enum ('contacted', 'replied', 'deal', 'lost');
create type delivery_mode   as enum ('bot', 'dashboard', 'both');
create type match_mode      as enum ('any', 'all', 'exact');
create type delivery_status as enum ('pending', 'sent', 'failed');

create type candidate_stage as enum ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected');
create type job_status      as enum ('open', 'paused', 'closed');
create type crm_event_kind  as enum ('interview', 'screening', 'call', 'sync', 'other');
create type chat_scope      as enum ('channel', 'dm', 'candidate');

-- ─────────────────────────── plans (справочник) ───────────────────────────
-- Зеркало lib/plans.ts. Лимиты живут в БД, чтобы триггеры могли их проверять.

create table plans (
  id          plan_id primary key,
  name        text        not null,
  tagline     text        not null,
  tagline_ru  text        not null,
  price_m     integer     not null,          -- $/мес при помесячной оплате
  price_y     integer     not null,          -- $/мес при годовой
  seats       integer     not null,
  searches    integer     not null,          -- лимит активных поисков
  sources     integer     not null,
  deliveries  integer     not null,          -- доставок бота в месяц
  polling     text        not null,
  features    text[]      not null default '{}',
  features_ru text[]      not null default '{}',
  recommended boolean     not null default false,
  sort        smallint    not null
);

-- ─────────────────────────── profiles ───────────────────────────
-- 1:1 с auth.users. Личные (не воркспейсные) настройки.

create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  position     text,
  age          text,
  avatar_url   text,                          -- storage: avatars/<uid>/...
  timezone     text          not null default 'Europe/Moscow (UTC+3)',
  language     text          not null default 'Русский',
  theme        theme_mode    not null default 'light',
  currency     currency_code not null default 'RUB',
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

-- ─────────────────────────── workspaces ───────────────────────────

create table workspaces (
  id                   uuid primary key default gen_random_uuid(),
  name                 text        not null default 'My workspace',
  plan                 plan_id     not null default 'free' references plans (id),
  extra_seats          integer     not null default 0 check (extra_seats >= 0),
  owner_id             uuid        not null references profiles (id) on delete restrict,

  -- settings (Settings / Notifications страницы)
  webhook              text        not null default '',
  quiet_from           time        not null default '22:00',
  quiet_to             time        not null default '08:00',
  min_alert_rel        smallint    not null default 70 check (min_alert_rel between 0 and 100),
  notif                jsonb       not null default '{"n1":true,"n2":true,"n3":false,"n4":true,"n5":true}'::jsonb,
  -- бюджет сканера по платформам, в сумме 100 (lib/platforms.ts)
  scan_quota           jsonb       not null default '{"tg":35,"vk":15,"avito":15,"hh":25,"web":10}'::jsonb,

  -- онбординг
  first_scan_done      boolean     not null default false,
  onboarding_dismissed boolean     not null default false,
  changelog_seen       boolean     not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint scan_quota_sums_100 check (
    (coalesce((scan_quota->>'tg')::int,0) + coalesce((scan_quota->>'vk')::int,0)
   + coalesce((scan_quota->>'avito')::int,0) + coalesce((scan_quota->>'hh')::int,0)
   + coalesce((scan_quota->>'web')::int,0)) = 100
  )
);

create table workspace_members (
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  user_id      uuid        not null references profiles (id) on delete cascade,
  role         member_role not null default 'member',
  avatar_bg    text        not null default '#1C2E42',
  color        text        not null default 'var(--blue)',
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

-- инвайты (заполняют купленные места)
create table workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  email        text        not null,
  role         member_role not null default 'member',
  token        uuid        not null default gen_random_uuid(),
  invited_by   uuid        references profiles (id) on delete set null,
  accepted_at  timestamptz,
  expires_at   timestamptz not null default now() + interval '14 days',
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ─────────────────────────── sources ───────────────────────────

create table sources (
  id           uuid           primary key default gen_random_uuid(),
  workspace_id uuid           not null references workspaces (id) on delete cascade,
  name         text           not null,
  handle       text           not null,          -- t.me/xxx, vk.com/xxx, avito.ru/...
  platform     platform       not null,
  type         source_kind    not null default 'CHANNEL',
  access       source_access  not null default 'PENDING',
  comments     comments_state not null default 'OFF',
  health       smallint       not null default 0 check (health between 0 and 100),
  avatar_bg    text           not null default '#1E3A2C',
  warning      text,
  last_checked_at timestamptz,
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now(),
  unique (workspace_id, handle)
);
create index on sources (workspace_id, platform);

-- ─────────────────────────── searches ───────────────────────────
-- SearchQuery.sources (число) и relRate/noiseRate/today/lastMatch — не колонки,
-- а вычисляемые поля: см. view search_stats внизу.

create table searches (
  id           uuid          primary key default gen_random_uuid(),
  workspace_id uuid          not null references workspaces (id) on delete cascade,
  name         text          not null,
  kws          text[]        not null default '{}',
  minus        text[]        not null default '{}',
  mode         match_mode    not null default 'any',
  delivery     delivery_mode not null default 'bot',
  threshold    smallint      not null default 75 check (threshold between 0 and 100),
  active       boolean       not null default true,
  created_by   uuid          references profiles (id) on delete set null,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  unique (workspace_id, name)
);
create index on searches (workspace_id, active);

-- какие источники сканирует поиск (M2M вместо счётчика sources:number)
create table search_sources (
  search_id uuid not null references searches (id) on delete cascade,
  source_id uuid not null references sources  (id) on delete cascade,
  primary key (search_id, source_id)
);
create index on search_sources (source_id);

-- ─────────────────────────── matches (лиды) ───────────────────────────

create table matches (
  id            uuid            primary key default gen_random_uuid(),
  workspace_id  uuid            not null references workspaces (id) on delete cascade,
  source_id     uuid            references sources  (id) on delete set null,
  search_id     uuid            references searches (id) on delete set null,

  src_type      src_type        not null,
  kw            text            not null,      -- совпавшее ключевое слово
  pre           text            not null default '',
  post          text            not null default '',
  rel           smallint        not null check (rel between 0 and 100),
  status        match_status    not null default 'new',

  sender        text            not null default '',   -- @handle
  author        text,                                  -- распознанное имя
  phone         text,
  summary       text,                                  -- AI-выжимка (lib/ai.ts)
  link          text            not null,
  minus_checked smallint        not null default 0,

  archived      boolean         not null default false,
  is_new        boolean         not null default true,

  -- CRM-lite прямо в инбоксе
  assignee      uuid            references profiles (id) on delete set null,
  crm_stage     match_crm_stage,
  note          text,
  reminder_at   timestamptz,

  posted_at     timestamptz     not null default now(),  -- время сообщения в источнике
  created_at    timestamptz     not null default now(),

  unique (workspace_id, link)                            -- дедуп как в runScan()
);
create index on matches (workspace_id, status, posted_at desc);
create index on matches (workspace_id, search_id, posted_at desc);
create index on matches (workspace_id, source_id);
create index on matches (workspace_id, assignee) where assignee is not null;
create index matches_text_trgm on matches using gin ((pre || kw || post) gin_trgm_ops);

-- ─────────────────────────── telegram bot ───────────────────────────

create table bot_recipients (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  handle       text        not null,           -- @anna_k
  name         text        not null,
  chat_id      bigint,                         -- telegram chat id после /start
  muted        boolean     not null default false,
  created_at   timestamptz not null default now(),
  unique (workspace_id, handle)
);

-- лог доставок: закрывает failedDeliveries + лимит plans.deliveries/мес
create table match_deliveries (
  id           uuid            primary key default gen_random_uuid(),
  workspace_id uuid            not null references workspaces (id) on delete cascade,
  match_id     uuid            not null references matches (id) on delete cascade,
  recipient_id uuid            references bot_recipients (id) on delete set null,
  status       delivery_status not null default 'pending',
  error        text,
  attempts     smallint        not null default 0,
  delivered_at timestamptz,
  created_at   timestamptz     not null default now()
);
create index on match_deliveries (workspace_id, created_at desc);
create index on match_deliveries (workspace_id, status) where status = 'failed';
create unique index on match_deliveries (match_id, recipient_id);

-- ─────────────────────────── CRM: вакансии и кандидаты ───────────────────────────

-- номер вакансии в реестре (#1043): последовательность, а не max()+1 —
-- параллельные вставки иначе выдали бы двум вакансиям один номер
create sequence job_code_seq start 1001;

create table jobs (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  title        text        not null,
  code         integer     not null default nextval('job_code_seq'),
  dept         text,
  status       job_status  not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on jobs (workspace_id, status);
create unique index jobs_code_per_ws on jobs (workspace_id, code);

create table candidates (
  id            uuid            primary key default gen_random_uuid(),
  workspace_id  uuid            not null references workspaces (id) on delete cascade,
  name          text            not null,
  -- фото контакта: data URI (клиент жмёт до 160×160) или внешняя ссылка
  avatar        text,
  position      text            not null default '',
  stage         candidate_stage not null default 'applied',
  assignee      uuid            references profiles (id) on delete set null,
  job_id        uuid            references jobs (id) on delete set null,

  email         text,
  phone         text,
  tg            text,
  location      text,
  salary        text,
  exp           text,
  skills        text[]          not null default '{}',
  source        text            not null default '',
  rating        smallint        not null default 0 check (rating between 0 and 5),
  -- рабочий статус контакта (null = не проставлен)
  status        text            check (status in ('paid','adapt','employed','office','working','response','minus','referral')),
  -- метки-иконки рядом со статусом (referral|compliance|local|urgent|medical)
  labels        text[]          not null default '{}',
  -- хэштеги для поиска, нормализованы: нижний регистр, без решётки
  tags          text[]          not null default '{}',
  -- дата рождения; возраст считаем от неё, а не храним — иначе устареет
  birthday      date,
  note          text,
  resume_text   text,

  -- файл резюме (сам файл — в storage bucket "resumes")
  resume_name   text,
  resume_size   integer,
  resume_path   text,
  resume_added_at timestamptz,

  reminder_at   timestamptz,
  reminder_label text,
  reject_reason text,

  -- лид, из которого сконвертили (convertMatchToCandidate → дедуп)
  match_id      uuid            references matches (id) on delete set null,

  stage_at      timestamptz     not null default now(),  -- для time-in-stage
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);
create index on candidates (workspace_id, stage);
create index on candidates (workspace_id, status);
create index on candidates using gin (tags);
create index on candidates using gin (labels);
create index on candidates (workspace_id, assignee) where assignee is not null;
create index on candidates (workspace_id, job_id) where job_id is not null;
create index on candidates (workspace_id, reminder_at) where reminder_at is not null;
create unique index candidates_one_per_match on candidates (workspace_id, match_id) where match_id is not null;

create table candidate_activity (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  candidate_id uuid        not null references candidates (id) on delete cascade,
  actor_id     uuid        references profiles (id) on delete set null,
  text         text        not null,
  created_at   timestamptz not null default now()
);
create index on candidate_activity (candidate_id, created_at);

create table candidate_comments (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  candidate_id uuid        not null references candidates (id) on delete cascade,
  author_id    uuid        not null references profiles (id) on delete cascade,
  text         text        not null,
  created_at   timestamptz not null default now()
);
create index on candidate_comments (candidate_id, created_at);

-- ─────────────────────────── CRM: календарь и задачи ───────────────────────────

create table crm_events (
  id           uuid           primary key default gen_random_uuid(),
  workspace_id uuid           not null references workspaces (id) on delete cascade,
  title        text           not null,
  day          date           not null,
  start_min    smallint       not null check (start_min between 0 and 1440),
  end_min      smallint       not null check (end_min   between 0 and 1440),
  kind         crm_event_kind not null default 'interview',
  candidate_id uuid           references candidates (id) on delete set null,
  assignee     uuid           references profiles   (id) on delete set null,
  created_at   timestamptz    not null default now(),
  check (end_min > start_min)
);
create index on crm_events (workspace_id, day);

create table crm_tasks (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  title        text        not null,
  due_at       timestamptz,
  -- true → срок без времени ("14 июл"); false → со временем ("11 июл, 15:00")
  due_all_day  boolean     not null default false,
  candidate_id uuid        references candidates (id) on delete set null,
  assignee     uuid        references profiles   (id) on delete set null,
  -- задача-зеркало брони: календарь рисует только событие, чтобы не было дублей
  event_id     uuid        references crm_events (id) on delete set null,
  done         boolean     not null default false,
  done_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on crm_tasks (workspace_id, done, due_at);
create index on crm_tasks (candidate_id) where candidate_id is not null;

-- интеграция Google Sheets (CrmSheetState, 1:1 на воркспейс)
create table crm_sheets (
  workspace_id uuid        primary key references workspaces (id) on delete cascade,
  connected    boolean     not null default false,
  url          text        not null default '',
  auto_sync    boolean     not null default true,
  last_sync_at timestamptz
);

-- ─────────────────────────── командный чат ───────────────────────────

create table chat_channels (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  scope        chat_scope  not null,
  name         text        not null,
  -- scope='candidate' → кандидат-тред
  candidate_id uuid        references candidates (id) on delete cascade,
  created_by   uuid        references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (scope <> 'candidate' or candidate_id is not null)
);
create unique index chat_channels_name_uniq on chat_channels (workspace_id, name) where scope = 'channel';
create unique index chat_channels_cand_uniq on chat_channels (workspace_id, candidate_id) where scope = 'candidate';

create table chat_channel_members (
  channel_id   uuid        not null references chat_channels (id) on delete cascade,
  user_id      uuid        not null references profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),   -- chatReads
  primary key (channel_id, user_id)
);
create index on chat_channel_members (user_id);

create table chat_messages (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  channel_id   uuid        not null references chat_channels (id) on delete cascade,
  author_id    uuid        references profiles (id) on delete set null,  -- null = system
  text         text        not null default '',
  reply_to     uuid        references chat_messages (id) on delete set null,
  edited_at    timestamptz,
  deleted      boolean     not null default false,
  created_at   timestamptz not null default now()
);
create index on chat_messages (channel_id, created_at desc);

-- @упоминания: строки вместо массива → дешёвый счётчик непрочитанных
create table chat_mentions (
  message_id uuid        not null references chat_messages (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  seen_at    timestamptz,
  primary key (message_id, user_id)
);
create index chat_mentions_unseen on chat_mentions (user_id) where seen_at is null;

create table chat_reactions (
  message_id uuid        not null references chat_messages (id) on delete cascade,
  user_id    uuid        not null references profiles (id) on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table chat_attachments (
  id         uuid        primary key default gen_random_uuid(),
  message_id uuid        not null references chat_messages (id) on delete cascade,
  name       text        not null,
  size       integer     not null,
  mime       text        not null,
  kind       text        not null check (kind in ('image', 'file')),
  path       text        not null,             -- storage: chat-attachments/<ws>/<msg>/<file>
  created_at timestamptz not null default now()
);
create index on chat_attachments (message_id);

-- ─────────────────────────── биллинг ───────────────────────────

create table subscriptions (
  workspace_id           uuid        primary key references workspaces (id) on delete cascade,
  plan                   plan_id     not null default 'free' references plans (id),
  cycle                  text        not null default 'monthly' check (cycle in ('monthly', 'yearly')),
  status                 text        not null default 'active'
                          check (status in ('active', 'past_due', 'canceled', 'trialing')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table invoices (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  amount_usd   numeric(10,2) not null,
  currency     currency_code not null default 'USD',
  status       text        not null check (status in ('paid', 'open', 'void', 'failed')),
  stripe_invoice_id text,
  pdf_url      text,
  issued_at    timestamptz not null default now()
);
create index on invoices (workspace_id, issued_at desc);

-- ============================================================================
-- Функции и триггеры
-- ============================================================================

-- updated_at
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger t_profiles_touch    before update on profiles    for each row execute function touch_updated_at();
create trigger t_workspaces_touch  before update on workspaces  for each row execute function touch_updated_at();
create trigger t_sources_touch     before update on sources     for each row execute function touch_updated_at();
create trigger t_searches_touch    before update on searches    for each row execute function touch_updated_at();
create trigger t_jobs_touch        before update on jobs        for each row execute function touch_updated_at();
create trigger t_candidates_touch  before update on candidates  for each row execute function touch_updated_at();
create trigger t_subs_touch        before update on subscriptions for each row execute function touch_updated_at();

-- auth.users → profiles
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger t_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- candidates.stage изменилась → обновить stage_at и записать в activity
create or replace function log_candidate_stage()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_at := now();
    insert into candidate_activity (workspace_id, candidate_id, actor_id, text)
    values (
      new.workspace_id, new.id, auth.uid(),
      'Стадия: ' || old.stage::text || ' → ' || new.stage::text ||
        coalesce(' (' || nullif(new.reject_reason, '') || ')', '')
    );
  end if;
  return new;
end $$;

create trigger t_candidate_stage
  before update of stage on candidates
  for each row execute function log_candidate_stage();

-- crm_tasks.done → done_at
create or replace function stamp_task_done()
returns trigger language plpgsql as $$
begin
  new.done_at := case when new.done then now() else null end;
  return new;
end $$;

create trigger t_task_done
  before update of done on crm_tasks
  for each row when (new.done is distinct from old.done)
  execute function stamp_task_done();

-- лимиты тарифа: активные поиски
create or replace function enforce_search_limit()
returns trigger language plpgsql as $$
declare lim int; cnt int;
begin
  if not new.active then return new; end if;
  select p.searches into lim
    from workspaces w join plans p on p.id = w.plan
   where w.id = new.workspace_id;
  select count(*) into cnt
    from searches
   where workspace_id = new.workspace_id and active and id <> new.id;
  if cnt >= lim then
    raise exception 'Plan limit: % active searches allowed', lim
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger t_search_limit
  before insert or update of active on searches
  for each row execute function enforce_search_limit();

-- лимиты тарифа: источники
create or replace function enforce_source_limit()
returns trigger language plpgsql as $$
declare lim int; cnt int;
begin
  select p.sources into lim
    from workspaces w join plans p on p.id = w.plan
   where w.id = new.workspace_id;
  select count(*) into cnt from sources where workspace_id = new.workspace_id;
  if cnt >= lim then
    raise exception 'Plan limit: % sources allowed', lim using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger t_source_limit
  before insert on sources
  for each row execute function enforce_source_limit();

-- лимиты тарифа: места (plan.seats + купленные extra_seats)
create or replace function enforce_seat_limit()
returns trigger language plpgsql as $$
declare lim int; cnt int;
begin
  select p.seats + w.extra_seats into lim
    from workspaces w join plans p on p.id = w.plan
   where w.id = new.workspace_id;
  select count(*) into cnt
    from workspace_members
   where workspace_id = new.workspace_id and user_id <> new.user_id;
  if cnt >= lim then
    raise exception 'Plan limit: % seats used', lim using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger t_seat_limit
  before insert on workspace_members
  for each row execute function enforce_seat_limit();

-- новый чат-канал (scope=channel) → в него входит вся команда
create or replace function seed_channel_members()
returns trigger language plpgsql as $$
begin
  if new.scope = 'channel' then
    insert into chat_channel_members (channel_id, user_id)
    select new.id, m.user_id from workspace_members m where m.workspace_id = new.workspace_id
    on conflict do nothing;
  elsif new.scope = 'candidate' then
    insert into chat_channel_members (channel_id, user_id)
    select new.id, m.user_id from workspace_members m where m.workspace_id = new.workspace_id
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger t_seed_channel_members
  after insert on chat_channels
  for each row execute function seed_channel_members();

-- RPC: создать воркспейс и сесть в него владельцем
create or replace function create_workspace(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into workspaces (name, owner_id) values (p_name, auth.uid()) returning id into ws;
  insert into workspace_members (workspace_id, user_id, role, color)
  values (ws, auth.uid(), 'owner', 'var(--amber)');
  insert into crm_sheets (workspace_id) values (ws);
  insert into subscriptions (workspace_id) values (ws);
  insert into chat_channels (workspace_id, scope, name, created_by)
  values (ws, 'channel', 'general', auth.uid());
  return ws;
end $$;

-- RPC: лид → кандидат (дедуп по match_id, как convertMatchToCandidate)
create or replace function convert_match_to_candidate(p_match uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare m matches%rowtype; cid uuid;
begin
  select * into m from matches where id = p_match;
  if not found then raise exception 'match not found'; end if;

  select id into cid from candidates
   where workspace_id = m.workspace_id and match_id = m.id;
  if cid is not null then return cid; end if;

  insert into candidates (workspace_id, name, position, stage, assignee, tg, phone, source, note, match_id)
  values (
    m.workspace_id,
    coalesce(m.author, m.sender),
    coalesce((select name from searches where id = m.search_id), ''),
    'applied',
    m.assignee,
    nullif(m.sender, ''),
    m.phone,
    coalesce((select s.name || ' · ' || s.platform::text from sources s where s.id = m.source_id), 'lead'),
    m.summary,
    m.id
  )
  returning id into cid;

  insert into candidate_activity (workspace_id, candidate_id, actor_id, text)
  values (m.workspace_id, cid, auth.uid(), 'Создан из лида');
  return cid;
end $$;

-- ============================================================================
-- Views — то, что в демо было закэшировано в объекте (today, relRate, noiseRate…)
-- ============================================================================

create or replace view search_stats as
select
  s.id                                                     as search_id,
  s.workspace_id,
  s.name,
  s.active,
  (select count(*) from search_sources ss where ss.search_id = s.id) as sources,
  count(m.*) filter (where m.posted_at >= date_trunc('day', now()))  as today,
  round(100.0 * count(m.*) filter (where m.rel >= s.threshold)
        / nullif(count(m.*), 0))                           as rel_rate,
  round(100.0 * count(m.*) filter (where m.status = 'noise')
        / nullif(count(m.*), 0))                           as noise_rate,
  max(m.posted_at)                                         as last_match_at
from searches s
left join matches m on m.search_id = s.id
group by s.id;

create or replace view source_stats as
select
  src.id           as source_id,
  src.workspace_id,
  src.name,
  src.platform,
  count(m.*) filter (where m.posted_at >= date_trunc('day', now())) as today,
  max(m.posted_at) as last_match_at
from sources src
left join matches m on m.source_id = src.id
group by src.id;

-- воронка найма для /analytics
create or replace view candidate_funnel as
select
  workspace_id,
  stage,
  count(*)                                                          as total,
  avg(extract(epoch from (now() - stage_at)) / 86400)::numeric(6,1) as avg_days_in_stage
from candidates
group by workspace_id, stage;

-- непрочитанное в чате для текущего юзера
create or replace view chat_unread as
select
  c.id                                                as channel_id,
  c.workspace_id,
  cm.user_id,
  count(msg.*) filter (
    where msg.created_at > cm.last_read_at and msg.author_id <> cm.user_id
  )                                                   as unread
from chat_channels c
join chat_channel_members cm on cm.channel_id = c.id
left join chat_messages msg  on msg.channel_id = c.id
group by c.id, cm.user_id;


-- ==================== supabase/migrations/20260714000002_rls.sql ====================
-- ============================================================================
-- Vexa — RLS. Правило одно: видно только то, что в моём воркспейсе.
-- ============================================================================

-- Хелперы — SECURITY DEFINER, поэтому политика на workspace_members,
-- которая сама читает workspace_members, не уходит в рекурсию.

create or replace function is_member(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function is_owner(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

-- воркспейс по id канала — для чат-таблиц без своего workspace_id
create or replace function channel_ws(ch uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select workspace_id from chat_channels where id = ch;
$$;

create or replace function message_ws(msg uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select workspace_id from chat_messages where id = msg;
$$;

alter table plans                enable row level security;
alter table profiles             enable row level security;
alter table workspaces           enable row level security;
alter table workspace_members    enable row level security;
alter table workspace_invites    enable row level security;
alter table sources              enable row level security;
alter table searches             enable row level security;
alter table search_sources       enable row level security;
alter table matches              enable row level security;
alter table bot_recipients       enable row level security;
alter table match_deliveries     enable row level security;
alter table jobs                 enable row level security;
alter table candidates           enable row level security;
alter table candidate_activity   enable row level security;
alter table candidate_comments   enable row level security;
alter table crm_events           enable row level security;
alter table crm_tasks            enable row level security;
alter table crm_sheets           enable row level security;
alter table chat_channels        enable row level security;
alter table chat_channel_members enable row level security;
alter table chat_messages        enable row level security;
alter table chat_mentions        enable row level security;
alter table chat_reactions       enable row level security;
alter table chat_attachments     enable row level security;
alter table subscriptions        enable row level security;
alter table invoices             enable row level security;

-- ─── plans: справочник, читают все ───
create policy plans_read on plans for select to authenticated using (true);

-- ─── profiles ───
-- вижу себя и всех, с кем делю воркспейс
create policy profiles_read on profiles for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from workspace_members me
    join workspace_members other on other.workspace_id = me.workspace_id
    where me.user_id = auth.uid() and other.user_id = profiles.id
  )
);
create policy profiles_update on profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- ─── workspaces ───
create policy ws_read   on workspaces for select to authenticated using (is_member(id));
create policy ws_update on workspaces for update to authenticated
  using (is_owner(id)) with check (is_owner(id));
create policy ws_delete on workspaces for delete to authenticated using (is_owner(id));
-- insert только через rpc create_workspace()

-- ─── members / invites ───
create policy wm_read   on workspace_members for select to authenticated using (is_member(workspace_id));
create policy wm_write  on workspace_members for insert to authenticated with check (is_owner(workspace_id));
create policy wm_delete on workspace_members for delete to authenticated
  using (is_owner(workspace_id) and role <> 'owner');

create policy inv_read  on workspace_invites for select to authenticated using (is_member(workspace_id));
create policy inv_write on workspace_invites for all    to authenticated
  using (is_owner(workspace_id)) with check (is_owner(workspace_id));

-- ─── всё, что имеет workspace_id: полный доступ участникам ───
create policy sources_all    on sources          for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy searches_all   on searches         for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));

-- search_sources своего workspace_id не имеет — гейтим через родительский поиск
create policy ss_all on search_sources for all to authenticated
  using (exists (select 1 from searches s where s.id = search_id and is_member(s.workspace_id)))
  with check (exists (select 1 from searches s where s.id = search_id and is_member(s.workspace_id)));
create policy matches_all    on matches          for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy bots_all       on bot_recipients   for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy deliv_all      on match_deliveries for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy jobs_all       on jobs             for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy cands_all      on candidates       for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy cact_all       on candidate_activity for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy ccom_all       on candidate_comments for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id) and author_id = auth.uid());
create policy cev_all        on crm_events       for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy ctask_all      on crm_tasks        for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy csheet_all     on crm_sheets       for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy chat_ch_all    on chat_channels    for all to authenticated
  using (is_member(workspace_id)) with check (is_member(workspace_id));

-- сообщения: читают участники воркспейса, пишут — только от своего имени
create policy chat_msg_read   on chat_messages for select to authenticated
  using (is_member(workspace_id));
create policy chat_msg_insert on chat_messages for insert to authenticated
  with check (is_member(workspace_id) and author_id = auth.uid());
create policy chat_msg_update on chat_messages for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy chat_msg_delete on chat_messages for delete to authenticated
  using (author_id = auth.uid());

create policy chat_mem_all on chat_channel_members for all to authenticated
  using (is_member(channel_ws(channel_id)))
  with check (is_member(channel_ws(channel_id)));

create policy chat_att_read   on chat_attachments for select to authenticated
  using (is_member(message_ws(message_id)));
create policy chat_att_insert on chat_attachments for insert to authenticated
  with check (is_member(message_ws(message_id)));

create policy chat_react_read on chat_reactions for select to authenticated
  using (is_member(message_ws(message_id)));
create policy chat_react_write on chat_reactions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_member(message_ws(message_id)));

create policy chat_ment_read   on chat_mentions for select to authenticated
  using (is_member(message_ws(message_id)));
create policy chat_ment_update on chat_mentions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chat_ment_insert on chat_mentions for insert to authenticated
  with check (is_member(message_ws(message_id)));

-- ─── биллинг: читают все, меняет владелец (в проде — только service_role) ───
create policy subs_read  on subscriptions for select to authenticated using (is_member(workspace_id));
create policy subs_write on subscriptions for update to authenticated
  using (is_owner(workspace_id)) with check (is_owner(workspace_id));
create policy inv_read2  on invoices      for select to authenticated using (is_member(workspace_id));

-- ============================================================================
-- Storage
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false), ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

-- avatars: публичное чтение, писать только в свою папку <uid>/...
create policy avatars_read on storage.objects for select
  using (bucket_id = 'avatars');
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- resumes и chat-attachments: путь <workspace_id>/... , доступ по членству
create policy files_read on storage.objects for select to authenticated
  using (
    bucket_id in ('resumes', 'chat-attachments')
    and is_member(((storage.foldername(name))[1])::uuid)
  );
create policy files_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('resumes', 'chat-attachments')
    and is_member(((storage.foldername(name))[1])::uuid)
  );
create policy files_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('resumes', 'chat-attachments')
    and is_member(((storage.foldername(name))[1])::uuid)
  );


-- ==================== supabase/migrations/20260714000003_seed_plans.sql ====================
-- ============================================================================
-- Vexa — справочник тарифов. Один-в-один с lib/plans.ts.
-- Идемпотентно: повторный прогон обновляет строки.
-- ============================================================================

insert into plans (id, name, tagline, tagline_ru, price_m, price_y, seats, searches, sources, deliveries, polling, features, features_ru, recommended, sort)
values
('free', 'Free',
 'Try Vexa on a single search', 'Попробуйте Vexa на одном поиске',
 0, 0, 1, 1, 3, 50, 'EVERY 15 MIN',
 array['1 active search','3 sources','50 bot deliveries / mo','Dashboard inbox','7-day match history'],
 array['1 активный поиск','3 источника','50 доставок бота / мес','Входящие в дашборде','История совпадений 7 дней'],
 false, 1),

('lite', 'Lite',
 'For a solo recruiter or founder', 'Для соло-рекрутера или фаундера',
 19, 15, 1, 3, 15, 500, 'EVERY 5 MIN',
 array['3 active searches','15 sources','500 bot deliveries / mo','Minus-words & match modes','30-day match history','CSV export'],
 array['3 активных поиска','15 источников','500 доставок бота / мес','Минус-слова и режимы поиска','История 30 дней','Экспорт CSV'],
 false, 2),

('pro', 'Pro',
 'Serious monitoring, full speed', 'Серьёзный мониторинг на полной скорости',
 49, 39, 1, 10, 100, 2000, 'EVERY 30 SEC',
 array['10 active searches','100 sources','2,000 bot deliveries / mo','Comments monitoring','Relevance tuning per search','Unlimited history','Priority support'],
 array['10 активных поисков','100 источников','2 000 доставок бота / мес','Мониторинг комментариев','Порог релевантности на поиск','Безлимитная история','Приоритетная поддержка'],
 true, 3),

('team', 'Team',
 'Shared inbox for up to 5 people', 'Общий инбокс на 5 человек',
 99, 79, 5, 25, 300, 10000, 'EVERY 30 SEC',
 array['Everything in Pro','5 team seats','25 active searches','300 sources','10,000 bot deliveries / mo','Shared inbox & assignments','Member roles (owner / member)'],
 array['Всё из Pro','5 мест в команде','25 активных поисков','300 источников','10 000 доставок бота / мес','Общий инбокс и назначения','Роли участников (владелец / участник)'],
 false, 4)

on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  tagline_ru = excluded.tagline_ru,
  price_m = excluded.price_m,
  price_y = excluded.price_y,
  seats = excluded.seats,
  searches = excluded.searches,
  sources = excluded.sources,
  deliveries = excluded.deliveries,
  polling = excluded.polling,
  features = excluded.features,
  features_ru = excluded.features_ru,
  recommended = excluded.recommended,
  sort = excluded.sort;

-- ─── Realtime: инбокс, чат и CRM-доска обновляются live ───
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table chat_reactions;
alter publication supabase_realtime add table candidates;
alter publication supabase_realtime add table crm_tasks;


-- ==================== supabase/migrations/20260714000004_seed_demo.sql ====================
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


