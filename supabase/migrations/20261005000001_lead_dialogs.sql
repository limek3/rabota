-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — расшифровка разговора в карточке лида
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Оператор записывает лид со ссылкой Скорозвона «…/#/leads/<лид>/answer/<звонок>/+7…».
--  Функция lead-dialog (supabase/functions/lead-dialog) берёт по номеру звонка запись
--  разговора, отдаёт её в Memo AI и кладёт сюда реплики. Пишет в таблицу только функция
--  (service_role), а читает тот, кто видит сам лид: политика спрашивает leads, а у leads
--  своя RLS — РОП все, супервайзер свои группы, оператор свои лиды.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

create table if not exists public.lead_dialogs (
  lead_id          text primary key references public.leads (id) on delete cascade,
  call_id          text not null default '',
  -- pending — ещё не начинали; waiting — Скорозвон ещё готовит запись; processing — Memo расшифровывает
  status           text not null default 'pending' check (status in ('pending', 'waiting', 'processing', 'done', 'failed')),
  error            text not null default '',
  memo_id          text,
  -- speaker_id из Memo, который говорит за оператора (остальные — клиент)
  operator_speaker text,
  -- [{ s: начало, e: конец (сек), who: speaker_id, t: текст }]
  segments         jsonb not null default '[]'::jsonb,
  call_at          timestamptz,
  call_sec         integer,
  call_user        text not null default '',
  record_url       text not null default '',
  attempts         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.lead_dialogs enable row level security;

drop policy if exists lead_dialogs_read on public.lead_dialogs;
create policy lead_dialogs_read on public.lead_dialogs for select to authenticated using (
  exists (select 1 from public.leads l where l.id = lead_id)
);
-- insert / update / delete политик нет: пишет только функция под service_role
