"use client";

import { useMemo } from "react";
import { useCrm } from "@/lib/crm/store";
import { fmtInt } from "@/lib/crm/format";
import { sparksEarned, sparksSpent, useShopRows } from "@/lib/shop";

/**
 * Пункт меню «Лавка» — как «Холст», заметный: золотая сумка с мерцающей искрой,
 * надпись с бегущим бликом и справа ваш баланс искр. Цвета и анимация — app/shop.css (.shn-*);
 * при «уменьшить движение» всё стоит на месте.
 */

export function ShopIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="shn-ic" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <defs>
          <linearGradient id="shn-gold" x1="4" y1="4" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff3c4" />
            <stop offset="0.45" stopColor="#f5c542" />
            <stop offset="1" stopColor="#d4870f" />
          </linearGradient>
        </defs>
        <path d="M5 8h14l-1.2 11.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8z" fill="url(#shn-gold)" fillOpacity="0.22" stroke="url(#shn-gold)" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" stroke="url(#shn-gold)" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
      <i className="shn-spark">✦</i>
    </span>
  );
}

/** Сколько искр осталось у вошедшего — те же правила, что в Лавке. */
export function useSparksLeft(): number {
  const { full, access } = useCrm();
  const rows = useShopRows();
  const earned = useMemo(
    () => sparksEarned(full.leads, { role: access.account.role, opId: access.opId, groups: access.ownGroups }).total,
    [full.leads, access.account.role, access.opId, access.ownGroups],
  );
  return earned - sparksSpent(rows, access.account.id);
}

export function ShopWord({ label = "Лавка" }: { label?: string }) {
  const left = useSparksLeft();
  return (
    <>
      <span className="shn-word">{label}</span>
      {left > 0 && (
        <span className="shn-bal" title="Ваши искры">
          ✦ {fmtInt(left)}
        </span>
      )}
    </>
  );
}
