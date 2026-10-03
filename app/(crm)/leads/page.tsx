"use client";

import { LeadsClassic } from "@/components/app/LeadsClassic";
import { LeadsV2 } from "@/components/app/LeadsV2";

/** Временный переключатель: false — вернуть прежнюю страницу «Лиды». */
const USE_V2 = true;

export default function LeadsPage() {
  return USE_V2 ? <LeadsV2 /> : <LeadsClassic />;
}
