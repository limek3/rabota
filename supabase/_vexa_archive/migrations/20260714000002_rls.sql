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
