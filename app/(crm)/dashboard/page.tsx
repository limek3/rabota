"use client";

import { DashboardClassic } from "@/components/app/DashboardClassic";
import { DashboardV2 } from "@/components/app/DashboardV2";

/** Временный переключатель: false — вернуть прежнюю «Сводку». */
const USE_V2 = true;

export default function DashboardPage() {
  return USE_V2 ? <DashboardV2 /> : <DashboardClassic />;
}
