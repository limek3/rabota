-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — способ передачи «перевод или форма» и проект «Дмитровка»
--
--  projects.handoff = 'mixed' — оператор переводит клиента на менеджера в звонке, а если не получилось —
--  отправляет форму заказчика. Что было, видно по лиду: перевели — в leads.checks одна отметка
--  «Перевели на менеджера в звонке»; нет — отмечены пункты чек-листа формы.
--
--  Заодно заводит проект «Дмитровка» с таким способом и чек-листом формы (если проекта с таким названием
--  ещё нет; если есть — ставит ему «перевод или форму» и условия, пока их не задали руками).
--  Города и цену лида задайте в «Проектах».
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.projects drop constraint if exists projects_handoff_check;
alter table public.projects add constraint projects_handoff_check check (handoff is null or handoff in ('transfer', 'form', 'mixed'));

do $$
declare
  v_brief text := $brief$Не берём:
- BYD FangChengBao Leopard 5
- Tank 700
- M-Hero
- Xiaomi
- LiXiang L9, LiXiang Mega
- Амберавто
- УМО 5
- Mitsubishi Pajero, Pajero Sport, Outlander — новые
- Toyota Fortuner, Land Cruiser
- электромобили Rising Auto
- новые BMW, Mercedes, Land Rover, Volvo, Audi

Передача: переводим клиента на менеджера в звонке. Не получилось — отправляем форму: обязательно телефон, имя, город клиента; в комментарии — все остальные критерии.$brief$;
  v_list jsonb := '["Телефон", "Имя", "Город клиента", "В комментарии — все остальные критерии"]'::jsonb;
  v_id text;
begin
  select id into v_id
  from public.projects
  where deleted_at is null and regexp_replace(lower(name), '[^a-z0-9а-я]', '', 'g') = 'дмитровка'
  limit 1;

  if v_id is null then
    insert into public.projects (id, name, active, color, sort, handoff, brief, checklist, created_at, updated_at)
    select 'pr-dmitrovka', 'Дмитровка', true, 'green', coalesce(max(sort), -1) + 1, 'mixed', v_brief, v_list, now(), now()
    from public.projects
    on conflict (id) do nothing;
  else
    update public.projects
    set handoff = 'mixed',
        brief = case when coalesce(brief, '') = '' then v_brief else brief end,
        checklist = case when coalesce(checklist, '[]'::jsonb) = '[]'::jsonb then v_list else checklist end,
        updated_at = now()
    where id = v_id and coalesce(handoff, 'transfer') = 'transfer';
  end if;
end $$;
