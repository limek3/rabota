"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { SeaBoard } from "@/components/app/sea/SeaBoard";
import { FLEET, canPlace, fleetOk, randomFleet, shipCells, type Cell, type Ship } from "@/lib/sea";

/**
 * Расстановка флота: выбрал корабль в доке (или он выбран сам — следующий по размеру),
 * навёл — видно, встанет ли (зелёный / красный), клик — поставил. R или правый клик —
 * повернуть. Клик по стоящему кораблю — поднять и переставить. «Случайно» дорасставит
 * остальное, «В бой!» — когда стоят все 10.
 */

const NAMES: Record<number, string> = { 4: "Линкор", 3: "Крейсер", 2: "Эсминец", 1: "Катер" };

export function SeaSetup({ busy, onReady }: { busy: boolean; onReady: (fleet: Ship[]) => void }) {
  const [fleet, setFleet] = useState<Ship[]>([]);
  const [horizontal, setHorizontal] = useState(true);
  const [pick, setPick] = useState<number | null>(4);
  const [hover, setHover] = useState<Cell | null>(null);

  // сколько кораблей каждого размера ещё в доке
  const left = useMemo(() => {
    const need = FLEET.slice();
    for (const s of fleet) need.splice(need.indexOf(s.length), 1);
    return need;
  }, [fleet]);
  const count = (len: number) => left.filter((l) => l === len).length;

  // выбранный кончился — берём следующий по размеру
  useEffect(() => {
    if (pick != null && count(pick) > 0) return;
    setPick(left.length ? Math.max(...left) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const rotate = useCallback(() => setHorizontal((h) => !h), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R" || e.key === "к" || e.key === "К") && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) rotate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotate]);

  const ghostCells = pick != null && hover ? shipCells(hover[0], hover[1], pick, horizontal) : null;
  const ghost = ghostCells ? { cells: ghostCells, ok: canPlace(ghostCells, fleet) } : null;
  const done = fleet.length === FLEET.length && fleetOk(fleet);

  const place = (x: number, y: number) => {
    if (pick == null) return;
    const s = shipCells(x, y, pick, horizontal);
    if (canPlace(s, fleet)) setFleet((f) => [...f, s]);
  };

  return (
    <div className="sea-setup">
      <div
        className="sea-setup-board"
        onContextMenu={(e) => {
          e.preventDefault();
          rotate();
        }}
      >
        <SeaBoard
          ships={fleet}
          ghost={ghost}
          onCell={place}
          onHover={setHover}
          pickable={(i) => {
            const s = fleet[i];
            setFleet((f) => f.filter((_, j) => j !== i));
            setPick(s.length);
            setHorizontal(s.length === 1 || s[0][1] === s[1][1]);
          }}
          label="Моё поле: расстановка"
        />
      </div>

      <div className="sea-dock">
        <div className="sea-dock-h">
          <b>Флот</b>
          <small>{left.length ? `осталось поставить ${left.length}` : "все на позициях"}</small>
        </div>
        <div className="sea-dock-list">
          {[4, 3, 2, 1].map((len) => (
            <button key={len} type="button" className="sea-dock-ship" data-on={pick === len ? "" : undefined} disabled={!count(len)} onClick={() => setPick(len)}>
              <span className="sea-dock-hull" data-len={len}>
                {Array.from({ length: len }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span className="sea-dock-name">{NAMES[len]}</span>
              <span className="sea-dock-n num">×{count(len)}</span>
            </button>
          ))}
        </div>
        <div className="sea-dock-tools">
          <button type="button" className="btn btn-ghost" onClick={rotate} title="Повернуть корабль: R или правый клик">
            <Icon name="refresh" size={14} /> {horizontal ? "Горизонтально" : "Вертикально"} <kbd>R</kbd>
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setFleet((f) => randomFleet(f))} disabled={!left.length}>
            <Icon name="bolt" size={14} /> Случайно
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setFleet([])} disabled={!fleet.length}>
            <Icon name="trash" size={14} /> Убрать всё
          </button>
        </div>
        <p className="sea-dock-hint">Корабли не должны касаться друг друга — даже углами. Клик по стоящему кораблю — поднять и переставить.</p>
        <button type="button" className="btn btn-primary sea-go" disabled={!done || busy} onClick={() => onReady(fleet)}>
          <Icon name="check" size={15} /> {busy ? "Отправляем…" : "В бой!"}
        </button>
      </div>
    </div>
  );
}
