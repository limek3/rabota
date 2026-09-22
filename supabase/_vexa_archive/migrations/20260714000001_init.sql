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

create table jobs (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  title        text        not null,
  dept         text,
  status       job_status  not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on jobs (workspace_id, status);

create table candidates (
  id            uuid            primary key default gen_random_uuid(),
  workspace_id  uuid            not null references workspaces (id) on delete cascade,
  name          text            not null,
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
