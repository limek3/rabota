"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import {
  DEFAULT_ACADEMY,
  STATUS_GROUPS,
  academyData,
  isAcademyData,
  newItemId,
  type AcadItemDoc,
  type AcadModuleDoc,
  type AcademyData,
} from "@/lib/academy/content";
import type { Block, NoteKind, QuizQ } from "@/lib/learn";
import { Icon, type IconName } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";
import { Chip, downloadText } from "@/components/ui/kit";

/**
 * «Редактор обучения» — РОП правит курс «Авто», «Оплату и стажировку», статусы, возражения и
 * глоссарий: тексты, блоки, тесты, порядок, добавление и удаление. Правки копятся в черновике
 * (он же сохраняется в браузере, чтобы не потерять работу) и уходят всем по «Опубликовать» —
 * в kv-строку "academy" (lib/academy/content.ts). Тренажёр Скорозвона — в коде, здесь не правится.
 */

type Part = "course" | "pay";
type RefKind = "st" | "obj" | "gloss";
type Sel = { t: "item"; id: string } | { t: "module"; part: Part; mi: number } | { t: "ref"; ref: RefKind } | { t: "home" };

const DRAFT_KEY = "leadup.acadDraft";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const KINDS = ["Урок", "Регламент", "Скрипт", "Чек-лист", "Справочник", "Тест", "Тренажёр", "Калькулятор"];
const KIND_IC: Record<string, IconName> = { Урок: "doc", Скрипт: "chat", Регламент: "list", "Чек-лист": "clip", Справочник: "book", Тест: "test", Тренажёр: "bolt", Калькулятор: "calc" };
const KIND_HUE: Record<string, string> = { Урок: "gray", Справочник: "blue", Тест: "amber", Скрипт: "pink", "Чек-лист": "green", Регламент: "indigo", Тренажёр: "teal", Калькулятор: "teal" };
const WIDGET_LABEL: Record<string, { t: string; ref?: RefKind }> = {
  "st-auto": { t: "справочник статусов", ref: "st" },
  "obj-auto": { t: "справочник возражений", ref: "obj" },
  "tr-auto": { t: "тренажёр возражений — карточки из справочника возражений", ref: "obj" },
  "tr-st": { t: "тренажёр статусов", ref: "st" },
  gloss: { t: "глоссарий", ref: "gloss" },
  "calc-op": { t: "калькулятор смены — считает по тарифной сетке из настроек" },
};
const NOTE_LABEL: Record<NoteKind, string> = { tip: "Подсказка", warn: "Важно", err: "Нельзя", ok: "Хорошо" };
const LETTERS = "АБВГДЕ";

type BlockType = "p" | "h" | "ul" | "ol" | "n" | "tb" | "s" | "d" | "ck";
const BLOCK_TYPES: { t: BlockType; l: string; i: IconName; hint: string }[] = [
  { t: "p", l: "Абзац", i: "doc", hint: "Обычный текст" },
  { t: "h", l: "Заголовок", i: "book", hint: "В скрипте — новый шаг" },
  { t: "ul", l: "Список", i: "list", hint: "Пункты с точками" },
  { t: "ol", l: "Нумерованный список", i: "list", hint: "Пункты по порядку" },
  { t: "n", l: "Плашка", i: "info", hint: "Подсказка, «важно», «нельзя»" },
  { t: "tb", l: "Таблица", i: "grid", hint: "Колонки и строки" },
  { t: "s", l: "Реплика", i: "chat", hint: "Что говорим клиенту дословно" },
  { t: "d", l: "Диалог", i: "chat", hint: "Клиент — оператор" },
  { t: "ck", l: "Чек-лист", i: "clip", hint: "Пункты с галочками" },
];

function blockType(b: Block): BlockType {
  return (Object.keys(b).find((k) => k !== "first") as BlockType) ?? "p";
}
function newBlock(t: BlockType): Block {
  switch (t) {
    case "p":
      return { p: "" };
    case "h":
      return { h: "" };
    case "ul":
      return { ul: [""] };
    case "ol":
      return { ol: [""] };
    case "n":
      return { n: { k: "tip", t: "", b: "" } };
    case "tb":
      return { tb: { h: ["", ""], r: [["", ""]] } };
    case "s":
      return { s: { l: "Говорим клиенту", b: "" } };
    case "d":
      return { d: [["cl", ""], ["op", ""]] };
    case "ck":
      return { ck: { id: `ck-${Math.random().toString(36).slice(2, 8)}`, items: [""] } };
  }
}
const newQuestion = (): QuizQ => ({ q: "", o: ["", ""], a: 0, w: "" });

/** Все материалы по местам: часть, модуль, индекс. */
function locate(d: AcademyData, id: string): { part: Part; mi: number; ii: number; it: AcadItemDoc } | null {
  for (const part of ["course", "pay"] as Part[]) {
    const mods = d[part].modules;
    for (let mi = 0; mi < mods.length; mi++) {
      const ii = mods[mi].items.findIndex((x) => x.id === id);
      if (ii >= 0) return { part, mi, ii, it: mods[mi].items[ii] };
    }
  }
  return null;
}
const allItems = (d: AcademyData) => [...d.course.modules, ...d.pay.modules].flatMap((m) => m.items);
const move = <T,>(a: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= a.length) return a;
  const b = a.slice();
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

/** Проблемы, из-за которых публиковать нельзя: пустые названия, тесты без ответов. */
function problems(d: AcademyData): string[] {
  const out: string[] = [];
  for (const part of ["course", "pay"] as Part[])
    d[part].modules.forEach((m, mi) => {
      if (!m.t.trim()) out.push(`${part === "course" ? "Курс" : "Оплата"}: модуль ${mi + 1} без названия`);
      m.items.forEach((it) => {
        if (!it.t.trim()) out.push(`Материал без названия в модуле «${m.t || mi + 1}»`);
        it.quiz?.forEach((q, qi) => {
          if (!q.q.trim()) out.push(`«${it.t}»: вопрос ${qi + 1} без текста`);
          if (q.o.filter((o) => o.trim()).length < 2) out.push(`«${it.t}»: в вопросе ${qi + 1} меньше двух вариантов`);
          else if (!q.o[q.a]?.trim()) out.push(`«${it.t}»: в вопросе ${qi + 1} не выбран правильный ответ`);
        });
        if (it.quiz && !it.quiz.length) out.push(`«${it.t}»: в тесте нет вопросов`);
      });
    });
  return out;
}

/** Что поменялось — для журнала: «Обучение — изменено: «Скрипт…», «Тест…» и ещё 3». */
function summary(prev: AcademyData, next: AcademyData): string {
  const was = new Map(allItems(prev).map((i) => [i.id, i]));
  const now = new Map(allItems(next).map((i) => [i.id, i]));
  const ch: string[] = [];
  for (const [id, it] of now) if (!was.has(id)) ch.push(`+«${it.t}»`);
  for (const [id, it] of was) if (!now.has(id)) ch.push(`−«${it.t}»`);
  for (const [id, it] of now) if (was.has(id) && !same(was.get(id), it)) ch.push(`«${it.t}»`);
  if (!same(prev.ST_AUTO, next.ST_AUTO)) ch.push("статусы");
  if (!same(prev.OBJ, next.OBJ)) ch.push("возражения");
  if (!same(prev.GLOSS, next.GLOSS)) ch.push("глоссарий");
  const modsChanged = (p: Part) => !same(prev[p].modules.map((m) => [m.t, m.d, m.items.map((i) => i.id)]), next[p].modules.map((m) => [m.t, m.d, m.items.map((i) => i.id)]));
  if (modsChanged("course") || modsChanged("pay")) ch.push("порядок и модули");
  if (!ch.length) return "Обучение — опубликовано без изменений";
  return `Обучение — изменено: ${ch.slice(0, 3).join(", ")}${ch.length > 3 ? ` и ещё ${ch.length - 3}` : ""}`;
}

/** Перед публикацией: пустые пункты списков и реплики диалогов убираем. */
function tidy(d: AcademyData): AcademyData {
  const out = clone(d);
  for (const it of allItems(out)) {
    if (!it.b) continue;
    it.b = it.b.map((b) =>
      "ul" in b ? { ul: cleanLines(b.ul) } : "ol" in b ? { ol: cleanLines(b.ol) } : "ck" in b ? { ck: { ...b.ck, items: cleanLines(b.ck.items) } } : "d" in b ? { d: b.d.filter((x) => x[1].trim()) } : b,
    );
  }
  return out;
}

/* ── поля ─────────────────────────────────────────────────────────── */

/** Многострочное поле, которое растёт по тексту. */
function Area({ value, onChange, placeholder, rows = 2, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} className={`inp ae-area${mono ? " mono" : ""}`} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Txt({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder?: string; style?: CSSProperties }) {
  return <input className="inp" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={style} />;
}

function IconBtn({ icon, title, onClick, disabled, danger }: { icon: IconName; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`btn btn-sm btn-icon ae-ib${danger ? " danger" : ""}${icon === "chevL" || icon === "chevR" ? " vert" : ""}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={13} />
    </button>
  );
}

/** Строки «по одной на строку» ↔ массив. Пустые строки в середине сохраняются, пока печатают. */
const linesOf = (a: string[]) => a.join("\n");
const toLines = (s: string) => s.split("\n");
const cleanLines = (a: string[]) => a.map((x) => x.trim()).filter(Boolean);

/* ── блок урока ───────────────────────────────────────────────────── */

function BlockEditor({ b, onChange }: { b: Block; onChange: (b: Block) => void }) {
  const t = blockType(b);
  if ("p" in b)
    return (
      <>
        <Area value={b.p} onChange={(v) => onChange({ ...b, p: v })} placeholder="Текст абзаца" rows={3} />
        <label className="ae-check">
          <input type="checkbox" checked={!!b.first} onChange={(e) => onChange(e.target.checked ? { ...b, first: 1 } : { p: b.p })} />
          Вводный абзац — крупнее, в начале урока
        </label>
      </>
    );
  if ("h" in b) return <Txt value={b.h} onChange={(v) => onChange({ h: v })} placeholder="Заголовок. В скрипте каждый заголовок — новый шаг" />;
  if ("ul" in b || "ol" in b) {
    const items = "ul" in b ? b.ul : b.ol;
    return (
      <>
        <Area value={linesOf(items)} onChange={(v) => onChange("ul" in b ? { ul: toLines(v) } : { ol: toLines(v) })} placeholder="Каждый пункт — с новой строки" rows={3} />
        <label className="ae-check">
          <input type="checkbox" checked={t === "ol"} onChange={(e) => onChange(e.target.checked ? { ol: items } : { ul: items })} />
          Нумерованный (по порядку)
        </label>
      </>
    );
  }
  if ("n" in b)
    return (
      <div className="ae-grid">
        <div className="ae-row">
          <div className="seg ae-seg">
            {(Object.keys(NOTE_LABEL) as NoteKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={b.n.k === k} onClick={() => onChange({ n: { ...b.n, k } })}>
                <span className={`ae-dot ${k}`} />
                {NOTE_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <Txt value={b.n.t} onChange={(v) => onChange({ n: { ...b.n, t: v } })} placeholder="Заголовок плашки (можно пусто)" />
        <Area value={b.n.b} onChange={(v) => onChange({ n: { ...b.n, b: v } })} placeholder="Текст плашки" />
      </div>
    );
  if ("s" in b)
    return (
      <div className="ae-grid">
        <div className="ae-row">
          <Txt value={b.s.l} onChange={(v) => onChange({ s: { ...b.s, l: v } })} placeholder="Подпись: «Говорим клиенту», «Если клиент из региона»" style={{ flex: 1 }} />
          <Txt value={b.s.t ?? ""} onChange={(v) => onChange({ s: v ? { ...b.s, t: v } : { l: b.s.l, b: b.s.b } })} placeholder="Время, «10 сек»" style={{ width: 120 }} />
        </div>
        <Area value={b.s.b} onChange={(v) => onChange({ s: { ...b.s, b: v } })} placeholder="Что говорим дословно" rows={2} />
      </div>
    );
  if ("d" in b)
    return (
      <div className="ae-grid">
        {b.d.map(([who, line], i) => (
          <div key={i} className="ae-row">
            <div className="seg ae-seg">
              <button type="button" aria-pressed={who !== "op"} onClick={() => onChange({ d: b.d.map((x, k) => (k === i ? ["cl", x[1]] : x)) })}>
                Клиент
              </button>
              <button type="button" aria-pressed={who === "op"} onClick={() => onChange({ d: b.d.map((x, k) => (k === i ? ["op", x[1]] : x)) })}>
                Оператор
              </button>
            </div>
            <Txt value={line} onChange={(v) => onChange({ d: b.d.map((x, k) => (k === i ? [x[0], v] : x)) })} placeholder="Реплика" style={{ flex: 1 }} />
            <IconBtn icon="close" title="Убрать реплику" onClick={() => onChange({ d: b.d.filter((_, k) => k !== i) })} disabled={b.d.length < 2} />
          </div>
        ))}
        <div>
          <button type="button" className="btn btn-sm" onClick={() => onChange({ d: [...b.d, [b.d[b.d.length - 1]?.[0] === "op" ? "cl" : "op", ""]] })}>
            <Icon name="plus" size={13} /> Реплика
          </button>
        </div>
      </div>
    );
  if ("ck" in b)
    return <Area value={linesOf(b.ck.items)} onChange={(v) => onChange({ ck: { ...b.ck, items: toLines(v) } })} placeholder="Каждый пункт чек-листа — с новой строки" rows={4} />;
  if ("tb" in b) {
    const { h, r } = b.tb;
    const set = (nh: string[], nr: string[][]) => onChange({ tb: { h: nh, r: nr } });
    return (
      <div className="ae-tb">
        <div className="ae-tb-scroll">
          <table>
            <thead>
              <tr>
                {h.map((x, ci) => (
                  <th key={ci}>
                    <div className="ae-row">
                      <input className="inp inp-sm" value={x} placeholder={`Колонка ${ci + 1}`} onChange={(e) => set(h.map((y, k) => (k === ci ? e.target.value : y)), r)} />
                      <IconBtn icon="close" title="Убрать колонку" disabled={h.length < 2} onClick={() => set(h.filter((_, k) => k !== ci), r.map((row) => row.filter((_, k) => k !== ci)))} />
                    </div>
                  </th>
                ))}
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {r.map((row, ri) => (
                <tr key={ri}>
                  {h.map((_, ci) => (
                    <td key={ci}>
                      <Area value={row[ci] ?? ""} onChange={(v) => set(h, r.map((rr, k) => (k === ri ? h.map((__, c) => (c === ci ? v : rr[c] ?? "")) : rr)))} rows={1} />
                    </td>
                  ))}
                  <td>
                    <IconBtn icon="close" title="Убрать строку" onClick={() => set(h, r.filter((_, k) => k !== ri))} disabled={r.length < 2} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ae-row">
          <button type="button" className="btn btn-sm" onClick={() => set(h, [...r, h.map(() => "")])}>
            <Icon name="plus" size={13} /> Строка
          </button>
          <button type="button" className="btn btn-sm" onClick={() => set([...h, ""], r.map((row) => [...row, ""]))}>
            <Icon name="plus" size={13} /> Колонка
          </button>
        </div>
      </div>
    );
  }
  return null;
}

/** «+ блок»: выбор типа. */
function AddBlock({ onAdd, label = "Добавить блок", compact }: { onAdd: (t: BlockType) => void; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ae-add${compact ? " compact" : ""}`}>
      {open ? (
        <div className="ae-add-menu">
          {BLOCK_TYPES.map((x) => (
            <button
              key={x.t}
              type="button"
              className="ae-add-opt"
              onClick={() => {
                onAdd(x.t);
                setOpen(false);
              }}
              title={x.hint}
            >
              <Icon name={x.i} size={14} />
              <span>
                <b>{x.l}</b>
                <small>{x.hint}</small>
              </span>
            </button>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button type="button" className={compact ? "ae-add-line" : "btn btn-sm"} onClick={() => setOpen(true)} title="Вставить блок">
          <Icon name="plus" size={13} /> {label}
        </button>
      )}
    </div>
  );
}

/** Предпросмотр блока — та же разметка, что у страницы обучения (стили .acad). */
function BlockView({ b }: { b: Block }) {
  if ("p" in b) return <p className={b.first ? "lead" : undefined}>{b.p}</p>;
  if ("h" in b) return <h2>{b.h}</h2>;
  if ("ul" in b) return <ul>{cleanLines(b.ul).map((x, i) => <li key={i}>{x}</li>)}</ul>;
  if ("ol" in b) return <ol>{cleanLines(b.ol).map((x, i) => <li key={i}>{x}</li>)}</ol>;
  if ("n" in b) {
    const cls = { tip: "tip", warn: "amber", err: "err", ok: "ok" }[b.n.k] ?? "";
    return (
      <div className={`note-line ${cls}`}>
        <Icon name={b.n.k === "ok" ? "check" : b.n.k === "tip" ? "info" : "alert"} size={15} />
        <div>
          {b.n.t && <span className="nt">{b.n.t}</span>}
          {b.n.b}
        </div>
      </div>
    );
  }
  if ("tb" in b)
    return (
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>{b.tb.h.map((x, i) => <th key={i}>{x}</th>)}</tr>
          </thead>
          <tbody>
            {b.tb.r.map((r, i) => (
              <tr key={i}>{r.map((x, k) => <td key={k}>{x}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if ("s" in b)
    return (
      <div className="say">
        <div className="sh">
          <Icon name="chat" size={14} />
          {b.s.l || "Говорим клиенту"}
          {b.s.t && <span className="tm">{b.s.t}</span>}
        </div>
        <div className="sb">{b.s.b}</div>
      </div>
    );
  if ("d" in b)
    return (
      <div className="say">
        <div className="sh">
          <Icon name="chat" size={14} />
          Пример диалога
        </div>
        <div className="dlg">
          {b.d.map(([w, x], i) => (
            <Fragment key={i}>
              <span className={`who ${w === "op" ? "op" : ""}`}>{w === "op" ? "Оператор" : "Клиент"}</span>
              <span>«{x}»</span>
            </Fragment>
          ))}
        </div>
      </div>
    );
  if ("ck" in b)
    return (
      <div className="cklist">
        {cleanLines(b.ck.items).map((x, i) => (
          <div key={i} className="ckrow">
            <span className="bx" />
            <span className="tx">{x}</span>
          </div>
        ))}
      </div>
    );
  return null;
}

/* ── тест ─────────────────────────────────────────────────────────── */

function QuizEditor({ quiz, onChange }: { quiz: QuizQ[]; onChange: (q: QuizQ[]) => void }) {
  const setQ = (i: number, q: QuizQ) => onChange(quiz.map((x, k) => (k === i ? q : x)));
  return (
    <div className="ae-stack">
      {quiz.map((q, i) => (
        <div key={i} className="ae-block">
          <div className="ae-block-h">
            <span className="ae-block-t">
              <Icon name="test" size={13} /> Вопрос {i + 1}
            </span>
            <span className="ae-tools">
              <IconBtn icon="chevL" title="Выше" onClick={() => onChange(move(quiz, i, -1))} disabled={i === 0} />
              <IconBtn icon="chevR" title="Ниже" onClick={() => onChange(move(quiz, i, 1))} disabled={i === quiz.length - 1} />
              <IconBtn icon="copy" title="Дублировать" onClick={() => onChange([...quiz.slice(0, i + 1), clone(q), ...quiz.slice(i + 1)])} />
              <IconBtn icon="trash" title="Удалить вопрос" danger onClick={() => onChange(quiz.filter((_, k) => k !== i))} />
            </span>
          </div>
          <div className="ae-grid">
            <Area value={q.q} onChange={(v) => setQ(i, { ...q, q: v })} placeholder="Вопрос или ситуация из звонка" />
            <div className="ae-opts">
              {q.o.map((o, j) => (
                <div key={j} className={`ae-opt${q.a === j ? " right" : ""}`}>
                  <button type="button" className="ae-opt-k" title={q.a === j ? "Правильный ответ" : "Сделать правильным"} onClick={() => setQ(i, { ...q, a: j })}>
                    {q.a === j ? <Icon name="check" size={13} stroke={2.6} /> : LETTERS[j]}
                  </button>
                  <Txt value={o} onChange={(v) => setQ(i, { ...q, o: q.o.map((x, k) => (k === j ? v : x)) })} placeholder={`Вариант ${LETTERS[j]}`} style={{ flex: 1 }} />
                  <IconBtn
                    icon="close"
                    title="Убрать вариант"
                    disabled={q.o.length < 3}
                    onClick={() => setQ(i, { ...q, o: q.o.filter((_, k) => k !== j), a: q.a === j ? 0 : q.a > j ? q.a - 1 : q.a })}
                  />
                </div>
              ))}
              {q.o.length < LETTERS.length && (
                <div>
                  <button type="button" className="btn btn-sm" onClick={() => setQ(i, { ...q, o: [...q.o, ""] })}>
                    <Icon name="plus" size={13} /> Вариант
                  </button>
                  <span className="ae-muted" style={{ marginLeft: 10 }}>
                    Правильный — отмечен галочкой, нажмите на букву, чтобы выбрать другой
                  </span>
                </div>
              )}
            </div>
            <Area value={q.w ?? ""} onChange={(v) => setQ(i, { ...q, w: v })} placeholder="Разбор: почему так — оператор увидит после проверки" />
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-sm" onClick={() => onChange([...quiz, newQuestion()])}>
          <Icon name="plus" size={13} /> Вопрос
        </button>
      </div>
    </div>
  );
}

/* ── редактор ─────────────────────────────────────────────────────── */

export function AcadEditor() {
  const { data, saveAcademy, confirm, toast } = useCrm();
  const doc = data.academy ?? null;
  const live = useMemo(() => academyData(doc), [doc]);
  const [draft, setDraftState] = useState<AcademyData>(() => clone(live));
  const [sel, setSel] = useState<Sel>({ t: "home" });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [treeQ, setTreeQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = !same(draft, live);
  const isDefault = same(live, DEFAULT_ACADEMY);

  // черновик в браузере: не потерять работу при перезагрузке; привязан к опубликованной версии
  const baseStamp = doc?.updatedAt ?? "default";
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { base: string; data: unknown };
      if (saved.base === baseStamp && isAcademyData(saved.data) && !same(saved.data, live)) {
        setDraftState(saved.data);
        setRestored(true);
      }
    } catch {
      /* нет хранилища — без черновика */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // опубликовали в другой вкладке — без своих правок просто подтягиваем
  const lastLive = useRef(live);
  useEffect(() => {
    setDraftState((d) => (same(d, lastLive.current) ? clone(live) : d));
    lastLive.current = live;
  }, [live]);
  useEffect(() => {
    try {
      if (dirty) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: baseStamp, data: draft }));
      else window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* нет хранилища */
    }
  }, [draft, dirty, baseStamp]);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  // из обучения: /learn/edit#item=a31 или #ref=st
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, "");
    const [k, v] = h.split("=");
    if (k === "item" && v && locate(draft, decodeURIComponent(v))) setSel({ t: "item", id: decodeURIComponent(v) });
    if (k === "ref" && (v === "st" || v === "obj" || v === "gloss")) setSel({ t: "ref", ref: v });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDraft = (fn: (d: AcademyData) => AcademyData) => setDraftState((d) => fn(clone(d)));
  const errs = useMemo(() => problems(draft), [draft]);

  const publish = async () => {
    if (errs.length) {
      toast(`Сначала исправьте: ${errs[0]}`, "err");
      return;
    }
    setBusy(true);
    const next = tidy(draft);
    const ok = await saveAcademy(same(next, DEFAULT_ACADEMY) ? null : next, summary(live, next));
    setBusy(false);
    if (ok) {
      setDraftState(next);
      setRestored(false);
      toast("Опубликовано — операторы видят новое обучение", "ok");
    }
  };
  const discard = async () => {
    if (!(await confirm({ title: "Отменить все правки?", text: "Черновик вернётся к тому, что сейчас видят операторы.", ok: "Отменить правки", danger: true }))) return;
    setDraftState(clone(live));
    setRestored(false);
  };
  const resetDefault = async () => {
    if (
      !(await confirm({
        title: "Вернуть исходное обучение?",
        text: "Все правки РОПа пропадут, у всех будет вариант из поставки CRM. Прогресс операторов сохранится.",
        ok: "Вернуть исходное",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const ok = await saveAcademy(null, "Обучение — возвращено исходное содержимое");
    setBusy(false);
    if (ok) {
      setDraftState(clone(DEFAULT_ACADEMY));
      setSel({ t: "home" });
      toast("Вернули исходное обучение", "ok");
    }
  };
  const exportJson = () => downloadText(`obuchenie-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(draft, null, 2), "application/json");
  const importJson = async (f: File) => {
    try {
      const d = JSON.parse(await f.text()) as unknown;
      if (!isAcademyData(d)) throw new Error("не тот файл");
      setDraftState(d);
      setSel({ t: "home" });
      toast("Загружено в черновик — проверьте и опубликуйте", "ok");
    } catch (e) {
      toast(`Не удалось загрузить: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  };

  /* ── действия над структурой ── */
  const updItem = (id: string, fn: (it: AcadItemDoc) => AcadItemDoc) =>
    setDraft((d) => {
      const l = locate(d, id);
      if (l) d[l.part].modules[l.mi].items[l.ii] = fn(l.it);
      return d;
    });
  const addItem = (part: Part, mi: number, kind: "Урок" | "Тест") => {
    const id = newItemId(draft);
    const it: AcadItemDoc =
      kind === "Тест"
        ? { id, t: "Новый тест", k: "Тест", m: "5 мин", quiz: [newQuestion()] }
        : { id, t: "Новый урок", k: "Урок", m: "5 мин", b: [{ p: "", first: 1 }] };
    setDraft((d) => {
      d[part].modules[mi].items.push(it);
      return d;
    });
    setSel({ t: "item", id });
    setPreview(false);
  };
  const delItem = async (id: string) => {
    const l = locate(draft, id);
    if (!l) return;
    if (!(await confirm({ title: `Удалить «${l.it.t}»?`, text: "Материал пропадёт у всех после публикации. Отметки операторов по нему перестанут учитываться.", ok: "Удалить", danger: true }))) return;
    setDraft((d) => {
      const m = locate(d, id);
      if (m) d[m.part].modules[m.mi].items.splice(m.ii, 1);
      return d;
    });
    setSel({ t: "module", part: l.part, mi: l.mi });
  };
  const dupItem = (id: string) => {
    const l = locate(draft, id);
    if (!l) return;
    const nid = newItemId(draft);
    setDraft((d) => {
      d[l.part].modules[l.mi].items.splice(l.ii + 1, 0, { ...clone(l.it), id: nid, t: `${l.it.t} (копия)`, final: undefined });
      return d;
    });
    setSel({ t: "item", id: nid });
  };
  const moveItem = (id: string, dir: -1 | 1) =>
    setDraft((d) => {
      const l = locate(d, id);
      if (!l) return d;
      const mods = d[l.part].modules;
      const items = mods[l.mi].items;
      const j = l.ii + dir;
      if (j >= 0 && j < items.length) mods[l.mi].items = move(items, l.ii, dir);
      else if (mods[l.mi + dir]) {
        // за край модуля — в соседний модуль
        items.splice(l.ii, 1);
        if (dir < 0) mods[l.mi - 1].items.push(l.it);
        else mods[l.mi + 1].items.unshift(l.it);
      }
      return d;
    });
  const moveItemTo = (id: string, key: string) =>
    setDraft((d) => {
      const l = locate(d, id);
      const [part, mi] = key.split(":") as [Part, string];
      if (!l || !d[part]?.modules[+mi]) return d;
      d[l.part].modules[l.mi].items.splice(l.ii, 1);
      d[part].modules[+mi].items.push(l.it);
      return d;
    });
  const addModule = (part: Part) => {
    setDraft((d) => {
      d[part].modules.push({ t: "Новый модуль", d: "", items: [] });
      return d;
    });
    setSel({ t: "module", part, mi: draft[part].modules.length });
  };
  const delModule = async (part: Part, mi: number) => {
    const m = draft[part].modules[mi];
    if (!(await confirm({ title: `Удалить модуль «${m.t}»?`, text: m.items.length ? `Вместе с ним удалятся ${m.items.length} материалов.` : "Модуль пустой.", ok: "Удалить", danger: true }))) return;
    setDraft((d) => {
      d[part].modules.splice(mi, 1);
      return d;
    });
    setSel({ t: "home" });
  };

  /* ── дерево ── */
  const q = treeQ.trim().toLowerCase();
  const match = (it: AcadItemDoc) => !q || it.t.toLowerCase().includes(q) || JSON.stringify(it.b ?? it.quiz ?? "").toLowerCase().includes(q);
  const changedIds = useMemo(() => {
    const was = new Map(allItems(live).map((i) => [i.id, i]));
    return new Set(allItems(draft).filter((i) => !same(was.get(i.id), i)).map((i) => i.id));
  }, [draft, live]);

  const tree = (part: Part, title: string, note?: string) => (
    <div className="ae-tree-g">
      <div className="ae-tree-gh">
        <span>{title}</span>
        <button type="button" className="ae-tree-add" onClick={() => addModule(part)} title="Добавить модуль">
          <Icon name="plus" size={12} /> модуль
        </button>
      </div>
      {draft[part].modules.map((m, mi) => {
        const items = m.items.filter(match);
        if (q && !items.length && !m.t.toLowerCase().includes(q)) return null;
        return (
          <div key={mi} className="ae-tree-m">
            <button type="button" className="ae-tree-row mod" aria-current={sel.t === "module" && sel.part === part && sel.mi === mi ? "true" : undefined} onClick={() => setSel({ t: "module", part, mi })}>
              <span className="ae-tree-n">{part === "course" ? mi + 1 : <Icon name="folder" size={12} />}</span>
              <span className="ae-tree-l">{m.t || "Без названия"}</span>
            </button>
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="ae-tree-row"
                aria-current={sel.t === "item" && sel.id === it.id ? "true" : undefined}
                onClick={() => {
                  setSel({ t: "item", id: it.id });
                }}
                title={it.t}
              >
                <Icon name={KIND_IC[it.k] ?? "doc"} size={13} />
                <span className="ae-tree-l">{it.t || "Без названия"}</span>
                {changedIds.has(it.id) && <span className="ae-dot-ch" title="Изменено, ещё не опубликовано" />}
              </button>
            ))}
          </div>
        );
      })}
      {note && <div className="ae-tree-note">{note}</div>}
    </div>
  );

  const refRow = (ref: RefKind, label: string, n: number, icon: IconName) => (
    <button type="button" className="ae-tree-row" aria-current={sel.t === "ref" && sel.ref === ref ? "true" : undefined} onClick={() => setSel({ t: "ref", ref })}>
      <Icon name={icon} size={13} />
      <span className="ae-tree-l">{label}</span>
      <span className="ae-tree-c">{n}</span>
    </button>
  );

  /* ── правая часть ── */
  let main: ReactNode = null;
  if (sel.t === "home") {
    const mats = allItems(draft);
    main = (
      <div className="card ae-card">
        <h2 className="ae-h">Как пользоваться</h2>
        <ol className="ae-howto">
          <li>Слева выберите модуль, материал или справочник. Сверху — поиск по названию и тексту.</li>
          <li>Меняйте текст, добавляйте и удаляйте блоки, вопросы тестов, двигайте материалы стрелками. «Как увидит оператор» — предпросмотр.</li>
          <li>
            Всё копится в черновике и сохраняется в этом браузере. Операторы увидят правки после <b>«Опубликовать»</b>.
          </li>
          <li>Прогресс операторов не теряется: пройденные материалы остаются пройденными, новые добавятся в конец их пути.</li>
        </ol>
        <div className="ae-stats">
          <div>
            <b>{draft.course.modules.length}</b>
            <span>модулей в курсе</span>
          </div>
          <div>
            <b>{mats.length}</b>
            <span>материалов</span>
          </div>
          <div>
            <b>{mats.filter((i) => i.quiz).length}</b>
            <span>тестов</span>
          </div>
          <div>
            <b>{draft.ST_AUTO.length + draft.OBJ.length + draft.GLOSS.length}</b>
            <span>строк в справочниках</span>
          </div>
        </div>
        <div className="note-line tip" style={{ marginTop: 14 }}>
          <Icon name="info" size={15} />
          <div>
            Тренажёр Скорозвона (5 глав «Практики») и разделы CRM «Марки авто» и «Карта городов» здесь не правятся: марки и города проекта — в «Проектах» и правилах «Марок авто».
          </div>
        </div>
      </div>
    );
  } else if (sel.t === "module") {
    const m: AcadModuleDoc | undefined = draft[sel.part].modules[sel.mi];
    if (m) {
      const setM = (fn: (m: AcadModuleDoc) => AcadModuleDoc) =>
        setDraft((d) => {
          d[sel.part].modules[sel.mi] = fn(d[sel.part].modules[sel.mi]);
          return d;
        });
      const n = draft[sel.part].modules.length;
      main = (
        <div className="card ae-card">
          <div className="ae-card-h">
            <div className="ae-eyebrow">{sel.part === "course" ? `Курс «Авто» · модуль ${sel.mi + 1}` : "Оплата и стажировка"}</div>
            <span className="ae-tools">
              <IconBtn icon="chevL" title="Модуль выше" disabled={sel.mi === 0} onClick={() => { setDraft((d) => { d[sel.part].modules = move(d[sel.part].modules, sel.mi, -1); return d; }); setSel({ ...sel, mi: sel.mi - 1 }); }} />
              <IconBtn icon="chevR" title="Модуль ниже" disabled={sel.mi === n - 1} onClick={() => { setDraft((d) => { d[sel.part].modules = move(d[sel.part].modules, sel.mi, 1); return d; }); setSel({ ...sel, mi: sel.mi + 1 }); }} />
              <IconBtn icon="trash" title="Удалить модуль" danger onClick={() => void delModule(sel.part, sel.mi)} />
            </span>
          </div>
          <div className="ae-grid">
            <label className="field">
              <span className="field-label">Название модуля</span>
              <Txt value={m.t} onChange={(v) => setM((x) => ({ ...x, t: v }))} />
            </label>
            {sel.part === "course" && (
              <label className="field">
                <span className="field-label">Описание на карте курса</span>
                <Area value={m.d ?? ""} onChange={(v) => setM((x) => ({ ...x, d: v }))} placeholder="Одной фразой: что оператор узнает в модуле" />
              </label>
            )}
          </div>
          <div className="ae-sub">Материалы · {m.items.length}</div>
          <div className="ae-list">
            {m.items.map((it, i) => (
              <div key={it.id} className="ae-li">
                <span className="ae-li-n">{i + 1}</span>
                <button type="button" className="ae-li-t" onClick={() => setSel({ t: "item", id: it.id })}>
                  <b>{it.t || "Без названия"}</b>
                  <Chip hue={KIND_HUE[it.k] ?? "gray"}>{it.k}</Chip>
                  <span className="ae-muted">{it.m}</span>
                </button>
                <span className="ae-tools">
                  <IconBtn icon="chevL" title="Выше" disabled={i === 0} onClick={() => moveItem(it.id, -1)} />
                  <IconBtn icon="chevR" title="Ниже" disabled={i === m.items.length - 1} onClick={() => moveItem(it.id, 1)} />
                  <IconBtn icon="trash" title="Удалить" danger onClick={() => void delItem(it.id)} />
                </span>
              </div>
            ))}
            {!m.items.length && <div className="ae-muted" style={{ padding: "8px 2px" }}>Пока пусто — добавьте урок или тест.</div>}
          </div>
          <div className="ae-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={() => addItem(sel.part, sel.mi, "Урок")}>
              <Icon name="plus" size={13} /> Урок
            </button>
            <button type="button" className="btn btn-sm" onClick={() => addItem(sel.part, sel.mi, "Тест")}>
              <Icon name="plus" size={13} /> Тест
            </button>
          </div>
        </div>
      );
    }
  } else if (sel.t === "item") {
    const l = locate(draft, sel.id);
    if (l) {
      const it = l.it;
      const set = (fn: (it: AcadItemDoc) => AcadItemDoc) => updItem(it.id, fn);
      const blocks = it.b ?? [];
      const setBlocks = (b: Block[]) => set((x) => ({ ...x, b }));
      const wl = it.w ? WIDGET_LABEL[it.w] : null;
      const modOpts = (["course", "pay"] as Part[]).flatMap((part) =>
        draft[part].modules.map((m, mi) => ({ value: `${part}:${mi}`, label: m.t || `Модуль ${mi + 1}`, group: part === "course" ? "Курс «Авто»" : "Оплата и стажировка" })),
      );
      const href = l.part === "course" ? `/learn#/item/${it.id}` : `/learn#/read/${it.id}`;
      main = (
        <div className="card ae-card">
          <div className="ae-card-h">
            <div className="ae-eyebrow">
              {l.part === "course" ? `Модуль ${l.mi + 1}. ${draft.course.modules[l.mi].t}` : draft.pay.modules[l.mi].t} · материал {l.ii + 1}
            </div>
            <span className="ae-tools">
              <IconBtn icon="chevL" title="Выше (за край — в соседний модуль)" onClick={() => moveItem(it.id, -1)} disabled={l.mi === 0 && l.ii === 0} />
              <IconBtn icon="chevR" title="Ниже (за край — в соседний модуль)" onClick={() => moveItem(it.id, 1)} disabled={l.mi === draft[l.part].modules.length - 1 && l.ii === draft[l.part].modules[l.mi].items.length - 1} />
              <IconBtn icon="copy" title="Дублировать" onClick={() => dupItem(it.id)} />
              <IconBtn icon="trash" title="Удалить материал" danger onClick={() => void delItem(it.id)} />
            </span>
          </div>
          <div className="ae-grid">
            <label className="field">
              <span className="field-label">Название</span>
              <Txt value={it.t} onChange={(v) => set((x) => ({ ...x, t: v }))} />
            </label>
            <div className="ae-row ae-row-wrap">
              <label className="field" style={{ width: 170 }}>
                <span className="field-label">Тип</span>
                <Select value={it.k} options={KINDS.map((k) => ({ value: k, label: k }))} onChange={(k) => set((x) => ({ ...x, k }))} />
              </label>
              <label className="field" style={{ width: 120 }}>
                <span className="field-label">Сколько времени</span>
                <Txt value={it.m} onChange={(v) => set((x) => ({ ...x, m: v }))} placeholder="5 мин" />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 200 }}>
                <span className="field-label">Модуль</span>
                <Select value={`${l.part}:${l.mi}`} options={modOpts} onChange={(v) => moveItemTo(it.id, v)} />
              </label>
            </div>
            {it.final ? (
              <div className="note-line amber">
                <Icon name="star" size={15} />
                <div>Итоговая аттестация: после неё у оператора открывается практика в Скорозвоне.</div>
              </div>
            ) : null}
            {wl && (
              <div className="note-line tip">
                <Icon name="info" size={15} />
                <div>
                  Под текстом встроен {wl.t}.{" "}
                  {wl.ref && (
                    <button type="button" className="ae-link" onClick={() => setSel({ t: "ref", ref: wl.ref! })}>
                      Править его строки
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="ae-sub ae-row" style={{ justifyContent: "space-between" }}>
            <span>{it.quiz ? `Вопросы · ${it.quiz.length}` : `Содержание · ${blocks.length} блоков`}</span>
            <span className="ae-row">
              {!it.quiz && (
                <div className="seg ae-seg">
                  <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
                    <Icon name="edit" size={13} /> Правка
                  </button>
                  <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
                    <Icon name="user" size={13} /> Как увидит оператор
                  </button>
                </div>
              )}
              {!dirty && (
                <Link className="btn btn-sm" href={href} title="Открыть материал в обучении">
                  <Icon name="external" size={13} /> В обучении
                </Link>
              )}
            </span>
          </div>

          {it.quiz ? (
            <QuizEditor quiz={it.quiz} onChange={(quiz) => set((x) => ({ ...x, quiz }))} />
          ) : preview ? (
            <div className="acad ae-preview">
              <div className="card doc">{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
            </div>
          ) : (
            <div className="ae-stack">
              {blocks.map((b, i) => {
                const bt = BLOCK_TYPES.find((x) => x.t === blockType(b));
                return (
                  <Fragment key={i}>
                    <div className={`ae-block t-${blockType(b)}`}>
                      <div className="ae-block-h">
                        <span className="ae-block-t">
                          <Icon name={bt?.i ?? "doc"} size={13} /> {bt?.l ?? "Блок"}
                        </span>
                        <span className="ae-tools">
                          <IconBtn icon="chevL" title="Выше" onClick={() => setBlocks(move(blocks, i, -1))} disabled={i === 0} />
                          <IconBtn icon="chevR" title="Ниже" onClick={() => setBlocks(move(blocks, i, 1))} disabled={i === blocks.length - 1} />
                          <IconBtn icon="copy" title="Дублировать" onClick={() => setBlocks([...blocks.slice(0, i + 1), clone(b), ...blocks.slice(i + 1)])} />
                          <IconBtn icon="trash" title="Удалить блок" danger onClick={() => setBlocks(blocks.filter((_, k) => k !== i))} />
                        </span>
                      </div>
                      <BlockEditor b={b} onChange={(nb) => setBlocks(blocks.map((x, k) => (k === i ? nb : x)))} />
                    </div>
                    {i < blocks.length - 1 && <AddBlock compact label="вставить сюда" onAdd={(t) => setBlocks([...blocks.slice(0, i + 1), newBlock(t), ...blocks.slice(i + 1)])} />}
                  </Fragment>
                );
              })}
              <AddBlock onAdd={(t) => setBlocks([...blocks, newBlock(t)])} />
            </div>
          )}
        </div>
      );
    }
  } else if (sel.t === "ref") {
    if (sel.ref === "st") {
      const rows = draft.ST_AUTO;
      const setRows = (r: typeof rows) => setDraft((d) => ({ ...d, ST_AUTO: r }));
      main = (
        <div className="card ae-card">
          <div className="ae-card-h">
            <div>
              <h2 className="ae-h">Статусы Скорозвона</h2>
              <div className="ae-muted">Справочник «Статусы», тренажёр статусов и результаты в тренажёре Скорозвона.</div>
            </div>
          </div>
          <div className="ae-stack">
            {rows.map((r, i) => (
              <div key={i} className="ae-block">
                <div className="ae-row ae-row-wrap">
                  <Select value={r.g} options={STATUS_GROUPS.map((g) => ({ value: g, label: g }))} onChange={(g) => setRows(rows.map((x, k) => (k === i ? { ...x, g } : x)))} width={170} />
                  <Txt value={r.n} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, n: v } : x)))} placeholder="Название, как в Скорозвоне" style={{ flex: 1, minWidth: 180 }} />
                  <span className="ae-tools">
                    <IconBtn icon="chevL" title="Выше" onClick={() => setRows(move(rows, i, -1))} disabled={i === 0} />
                    <IconBtn icon="chevR" title="Ниже" onClick={() => setRows(move(rows, i, 1))} disabled={i === rows.length - 1} />
                    <IconBtn icon="trash" title="Удалить" danger onClick={() => setRows(rows.filter((_, k) => k !== i))} />
                  </span>
                </div>
                <Area value={r.d} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, d: v } : x)))} placeholder="Когда ставим" />
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { g: "Промежуточные", n: "", d: "" }])}>
                <Icon name="plus" size={13} /> Статус
              </button>
            </div>
          </div>
        </div>
      );
    } else if (sel.ref === "obj") {
      const rows = draft.OBJ;
      const setRows = (r: typeof rows) => setDraft((d) => ({ ...d, OBJ: r }));
      main = (
        <div className="card ae-card">
          <div className="ae-card-h">
            <div>
              <h2 className="ae-h">Возражения</h2>
              <div className="ae-muted">Справочник «Возражения» и карточки тренажёра возражений. Ответ заканчивайте вопросом по скрипту.</div>
            </div>
          </div>
          <div className="ae-stack">
            {rows.map((r, i) => (
              <div key={i} className="ae-block">
                <div className="ae-row">
                  <Txt value={r.q} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, q: v } : x)))} placeholder="Что говорит клиент: «Откуда номер?»" style={{ flex: 1 }} />
                  <span className="ae-tools">
                    <IconBtn icon="chevL" title="Выше" onClick={() => setRows(move(rows, i, -1))} disabled={i === 0} />
                    <IconBtn icon="chevR" title="Ниже" onClick={() => setRows(move(rows, i, 1))} disabled={i === rows.length - 1} />
                    <IconBtn icon="trash" title="Удалить" danger onClick={() => setRows(rows.filter((_, k) => k !== i))} />
                  </span>
                </div>
                <Area value={r.a} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, a: v } : x)))} placeholder="Что отвечаем" rows={2} />
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { t: "auto", q: "", a: "" }])}>
                <Icon name="plus" size={13} /> Возражение
              </button>
            </div>
          </div>
        </div>
      );
    } else {
      const rows = draft.GLOSS;
      const setRows = (r: typeof rows) => setDraft((d) => ({ ...d, GLOSS: r }));
      main = (
        <div className="card ae-card">
          <div className="ae-card-h">
            <div>
              <h2 className="ae-h">Глоссарий</h2>
              <div className="ae-muted">Слова по автотеме и внутренние термины — раздел «Глоссарий» и поиск в обучении.</div>
            </div>
          </div>
          <div className="ae-stack">
            {rows.map((r, i) => (
              <div key={i} className="ae-block">
                <div className="ae-row ae-row-wrap">
                  <Txt value={r.t} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, t: v } : x)))} placeholder="Термин" style={{ flex: 1, minWidth: 180 }} />
                  <Select
                    value={r.g === "int" ? "int" : "auto"}
                    options={[
                      { value: "auto", label: "Авто" },
                      { value: "int", label: "Внутреннее" },
                    ]}
                    onChange={(g) => setRows(rows.map((x, k) => (k === i ? { ...x, g } : x)))}
                    width={150}
                  />
                  <span className="ae-tools">
                    <IconBtn icon="chevL" title="Выше" onClick={() => setRows(move(rows, i, -1))} disabled={i === 0} />
                    <IconBtn icon="chevR" title="Ниже" onClick={() => setRows(move(rows, i, 1))} disabled={i === rows.length - 1} />
                    <IconBtn icon="trash" title="Удалить" danger onClick={() => setRows(rows.filter((_, k) => k !== i))} />
                  </span>
                </div>
                <Area value={r.d} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, d: v } : x)))} placeholder="Простыми словами" />
              </div>
            ))}
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { t: "", d: "", g: "auto" }])}>
                <Icon name="plus" size={13} /> Термин
              </button>
            </div>
          </div>
        </div>
      );
    }
  }
  if (!main) main = <div className="card ae-card ae-muted">Ничего не выбрано — выберите материал слева.</div>;

  const stamp = doc?.updatedAt ? new Date(doc.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="ae">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Редактор обучения</h1>
          <p className="page-sub">
            {isDefault ? "Сейчас у всех исходный вариант обучения." : `Опубликовано: ${doc?.by || "РОП"}, ${stamp}.`} Правки видят все операторы и стажёры после «Опубликовать».
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-sm" onClick={exportJson} title="Скачать черновик файлом — резервная копия">
            <Icon name="download" size={13} /> Скачать
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} title="Загрузить из файла в черновик">
            <Icon name="upload" size={13} /> Загрузить
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = "";
            }}
          />
          {!isDefault && (
            <button type="button" className="btn btn-sm" onClick={() => void resetDefault()} disabled={busy} title="Убрать все правки — вариант из поставки CRM">
              <Icon name="restore" size={13} /> Исходное
            </button>
          )}
        </div>
      </div>

      <div className={`ae-bar${dirty ? " dirty" : ""}`} role="status">
        <Icon name={dirty ? "edit" : "check"} size={14} />
        <span className="ae-bar-t">
          {dirty
            ? errs.length
              ? `Не опубликовать: ${errs[0]}${errs.length > 1 ? ` (и ещё ${errs.length - 1})` : ""}`
              : `${restored ? "Черновик восстановлен. " : ""}Есть неопубликованные правки — их видите только вы`
            : "Всё опубликовано — операторы видят то же, что здесь"}
        </span>
        {dirty && (
          <>
            <button type="button" className="btn btn-sm" onClick={() => void discard()} disabled={busy}>
              Отменить правки
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void publish()} disabled={busy || errs.length > 0}>
              <Icon name="check" size={13} /> {busy ? "Публикую…" : "Опубликовать"}
            </button>
          </>
        )}
      </div>

      <div className="ae-lay">
        <aside className="card ae-tree">
          <div className="ae-tree-s">
            <Icon name="search" size={13} />
            <input value={treeQ} onChange={(e) => setTreeQ(e.target.value)} placeholder="Найти материал или текст" />
          </div>
          <button type="button" className="ae-tree-row" aria-current={sel.t === "home" ? "true" : undefined} onClick={() => setSel({ t: "home" })}>
            <Icon name="info" size={13} />
            <span className="ae-tree-l">Как пользоваться</span>
          </button>
          {tree("course", "Курс «Авто»", "Затем — «Практика в Скорозвоне»: 5 глав тренажёра, они в коде.")}
          {tree("pay", "Оплата и стажировка")}
          <div className="ae-tree-g">
            <div className="ae-tree-gh">
              <span>Справочники</span>
            </div>
            {refRow("st", "Статусы", draft.ST_AUTO.length, "list")}
            {refRow("obj", "Возражения", draft.OBJ.length, "target")}
            {refRow("gloss", "Глоссарий", draft.GLOSS.length, "book")}
          </div>
        </aside>
        <div className="ae-main">{main}</div>
      </div>
    </div>
  );
}
