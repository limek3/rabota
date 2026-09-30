"use client";

import { useEffect, useRef } from "react";
import { useCrm, type LearnPatch } from "@/lib/crm/store";
import { ACAD_COURSE } from "@/lib/academy/course";
import { mountAcademy } from "@/lib/academy/engine";

/**
 * «Обучение» — курс «Авто», тренажёр Скорозвона, справочники и тренажёры.
 *
 * Страницу рисует lib/academy/engine.js (та же обучалка, что и отдельный HTML),
 * меню обучения — components/app/LearnRail.tsx. Прогресс пишется в записи learn
 * аккаунта (courseId "op-auto"), поэтому его видят руководитель и карточка оператора.
 */
export default function LearnPage() {
  const { data, me, saveLearn, resetLearn, toast } = useCrm();
  const ref = useRef<HTMLDivElement>(null);
  // движок монтируется один раз на аккаунт; свежие данные и функции берёт через ref
  const live = useRef({ data, saveLearn, resetLearn, toast });
  live.current = { data, saveLearn, resetLearn, toast };

  useEffect(() => {
    const root = ref.current;
    if (!root || me.id === "__boot__") return;
    const app = mountAcademy(root, {
      accountId: me.id,
      records: () => live.current.data.learn.filter((l) => l.accountId === me.id && l.courseId === ACAD_COURSE),
      save: (itemId: string, patch: LearnPatch) => void live.current.saveLearn(ACAD_COURSE, itemId, patch),
      reset: () => void live.current.resetLearn(ACAD_COURSE),
      toast: (text: string) => live.current.toast(text, "ok"),
    });
    return () => app.destroy();
  }, [me.id]);

  return <div className="acad" ref={ref} />;
}
