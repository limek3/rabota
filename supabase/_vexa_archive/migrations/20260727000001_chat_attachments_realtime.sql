-- Картинки в чате: строки chat_attachments вставляются ПОСЛЕ строки сообщения,
-- а realtime слушал только chat_messages — получатель успевал зафетчить
-- сообщение без вложений и больше о них не узнавал (пустой пузырь).
-- Добавляем таблицу в публикацию; фильтра по workspace нет (нет колонки),
-- чужие строки отсекает RLS-политика chat_att_read.
-- Guard: alter publication не умеет if not exists, повторный запуск падал бы.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_attachments'
  ) then
    alter publication supabase_realtime add table chat_attachments;
  end if;
end $$;
