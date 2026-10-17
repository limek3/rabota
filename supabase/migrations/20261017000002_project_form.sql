-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — проекты с отправкой формы (100 up) и условия проекта для оператора
--
--  projects.handoff   — как передаётся лид: 'transfer' — перевод на менеджера (авто.ру, как было),
--                       'form' — оператор отправляет форму заказчика, клиента не переводит (100 up);
--  projects.brief     — условия проекта: показываются оператору в окне лида;
--  projects.checklist — пункты, которые оператор отмечает перед записью лида (для формы — что заполнено).
--
--  Заодно заводит проект «100 up» с условиями заказчика (если проекта с таким названием ещё нет;
--  если есть — проставляет ему «форму» и условия, пока их не задали руками).
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--  Колонки без not null: импорт и восстановление копии (crm_replace_all) у старых копий
--  этих полей не найдут и вставят null — приложение читает его как «перевод, без условий».
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

alter table public.projects add column if not exists handoff text default 'transfer';
alter table public.projects add column if not exists brief text default '';
alter table public.projects add column if not exists checklist jsonb default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_handoff_check;
alter table public.projects add constraint projects_handoff_check check (handoff is null or handoff in ('transfer', 'form'));

do $$
declare
  v_brief text := $brief$Подбор авто. Все марки, кроме: коммерческий транспорт, Mercedes-Benz, BMW, Audi и Porsche, Cadillac, Infiniti, Lexus, Газели, кабриолеты, Волга, Ford Mustang и подобные авто, Kia Carnival, Toyota Land Cruiser Prado, Toyota Land Cruiser 100, Toyota Land Cruiser 200, пикапы, минивэны, спецтехника.

Города: Москва, Краснодар, Самара, Сургут, Липецк, Тольятти, Екатеринбург, Тюмень.

Условия:
1. Гражданство РФ
2. Не лизинг
3. Стоимость от 500 тыс до 5 млн руб — новые авто и с пробегом
4. Рассматривает покупку в городе автосалона или готов приехать
5. Желательно кредит
6. Рассматривает покупку в течение 3 месяцев

Не работаем с Кавказом.
Продукты: трейд-ин, кредит, рассрочка.

Клиента НЕ переводим — отправляем форму. Обязательно: телефон, имя, город клиента; в комментарии — все остальные критерии.$brief$;
  v_list jsonb := '["Телефон", "Имя", "Город клиента", "В комментарии — все остальные критерии"]'::jsonb;
  v_id text;
begin
  select id into v_id
  from public.projects
  where deleted_at is null and regexp_replace(lower(name), '[^a-z0-9а-я]', '', 'g') = '100up'
  limit 1;

  if v_id is null then
    insert into public.projects (id, name, active, color, sort, handoff, brief, checklist, created_at, updated_at)
    select 'pr-100up', '100 up', true, 'blue', coalesce(max(sort), -1) + 1, 'form', v_brief, v_list, now(), now()
    from public.projects
    on conflict (id) do nothing;
  else
    update public.projects
    set handoff = 'form',
        brief = case when coalesce(brief, '') = '' then v_brief else brief end,
        checklist = case when coalesce(checklist, '[]'::jsonb) = '[]'::jsonb then v_list else checklist end,
        updated_at = now()
    where id = v_id and coalesce(handoff, 'transfer') = 'transfer';
  end if;
end $$;
