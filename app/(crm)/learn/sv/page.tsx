"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { Academy } from "@/components/learn/Academy";
import { StickyHead } from "@/components/app/StickyHead";

/**
 * Академия супервайзера — прежняя «Академия обзвона» с программами супервайзера:
 * найм и вывод новичка, управление группой, деньги и базы. Открывается из меню
 * обучения («Для супервайзера»); операторы учатся по курсу «Авто» на /learn.
 */
export default function SupervisorAcademyPage() {
  const { access } = useCrm();
  const router = useRouter();
  useEffect(() => {
    if (access.isOp) router.replace("/learn");
  }, [access.isOp, router]);
  if (access.isOp) return null;
  return (
    <>
      <StickyHead title="Академия супервайзера" offset={160} />
      <Academy />
    </>
  );
}
