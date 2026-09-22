-- ═══════════════════════════════════════════════════════════════════════
-- Метки, хэштеги, дата рождения и номер вакансии
--
--   candidates.labels    — метки-иконки рядом со статусом (👥 ❕ 🏠 ⚡️ 🩺).
--   candidates.tags      — свободные хэштеги для поиска ("альпинист", "чс").
--                          Храним нормализованными: нижний регистр, без "#".
--   candidates.birthday  — дата рождения. Возраст СЧИТАЕМ от неё, а не храним:
--                          записанное однажды "45" через год врёт.
--   jobs.code            — номер вакансии как в реестре (#1043). Сорок
--                          «грузчиков» иначе не различить. Номер выдаёт
--                          последовательность — без гонок на параллельной вставке.
--
-- Применить к базе: выполнить этот файл в Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

alter table candidates
  add column if not exists labels   text[] not null default '{}',
  add column if not exists tags     text[] not null default '{}',
  add column if not exists birthday date;

comment on column candidates.labels is
  'Метки-иконки: referral|compliance|local|urgent|medical. В таблице показываем не больше трёх.';
comment on column candidates.tags is
  'Хэштеги для поиска, нормализованы (нижний регистр, без решётки).';
comment on column candidates.birthday is
  'Дата рождения. Возраст вычисляется на лету — не хранится.';

-- поиск по хэштегу и фильтр по метке идут по массиву целиком → GIN
create index if not exists candidates_tags_idx   on candidates using gin (tags);
create index if not exists candidates_labels_idx on candidates using gin (labels);

/* ── номер вакансии ──────────────────────────────────────────────────── */

create sequence if not exists job_code_seq start 1001;

alter table jobs
  add column if not exists code integer;

-- пронумеровать вакансии, заведённые до этой миграции (порядок — по дате)
update jobs j
   set code = nextval('job_code_seq')
  from (select id from jobs where code is null order by created_at) ordered
 where j.id = ordered.id;

alter table jobs
  alter column code set default nextval('job_code_seq'),
  alter column code set not null;

comment on column jobs.code is 'Номер вакансии в реестре (#1043). Уникален в пределах воркспейса.';

create unique index if not exists jobs_code_per_ws on jobs (workspace_id, code);
