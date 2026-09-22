"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Регистрации нет: вход сотруднику создаёт руководитель в «Настройки → Аккаунты»
 * (серверная функция supabase/functions/crm-users). Старые ссылки ведут на вход.
 */
export default function SignupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
