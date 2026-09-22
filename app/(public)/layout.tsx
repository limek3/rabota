import { AuthPagesGate } from "@/components/app/AuthGate";

/**
 * Вход, регистрация, сброс пароля. Пока авторизация спрятана
 * (AUTH_ENABLED = false в lib/appMode.ts), эти страницы уводят в CRM.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <AuthPagesGate>{children}</AuthPagesGate>;
}
