"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CITIES, destination, project, shortRegion, unproject, type City, type Near, type OurCity } from "@/lib/geo/cities";
import { LAND_PATH, REGIONS } from "@/lib/geo/map";
import { Icon } from "@/components/ui/icons";

/**
 * Карта России без подложек и сети: море, суша, 85 регионов с границами (lib/geo/map.ts),
 * точки всех городов справочника. Регионы, где мы работаем, подкрашены цветом сегмента,
 * регион клиента — красным; от клиента — кольца расстояний и дуги до ближайших наших городов.
 * Колесо — масштаб под курсором, перетаскивание — сдвиг, клик — город (или точка на карте).
 *
 * Размер в пикселях при любом масштабе: штрихи — non-scaling-stroke, точки — нулевой отрезок
 * с круглым концом, подписи и метки — группа с scale(s), где s — единиц карты (≈ км) на пиксель.
 */

/** Цель на карте: город клиента или точка, куда кликнули. */
export type Target = { lat: number; lon: number; city: City | null };

interface View {
  cx: number;
  cy: number;
  /** Единиц карты (≈ км) на пиксель экрана. */
  s: number;
}

const PTS = CITIES.map((c) => project(c.lat, c.lon));

// вся страна — по городам: Калининград … Чукотка
const BOUNDS = (() => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of PTS) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
})();

/** Города одним путём на класс размера: нулевой отрезок с круглым концом — точка. */
const DOTS = (() => {
  const cls = ["", "", ""];
  CITIES.forEach((c, i) => {
    const [x, y] = PTS[i];
    const k = c.pop >= 500_000 ? 2 : c.pop >= 100_000 ? 1 : 0;
    cls[k] += `M${x.toFixed(1)} ${y.toFixed(1)}h0`;
  });
  return cls;
})();

/** Сетка: параллели через 10°, меридианы через 20° — видна только на море, под сушей. */
const GRID = (() => {
  let d = "";
  for (let lat = 30; lat <= 80; lat += 10) {
    let s = "";
    for (let lon = 0; lon <= 200; lon += 2.5) {
      const [x, y] = project(lat, lon);
      s += `${s ? "L" : "M"}${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    d += s;
  }
  for (let lon = 20; lon <= 200; lon += 20) {
    let s = "";
    for (let lat = 30; lat <= 84; lat += 2) {
      const [x, y] = project(lat, lon);
      s += `${s ? "L" : "M"}${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    d += s;
  }
  return d;
})();

/** Эллипс затухания суши: вокруг страны, с запасом. */
const FADE = (() => {
  const cx = (BOUNDS.x0 + BOUNDS.x1) / 2;
  const cy = (BOUNDS.y0 + BOUNDS.y1) / 2;
  return `translate(${cx.toFixed(0)} ${cy.toFixed(0)}) scale(${((BOUNDS.x1 - BOUNDS.x0) * 0.78).toFixed(0)} ${((BOUNDS.y1 - BOUNDS.y0) * 1.05).toFixed(0)})`;
})();

const SEG_COLOR: Record<OurCity["segment"], string> = { main: "var(--c-blue-fg)", regional: "var(--c-amber-fg)", project: "var(--c-teal-fg)" };
/** Кольца расстояний от клиента, км. */
const RINGS = [250, 500, 1000, 2000];
const SCALE_KM = [25, 50, 100, 200, 300, 500, 1000, 2000];

function fitView(pts: [number, number][], w: number, h: number, pad = 1.35, minS = 0.35): View {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const s = Math.max(((x1 - x0) * pad) / Math.max(w, 1), ((y1 - y0) * pad) / Math.max(h, 1), minS);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
}
const fullView = (w: number, h: number) => fitView([[BOUNDS.x0, BOUNDS.y0], [BOUNDS.x1, BOUNDS.y1]], w, h, 1.06, 0);

/**
 * Неподвижный слой: море-сетка, суша, регионы. Не зависит от масштаба — при сдвиге и зуме
 * React его не перерисовывает, меняется только viewBox.
 */
const Base = memo(function Base({ ourSeg, client, hover, onHover }: { ourSeg: Map<string, OurCity["segment"]>; client: string | null; hover: number | null; onHover: (i: number | null) => void }) {
  return (
    <g>
      <path d={GRID} className="cm-grid" vectorEffect="non-scaling-stroke" />
      {/* соседняя суша растворяется к краям: срез контуров по рамке не виден */}
      <defs>
        <radialGradient id="cm-fade" gradientUnits="userSpaceOnUse" cx={0} cy={0} r={1} gradientTransform={FADE}>
          <stop offset="0.55" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id="cm-land-mask" maskUnits="userSpaceOnUse" x={-20000} y={-20000} width={40000} height={40000}>
          <rect x={-20000} y={-20000} width={40000} height={40000} fill="url(#cm-fade)" />
        </mask>
      </defs>
      <path d={LAND_PATH} className="cm-land" vectorEffect="non-scaling-stroke" mask="url(#cm-land-mask)" />
      <g className="cm-regions" onPointerLeave={() => onHover(null)}>
        {REGIONS.map((r, i) => {
          const seg = ourSeg.get(r.n);
          const cls = `cm-rg${seg ? ` our ${seg}` : ""}${client === r.n ? " client" : ""}${hover === i ? " hover" : ""}`;
          return <path key={r.iso} d={r.d} data-region={r.n} className={cls} vectorEffect="non-scaling-stroke" onPointerEnter={() => onHover(i)} />;
        })}
      </g>
    </g>
  );
});

export function CityMap({
  ours,
  target,
  near,
  focus,
  onPick,
  height,
}: {
  ours: OurCity[];
  target: Target | null;
  near: Near[];
  /** Подсвеченный наш город (наведён в списке). */
  focus: number | null;
  onPick: (t: Target) => void;
  /** Нет — карта тянется на высоту строки (быстрое окно: вровень с панелью слева). */
  height?: number | string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [view, setView] = useState<View>(() => fullView(800, 480));
  const viewRef = useRef(view);
  viewRef.current = view;
  const anim = useRef(0);
  const sized = useRef(false);
  /** Карту двигали или выбрали город — при смене размера окна вид не сбрасываем. */
  const touched = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const maxS = () => fullView(size.w, size.h).s * 1.6;

  /** Плавный перелёт: центр — по прямой, масштаб — по логарифму (без «провала»). */
  const flyTo = (to: View, ms = 620) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setView({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e) });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setSize({ w, h });
      if (sized.current && !touched.current) {
        cancelAnimationFrame(anim.current);
        setView(fullView(w, h));
      }
      // первая раскладка — страна чуть издалека и «влёт» к ней
      if (!sized.current) {
        sized.current = true;
        const f = fullView(w, h);
        viewRef.current = { ...f, s: f.s * 1.25 };
        setView(viewRef.current);
        requestAnimationFrame(() => flyTo(f, 900));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // выбрали город — показываем его и три ближайших наших (с запасом справа под подписи)
  const nearKey = near.map((n) => n.our.city.id).join(",");
  useEffect(() => {
    if (!target) return;
    touched.current = true;
    const pts: [number, number][] = [project(target.lat, target.lon), ...near.slice(0, 3).map((n) => project(n.our.city.lat, n.our.city.lon))];
    const right = pts.reduce((m, [x]) => Math.max(m, x), -Infinity);
    flyTo(fitView([...pts, [right + 160, pts[0][1]]], size.w, size.h, 1.6, 0.6));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lon, nearKey]);

  // ── мышь: колесо, перетаскивание, клик ──
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);
  const toMap = (px: number, py: number, v = viewRef.current) => [v.cx + (px - size.w / 2) * v.s, v.cy + (py - size.h / 2) * v.s] as const;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // колесо — не прокручивать страницу, пока курсор над картой
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      touched.current = true;
      cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const v = viewRef.current;
      const k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016))));
      const s = Math.max(0.12, Math.min(maxS(), v.s * k));
      const mx = v.cx + (px - el.clientWidth / 2) * v.s;
      const my = v.cy + (py - el.clientHeight / 2) * v.s;
      setView({ cx: mx - (px - el.clientWidth / 2) * s, cy: my - (py - el.clientHeight / 2) * s, s });
    };
    // подсказка региона едет за курсором без перерисовки карты
    const onMove = (e: PointerEvent) => {
      const t = tip.current;
      if (!t) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      t.style.transform = `translate(${Math.min(x + 14, r.width - t.offsetWidth - 8)}px, ${y + 16 + t.offsetHeight > r.height ? y - t.offsetHeight - 10 : y + 16}px)`;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointermove", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(anim.current);
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      touched.current = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(d.id);
    }
    setView((v) => ({ ...v, cx: d.cx - dx * v.s, cy: d.cy - dy * v.s }));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || d.moved) return;
    // клик: рядом с точкой города — этот город, иначе — точка на карте
    const r = box.current!.getBoundingClientRect();
    const [mx, my] = toMap(e.clientX - r.left, e.clientY - r.top);
    let best = -1;
    let bd = 10 * view.s;
    PTS.forEach(([x, y], i) => {
      const dd = Math.hypot(x - mx, y - my);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    if (best >= 0) onPick({ lat: CITIES[best].lat, lon: CITIES[best].lon, city: CITIES[best] });
    else onPick({ ...unproject(mx, my), city: null });
  };

  const zoom = (k: number) => flyTo({ ...view, s: Math.max(0.12, Math.min(maxS(), view.s * k)) }, 280);

  // ── что подсвечено ──
  const ourSeg = useMemo(() => {
    const m = new Map<string, OurCity["segment"]>();
    for (const o of ours) if (!m.has(o.city.region) || o.segment === "main") m.set(o.city.region, o.segment);
    return m;
  }, [ours]);
  const ourByRegion = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of ours) m.set(o.city.region, [...(m.get(o.city.region) ?? []), o.city.name]);
    return m;
  }, [ours]);
  const clientRegion = target ? (target.city ?? nearestCity(target)).region : null;

  const s = view.s;
  const vb = `${view.cx - (size.w / 2) * s} ${view.cy - (size.h / 2) * s} ${size.w * s} ${size.h * s}`;
  const inView = (x: number, y: number, m = 1.05) => Math.abs(x - view.cx) < (size.w / 2) * s * m && Math.abs(y - view.cy) < (size.h / 2) * s * m;
  const at = (x: number, y: number) => `translate(${x} ${y}) scale(${s})`;
  const ourIds = useMemo(() => new Set(ours.map((o) => o.city.id)), [ours]);
  const nearIds = useMemo(() => new Set(near.slice(0, 3).map((n) => n.our.city.id)), [near]);

  // подписи регионов — когда регион на экране крупнее ~110×110 px
  const regionLabels = REGIONS.map((r, i) => ({ r, i })).filter(({ r }) => r.a / (s * s) > 12_000 && inView(r.x, r.y));
  // крупные «чужие» города подписываем при приближении: чем ближе, тем мельче порог
  const minPop = s > 4 ? Infinity : s > 2.2 ? 1_000_000 : s > 1.2 ? 400_000 : s > 0.6 ? 120_000 : 40_000;
  const others: number[] = [];
  if (minPop !== Infinity)
    for (let i = 0; i < CITIES.length && others.length < 70; i++) {
      const c = CITIES[i];
      if (c.pop < minPop) break;
      if (ourIds.has(c.id) || c.id === target?.city?.id) continue;
      if (inView(PTS[i][0], PTS[i][1])) others.push(i);
    }

  const tp = target ? project(target.lat, target.lon) : null;
  // кольца: до самого дальнего из трёх ближайших (и ещё одно за ним)
  const reach = near[Math.min(2, near.length - 1)]?.km ?? 500;
  const rings = useMemo(() => {
    if (!target) return [];
    const list = RINGS.filter((km, i) => km <= reach || RINGS[i - 1] < reach || i === 0);
    return list.map((km) => {
      let d = "";
      for (let deg = 0; deg <= 360; deg += 4) {
        const p = destination(target, km, deg);
        const [x, y] = project(p.lat, p.lon);
        d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      // подпись — на юго-востоке кольца: наши города чаще к западу, там она никому не мешает
      const top = destination(target, km, 150);
      return { km, d: d + "Z", top: project(top.lat, top.lon) };
    });
  }, [target, reach]);

  // шкала: «круглое» расстояние длиной 70–160 px
  const scaleKm = SCALE_KM.find((km) => km / s >= 70) ?? SCALE_KM[SCALE_KM.length - 1];
  const hov = hover != null ? REGIONS[hover] : null;

  return (
    <div
      className={`cm${dragging ? " dragging" : ""}`}
      ref={box}
      style={{ height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <svg viewBox={vb} width={size.w} height={size.h} className="cm-svg" aria-label="Карта городов России">
        <Base ourSeg={ourSeg} client={clientRegion} hover={dragging ? null : hover} onHover={setHover} />

        {regionLabels.map(({ r, i }) => (
          <g key={r.iso} transform={at(r.x, r.y)} className={`cm-rlabel${hover === i ? " on" : ""}`}>
            <text textAnchor="middle">{shortRegion(r.n)}</text>
          </g>
        ))}

        <path d={DOTS[0]} className="cm-dot cm-dot0" vectorEffect="non-scaling-stroke" />
        <path d={DOTS[1]} className="cm-dot cm-dot1" vectorEffect="non-scaling-stroke" />
        <path d={DOTS[2]} className="cm-dot cm-dot2" vectorEffect="non-scaling-stroke" />

        {others.map((i) => (
          <g key={i} transform={at(PTS[i][0], PTS[i][1])} className="cm-other">
            <text x={5} y={3.5}>{CITIES[i].name}</text>
          </g>
        ))}

        {/* кольца расстояний от клиента */}
        {tp &&
          rings.map((g) => (
            <g key={g.km} className="cm-ring">
              <path d={g.d} vectorEffect="non-scaling-stroke" />
              {inView(g.top[0], g.top[1], 1) && (
                <g transform={at(g.top[0], g.top[1])}>
                  <text x={4} y={10}>
                    {g.km.toLocaleString("ru-RU")} км
                  </text>
                </g>
              )}
            </g>
          ))}

        {/* дуги до трёх ближайших наших — с расстоянием на вершине дуги */}
        {tp &&
          near.slice(0, 3).map((n, i) => {
            const [x, y] = project(n.our.city.lat, n.our.city.lon);
            const dx = x - tp[0];
            const dy = y - tp[1];
            const k = (i % 2 ? -1 : 1) * 0.16;
            const qx = (tp[0] + x) / 2 - dy * k;
            const qy = (tp[1] + y) / 2 + dx * k;
            // середина кривой Безье: ¼ начала + ½ опоры + ¼ конца
            const mx = 0.25 * tp[0] + 0.5 * qx + 0.25 * x;
            const my = 0.25 * tp[1] + 0.5 * qy + 0.25 * y;
            const label = `${Math.round(n.km).toLocaleString("ru-RU")} км`;
            const w = 14 + label.length * 6.4;
            return (
              <g key={n.our.city.id} className={`cm-link${i === 0 ? " first" : ""}${focus === n.our.city.id ? " focus" : ""}`}>
                <path d={`M${tp[0]} ${tp[1]}Q${qx} ${qy} ${x} ${y}`} className="cm-arc-bg" vectorEffect="non-scaling-stroke" />
                <path d={`M${tp[0]} ${tp[1]}Q${qx} ${qy} ${x} ${y}`} className="cm-arc" vectorEffect="non-scaling-stroke" />
                {n.km >= 1 && (
                  <g transform={at(mx, my)}>
                    <rect x={-w / 2} y={-10} width={w} height={20} rx={10} />
                    <text y={4} textAnchor="middle">
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

        {ours.map((o) => {
          const [x, y] = project(o.city.lat, o.city.lon);
          const hot = nearIds.has(o.city.id);
          const first = !!target && near[0]?.our.city.id === o.city.id;
          const fo = focus === o.city.id;
          return (
            <g key={o.city.id} transform={at(x, y)} className={`cm-our${hot ? " hot" : ""}${first ? " first" : ""}${fo ? " focus" : ""}`} style={{ color: first ? "var(--c-green-fg)" : SEG_COLOR[o.segment] }}>
              {(first || fo) && <circle r={8} className="cm-halo" />}
              <circle r={first ? 7 : hot ? 6 : 5} className="cm-our-ring" />
              <circle r={first ? 3 : 2.4} className="cm-our-core" />
              <text x={first ? 11 : 9} y={4}>
                {o.city.name}
              </text>
            </g>
          );
        })}

        {tp && (
          <g transform={at(tp[0], tp[1])} className="cm-target">
            <ellipse rx={7} ry={2.6} className="cm-pin-shadow" />
            <circle r={6} className="cm-pulse" />
            <path d="M0 0C-1.6-5-9-9.5-9-16.5a9 9 0 0 1 18 0C9-9.5 1.6-5 0 0Z" className="cm-pin" />
            <circle cy={-16.5} r={3.4} className="cm-pin-core" />
            <text x={13} y={-12}>
              {target?.city ? target.city.name : "Точка"}
            </text>
          </g>
        )}
      </svg>

      {/* подсказка региона под курсором */}
      <div ref={tip} className={`cm-tip${hov && !dragging ? " on" : ""}`}>
        {hov && (
          <>
            <b>{hov.n}</b>
            {ourByRegion.get(hov.n) ? (
              <span className="cm-tip-our">
                <i style={{ background: SEG_COLOR[ourSeg.get(hov.n) ?? "main"] }} />
                работаем: {ourByRegion.get(hov.n)!.join(", ")}
              </span>
            ) : (
              <span className="cm-tip-sub">наших городов нет</span>
            )}
            {clientRegion === hov.n && <span className="cm-tip-client">регион клиента</span>}
          </>
        )}
      </div>

      <div className="cm-ctl" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoom(0.6)} aria-label="Приблизить" title="Приблизить">
          <Icon name="plus" size={14} />
        </button>
        <button type="button" onClick={() => zoom(1 / 0.6)} aria-label="Отдалить" title="Отдалить">
          <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 600 }}>−</span>
        </button>
        <button type="button" onClick={() => flyTo(fullView(size.w, size.h))} aria-label="Вся Россия" title="Вся Россия">
          <Icon name="map" size={14} />
        </button>
      </div>

      <div className="cm-scale" aria-hidden>
        <span style={{ width: scaleKm / s }} />
        {scaleKm.toLocaleString("ru-RU")} км
      </div>

      <div className="cm-legend" onPointerDown={(e) => e.stopPropagation()}>
        <span><i style={{ background: SEG_COLOR.main }} /> основа</span>
        <span><i style={{ background: SEG_COLOR.regional }} /> регионы</span>
        <span><i style={{ background: SEG_COLOR.project }} /> города проектов</span>
        {target && <span><i className="cm-lg-client" /> регион клиента</span>}
        <span className="cm-hint">колесо — масштаб · тяни — сдвиг · клик — выбрать</span>
      </div>
    </div>
  );
}

/** Ближайший город справочника к точке (для региона точки на карте). */
function nearestCity(p: { lat: number; lon: number }): City {
  const [x, y] = project(p.lat, p.lon);
  let best = 0;
  let bd = Infinity;
  PTS.forEach(([cx, cy], i) => {
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return CITIES[best];
}
