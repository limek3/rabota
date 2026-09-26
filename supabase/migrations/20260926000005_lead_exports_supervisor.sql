-- ════════════════════════════════════════════════════════════════════════
--  LEADUP CRM — выгрузка номеров для супервайзеров
--
--  Supabase → SQL Editor → вставить файл целиком → Run. Повторный запуск безопасен,
--  данные не трогаются.
--
--  Отметки «номер выгружен» и история выгрузок лежат в настройках (public.kv) двумя
--  строками: leadExports и leadExportLog. Настройки меняет только РОП; это правило
--  разрешает супервайзеру писать ровно эти две строки — остальные настройки ему
--  по-прежнему недоступны. Пока файл не выполнен, выгрузка у супервайзера скачает
--  Excel, но отметка не сохранится (CRM покажет «нет прав»).
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists kv_lead_exports_insert on public.kv;
drop policy if exists kv_lead_exports_update on public.kv;

create policy kv_lead_exports_insert on public.kv for insert to authenticated
  with check (key in ('leadExports', 'leadExportLog') and (select public.crm_role()) = 'supervisor');

create policy kv_lead_exports_update on public.kv for update to authenticated
  using (key in ('leadExports', 'leadExportLog') and (select public.crm_role()) = 'supervisor')
  with check (key in ('leadExports', 'leadExportLog') and (select public.crm_role()) = 'supervisor');
