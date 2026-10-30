"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCrm, type LearnPatch } from "@/lib/crm/store";
import { ACAD_COURSE } from "@/lib/academy/course";
import { academyData } from "@/lib/academy/content";
import { mountAcademy } from "@/lib/academy/engine";
import { StickyHead } from "@/components/app/StickyHead";
import { CarFinder } from "@/components/app/CarFinder";
import { CityFinder } from "@/components/app/CityFinder";

/**
 * «Обучение» — курс «Авто», тренажёр Скорозвона, справочники и тренажёры.
 *
 * Страницу рисует lib/academy/engine.js (та же обучалка, что и отдельный HTML),
 * меню обучения — components/app/LearnRail.tsx. Прогресс пишется в записи learn
 * аккаунта (courseId "op-auto"), поэтому его видят руководитель и карточка оператора.
 * Содержимое — правка РОПа из «Редактора обучения» (data.academy) или исходное: новая
 * правка пересобирает страницу у всех, у кого она открыта.
 *
 * «Марки авто» и «Карта городов» открываются прямо в обучении: движок оставляет место
 * (onSlot), а сюда в него рисуются те же поиск машины и карта, что в разделах CRM.
 */
type Slot = { el: HTMLElement; kind: string } | null;

export default function LearnPage() {
  const { data, me, access, saveLearn, resetLearn, toast } = useCrm();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<Slot>(null);
  // движок монтируется один раз на аккаунт и правку; свежие данные и функции берёт через ref
  const live = useRef({ data, saveLearn, resetLearn, toast, router });
  live.current = { data, saveLearn, resetLearn, toast, router };
  const academy = data.academy;
  // руководитель открывает любой материал сразу, без прохождения предыдущих
  const unlockAll = !access.isOp;

  useEffect(() => {
    const root = ref.current;
    if (!root || me.id === "__boot__") return;
    const app = mountAcademy(root, {
      accountId: me.id,
      // стажёру по окончании — «руководитель переведёт вас в операторы»
      trainee: access.isTrainee,
      content: academyData(academy),
      canEdit: access.isHead,
      unlockAll,
      navigate: (href: string) => live.current.router.push(href),
      onSlot: (s: Slot) => setSlot(s),
      records: () => live.current.data.learn.filter((l) => l.accountId === me.id && l.courseId === ACAD_COURSE),
      save: (itemId: string, patch: LearnPatch) => void live.current.saveLearn(ACAD_COURSE, itemId, patch),
      reset: () => void live.current.resetLearn(ACAD_COURSE),
      toast: (text: string) => live.current.toast(text, "ok"),
    });
    return () => app.destroy();
  }, [me.id, access.isTrainee, access.isHead, unlockAll, academy]);

  return (
    <>
      <StickyHead title="Обучение" offset={160} />
      <div className="acad" ref={ref} />
      {slot && createPortal(<div className="acad-tool">{slot.kind === "cars" ? <CarFinder /> : <CityFinder />}</div>, slot.el, slot.kind)}
    </>
  );
}
