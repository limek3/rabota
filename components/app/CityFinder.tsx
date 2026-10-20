"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { closestCity, driveHours, fmtPop, localTime, mskOffset, nearest, ourCities, roadKm, searchCities, type Hit } from "@/lib/geo/cities";
import { Icon } from "@/components/ui/icons";
import { Select, dot, type Opt } from "@/components/ui/select";
import { CityMap, type Target } from "./CityMap";

/**
 * «Карта городов»: оператор набирает город клиента — сразу подсказки, выбор — и на карте
 * линии до ближайших городов, где мы работаем, а справа список: сколько км, примерно часов
 * на машине, разница во времени. Наши города — «Основа» и «Регионы» из настроек плюс
 * свои города проектов (100 up). Страница /cities и быстрое окно (клавиша G, кнопка в лиде).
 *
 * choose — открыли из окна лида: «Выбрать для лида» подставит город в поле, если он есть
 * в списке проекта (allowed).
 */
export function CityFinder({
  compact = false,
  projectId: initialProject = "",
  choose,
  allowed,
  autoFocus = true,
}: {
  compact?: boolean;
  projectId?: string;
  choose?: (label: string) => void;
  allowed?: string[];
  autoFocus?: boolean;
}) {
  const { data, toast } = useCrm();
  const [projectId, setProjectId] = useState(initialProject);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const ours = useMemo(() => ourCities(data, projectId), [data, projectId]);
  const hits = useMemo(() => searchCities(q, 8), [q]);
  const near = useMemo(() => (target ? nearest(target, ours.list, 6) : []), [target, ours.list]);

  const projects = data.projects.filter((p) => !p.deletedAt && p.active);
  const projectOpts: Opt[] = [
    { value: "", label: "Все проекты", icon: <Icon name="folder" size={14} /> },
    ...projects.map<Opt>((p) => ({ value: p.id, label: p.name, icon: dot(p.color), hint: p.regions?.length ? `${p.regions.length} гор.` : "города настроек" })),
  ];

  const pick = (t: Target) => {
    setTarget(t);
    setFocus(null);
    setOpen(false);
    if (t.city) setQ(t.city.name);
    else {
      const c = closestCity(t);
      setQ(`Точка возле г. ${c.city.name}`);
    }
  };
  const pickHit = (h: Hit) => pick({ lat: h.city.lat, lon: h.city.lon, city: h.city });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) pickHit(hits[active]);
    } else if (e.key === "Escape" && open && q) {
      // первый Esc — закрыть подсказки, второй — окно (если это быстрое окно)
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    }
  };

  const clear = () => {
    setQ("");
    setTarget(null);
    setFocus(null);
    inp.current?.focus();
  };

  const city = target?.city ?? null;
  const here = target ? closestCity(target) : null;
  const tz = city?.utc ?? here?.city.utc ?? 3;
  const ourHere = !!city && ours.list.some((o) => o.city.id === city.id);
  const best = near[0];

  const copy = async () => {
    if (!best || !target) return;
    const from = city ? city.name : `точка возле г. ${here?.city.name}`;
    const txt = ourHere ? `${from} — работаем в этом городе` : `${from}: ближайший наш город — ${best.our.city.name}, ~${fmtKm(best.km)} по прямой (≈${fmtKm(roadKm(best.km))} по дороге)`;
    try {
      await navigator.clipboard.writeText(txt);
      toast("Скопировано — можно вставить в комментарий");
    } catch {
      toast("Не удалось скопировать", "err");
    }
  };

  const canChoose = (label: string) => !!choose && (!allowed || allowed.includes(label));

  const panel = (
    <div className="cf-panel">
      <div className="cf-search">
        <Icon name="search" size={15} className="cf-search-ic" />
        <input
          ref={inp}
          className="inp cf-inp"
          value={q}
          autoFocus={autoFocus}
          placeholder="Город клиента — например, Оренбург"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => q && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          aria-label="Город клиента"
          aria-expanded={open && hits.length > 0}
          role="combobox"
          aria-autocomplete="list"
        />
        {q && (
          <button type="button" className="cf-x" onClick={clear} aria-label="Очистить">
            <Icon name="close" size={13} />
          </button>
        )}
        {open && q && (
          <div className="cf-pop" role="listbox">
            {hits.length === 0 ? (
              <div className="cf-none">Не нашли такой город. Наберите ближайший крупный или кликните по карте.</div>
            ) : (
              hits.map((h, i) => {
                const mine = ours.list.some((o) => o.city.id === h.city.id);
                return (
                  <button
                    type="button"
                    key={h.city.id}
                    role="option"
                    aria-selected={i === active}
                    className={`cf-opt${i === active ? " on" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pickHit(h)}
                  >
                    <span className="cf-opt-name">
                      {/* одним элементом: иначе flex-зазор рвёт слово между жирной и обычной частью */}
                      <span>{mark(h.city.name, q)}</span>
                      {mine && <span className="cf-tag">наш</span>}
                    </span>
                    <span className="cf-opt-sub">
                      {h.byRegion ? `${h.city.region} · центр` : h.city.region}
                      <span className="num"> · {fmtPop(h.city.pop)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="cf-filter">
        <Select value={projectId} onChange={setProjectId} options={projectOpts} ariaLabel="Проект" width="100%" minPopWidth={240} />
      </div>

      {!target ? (
        <div className="cf-ours">
          <div className="cf-h">
            Где мы работаем<span className="num">{ours.list.length}</span>
          </div>
          <div className="cf-chips">
            {ours.list.map((o) => (
              <button type="button" key={o.city.id} className="cf-chip" data-seg={o.segment} onClick={() => pick({ lat: o.city.lat, lon: o.city.lon, city: o.city })} title={o.city.region}>
                {o.city.name}
              </button>
            ))}
            {!ours.list.length && <span className="cf-dim">Список пуст: города задаются в «Настройках → Регионы» и в карточке проекта.</span>}
          </div>
          {ours.unknown.length > 0 && (
            <div className="cf-warn">
              <Icon name="alert" size={13} /> Не нашли на карте: {ours.unknown.join(", ")} — проверьте написание в настройках.
            </div>
          )}
          <div className="cf-tip">
            <Icon name="info" size={13} /> Начните вводить город клиента — покажем ближайшие наши города. Можно и в английской раскладке, и просто кликнуть по карте.
          </div>
        </div>
      ) : (
        <div className="cf-res">
          <div className="cf-where">
            <div className="cf-where-name">{city ? city.name : `Точка возле г. ${here?.city.name}`}</div>
            <div className="cf-where-sub">
              {(city ?? here?.city)?.region}
              {city && <span className="num"> · {fmtPop(city.pop)}</span>}
            </div>
            <div className="cf-time">
              <Icon name="clock" size={13} /> у клиента сейчас <b className="num">{localTime(tz, now)}</b> <span className="cf-dim">({mskOffset(tz)})</span>
            </div>
          </div>
          {ourHere && (
            <div className="cf-ok">
              <Icon name="check" size={14} /> Работаем в этом городе
            </div>
          )}
          <div className="cf-h">
            Ближайшие наши города
            {best && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()} title="Скопировать для комментария">
                <Icon name="copy" size={12} /> Скопировать
              </button>
            )}
          </div>
          <ol className="cf-list">
            {near.map((n, i) => (
              <li
                key={n.our.city.id}
                className={`cf-row${i === 0 ? " first" : ""}${focus === n.our.city.id ? " focus" : ""}`}
                onMouseEnter={() => setFocus(n.our.city.id)}
                onMouseLeave={() => setFocus(null)}
              >
                <span className="cf-rank num">{i + 1}</span>
                <span className="cf-row-main">
                  <span className="cf-row-name">
                    <i className="cf-seg" data-seg={n.our.segment} />
                    {n.our.city.name}
                    {i === 0 && !ourHere && <span className="cf-tag good">ближайший</span>}
                  </span>
                  <span className="cf-row-sub">
                    {n.our.projects.length ? n.our.projects.join(", ") : n.our.segment === "regional" ? "регионы" : "основа"}
                    {n.our.city.utc !== tz && <> · {mskOffset(n.our.city.utc)}</>}
                  </span>
                </span>
                <span className="cf-km">
                  <b className="num">{n.km < 1 ? "здесь" : fmtKm(n.km)}</b>
                  {n.km >= 1 && <span className="num">≈ {fmtKm(roadKm(n.km))} · {fmtHours(driveHours(n.km))}</span>}
                </span>
                {choose && (
                  <button
                    type="button"
                    className="btn btn-sm cf-choose"
                    disabled={!canChoose(n.our.labels[0])}
                    title={canChoose(n.our.labels[0]) ? "Подставить в поле «Город клиента»" : "Этого города нет в списке выбранного проекта"}
                    onClick={() => choose(n.our.labels[0])}
                  >
                    Выбрать
                  </button>
                )}
              </li>
            ))}
            {!near.length && <li className="cf-dim">Наших городов в списке нет.</li>}
          </ol>
          <div className="cf-foot cf-dim">Расстояние — по прямой, под ним — примерно по дороге и на машине.</div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`cf${compact ? " compact" : ""}`}>
      {panel}
      <CityMap ours={ours.list} target={target} near={near} focus={focus} onPick={pick} height={compact ? 380 : "calc(100vh / var(--ui-scale, 1) - 200px)"} />
    </div>
  );
}

const fmtKm = (km: number) => `${Math.round(km).toLocaleString("ru-RU")} км`;
const fmtHours = (h: number) => (h < 1 ? `${Math.max(10, Math.round((h * 60) / 10) * 10)} мин` : h < 10 ? `${(Math.round(h * 2) / 2).toLocaleString("ru-RU")} ч` : `${Math.round(h)} ч`);

/** Подсветить набранное в названии. */
function mark(name: string, q: string) {
  const n = q.trim().toLowerCase().replace(/ё/g, "е");
  const i = name.toLowerCase().replace(/ё/g, "е").indexOf(n);
  if (!n || i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <b>{name.slice(i, i + n.length)}</b>
      {name.slice(i + n.length)}
    </>
  );
}
