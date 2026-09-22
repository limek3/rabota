-- Командные виды таблицы контактов.
--
-- Порядок колонок, их ширины и фильтры до сих пор жили в localStorage каждого
-- сотрудника. Следствий два, и оба про команду, а не про удобство одного
-- человека: новый рекрутёр открывает базу в состоянии «по умолчанию» и собирает
-- свой вид с нуля, а договориться «смотрим вот так» нельзя вообще никак —
-- показать чужой экран можно, передать раскладку нельзя.
--
-- Сохранённые виды уже есть, но они тоже персональные. Не хватает ровно одного:
-- пометки «командный» и места, где такой вид лежит общим для всех.
--
-- Персональные виды остаются в localStorage. Здесь только общие: их немного,
-- меняют их редко, а таскать личные раскладки в БД — синхронизировать то, что
-- никого, кроме владельца, не касается.
create table if not exists crm_views (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references workspaces (id) on delete cascade,
  name         text        not null,

  -- filters — тот же ContactFilters, layout — order/hidden/widths.
  --
  -- Держим их раздельно, потому что это разные вопросы: «какие строки видно» и
  -- «как разложены колонки». Слитым объектом нельзя было бы, например, отдать
  -- новичку раскладку, не навязав ему заодно чужой фильтр по ответственному.
  filters      jsonb       not null default '{}'::jsonb,
  layout       jsonb       not null default '{}'::jsonb,

  -- Вид, который получает тот, кто ещё ничего не настраивал. Ровно один на
  -- воркспейс — частичный уникальный индекс ниже.
  is_default   boolean     not null default false,

  created_by   uuid        references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Имя — то, чем вид зовут вслух; два «Горящие» в одном списке неразличимы.
create unique index if not exists crm_views_ws_name_idx
  on crm_views (workspace_id, lower(name));

create unique index if not exists crm_views_ws_default_idx
  on crm_views (workspace_id) where is_default;

alter table crm_views enable row level security;

-- Смотрят все члены воркспейса: вид командный, в этом весь смысл.
drop policy if exists cviews_select on crm_views;
create policy cviews_select on crm_views for select to authenticated
  using (is_member(workspace_id));

-- Заводят и правят — руководители. Общий вид — это соглашение команды, и менять
-- его в одиночку из своего угла нельзя, иначе он ничем не лучше персонального.
drop policy if exists cviews_write on crm_views;
create policy cviews_write on crm_views for all to authenticated
  using (is_member(workspace_id) and is_manager(workspace_id))
  with check (is_member(workspace_id) and is_manager(workspace_id));
