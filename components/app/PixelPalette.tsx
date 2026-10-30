"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { ColorPop } from "@/components/app/ColorPop";
import { GOLD, PALETTE, TIERS } from "@/lib/pixels";

/**
 * Палитра «Холста» — компактно: вкладки «Основные · Пастель · Неон · Золото».
 * В основных — ряд кружков-цветов и под ним 8 оттенков выбранного; особые наборы
 * открывает грейд (у РОПа и СВ — всё). Сверху — текущий цвет, «Свой» и недавние.
 */

type Tab = "base" | 2 | 3 | 4;
const ROMAN = ["I", "II", "III", "IV"];

export function PixelPalette({
  color,
  onPick,
  recent,
  grade,
}: {
  color: string;
  onPick: (c: string) => void;
  recent: string[];
  /** Лучший грейд за месяц; у РОПа и СВ — 4, всё открыто. */
  grade: number;
}) {
  const famOf = (c: string) => PALETTE.findIndex((f) => f.shades.includes(c));
  const tierOf = (c: string) => TIERS.find((t) => t.colors.includes(c))?.grade;
  const [tab, setTab] = useState<Tab>(() => tierOf(color) ?? "base");
  const [fam, setFam] = useState(() => Math.max(0, famOf(color)) || 8);
  const [custom, setCustom] = useState(false);

  // цвет взяли пипеткой или из недавних — показываем, откуда он
  useEffect(() => {
    const t = tierOf(color);
    if (t) return setTab(t);
    const f = famOf(color);
    if (f >= 0) {
      setFam(f);
      setTab("base");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  const closeCustom = useCallback(() => setCustom(false), []);
  const tier = tab === "base" ? null : TIERS.find((t) => t.grade === tab)!;
  const locked = !!tier && tier.grade > grade;

  return (
    <section className="card px-pal">
      <div className="px-pal-h">
        <i className="px-cur" data-gold={color === GOLD ? "" : undefined} style={{ background: color }} />
        <span className="num">{color}</span>
        <button type="button" className="btn btn-ghost btn-sm px-custom" data-on={custom ? "" : undefined} onClick={() => setCustom((v) => !v)} title="Любой цвет">
          <Icon name="plus" size={12} /> Свой
        </button>
        {custom && <ColorPop value={color} onChange={onPick} onClose={closeCustom} />}
      </div>

      {recent.length > 0 && (
        <div className="px-recent" title="Недавние">
          {recent.map((c) => (
            <button key={c} type="button" className="px-dot-sw" data-on={c === color ? "" : undefined} data-gold={c === GOLD ? "" : undefined} style={{ background: c }} onClick={() => onPick(c)} aria-label={c} />
          ))}
        </div>
      )}

      <div className="px-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "base"} data-on={tab === "base" ? "" : undefined} onClick={() => setTab("base")}>
          Основные
        </button>
        {TIERS.map((t) => (
          <button
            key={t.grade}
            type="button"
            role="tab"
            aria-selected={tab === t.grade}
            data-on={tab === t.grade ? "" : undefined}
            data-tier={t.grade}
            onClick={() => setTab(t.grade)}
            title={t.grade > grade ? `Откроется на Грейде ${ROMAN[t.grade - 1]}` : t.name}
          >
            {t.grade > grade && <Icon name="lock" size={10} />}
            {t.name}
          </button>
        ))}
      </div>

      {tab === "base" ? (
        <>
          <div className="px-fam-row">
            {PALETTE.map((f, i) => (
              <button
                key={f.name}
                type="button"
                className="px-fam"
                data-on={i === fam ? "" : undefined}
                style={{ background: f.name === "Серый" ? "linear-gradient(135deg, #fff 0 50%, #2b2f36 50% 100%)" : f.shades[4] }}
                onClick={() => setFam(i)}
                title={f.name}
                aria-label={f.name}
              />
            ))}
          </div>
          <div className="px-shades">
            {PALETTE[fam].shades.map((c) => (
              <button key={c} type="button" className="px-sw" data-on={c === color ? "" : undefined} style={{ background: c }} onClick={() => onPick(c)} aria-label={`${PALETTE[fam].name} ${c}`} />
            ))}
          </div>
        </>
      ) : (
        <div className="px-tier" data-tier={tier!.grade} data-locked={locked ? "" : undefined}>
          <div className="px-shades">
            {tier!.colors.map((c) => (
              <button
                key={c}
                type="button"
                className="px-sw"
                data-on={c === color ? "" : undefined}
                data-gold={c === GOLD ? "" : undefined}
                style={{ background: c, color: c }}
                disabled={locked}
                onClick={() => onPick(c)}
                aria-label={`${tier!.name} ${c}`}
              />
            ))}
          </div>
          {locked && (
            <div className="px-tier-note">
              <Icon name="lock" size={11} /> Откроется на Грейде {ROMAN[tier!.grade - 1]} — {[6, 8, 11][tier!.grade - 2]} одобренных лидов за день
            </div>
          )}
        </div>
      )}
    </section>
  );
}
