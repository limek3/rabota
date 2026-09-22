-- Журнал удалений контактов.
--
-- До сих пор след от удаления жил на самой карточке: candidate_activity висит
-- на candidates(id) с on delete cascade, поэтому в момент удаления история
-- уходила вместе с карточкой. Оставался тост с «отменить» — ровно до тех пор,
-- пока он не погас. После этого вопрос «кто снёс контакт» ответа не имел.
--
-- С 20260722000002 удаление — право руководителя, а не любого сотрудника. Раз
-- действие стало привилегией, у него должен быть след, переживающий объект. Он
-- обязан лежать в отдельной таблице: всё, что ссылается на candidates(id),
-- каскадом умирает вместе с карточкой.
create table if not exists deletion_log (
  id              uuid        primary key default gen_random_uuid(),

  -- FK на workspaces тут намеренно НЕТ.
  --
  -- Удаление рабочего пространства каскадом сносит его контакты, на каждый
  -- срабатывает этот триггер и пытается вставить строку журнала. Родитель к
  -- этому моменту уже удалён, и внешний ключ отверг бы вставку — то есть
  -- FK ломал бы удаление самого пространства. Осиротевшие строки читать всё
  -- равно некому: политика ниже требует членства, а членов у исчезнувшего
  -- пространства не осталось.
  workspace_id    uuid        not null,

  entity          text        not null default 'candidate',
  -- Тоже без FK: строки, на которую он бы указывал, уже нет.
  entity_id       uuid        not null,

  -- Подпись для списка. Держим отдельно от snapshot, чтобы журнал читался
  -- запросом без разбора jsonb.
  title           text        not null default '',
  subtitle        text        not null default '',
  assignee        uuid,

  -- null = удаление прошло сервисным ключом (миграция, скрипт), а не человеком.
  deleted_by      uuid,
  -- Имя копией: профиль удалившего может исчезнуть позже, журнал — нет.
  deleted_by_name text        not null default '',

  -- Полный снимок строки: журнал отвечает не только «кто», но и «что именно».
  snapshot        jsonb       not null default '{}'::jsonb,

  deleted_at      timestamptz not null default now()
);

create index if not exists deletion_log_ws_at_idx on deletion_log (workspace_id, deleted_at desc);

-- Пишет только этот триггер. security definer — потому что у сотрудника прав на
-- запись в журнал нет и быть не должно: иначе запись можно было бы подделать.
create or replace function log_candidate_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
begin
  insert into deletion_log (
    workspace_id, entity, entity_id, title, subtitle,
    assignee, deleted_by, deleted_by_name, snapshot
  )
  values (
    old.workspace_id,
    'candidate',
    old.id,
    coalesce(old.name, ''),
    coalesce(old.position, ''),
    old.assignee,
    actor,
    coalesce((select p.display_name from profiles p where p.id = actor), ''),
    -- resume_data выкидываем: это data URI файла резюме, до 900 КБ на карточку
    -- (см. 20260722000001). В журнале он раздул бы таблицу на пустом месте.
    to_jsonb(old) - 'resume_data'
  );
  return old;
end;
$$;

drop trigger if exists trg_log_candidate_delete on candidates;
create trigger trg_log_candidate_delete
  before delete on candidates
  for each row execute function log_candidate_delete();

alter table deletion_log enable row level security;

-- Читают журнал те же, кому разрешено удалять, — руководители.
drop policy if exists dlog_select on deletion_log;
create policy dlog_select on deletion_log for select to authenticated
  using (is_member(workspace_id) and is_manager(workspace_id));

-- Политик insert/update/delete нет намеренно: через PostgREST в журнал не
-- пишет и не правит никто, включая владельца. Единственный автор — триггер.
