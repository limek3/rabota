"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { StickyHead } from "@/components/app/StickyHead";
import { AcadEditor } from "@/components/learn/AcadEditor";

/**
 * «Редактор обучения» — только РОП: правка курса «Авто», оплаты и справочников для всех
 * (components/learn/AcadEditor.tsx). Остальных возвращаем в обучение.
 */
export default function LearnEditPage() {
  const { me, access } = useCrm();
  const router = useRouter();
  const allowed = access.isHead;
  useEffect(() => {
    if (me.id !== "__boot__" && !allowed) router.replace("/learn");
  }, [allowed, me.id, router]);
  if (!allowed) return null;
  return (
    <>
      <StickyHead title="Редактор обучения" offset={120} />
      <AcadEditor />
    </>
  );
}
