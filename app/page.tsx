"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HOME_ROUTE } from "@/lib/appMode";

/** Корень приложения — сразу в CRM (лендинга нет). */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    // ?lead=1 — ярлык «Лид передан» с главного экрана телефона: форму откроет Shell
    router.replace(HOME_ROUTE + window.location.search);
  }, [router]);
  return null;
}
