# Vexa — база данных (Supabase / Postgres)

## Как залить

SQL Editor в дашборде Supabase — выполнить по порядку:

1. `migrations/20260714000001_init.sql` — типы, таблицы, индексы, триггеры, view
2. `migrations/20260714000002_rls.sql` — RLS-политики + storage-бакеты
3. `migrations/20260714000003_seed_plans.sql` — тарифы + realtime

Или через CLI: `supabase db push`.

Дальше типы для фронта: `supabase gen types typescript --project-id <ref> > lib/database.types.ts`.

## Как устроено

Всё вешается на **workspace** (воркспейс = организация). `auth.users` → `profiles` (личные
настройки: тема, язык, валюта, аватар) → `workspace_members` (роль owner/member, цвет).
У каждой таблицы с данными есть `workspace_id`, RLS пускает только участников.

Воркспейс создаётся через RPC:

```ts
const { data: wsId } = await supabase.rpc("create_workspace", { p_name: "Aventa Recruiting" });
```

Он же сразу заводит владельца, `crm_sheets`, `subscriptions` и канал `#general`.

## Что откуда взялось

| Поле/срез в `store.tsx` | В базе |
|---|---|
| `workspaceName`, `plan`, `extraSeats`, `notif`, `quietFrom/To`, `minAlertRel`, `scanQuota`, флаги онбординга | колонки `workspaces` |
| `members` | `workspace_members` + `profiles` |
| `prefs` (тема, язык, валюта, имя, должность, аватар) | `profiles` — настройки личные, не общие на команду |
| `sources` | `sources` |
| `searches` | `searches` + `search_sources` (M2M вместо счётчика `sources: number`) |
| `matches` | `matches` |
| `botRecipients` | `bot_recipients` |
| `failedDeliveries` | `match_deliveries` (лог, а не флаг — из него же считается месячный лимит доставок) |
| `jobs`, `candidates`, `crmTasks`, `crmEvents`, `crmSheet` | `jobs`, `candidates`, `crm_tasks`, `crm_events`, `crm_sheets` |
| `Candidate.activity` / `.comments` | `candidate_activity` / `candidate_comments` |
| `chatChannels`, `chatMessages`, `chatReads`, `chatMentionSeen` | `chat_channels`, `chat_channel_members.last_read_at`, `chat_messages`, `chat_mentions`, `chat_reactions`, `chat_attachments` |

## Что стало вычисляемым

Демо кэшировало в объекте то, что база считает сама. Это **view**, не колонки:

- `search_stats` — `today`, `rel_rate`, `noise_rate`, `sources`, `last_match_at` по каждому поиску
- `source_stats` — `today`, `last_match_at` по каждому источнику
- `candidate_funnel` — воронка + среднее время в стадии (для `/analytics`)
- `chat_unread` — непрочитанные по каналам

## Связи, которые держат систему

- `matches.link` уникален внутри воркспейса → дедуп сканера (как в `runScan()`)
- `candidates.match_id` уникален → лид нельзя сконвертить в кандидата дважды (`convert_match_to_candidate(uuid)` RPC)
- `crm_tasks.event_id` → задача-зеркало брони; календарь рисует только событие
- удалили вакансию → у кандидатов `job_id = null` (не каскад)
- удалили кандидата → задачи остаются, `candidate_id = null`; тред в чате уходит каскадом

## Триггеры

- `stage` кандидата поменялась → `stage_at = now()` + строка в `candidate_activity` (автоматом, руками писать не надо)
- лимиты тарифа проверяются в БД, а не только в UI: активные поиски, источники, места (`plan.seats + extra_seats`)
- `auth.users` insert → `profiles` создаётся сам
- новый канал → в него добавляется вся команда

## Storage

| Бакет | Путь | Доступ |
|---|---|---|
| `avatars` | `<user_id>/file` | публичное чтение, пишет только сам юзер |
| `resumes` | `<workspace_id>/<candidate_id>/file` | только участники воркспейса |
| `chat-attachments` | `<workspace_id>/<message_id>/file` | только участники воркспейса |

## Realtime

Включён на `matches`, `chat_messages`, `chat_reactions`, `candidates`, `crm_tasks` — инбокс,
чат и CRM-доска обновляются без поллинга.
