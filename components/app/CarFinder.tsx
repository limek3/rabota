"use client";

import { useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { Icon } from "@/components/ui/icons";
import { Select, dot, type Opt } from "@/components/ui/select";
import { BODY_LABEL, BRAND_LIST, POWER_LABEL, modelById, modelsOf, searchCars, yearsLabel, type Brand, type Model } from "@/lib/cars/catalog";
import { CRITERIA_NOTE, CRITERIA_SHORT, VERDICT_LABEL, rulesFor, type CarRules, type VerdictKind, type ZoneVerdict } from "@/lib/cars/rules";
import { photoOf } from "@/lib/cars/photo";
import type { Project } from "@/lib/crm/types";

/**
 * «Марки авто»: оператор выбирает проект и набирает машину клиента («тайота камри», «крузак»,
 * в английской раскладке, с опечаткой) — подсказки сразу, выбор — карточка: фото, кузов,
 * двигатель, особенности и крупно «передаём / не передаём / уточнить» с причиной.
 * Правила проектов — lib/cars/rules.ts, каталог — lib/cars/data.ts, фото — public/cars (Википедия).
 */


/** Один цвет на проект: все зоны «да» — да, все «нет» — нет, иначе — зависит (уточнить). */
function overall(vs: ZoneVerdict[]): VerdictKind {
  if (vs.every((v) => v.kind === "ok")) return "ok";
  if (vs.every((v) => v.kind === "no")) return "no";
  return "ask";
}

export function CarFinder() {
  const { data, toast } = useCrm();
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);

  const projects = data.projects.filter((p) => !p.deletedAt && p.active);
  // проекты, для которых есть правила: выбран — он один, «все» — все такие
  const ruled = projects.map((p) => ({ p, rules: rulesFor(p) })).filter((x): x is { p: Project; rules: CarRules } => !!x.rules);
  const shown = projectId ? ruled.filter((x) => x.p.id === projectId) : ruled;
  const picked = projects.find((p) => p.id === projectId) ?? null;

  const projectOpts: Opt[] = [
    { value: "", label: "Все проекты", icon: <Icon name="folder" size={14} /> },
    ...projects.map<Opt>((p) => ({ value: p.id, label: p.name, icon: dot(p.color), hint: rulesFor(p) ? undefined : "правил нет" })),
  ];

  const hits = useMemo(() => searchCars(q, 8), [q]);
  // марки без моделей в справочнике (Hummer, McLaren…): поиск по моделям их не находит — ищем по названию
  const bare = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return BRAND_LIST.filter((b) => !modelsOf(b.id).length && [b.name, ...b.ru].some((n) => n.toLowerCase().startsWith(t))).slice(0, 6);
  }, [q]);
  const sel = selId ? modelById.get(selId) ?? null : null;
  const brand = brandId ? BRAND_LIST.find((b) => b.id === brandId) ?? null : null;

  // вердикт для точки в списках: по выбранному проекту, а если «все» — по единственному с правилами
  const dotOf = (m: Model): VerdictKind | null => {
    const one = shown.length === 1 ? shown[0] : null;
    return one ? overall(one.rules.check(m)) : null;
  };

  const pick = (m: Model) => {
    setSelId(m.id);
    // слева была марка без моделей (Hummer) — после выбора модели она уже ни к чему
    setBrandId((b) => (b && !modelsOf(b).length ? null : b));
    setQ(m.full);
    setOpen(false);
  };

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
      if (hits[active]) pick(hits[active].model);
    } else if (e.key === "Escape" && open && q) {
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    }
  };

  const clear = () => {
    setQ("");
    setSelId(null);
    inp.current?.focus();
  };

  const copy = async () => {
    if (!sel) return;
    const lines = shown.map(({ p, rules }) => {
      const vs = rules.check(sel);
      return `${p.name}: ${vs.map((v) => `${v.zone ? `${v.zone} — ` : ""}${VERDICT_LABEL[v.kind].toLowerCase()}${v.reasons.length ? ` (${v.reasons.join("; ")})` : ""}`).join(", ")}`;
    });
    const txt = [`${sel.full} (${sel.bodies.map((b) => BODY_LABEL[b]).join(", ")}; ${sel.power.map((p) => POWER_LABEL[p]).join(", ")}) — ${CRITERIA_SHORT}`, ...lines].join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      toast("Скопировано — можно вставить в комментарий");
    } catch {
      toast("Не удалось скопировать", "err");
    }
  };

  const chinese = BRAND_LIST.filter((b) => b.cn || b.cnLocal);
  const others = BRAND_LIST.filter((b) => !b.cn && !b.cnLocal);

  return (
    <div className={`ca${sel ? " has-sel" : ""}`}>
      <div className="cf-panel">
        <div className="cf-search">
          <Icon name="search" size={15} className="cf-search-ic" />
          <input
            ref={inp}
            className="inp cf-inp"
            value={q}
            autoFocus
            placeholder="Машина клиента — например, Тойота Камри"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => q && setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKey}
            aria-label="Машина клиента"
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
              {bare.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    role="option"
                    aria-selected={false}
                    className="cf-opt ca-opt"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setBrandId(b.id);
                      setSelId(null);
                      setQ(b.name);
                      setOpen(false);
                    }}
                  >
                    <span className="ca-thumb ph">
                      <Icon name="car" size={16} />
                    </span>
                    <span className="ca-opt-main">
                      <span className="cf-opt-name">{b.name}</span>
                      <span className="cf-opt-sub">марка целиком · {b.country}</span>
                    </span>
                  </button>
                ))}
              {hits.length === 0 && !bare.length ? (
                <div className="cf-none">Не нашли такую машину. Попробуйте марку и модель латиницей или как пишут в объявлениях.</div>
              ) : (
                hits.map((h, i) => (
                  <button
                    type="button"
                    key={h.model.id}
                    role="option"
                    aria-selected={i === active}
                    className={`cf-opt ca-opt${i === active ? " on" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(h.model)}
                  >
                    <Thumb m={h.model} />
                    <span className="ca-opt-main">
                      <span className="cf-opt-name">{h.model.full}</span>
                      <span className="cf-opt-sub">
                        {h.model.bodies.map((b) => BODY_LABEL[b]).join(", ")} · {yearsLabel(h.model)}
                      </span>
                    </span>
                    <VDot kind={dotOf(h.model)} />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="cf-filter">
          <Select value={projectId} onChange={setProjectId} options={projectOpts} ariaLabel="Проект" width="100%" minPopWidth={240} />
        </div>

        <div className="ca-lists">
        {brand ? (
          <div className="cf-ours">
            <div className="cf-h">
              {brand.name}
              <span className="num">{modelsOf(brand.id).length}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBrandId(null)}>
                <Icon name="arrowL" size={12} /> Все марки
              </button>
            </div>
            {!modelsOf(brand.id).length && <BrandVerdicts b={brand} shown={shown} />}
            <div className="ca-list">
              {modelsOf(brand.id).map((m) => (
                <button type="button" key={m.id} className={`ca-row${sel?.id === m.id ? " on" : ""}`} onClick={() => pick(m)}>
                  <Thumb m={m} />
                  <span className="ca-opt-main">
                    <span className="ca-row-name">{m.name}</span>
                    <span className="cf-opt-sub">
                      {m.bodies.map((b) => BODY_LABEL[b]).join(", ")} · {yearsLabel(m)}
                    </span>
                  </span>
                  <VDot kind={dotOf(m)} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {shown.map(({ p, rules }) => (
              <div key={p.id} className="cf-ours ca-rules">
                <div className="cf-h">
                  <i className="ca-pdot" style={{ background: `var(--c-${p.color}-fg, var(--dim))` }} />
                  {p.name}: {rules.key === "autoru" ? "какие марки берём" : "не берём"}
                </div>
                <ul>
                  {rules.list.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ))}
            {picked && !rulesFor(picked) && (
              <div className="cf-tip">
                <Icon name="info" size={13} /> Для проекта «{picked.name}» правил по машинам пока нет.
              </div>
            )}
            <div className="cf-ours">
              <div className="cf-h">
                Марки<span className="num">{BRAND_LIST.length}</span>
              </div>
              <div className="ca-sub">Китайские</div>
              <div className="cf-chips">
                {chinese.map((b) => (
                  <button type="button" key={b.id} className="cf-chip ca-chip" data-cn="" onClick={() => setBrandId(b.id)} title={b.country}>
                    {b.name}
                  </button>
                ))}
              </div>
              <div className="ca-sub">Остальные</div>
              <div className="cf-chips">
                {others.map((b) => (
                  <button type="button" key={b.id} className="cf-chip ca-chip" onClick={() => setBrandId(b.id)} title={b.country}>
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      {sel ? (
        <CarCard m={sel} shown={shown} single={!!projectId} onCopy={() => void copy()} />
      ) : (
        <div className="ca-empty">
          <Icon name="car" size={40} />
          <b>Начните вводить машину клиента</b>
          <span>Марку и модель — как скажет клиент: «тайота камри», «крузак», «солярис». Можно латиницей, в английской раскладке и с опечаткой.</span>
        </div>
      )}
    </div>
  );
}

function VDot({ kind }: { kind: VerdictKind | null }) {
  if (!kind) return null;
  return <i className="ca-vdot" data-kind={kind} title={VERDICT_LABEL[kind]} />;
}

function Thumb({ m }: { m: Model }) {
  const ph = photoOf(m.id);
  return ph ? <img className="ca-thumb" src={`/cars/${m.id}.jpg`} alt="" loading="lazy" /> : <span className="ca-thumb ph"><Icon name="car" size={16} /></span>;
}

function CarCard({ m, shown, single, onCopy }: { m: Model; shown: { p: Project; rules: CarRules }[]; single: boolean; onCopy: () => void }) {
  const ph = photoOf(m.id);
  return (
    <div className="ca-card">
      <div className="ca-photo">
        {ph ? (
          <img src={`/cars/${m.id}.jpg`} alt={m.full} />
        ) : (
          <div className="ca-ph">
            <Icon name="car" size={56} />
            <span>фото нет</span>
          </div>
        )}
      </div>
      <div className="ca-info">
        <div className="ca-brand">
          {m.brand.name} · {m.brand.country}
          {m.brand.cn && <span className="cf-tag">китайская</span>}
        </div>
        <h2 className="ca-name">{m.full}</h2>
        <div className="ca-meta">
          {yearsLabel(m)} · {m.bodies.map((b) => BODY_LABEL[b]).join(", ")}
          {m.sport && " · спорткар"}
        </div>
        <div className="ca-chips">
          {m.power.map((p) => (
            <span key={p} className="ca-pw" data-p={p}>
              {POWER_LABEL[p]}
            </span>
          ))}
        </div>
        {m.notes && <p className="ca-notes">{m.notes}</p>}

        <div className={`ca-vs${single ? " single" : ""}`}>
          {shown.map(({ p, rules }) => {
            const vs = rules.check(m);
            const kind = overall(vs);
            return (
              <div key={p.id} className="ca-v" data-kind={kind}>
                <div className="ca-v-head">
                  <span className="ca-v-proj">{p.name}</span>
                  <span className="ca-v-kind">
                    <Icon name={kind === "ok" ? "check" : kind === "no" ? "close" : "alert"} size={single ? 18 : 14} />
                    {vs.length > 1 && kind === "ask" ? "Зависит от города" : VERDICT_LABEL[kind]}
                  </span>
                </div>
                {vs.length > 1
                  ? vs.map((v) => (
                      <div key={v.zone} className="ca-zone" data-kind={v.kind}>
                        <i className="ca-vdot" data-kind={v.kind} />
                        <span>
                          <b>{v.zone}</b> — {VERDICT_LABEL[v.kind].toLowerCase()}
                          {v.reasons.length > 0 && <span className="ca-why"> · {v.reasons.join("; ")}</span>}
                        </span>
                      </div>
                    ))
                  : vs[0].reasons.length > 0 && (
                      <ul className="ca-reasons">
                        {vs[0].reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
              </div>
            );
          })}
          {!shown.length && <div className="cf-tip">Для этого проекта правил по машинам пока нет.</div>}
        </div>
        {shown.length > 0 && (
          <div className="ca-crit" role="note">
            <Icon name="alert" size={15} />
            <span>{CRITERIA_NOTE}</span>
          </div>
        )}

        <div className="ca-foot">
          <button type="button" className="btn btn-sm" onClick={onCopy} title="Скопировать для комментария к лиду">
            <Icon name="copy" size={13} /> Скопировать
          </button>
          {ph && (
            <a className="ca-credit" href={`https://${ph.host}/wiki/${encodeURIComponent(ph.page.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer">
              Фото: {ph.by || "Википедия"}
              {ph.lic ? `, ${ph.lic}` : ""}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Марка без моделей в справочнике: вердикт по марке целиком (Hummer — 100 up не берёт). */
function BrandVerdicts({ b, shown }: { b: Brand; shown: { p: Project; rules: CarRules }[] }) {
  return (
    <div className="ca-vs" style={{ padding: "4px 2px 10px" }}>
      <div className="cf-tip">Моделей этой марки в справочнике нет — вердикт по марке.</div>
      {shown.map(({ p, rules }) => {
        const vs = rules.checkBrand(b);
        const kind = vs ? overall(vs) : "ask";
        return (
          <div key={p.id} className="ca-v" data-kind={kind}>
            <div className="ca-v-head">
              <span className="ca-v-proj">{p.name}</span>
              <span className="ca-v-kind">
                <Icon name={kind === "ok" ? "check" : kind === "no" ? "close" : "alert"} size={14} />
                {VERDICT_LABEL[kind]}
              </span>
            </div>
            <ul className="ca-reasons">
              {(vs ? vs.flatMap((v) => (v.zone ? [`${v.zone} — ${VERDICT_LABEL[v.kind].toLowerCase()}${v.reasons.length ? `: ${v.reasons.join("; ")}` : ""}`] : v.reasons)) : ["по одной марке не решить — уточните модель у РОП"]).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        );
      })}
      {shown.length > 0 && (
        <div className="ca-crit" role="note">
          <Icon name="alert" size={15} />
          <span>{CRITERIA_NOTE}</span>
        </div>
      )}
    </div>
  );
}
