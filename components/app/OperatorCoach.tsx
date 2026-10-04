"use client";

import { useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useInsights, useMonthModel } from "@/lib/crm/hooks";
import { canNote } from "@/lib/crm/access";
import { hasNotesTable } from "@/lib/crm/remote";
import type { OpRow } from "@/lib/crm/calc";
import { LAG_HINT, NOTE_METRIC_LABEL, fmtImpact, fmtNoteMetric, noteEffect } from "@/lib/crm/insights";
import { NOTE_METRICS, type DayKey, type NoteMetric, type OpNote } from "@/lib/crm/types";
import { fmtNum, fmtPct } from "@/lib/crm/format";
import { hueVars } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";
import { DateInput } from "@/components/ui/select";
import { RealCell, TrendCell, WhyCell } from "./Insights";

const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dShort = (d: DayKey) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;

/** Живые заметки оператора, свежие сверху. */
export function useOpNotes(opId: string): OpNote[] {
  const { data } = useCrm();
  return useMemo(
    () => data.notes.filter((n) => n.operatorId === opId && !n.deletedAt).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [data.notes, opId],
  );
}

/**
 * Разбор в карточке оператора: почему отстаёт, куда идёт темп, реально ли закрыть план
 * и что сделать. Только для руководителей: оператору в «Моих показателях» не показываем.
 */
export function OperatorInsight({ row }: { row: OpRow }) {
  const m = useMonthModel();
  const { byOp } = useInsights(m);
  const ins = byOp.get(row.op.id);
  if (!ins) return null;
  const { tempo: t, reason, realism, signals } = ins;
  if (!reason && t.change == null && realism == null && !signals.length) return null;
  return (
    <div className="card card-pad ins-coach">
      <div className="card-head" style={{ marginBottom: 10 }}>
        <div>
          <h3 className="card-title"><Icon name="bulb" size={15} className="title-ic" />Разбор</h3>
          <p className="card-sub">Сравнение с медианой команды за этот месяц</p>
        </div>
      </div>
      <div className="ins-coach-rows">
        <span className="ins-coach-l">Почему отстаёт</span>
        <div>
          <WhyCell reason={reason} />
          {reason && <div className="ins-coach-hint">{LAG_HINT[reason.kind]}</div>}
        </div>
        <span className="ins-coach-l">Тренд</span>
        <div className="ins-coach-v">
          <TrendCell t={t} />
          <span className="ins-coach-hint">{t.change != null ? `5 смен: ${fmtNum(t.last)} в день, до них ${fmtNum(t.prev)}` : "мало смен для сравнения"}</span>
        </div>
        <span className="ins-coach-l">Реально ли</span>
        <div className="ins-coach-v">
          <RealCell real={realism} row={row} />
          {realism != null && realism !== Infinity && (
            <span className="ins-coach-hint">
              нужно {fmtNum(row.pace.needPerDay ?? 0)} в день, делает {fmtNum(row.avgPerWorkday)}
            </span>
          )}
        </div>
      </div>
      {reason && reason.kind !== "plan" && (
        <div className="ins-coach-hint" style={{ marginTop: 8 }}>
          Из {fmtImpact(reason.hoursImpact + reason.lphImpact)} к дате: {fmtImpact(reason.hoursImpact)} из-за часов, {fmtImpact(reason.lphImpact)} из-за лидов в час.
        </div>
      )}
      {signals.length > 0 && (
        <div className="ins-coach-sig">
          {signals.map((s) => (
            <div key={s.kind} className="ins-coach-s" style={hueVars(s.hue)}>
              <b>{s.title}</b>
              <span>{s.detail}</span>
              <span className="ins-coach-todo">→ {s.todo}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── заметки СВ: панель справа на «Операторах» и карточка оператора ── */

/** Частые темы разговора — подставляются в начало заметки, чтобы формулировки не расходились. */
const NOTE_TOPICS = ["Разбор звонков", "Скрипт", "Возражения", "Часы и график", "Мотивация", "Дисциплина"];
const NOTE_ICON: Record<NoteMetric, IconName> = { lph: "target", hours: "clock", leads: "phone" };
const NOTE_SHORT: Record<NoteMetric, string> = { lph: "Конверсия", hours: "Часы / смена", leads: "Лиды / смена" };

/**
 * Заметки СВ: тема, о чём поговорили, за каким показателем следить. Рядом с показателем —
 * его значение до разговора; у каждой заметки — что стало после (CRM считает сама).
 */
export function OperatorNotes({ opId, variant = "box" }: { opId: string; variant?: "box" | "card" }) {
  const { access, remote, today, ix, saveNote, deleteNote } = useCrm();
  const notes = useOpNotes(opId);
  const [text, setText] = useState("");
  const [metric, setMetric] = useState<NoteMetric>("lph");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const can = canNote(access, opId);
  const missing = remote && !hasNotesTable();
  const day = date > today ? today : date;

  const effects = useMemo(() => notes.map((n) => ({ n, e: noteEffect(n, ix, today) })), [notes, ix, today]);
  const judged = effects.filter((x) => x.e.change != null);
  const helped = judged.filter((x) => (x.e.change ?? 0) >= 0.1).length;
  // без права писать и без заметок показывать нечего
  if (!can && notes.length === 0) return null;

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await saveNote({ operatorId: opId, date: day, text, metric });
    setBusy(false);
    if (ok) {
      setText("");
      setDate(today);
    }
  };
  const topic = (t: string) => {
    setText((v) => (v.trim() ? v : `${t}: `));
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  return (
    <div className={variant === "card" ? "card card-pad o2-notes" : "o2-box o2-notes"}>
      <div className="o2-box-h" style={{ marginBottom: 2 }}>
        {variant === "card" ? (
          <h3 className="card-title">
            <Icon name="note" size={15} className="title-ic" />
            Заметки СВ{notes.length > 0 && <span className="o2-cnt">{notes.length}</span>}
          </h3>
        ) : (
          <b>
            <Icon name="note" size={13} className="mi" />
            Заметки СВ{notes.length > 0 && <span className="o2-cnt">{notes.length}</span>}
          </b>
        )}
        {judged.length > 0 && (
          <span className="o2-muted" style={{ fontSize: 11.5 }} title="Заметки, по которым уже есть по 3 смены до и после">
            помогло {helped} из {judged.length}
          </span>
        )}
      </div>
      <div className="o2-notes-sub">О чём поговорили и за чем следить. CRM сравнит показатель до и после разговора.</div>

      {missing ? (
        <div className="ins-note-miss">
          В базе ещё нет таблицы заметок. Выполните <code>supabase/migrations/20260927000001_op_notes.sql</code> в Supabase → SQL Editor и обновите страницу.
        </div>
      ) : (
        can && (
          <div className="o2-nf">
            <div className="o2-topics">
              {NOTE_TOPICS.map((t) => (
                <button key={t} type="button" onClick={() => topic(t)}>
                  {t}
                </button>
              ))}
            </div>
            <textarea
              ref={taRef}
              className="inp"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Например: разобрали 5 звонков, теряет клиента на «дорого» — дал шаблон ответа"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
              }}
            />
            <div className="o2-nf-l">За чем следить · сейчас, до разговора</div>
            <div className="o2-metrics" role="radiogroup" aria-label="Показатель">
              {NOTE_METRICS.map((k) => {
                const e = noteEffect({ operatorId: opId, date: day, metric: k }, ix, today);
                return (
                  <button key={k} type="button" role="radio" aria-checked={metric === k} className={metric === k ? "on" : ""} onClick={() => setMetric(k)} title="Среднее за 10 смен до дня разговора">
                    <span className="k">
                      <Icon name={NOTE_ICON[k]} size={12} />
                      {NOTE_SHORT[k]}
                    </span>
                    <b>{e.before > 0 ? fmtNoteMetric(k, e.before) : "—"}</b>
                  </button>
                );
              })}
            </div>
            <div className="o2-nf-foot">
              <DateInput size="sm" width={132} value={date} max={today} onChange={(v) => setDate(v || today)} ariaLabel="День разговора" />
              <button type="button" className="o2-btn pri" style={{ marginLeft: "auto", height: 30 }} onClick={() => void add()} disabled={!text.trim() || busy} title="Ctrl+Enter">
                <Icon name="plus" size={13} /> Добавить
              </button>
            </div>
          </div>
        )
      )}

      {notes.length === 0 ? (
        <div className="o2-notes-empty">
          <Icon name="note" size={18} />
          <span>Заметок пока нет. После 1:1 запишите, о чём договорились, — через 3 смены будет видно, помог ли разговор.</span>
        </div>
      ) : (
        <div className="o2-tl">
          {effects.map(({ n, e }) => {
            const hue = e.change == null ? "gray" : e.change >= 0.1 ? "green" : e.change <= -0.1 ? "red" : "amber";
            const verdict = e.early ? `рано · ${e.daysAfter} из 3 смен` : e.change == null ? "мало смен до" : e.change >= 0.1 ? "помогло" : e.change <= -0.1 ? "стало хуже" : "без изменений";
            const mine = n.authorId === access.account.id || access.isHead;
            return (
              <div key={n.id} className="o2-tl-it" data-hue={hue}>
                <i className="dot" />
                <div className="meta">
                  <span>
                    <b>{dShort(n.date)}</b> · {n.authorName || "—"}
                  </span>
                  {mine && (
                    <button type="button" className="o2-kebab" style={{ width: 22, height: 22, marginLeft: "auto" }} title="Удалить заметку" onClick={() => void deleteNote(n.id)}>
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
                <div className="tx">{n.text}</div>
                <div className="eff">
                  <span className="m">
                    <Icon name={NOTE_ICON[n.metric]} size={11} />
                    {NOTE_METRIC_LABEL[n.metric]}
                  </span>
                  {e.change != null ? (
                    <span className="num">
                      {fmtNoteMetric(n.metric, e.before)} → <b>{fmtNoteMetric(n.metric, e.after)}</b>
                    </span>
                  ) : e.after > 0 ? (
                    <span className="num">после: {fmtNoteMetric(n.metric, e.after)}</span>
                  ) : null}
                  <span className="o2-pill" data-hue={hue} style={{ marginLeft: "auto" }}>
                    {e.change != null ? `${e.change >= 0 ? "+" : "−"}${fmtPct(Math.abs(e.change))} · ` : ""}
                    {verdict}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
