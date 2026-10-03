"use client";

import { OperatorsClassic } from "@/components/app/OperatorsClassic";
import { OperatorsV2 } from "@/components/app/OperatorsV2";

/** Временный переключатель: false — вернуть прежнюю страницу «Операторы». */
const USE_V2 = true;

export default function OperatorsPage() {
  return USE_V2 ? <OperatorsV2 /> : <OperatorsClassic />;
}
