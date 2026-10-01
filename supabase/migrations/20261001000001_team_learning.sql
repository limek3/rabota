-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — «Обучение команды»: руководитель видит, как учатся его люди
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен.
--
--  Прогресс обучения (таблица learn) привязан к аккаунту, а не к карточке сотрудника.
--  Записи learn читать уже можно всем вошедшим, но аккаунты до сих пор видели только
--  РОП и сам владелец — поэтому супервайзер не мог сопоставить прогресс со своими
--  стажёрами («нет аккаунта», 0%). Теперь аккаунты операторов своей зоны видны:
--    супервайзеру — операторов его групп (или всего отдела, если «видеть все группы»);
--    наставнику (старший оператор) — операторов его группы.
--  Менять чужие аккаунты по-прежнему может только РОП: insert/update/delete не трогаем.
--  То же правило в приложении — lib/crm/access.ts (scopeData, accounts).
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- операторы, чьи аккаунты видны вошедшему (кроме РОПа — он и так видит все)
create or replace function public.crm_team_op_ids() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  ids text[];
  mg  text;
begin
  if public.crm_sees_all() then
    select coalesce(array_agg(o.id), '{}'::text[]) into ids from public.operators o where o.deleted_at is null;
    return ids;
  end if;
  ids := case when public.crm_role() = 'supervisor' then coalesce(public.crm_touch_ops(), '{}'::text[]) else '{}'::text[] end;
  -- наставник: функция есть, если применена миграция 20260929000001_mentor.sql
  if to_regproc('public.crm_mentor_group') is not null then
    execute 'select public.crm_mentor_group()' into mg;
    if mg is not null then
      ids := ids || coalesce((select array_agg(o.id) from public.operators o where o.deleted_at is null and o.group_id = mg), '{}'::text[]);
    end if;
  end if;
  return ids;
end
$$;

revoke all on function public.crm_team_op_ids() from public, anon;
grant execute on function public.crm_team_op_ids() to authenticated;

-- аккаунты: РОП — все, каждый — свой, руководитель — аккаунты операторов своей зоны
drop policy if exists accounts_read on public.accounts;
create policy accounts_read on public.accounts for select to authenticated using (
  (select public.crm_is_head())
  or id = (select public.crm_account_id())
  -- coalesce обязателен: «= any ((select …))» Postgres понимает как сравнение со строками
  -- подзапроса (text = text[]), а не с элементами массива — как в остальных политиках схемы
  or (role = 'operator' and operator_id is not null and operator_id = any (coalesce((select public.crm_team_op_ids()), '{}'::text[])))
);
