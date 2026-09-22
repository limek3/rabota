/**
 * Режим приложения.
 *
 * AUTH_ENABLED — включается сам, когда в .env.local прописан проект Supabase:
 *   - вход по почте и паролю (app/(public)/login|signup|reset), данные — в Supabase
 *     (lib/crm/remote.ts), права режет база (supabase/migrations/…_crm_schema.sql);
 *   - без .env.local — как раньше: данные в браузере (IndexedDB), вход выключен,
 *     аккаунты переключаются из меню (режим для тестов).
 */
export const AUTH_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

/** Куда приземляется вход и запуск приложения. */
export const HOME_ROUTE = "/dashboard";

export const APP_NAME = "LEADUP";
export const APP_SUB = "Лидогенерация · CRM";
