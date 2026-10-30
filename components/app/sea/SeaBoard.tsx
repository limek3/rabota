"use client";

import type { CSSProperties } from "react";
import { COLS, N, cellName, type Cell, type Ship, type Shot } from "@/lib/sea";

/**
 * Поле 10×10: вода, координаты А–К и 1–10, корпуса кораблей, попадания (огонь), промахи
 * (всплеск), потопленные корабли (обломки) и клетки вокруг них. Стили — app/sea.css (.sea-*).
 */

export interface Ghost {
  cells: Ship;
  ok: boolean;
}

const k = (x: number, y: number) => y * N + x;

function hullStyle(s: Ship): CSSProperties {
  const xs = s.map((c) => c[0]);
  const ys = s.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x + 1;
  const h = Math.max(...ys) - y + 1;
  return {
    left: `calc(var(--sea-c) * ${x})`,
    top: `calc(var(--sea-c) * ${y})`,
    width: `calc(var(--sea-c) * ${w})`,
    height: `calc(var(--sea-c) * ${h})`,
  };
}

const vertical = (s: Ship) => s.length > 1 && s[0][0] === s[1][0];

export function SeaBoard({
  ships = [],
  wrecks = [],
  ghosts = [],
  shots = [],
  halo,
  ghost,
  pending,
  last,
  aim,
  dim,
  size = "lg",
  label,
  onCell,
  onHover,
  pickable,
}: {
  /** Свои корабли (или открытые после партии). */
  ships?: Ship[];
  /** Потопленные корабли соперника — обломки. */
  wrecks?: Ship[];
  /** Корабли соперника, открытые после партии и не потопленные. */
  ghosts?: Ship[];
  shots?: Shot[];
  halo?: Set<number>;
  /** Предпросмотр корабля при расстановке. */
  ghost?: Ghost | null;
  /** Выстрел улетел, ждём ответа. */
  pending?: Cell | null;
  /** Последний выстрел — подсветить. */
  last?: Cell | null;
  /** Режим прицела: мой ход, по клеткам можно стрелять. */
  aim?: boolean;
  dim?: boolean;
  size?: "lg" | "sm";
  label?: string;
  onCell?: (x: number, y: number) => void;
  onHover?: (c: Cell | null) => void;
  /** Клик по кораблю (расстановка: поднять и переставить). */
  pickable?: (i: number) => void;
}) {
  const shotAt = new Map(shots.map((s) => [k(s[0], s[1]), s]));
  return (
    <div className="sea-board" data-size={size} data-aim={aim ? "" : undefined} data-dim={dim ? "" : undefined} aria-label={label}>
      <div className="sea-cols" aria-hidden>
        {COLS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="sea-rows" aria-hidden>
        {Array.from({ length: N }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="sea-water" onMouseLeave={() => onHover?.(null)}>
        <div className="sea-waves" aria-hidden />
        {/* клетки — кнопки: прицел, клик, подсказка с координатой */}
        <div className="sea-grid">
          {Array.from({ length: N * N }, (_, i) => {
            const x = i % N;
            const y = Math.floor(i / N);
            const shot = shotAt.get(i);
            const known = !!shot || !!halo?.has(i);
            return (
              <button
                key={i}
                type="button"
                className="sea-cell"
                data-known={known ? "" : undefined}
                tabIndex={aim && !known ? 0 : -1}
                disabled={!onCell || (aim && known)}
                title={cellName(x, y)}
                onMouseEnter={() => onHover?.([x, y])}
                onFocus={() => onHover?.([x, y])}
                onClick={() => onCell?.(x, y)}
              />
            );
          })}
        </div>

        {ships.map((s, i) => (
          <div
            key={`s${i}`}
            className="sea-ship"
            data-v={vertical(s) ? "" : undefined}
            data-len={s.length}
            data-pick={pickable ? "" : undefined}
            style={hullStyle(s)}
            onClick={pickable ? () => pickable(i) : undefined}
          >
            <i />
          </div>
        ))}
        {ghosts.map((s, i) => (
          <div key={`g${i}`} className="sea-ship sea-ship-ghost" data-v={vertical(s) ? "" : undefined} data-len={s.length} style={hullStyle(s)}>
            <i />
          </div>
        ))}
        {wrecks.map((s, i) => (
          <div key={`w${i}`} className="sea-ship sea-wreck" data-v={vertical(s) ? "" : undefined} data-len={s.length} style={hullStyle(s)}>
            <i />
          </div>
        ))}
        {ghost && <div className="sea-ghost" data-ok={ghost.ok ? "" : undefined} data-v={vertical(ghost.cells) ? "" : undefined} style={hullStyle(ghost.cells)} />}

        {halo &&
          Array.from(halo).map((i) =>
            shotAt.has(i) ? null : <i key={`h${i}`} className="sea-mark sea-halo" style={{ left: `calc(var(--sea-c) * ${i % N})`, top: `calc(var(--sea-c) * ${Math.floor(i / N)})` }} />,
          )}
        {shots.map((s) => (
          <i
            key={`m${s[0]}-${s[1]}`}
            className={`sea-mark ${s[2] === 0 ? "sea-miss" : s[2] === 1 ? "sea-hit" : "sea-hit sea-sunk"}`}
            style={{ left: `calc(var(--sea-c) * ${s[0]})`, top: `calc(var(--sea-c) * ${s[1]})` }}
          >
            {s[2] > 0 && (
              <>
                <b />
                <b />
              </>
            )}
          </i>
        ))}
        {last && <i key={`l${last[0]}-${last[1]}`} className="sea-mark sea-last" style={{ left: `calc(var(--sea-c) * ${last[0]})`, top: `calc(var(--sea-c) * ${last[1]})` }} />}
        {pending && <i className="sea-mark sea-pending" style={{ left: `calc(var(--sea-c) * ${pending[0]})`, top: `calc(var(--sea-c) * ${pending[1]})` }} />}
      </div>
    </div>
  );
}
