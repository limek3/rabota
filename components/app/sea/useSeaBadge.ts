"use client";

import { useEffect, useState } from "react";
import { needsMe, seaStore, type SeaGame } from "@/lib/sea";

/**
 * Сколько партий «Морского боя» ждут меня: мой ход, вызов мне, пора расставить флот.
 * Для значка в меню — на любой странице CRM. Нет таблиц (миграция ещё не запущена) — 0.
 */
export function useSeaBadge(me: string, enabled: boolean): number {
  const [games, setGames] = useState<SeaGame[]>([]);
  useEffect(() => {
    if (!enabled || !me) return;
    let off = false;
    seaStore.games(me).then(
      (r) => !off && setGames(r),
      () => !off && setGames([]),
    );
    const unsub = seaStore.subscribe(me, ({ g }) => {
      if (g.aId !== me && g.bId !== me) return;
      setGames((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [g, ...prev]));
    });
    return () => {
      off = true;
      unsub();
    };
  }, [me, enabled]);
  return games.filter((g) => needsMe(g, me)).length;
}
