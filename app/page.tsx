"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HOME_ROUTE } from "@/lib/appMode";

/** Корень приложения — сразу в CRM (лендинга нет). */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(HOME_ROUTE);
  }, [router]);
  return null;
}
