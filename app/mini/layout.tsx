import { AuthGate } from "@/components/app/AuthGate";
import { CrmProvider } from "@/lib/crm/store";

/**
 * Маленькие окна поверх всех (мини-окно «Марок авто»): тот же вход и те же данные CRM,
 * но без меню, шапки и всплывашек главного окна.
 */
export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <CrmProvider>{children}</CrmProvider>
    </AuthGate>
  );
}
