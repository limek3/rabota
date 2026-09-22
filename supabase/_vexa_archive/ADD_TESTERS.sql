-- Посадить тестеров в общий воркспейс, пока инвайт-ссылки нет.
--
-- ПОРЯДОК ВАЖЕН, и он неочевиден. Сначала завести людей в Auth, потом выполнить
-- этот скрипт, и только потом они впервые заходят в приложение.
--
-- Почему нельзя наоборот: при первом входе стор зовёт fetchMyWorkspace(), и если
-- та вернула null — создаёт человеку собственный воркспейс (lib/store.tsx:522).
-- А fetchMyWorkspace() берёт воркспейс с самым ранним joined_at (lib/db.ts:124).
-- Значит тестер, зашедший до того, как его добавили сюда, навсегда останется в
-- своём личном: общий воркспейс присоединится позже и всегда будет проигрывать
-- по дате. Внешне это выглядит как «его не пустило к нам», хотя строка в
-- workspace_members есть.
--
-- Выполнять в Supabase → SQL Editor (там роль postgres, RLS не мешает).

-- ── 1. Найти свой воркспейс. Скопировать workspace_id ────────────────────
select w.id as workspace_id, w.name, w.plan, p.email as owner
from workspaces w
join profiles p on p.id = w.owner_id;

-- ── 2. Проверить, что тестеры заведены ───────────────────────────────────
-- Auth → Users → Add user (с галкой Auto Confirm User). Строку в profiles
-- триггер handle_new_user создаст сам — руками её добавлять не нужно.
select id, email, display_name, created_at
from profiles
order by created_at desc;

-- ── 3. Посадить их в воркспейс ───────────────────────────────────────────
-- Подставить workspace_id из шага 1 и реальные почты из шага 2.
insert into workspace_members (workspace_id, user_id, role)
select
  '00000000-0000-0000-0000-000000000000'::uuid,  -- ← workspace_id
  id,
  'member'
from profiles
where email in ('tester1@example.com', 'tester2@example.com')  -- ← почты тестеров
on conflict (workspace_id, user_id) do nothing;

-- ── 4. Тариф team ────────────────────────────────────────────────────────
-- На free в плане одно место, и интерфейс мест будет считать, что команда
-- переполнена. На доступ к данным это не влияет (RLS смотрит только на
-- членство), но экран команды будет врать.
update workspaces
set plan = 'team'
where id = '00000000-0000-0000-0000-000000000000'::uuid;  -- ← workspace_id

-- ── 5. Проверка: три строки — вы и двое ──────────────────────────────────
select p.email, m.role, m.joined_at
from workspace_members m
join profiles p on p.id = m.user_id
where m.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid  -- ← workspace_id
order by m.joined_at;
