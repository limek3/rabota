"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useInsights, useMonthModel } from "@/lib/crm/hooks";
import { canNote } from "@/lib/crm/access";
import { hasNotesTable } from "@/lib/crm/remote";
import type { OpRow } from "@/lib/crm/calc";
import { LAG_HINT, NOTE_METRIC_LABEL, fmtImpact, fmtNoteMetric, noteEffect } from "@/lib/crm/insights";
import { NOTE_METRICS, type NoteMetric, type OpNote } from "@/lib/crm/types";
import { fmtDayShort, fmtWeekday } from "@/lib/crm/dates";
import { fmtNum, fmtPct } from "@/lib/crm/format";
import { Chip, Seg, hueVars } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { DateInput } from "@/components/ui/select";
import { RealCell, TrendCell, WhyCell } from "./Insights";

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
          <h3 className="card-title">Разбор</h3>
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

/**
 * Заметки СВ: о чём поговорили и за каким показателем следить. CRM сама считает
 * показатель до и после дня заметки — видно, какие разговоры работают.
 */
export function OperatorNotes({ opId }: { opId: string }) {
  const { access, remote, today, ix, saveNote, deleteNote } = useCrm();
  const notes = useOpNotes(opId);
  const [text, setText] = useState("");
  const [metric, setMetric] = useState<NoteMetric>("lph");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  if (!canNote(access, opId)) return null;
  const missing = remote && !hasNotesTable();

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await saveNote({ operatorId: opId, date: date > today ? today : date, text, metric });
    setBusy(false);
    if (ok) {
      setText("");
      setDate(today);
    }
  };

  return (
    <div className="card card-pad">
      <div className="card-head" style={{ marginBottom: 10 }}>
        <div>
          <h3 className="card-title">Заметки СВ</h3>
          <p className="card-sub">О чём поговорили. CRM сравнит показатель до и после — видно, помог ли разговор</p>
        </div>
      </div>
      {missing ? (
        <div className="ins-note-miss">
          В базе ещё нет таблицы заметок. Выполните <code>supabase/migrations/20260927000001_op_notes.sql</code> в Supabase → SQL Editor и обновите страницу.
        </div>
      ) : (
        <div className="ins-note-form">
          <textarea
            id={`note-${opId}`}
            className="inp"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Например: разобрали 5 звонков, теряет клиента на «дорого» — дал шаблон ответа"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
            }}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="ins-note-l">Следить за</span>
            <Seg<NoteMetric> value={metric} onChange={setMetric} options={NOTE_METRICS.map((k) => ({ value: k, label: NOTE_METRIC_LABEL[k] }))} />
            <DateInput size="sm" width={140} value={date} max={today} onChange={(v) => setDate(v || today)} ariaLabel="День разговора" />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void add()} disabled={!text.trim() || busy} style={{ marginLeft: "auto" }}>
              <Icon name="plus" size={13} stroke={2.2} /> Добавить
            </button>
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="ins-notes">
          {notes.map((n, i) => {
            const e = noteEffect(n, ix, today);
            const hue = e.change == null ? "gray" : e.change >= 0.1 ? "green" : e.change <= -0.1 ? "red" : "amber";
            const verdict = e.change == null ? "" : e.change >= 0.1 ? "сработало" : e.change <= -0.1 ? "стало хуже" : "без изменений";
            const mine = n.authorId === access.account.id || access.isHead;
            return (
              <div key={n.id} className="ins-note">
                <div className="ins-note-meta">
                  <span className="ins-note-no">{notes.length - i}</span>
                  <span>
                    {fmtDayShort(n.date)}, {fmtWeekday(n.date)} · {n.authorName || "—"}
                  </span>
                  <Chip hue="gray">{NOTE_METRIC_LABEL[n.metric]}</Chip>
                  {mine && (
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Удалить заметку" onClick={() => void deleteNote(n.id)} style={{ marginLeft: "auto" }}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                <div className="ins-note-text">{n.text}</div>
                <div className="ins-note-eff" style={hueVars(hue)}>
                  {e.early ? (
                    <>Пока рано: после заметки {e.daysAfter} из 3 смен</>
                  ) : e.change == null ? (
                    <>До заметки мало смен для сравнения · после: {fmtNoteMetric(n.metric, e.after)}</>
                  ) : (
                    <>
                      {NOTE_METRIC_LABEL[n.metric]}: <b className="num">{fmtNoteMetric(n.metric, e.before)} → {fmtNoteMetric(n.metric, e.after)}</b> ({e.change >= 0 ? "+" : "−"}
                      {fmtPct(Math.abs(e.change))}) · <b>{verdict}</b>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
