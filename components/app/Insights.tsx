"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { PACE_HUE, PACE_LABEL, type OpRow, type PaceStatus } from "@/lib/crm/calc";
import { LAG_HINT, LAG_HUE, LAG_LABEL, fmtImpact, type GroupSpread, type LagReason, type Medians, type OpInsight, type Signal, type Tempo } from "@/lib/crm/insights";
import { NO_GROUP_LABEL } from "@/lib/crm/types";
import { fmtNum, fmtPct, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Collapse, hueFg, hueVars } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/* ── «Требует внимания»: над таблицей операторов ───────────────────── */

const OPEN_KEY = "leadup.attention.open";
/** Больше пяти человек подряд не читают — остальные страницами. */
const PAGE = 5;
const SUM_STATUSES: PaceStatus[] = ["ahead", "ontrack", "lagging", "critical", "idle"];

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

const topSignal = (s: Signal[]) => s.reduce((a, b) => (b.sev > a.sev ? b : a));

export function AttentionPanel({ rows, byOp, med, onOpen }: { rows: OpRow[]; byOp: Map<string, OpInsight>; med: Medians; onOpen: (id: string) => void }) {
  const { ix } = useCrm();
  const [open, setOpen] = useState(readOpen);
  const [page, setPage] = useState(0);

  const live = useMemo(() => rows.filter((r) => !r.op.deletedAt && r.op.status !== "fired" && r.inWindow), [rows]);
  const items = useMemo(
    () =>
      live
        .map((r) => ({ r, s: byOp.get(r.op.id)?.signals ?? [] }))
        .filter((x) => x.s.length)
        .sort((a, b) => topSignal(b.s).sev - topSignal(a.s).sev || a.r.pace.paceRatio - b.r.pace.paceRatio),
    [live, byOp],
  );
  const need = items.filter((x) => x.s.some((z) => z.sev >= 2)).length;
  const counts = useMemo(() => {
    const c = {} as Record<PaceStatus, number>;
    for (const r of live) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [live]);
  const bar = SUM_STATUSES.filter((s) => counts[s]);

  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(OPEN_KEY, v ? "0" : "1");
      } catch {
        /* приватное окно — не запомним, не страшно */
      }
      return !v;
    });

  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  // список сократился (кому-то стало лучше, сменили фильтр) — не остаёмся на пустой странице
  const pg = Math.min(page, pages - 1);
  const shown = items.slice(pg * PAGE, pg * PAGE + PAGE);

  return (
    <div className="card ins-att">
      <button type="button" className="ins-att-head" onClick={toggle} aria-expanded={open}>
        <Icon name="chevR" size={14} className={`grp-chev${open ? " open" : ""}`} />
        <span className="card-title"><Icon name="alert" size={15} className="title-ic" />Требует внимания</span>
        {need > 0 ? <Chip hue="red">{need}</Chip> : <Chip hue="green">всё спокойно</Chip>}
        <span className="ins-att-sub">
          сигналы по темпу, часам и лидам в час · сравнение с медианой команды
        </span>
      </button>
      <Collapse open={open}>
        <div className="ins-att-body">
          <div className="ins-att-sum">
            <div>
              <div className="ins-att-big num">
                {need}
                <span> / {live.length}</span>
              </div>
              <div className="ins-att-lbl">в зоне внимания</div>
            </div>
            {bar.length > 0 && (
              <div>
                <div className="ins-stack">
                  {bar.map((s) => (
                    <i key={s} style={{ flex: counts[s], background: hueFg(PACE_HUE[s]) }} title={`${PACE_LABEL[s]}: ${counts[s]}`} />
                  ))}
                </div>
                <div className="ins-legend">
                  {bar.map((s) => (
                    <div key={s}>
                      <span className="ins-sw" style={{ background: hueFg(PACE_HUE[s]) }} />
                      {PACE_LABEL[s]}
                      <span className="num">{counts[s]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(med.hpd != null || med.lph != null) && (
              <div className="ins-att-med">
                Медиана команды:
                {med.hpd != null && <b className="num"> {fmtNum(med.hpd)} ч</b>}
                {med.hpd != null && " в рабочий день"}
                {med.lph != null && (
                  <>
                    {" · "}
                    <b className="num">{fmtNum(med.lph, 2)}</b> лида в час
                  </>
                )}
              </div>
            )}
          </div>
          <div className="ins-att-list">
            {items.length === 0 ? (
              <div className="ins-att-empty">Ни у кого нет тревожных сигналов: темп, часы и лиды в час в норме.</div>
            ) : (
              shown.map(({ r, s }) => {
                const top = topSignal(s);
                const g = r.op.groupId ? ix.groupById.get(r.op.groupId) : null;
                return (
                  <button type="button" key={r.op.id} className="ins-item" style={hueVars(top.hue)} onClick={() => onOpen(r.op.id)}>
                    <span className="ins-stripe" />
                    <span className="ins-item-body">
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar name={r.op.name} id={r.op.id} size={24} />
                        <span className="ins-item-name">{shortName(r.op.name)}</span>
                        <span className="ins-item-grp">
                          {g ? g.name : NO_GROUP_LABEL} · {fmtPct(r.pace.paceRatio)} темпа
                        </span>
                      </span>
                      <span className="ins-trig">
                        {s.map((z) => (
                          <span key={z.kind} style={{ ["--t" as string]: hueFg(z.hue) }}>
                            <b>{z.title}</b> <span>· {z.detail}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="ins-todo">{top.todo}</span>
                  </button>
                );
              })
            )}
            {pages > 1 && (
              <div className="ins-pager">
                <span className="num">
                  {pg * PAGE + 1}–{Math.min(items.length, pg * PAGE + PAGE)} из {items.length}
                </span>
                <span className="ins-pager-dots">
                  {Array.from({ length: pages }, (_, i) => (
                    <button type="button" key={i} aria-label={`Страница ${i + 1}`} aria-current={i === pg} onClick={() => setPage(i)} />
                  ))}
                </span>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Назад" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
                  <Icon name="chevL" size={14} />
                </button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Дальше" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
                  <Icon name="chevR" size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/* ── ячейки таблицы ────────────────────────────────────────────────── */

export function TrendCell({ t }: { t: Tempo | undefined }) {
  if (!t || t.change == null) return <span className="muted">—</span>;
  const c = t.change;
  const tone = c >= 0.1 ? "var(--text-sub)" : c <= -0.1 ? "var(--c-red-fg)" : "var(--dim)";
  return (
    <span className="ins-trend" style={{ color: tone }} title={`Последние 5 смен: ${fmtNum(t.last)} лида в день, 5 смен до них: ${fmtNum(t.prev)}`}>
      <b>{c >= 0.1 ? "↗" : c <= -0.1 ? "↘" : "→"}</b>
      <span className="num">
        {c > 0 ? "+" : c < 0 ? "−" : ""}
        {fmtPct(Math.abs(c))}
      </span>
    </span>
  );
}

export function WhyCell({ reason }: { reason: LagReason | null | undefined }) {
  if (!reason) return <span className="muted">—</span>;
  // одна строка: причина и, в подсказке, сколько лидов отставания из-за часов и из-за л/ч
  const split = reason.kind === "plan" ? "часы и лиды в час как у команды" : `из-за часов ${fmtImpact(reason.hoursImpact)}, из-за л/ч ${fmtImpact(reason.lphImpact)}`;
  return (
    <span className="ins-why" title={`${LAG_HINT[reason.kind]}
Отставание к дате: ${split}`}>
      <Chip hue={LAG_HUE[reason.kind]}>{LAG_LABEL[reason.kind]}</Chip>
    </span>
  );
}

export function RealCell({ real, row }: { real: number | null | undefined; row: OpRow }) {
  if (real == null) return <span className="muted">—</span>;
  const need = row.pace.needPerDay ?? 0;
  // успевает в своём темпе — не шумим плашкой, достаточно галочки
  if (real < 1.15)
    return (
      <span className="ins-ok" title={`Успевает: нужно ${fmtNum(need)} лида в рабочий день, делает ${fmtNum(row.avgPerWorkday)}`}>
        ✓
      </span>
    );
  const hue = real >= 1.5 ? "red" : "amber";
  return (
    <span
      className="ins-x num"
      style={hueVars(hue)}
      title={`Нужно ${fmtNum(need)} лида в рабочий день до конца месяца, в среднем делает ${fmtNum(row.avgPerWorkday)}`}
    >
      {real === Infinity ? "нет темпа" : `×${fmtNum(real)}`}
    </span>
  );
}

/* ── разброс внутри группы ─────────────────────────────────────────── */

export function SpreadBar({ sp }: { sp: GroupSpread }) {
  if (!sp.people.length) return null;
  const top = Math.max(2, ...sp.people.map((p) => p.ratio));
  const x = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  return (
    <div className="ins-spread-wrap">
      <div className="ins-spread" aria-label="Темп каждого человека группы">
        <span className="ins-spread-ln" />
        <span className="ins-spread-100" style={{ left: x(1) }} title="100% темпа" />
        {sp.people.map((p) => (
          <span key={p.id} className="ins-spread-dot" style={{ left: x(p.ratio), background: hueFg(PACE_HUE[p.status]) }} title={`${p.name}: ${fmtPct(p.ratio)} темпа`} />
        ))}
      </div>
      <div className="ins-spread-l num">
        <span>0%</span>
        <span style={{ position: "absolute", left: x(1), transform: "translateX(-50%)" }}>100%</span>
        <span>{fmtPct(top)}</span>
      </div>
    </div>
  );
}
