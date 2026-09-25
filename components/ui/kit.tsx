"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { useCrm } from "@/lib/crm/store";
import {
  addDays,
  addMonths,
  currentMonth,
  fmtMonth,
  fmtRange,
  fmtStamp,
  monthEnd,
  monthOf,
  monthStart,
  weekEnd,
  weekStart,
} from "@/lib/crm/dates";
import type { DayKey, Lead, MonthKey, Operator } from "@/lib/crm/types";
import { LEAD_STATUS_HUE, LEAD_STATUS_LABEL } from "@/lib/crm/types";
import { initials } from "@/lib/crm/format";
import { PACE_HUE, PACE_LABEL, type PaceStatus } from "@/lib/crm/calc";
import { DateInput, MonthPicker } from "./select";

/* ── цвет по тону палитры чипов ───────────────────────────────────── */
export function hueVars(hue: string): CSSProperties {
  return {
    ["--chip-fg" as string]: `var(--c-${hue}-fg)`,
    ["--chip-bg" as string]: `var(--c-${hue}-bg)`,
    ["--chip-bd" as string]: `var(--c-${hue}-bd)`,
  };
}
export const hueFg = (hue: string) => `var(--c-${hue}-fg)`;

export function Chip({ hue = "gray", children, dot, title, style }: { hue?: string; children: ReactNode; dot?: boolean; title?: string; style?: CSSProperties }) {
  return (
    <span className="chip" style={{ ...hueVars(hue), ...style }} title={title}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

/** Плашка у имени: «увол. 21.09» или «удалён» — в графике, зарплате, списках. */
export function GoneTag({ op }: { op: Pick<Operator, "status" | "fireDate" | "deletedAt"> }) {
  const small: CSSProperties = { height: 18, padding: "0 6px", fontSize: 10.5, flex: "none" };
  if (op.status === "fired") {
    const d = op.fireDate ? `${op.fireDate.slice(8, 10)}.${op.fireDate.slice(5, 7)}` : "";
    return (
      <Chip hue="red" title={op.fireDate ? `Уволен с ${d}.${op.fireDate.slice(0, 4)}` : "Уволен"} style={small}>
        увол.{d && ` ${d}`}
      </Chip>
    );
  }
  if (op.deletedAt) return <Chip hue="gray" title="Удалён из списков, история сохранена" style={small}>удалён</Chip>;
  return null;
}

/**
 * Ссылка на лид: открывает её в новой вкладке (в десктопе — в браузере). Клик не
 * открывает карточку лида под ней — строки таблиц кликабельны.
 *   pill — кнопка «↗ лид» (кабинет, карточка оператора);
 *   icon — маленький значок рядом с именем клиента (журнал лидов).
 */
export function LeadLinkButton({ link, variant = "pill" }: { link: string; variant?: "pill" | "icon" }) {
  if (!link) return variant === "icon" ? null : <span className="muted">—</span>;
  return (
    <a
      className={variant === "icon" ? "lead-open-ico" : "lead-open"}
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      title={`Открыть лид в новой вкладке\n${link}`}
      aria-label="Открыть лид в новой вкладке"
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name={variant === "icon" ? "external" : "arrowR"} size={variant === "icon" ? 12 : 11} stroke={2.2} style={variant === "icon" ? undefined : { transform: "rotate(-45deg)" }} />
      {variant === "pill" && "лид"}
    </a>
  );
}

/**
 * Текст в узкой колонке: обрезается многоточием, а целиком появляется при наведении —
 * своей подсказкой, без задержки системного title. Не обрезался — подсказки нет.
 */
export function ClipText({ text, width, full }: { text: string; width: number; full?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // top — подсказка под текстом; bottom — над ним, если внизу окна не хватает места.
  // Позиция задаётся top/bottom, а не transform: иначе анимация появления сбивает сдвиг
  // и подсказка прыгает — сначала на месте текста, потом выше.
  const [tip, setTip] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  if (!text) return <span className="muted">—</span>;
  const show = () => {
    const el = ref.current;
    // подсказка — если текст обрезан или показан сокращённо (full — полная форма)
    if (!el || (el.scrollWidth <= el.clientWidth && (!full || full === text))) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left - 10, window.innerWidth - 388));
    setTip(window.innerHeight - r.bottom < 140 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  return (
    <>
      <span ref={ref} className="clip-text" style={{ maxWidth: width }} onMouseEnter={show} onMouseLeave={() => setTip(null)}>
        {text}
      </span>
      {tip &&
        createPortal(
          <div className={tip.bottom != null ? "clip-tip up" : "clip-tip"} style={tip} role="tooltip">
            {full || text}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Разделитель в таблице перед уволенными: «Уволены · 2». Уволенные идут в конце списка
 * и видны, но не смешиваются с работающими.
 */
export function GoneSepRow({ count, colSpan, indent = 10 }: { count: number; colSpan: number; indent?: number }) {
  return (
    <tr className="gone-sep">
      <td className="sticky-col" style={{ paddingLeft: indent }}>
        Уволены · {count}
      </td>
      {colSpan > 1 && <td colSpan={colSpan - 1} />}
    </tr>
  );
}

/** Статус лида; у «не доведён» — причина в подсказке, у проверенных — кто и когда. */
export function LeadStatusChip({ lead }: { lead: Pick<Lead, "status" | "statusReason" | "statusAt" | "statusBy"> }) {
  const who = lead.statusBy ? `${lead.statusBy}${lead.statusAt ? `, ${fmtStamp(lead.statusAt).slice(0, 5)} ${fmtStamp(lead.statusAt).slice(11)}` : ""}` : "";
  const title = [lead.status === "failed" && lead.statusReason ? `Причина: ${lead.statusReason}` : "", who].filter(Boolean).join(" · ");
  return (
    <Chip hue={LEAD_STATUS_HUE[lead.status]} dot title={title || undefined}>
      {LEAD_STATUS_LABEL[lead.status]}
    </Chip>
  );
}

export function StatusChip({ status }: { status: PaceStatus }) {
  return (
    <Chip hue={PACE_HUE[status]} dot>
      {PACE_LABEL[status]}
    </Chip>
  );
}

export function Swatch({ hue, size = 8 }: { hue: string; size?: number }) {
  return <span className="swatch" style={{ background: hueFg(hue), width: size, height: size }} />;
}

/* ── аватар ───────────────────────────────────────────────────────── */
const AV_HUES = ["blue", "green", "amber", "purple", "teal", "pink", "indigo"];
export function Avatar({ name, id, size = 26 }: { name: string; id: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = AV_HUES[h % AV_HUES.length];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        background: `var(--c-${hue}-bg)`,
        color: `var(--c-${hue}-fg)`,
        border: `1px solid var(--c-${hue}-bd)`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/* ── прогресс ─────────────────────────────────────────────────────── */
export function Progress({
  value,
  marker,
  hue,
  height = 6,
  style,
}: {
  /** 0…1+ */
  value: number;
  /** Отметка «план на дату», 0…1 */
  marker?: number;
  hue?: string;
  height?: number;
  style?: CSSProperties;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const m = marker != null && Number.isFinite(marker) ? Math.max(0, Math.min(1, marker)) : null;
  return (
    <div className="bar-track" style={{ height, overflow: "visible", ...style }}>
      <div className="bar-fill" style={{ width: `${v * 100}%`, background: hue ? hueFg(hue) : undefined }} />
      {m != null && m > 0 && (
        <span
          title="План на сегодня"
          style={{ position: "absolute", left: `calc(${m * 100}% - 1px)`, top: -3, bottom: -3, width: 2, borderRadius: 2, background: "var(--text)" , opacity: 0.55 }}
        />
      )}
    </div>
  );
}

/* ── плитка показателя ────────────────────────────────────────────── */
export function Kpi({
  label,
  value,
  sub,
  delta,
  title,
  onClick,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: { text: string; good: boolean | null };
  title?: string;
  onClick?: () => void;
  /** Окраска значения: норматив соблюдён или нет. */
  tone?: "good" | "warn" | "bad";
}) {
  const toneColor = tone === "good" ? "var(--c-green-fg)" : tone === "warn" ? "var(--c-amber-fg)" : tone === "bad" ? "var(--c-red-fg)" : undefined;
  return (
    <div className="card kpi" title={title} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </span>
      {(sub || delta) && (
        <span className="kpi-sub">
          {delta && (
            <span style={{ color: delta.good == null ? "var(--dim)" : delta.good ? "var(--c-green-fg)" : "var(--c-red-fg)", fontWeight: 600, marginRight: 6 }}>
              {delta.text}
            </span>
          )}
          {sub}
        </span>
      )}
    </div>
  );
}

/* ── заголовок страницы ───────────────────────────────────────────── */
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </div>
  );
}

export function Empty({ icon = "info", title, text, action }: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span style={{ width: 40, height: 40, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-tint)", color: "var(--brand)" }}>
        <Icon name={icon} size={20} />
      </span>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

/* ── сегменты ─────────────────────────────────────────────────────── */
export function Seg<T extends string>({ value, options, onChange, style }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; style?: CSSProperties }) {
  return (
    <div className="seg" role="group" style={style}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── переключатель ────────────────────────────────────────────────── */
/**
 * Ползунок вместо галочки. Один элемент на всё приложение: фильтры списков,
 * права ролей, настройки. Подпись и пояснение — часть кнопки, поэтому
 * попасть по нему легко и состояние читается без прищуривания.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  size = "md",
  style,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <label className={`sw${size === "sm" ? " sw-sm" : ""}${hint ? " sw-hint" : ""}`} style={style} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw-track" />
      {(label || hint) && (
        <span className="sw-txt">
          {label && <span className="sw-l">{label}</span>}
          {hint && <span className="sw-h">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/* ── черновик и кнопки сохранения ─────────────────────────────────── */
/**
 * Черновик настроек: правки копятся локально и уходят в базу одной записью по
 * «Сохранить». Раньше поля писали на каждое нажатие клавиши — записи обгоняли
 * друг друга, и в базе оставалось промежуточное значение.
 * Пока своих правок нет, черновик сам подтягивает изменения извне (другая вкладка, realtime).
 */
export function useDraft<T>(source: T) {
  const [draft, setDraft] = useState<T>(source);
  const base = useRef(source);
  const key = JSON.stringify(source);
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === JSON.stringify(base.current) ? source : d));
    base.current = source;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const dirty = JSON.stringify(draft) !== key;
  return { draft, setDraft, dirty, reset: () => setDraft(source) };
}

/** «Есть несохранённые изменения · Отменить · Сохранить» — внизу раздела, пока есть правки. */
export function SaveBar({ dirty, onSave, onReset, busy, error, sticky }: { dirty: boolean; onSave: () => void; onReset: () => void; busy?: boolean; error?: string | null; sticky?: boolean }) {
  if (!dirty) return null;
  return (
    <div className={`save-bar${sticky ? " save-bar-sticky" : ""}`} role="status">
      <Icon name="info" size={14} />
      <span style={{ flex: 1, minWidth: 0 }}>{error || "Есть несохранённые изменения"}</span>
      <button type="button" className="btn btn-sm" onClick={onReset} disabled={busy}>
        Отменить
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onSave} disabled={busy || !!error}>
        <Icon name="check" size={13} /> {busy ? "Сохраняю…" : "Сохранить"}
      </button>
    </div>
  );
}

/* ── поле формы ───────────────────────────────────────────────────── */
export function Field({ label, hint, error, children, style }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="field" style={style}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Числовое поле: хранит строку, пока пользователь печатает, отдаёт число или null. */
export function NumInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  placeholder,
  allowEmpty,
  className = "inp",
  style,
  autoFocus,
  onEnter,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? "" : String(value));
    }
  }, [value]);
  return (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Enter") onEnter?.();
      }}
      onChange={(e) => {
        // «1 500», «1 500 ₽», «30%» — пробелы, валюта и проценты не мешают числу
        const t = e.target.value.replace(/[\s  ₽%]/g, "").replace(",", ".");
        setText(e.target.value);
        if (t.trim() === "") {
          last.current = allowEmpty ? null : 0;
          onChange(allowEmpty ? null : 0);
          return;
        }
        let n = Number(t);
        if (!Number.isFinite(n)) return;
        if (min != null) n = Math.max(min, n);
        if (max != null) n = Math.min(max, n);
        if (step >= 1) n = Math.round(n);
        last.current = n;
        onChange(n);
      }}
    />
  );
}

/* ── плавное раскрытие ────────────────────────────────────────────── */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Блок, который плавно выезжает вниз и так же плавно сворачивается (grid-template-rows 0fr → 1fr,
 * высоту мерить не нужно). Содержимое монтируется при первом раскрытии и остаётся —
 * иначе сворачивать было бы нечего. innerStyle — отступы содержимого: они сворачиваются вместе с ним.
 */
export function Collapse({ open, children, innerStyle, className }: { open: boolean; children: ReactNode; innerStyle?: CSSProperties; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setMounted(true);
    // свёрнутое содержимое не должно ловить фокус с клавиатуры
    if (ref.current) (ref.current as HTMLDivElement & { inert: boolean }).inert = !open;
  }, [open]);
  return (
    <div ref={ref} className={`collapse${open ? " open" : ""}${className ? ` ${className}` : ""}`} aria-hidden={!open}>
      <div className="collapse-in">
        <div style={innerStyle}>{mounted || open ? children : null}</div>
      </div>
    </div>
  );
}

export type FoldPhase = "in" | "out" | undefined;

/**
 * Сворачиваемые группы строк в таблице (зарплата, операторы) — одним движением, как аккордеон.
 * Контейнер таблицы (wrapRef, .tbl-wrap) плавно меняет высоту, «Итого» (sticky снизу) едет вместе
 * с краем, группы ниже одновременно сдвигаются вверх/вниз, а строки самой группы гаснут или
 * проявляются каскадом. Строки убираются из DOM только когда всё доехало — без скачка в конце.
 * У каждой группы — <tbody data-fold={key}>, первая строка в нём — заголовок группы.
 */
export function useFoldGroups(wrapRef: RefObject<HTMLElement>) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<Record<string, "in" | "out">>({});
  const opening = useRef<{ key: string; from: number } | null>(null);
  const running = useRef<Animation[]>([]);
  const cancelAfterCommit = useRef(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  const dropPhase = (key: string) =>
    setPhase((p) => {
      const { [key]: _, ...rest } = p;
      return rest;
    });

  const stopAll = () => {
    running.current.forEach((a) => a.cancel());
    running.current = [];
    if (wrapRef.current) wrapRef.current.style.overflow = "";
  };
  const track = (list: Animation[]) => {
    running.current = list;
    const end = () => (running.current === list ? stopAll() : undefined);
    const last = list[list.length - 1];
    if (last) last.onfinish = end;
    later(end, FOLD_MS + 60);
  };
  // группа: её tbody, высота её строк (без заголовка) и tbody групп ниже
  const parts = (el: HTMLElement, key: string) => {
    const tb = Array.from(el.querySelectorAll<HTMLElement>("tbody[data-fold]")).find((t) => t.dataset.fold === key) ?? null;
    if (!tb) return null;
    const rows = Array.from(tb.children).slice(1) as HTMLElement[];
    const rowsH = rows.reduce((s, r) => s + r.offsetHeight, 0);
    const below: HTMLElement[] = [];
    for (let n = tb.nextElementSibling; n; n = n.nextElementSibling) if (n.tagName === "TBODY") below.push(n as HTMLElement);
    return { rowsH, below };
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    // сворачивание доехало, строки только что убраны — снимаем «замороженную» высоту в том же кадре
    if (cancelAfterCommit.current) {
      cancelAfterCommit.current = false;
      stopAll();
    }
    const o = opening.current;
    opening.current = null;
    if (!el || !o || reducedMotion() || typeof el.animate !== "function") return;
    const p = parts(el, o.key);
    if (!p) return;
    const to = el.offsetHeight;
    el.style.overflow = "hidden";
    const opts: KeyframeAnimationOptions = { duration: FOLD_MS, easing: FOLD_EASE };
    const list: Animation[] = [];
    for (const b of p.below) list.push(b.animate([{ transform: `translateY(${-p.rowsH}px)` }, { transform: "none" }], opts));
    if (Math.abs(to - o.from) > 1) list.push(el.animate([{ height: `${o.from}px` }, { height: `${to}px` }], opts));
    track(list);
  }, [closed, wrapRef]);

  const toggle = useCallback(
    (key: string) => {
      const el = wrapRef.current;
      const from = el?.offsetHeight ?? 0; // текущая высота — и посреди прошлой анимации (offsetHeight её учитывает)
      // повторный клик, пока группа сворачивается — передумали: возвращаем как было
      if (phase[key] === "out" && !closed.has(key)) {
        stopAll();
        dropPhase(key);
        return;
      }
      stopAll();
      if (closed.has(key)) {
        opening.current = el ? { key, from } : null;
        setPhase((p) => ({ ...p, [key]: "in" }));
        setClosed((s) => {
          const n = new Set(s);
          n.delete(key);
          return n;
        });
        later(() => dropPhase(key), 700);
        return;
      }
      const p = el && typeof el.animate === "function" && !reducedMotion() ? parts(el, key) : null;
      if (!el || !p) {
        setClosed((s) => new Set(s).add(key));
        return;
      }
      // до какой высоты сжимается контейнер: содержимое минус строки группы, но не выше, чем сейчас
      const chrome = el.offsetHeight - el.clientHeight;
      const to = Math.min(from, el.scrollHeight - p.rowsH + chrome);
      setPhase((ph) => ({ ...ph, [key]: "out" }));
      el.style.overflow = "hidden";
      const opts: KeyframeAnimationOptions = { duration: FOLD_MS, easing: FOLD_EASE, fill: "forwards" };
      const list: Animation[] = [];
      for (const b of p.below) list.push(b.animate([{ transform: "none" }, { transform: `translateY(${-p.rowsH}px)` }], opts));
      list.push(el.animate([{ height: `${from}px` }, { height: `${to}px` }], opts));
      running.current = list;
      // конец — по событию анимации или по таймеру (события не приходят, пока вкладка не рисуется)
      const finish = () => {
        if (running.current !== list || cancelAfterCommit.current) return;
        cancelAfterCommit.current = true;
        setClosed((s) => new Set(s).add(key));
        dropPhase(key);
      };
      list[list.length - 1].onfinish = finish;
      later(finish, FOLD_MS + 60);
    },
    [closed, phase, wrapRef],
  );

  return { isClosed: (key: string) => closed.has(key), phase: (key: string): FoldPhase => phase[key], toggle };
}

const FOLD_MS = 280;
const FOLD_EASE = "cubic-bezier(.2,.75,.25,1)";

/** Класс и задержка для строки группы: каскад сверху вниз при раскрытии, общий уход при сворачивании. */
export function foldRow(phase: FoldPhase, index: number): { className: string; style?: CSSProperties } {
  if (phase === "in") return { className: "fold-in", style: { animationDelay: `${Math.min(index, 12) * 24}ms` } };
  if (phase === "out") return { className: "fold-out" };
  return { className: "" };
}

/**
 * Колесо мыши листает широкую таблицу вправо-влево без Shift (график на месяц).
 * Плавно: колесо двигает цель, прокрутка догоняет её. Упёрлись в край — колесо снова
 * крутит страницу вертикально. Тачпад с горизонтальным жестом и Ctrl+колесо (масштаб) не трогаем.
 */
export function useWheelHScroll(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let target = el.scrollLeft;
    let raf = 0;
    const step = () => {
      const diff = target - el.scrollLeft;
      if (Math.abs(diff) < 0.5) {
        el.scrollLeft = target;
        raf = 0;
        return;
      }
      el.scrollLeft += diff * 0.22;
      raf = requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      if (!raf) target = el.scrollLeft; // пока стояли, таблицу могли сдвинуть полосой прокрутки
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? el.clientWidth : 1;
      const next = Math.max(0, Math.min(max, target + e.deltaY * unit));
      if (next === target) return; // край — отдаём колесо странице
      e.preventDefault();
      target = next;
      if (reducedMotion()) {
        el.scrollLeft = target;
        return;
      }
      if (!raf) raf = requestAnimationFrame(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/* ── модальное окно ───────────────────────────────────────────────── */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc уже обработал открытый внутри список/календарь — модалку не трогаем
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".modal-back")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <>
      <div className="drawer-back" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal>
        {children}
      </aside>
    </>,
    document.body,
  );
}

/* ── подтверждение и уведомления (монтируются в оболочке) ─────────── */
export function ConfirmHost() {
  const { confirmState, answerConfirm } = useCrm();
  if (!confirmState) return null;
  return (
    <Modal
      title={confirmState.title}
      onClose={() => answerConfirm(false)}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => answerConfirm(false)}>
            Отмена
          </button>
          <button className={confirmState.danger ? "btn btn-danger-solid" : "btn btn-primary"} autoFocus onClick={() => answerConfirm(true)}>
            {confirmState.ok ?? "Подтвердить"}
          </button>
        </>
      }
    >
      {confirmState.text && <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-sub)" }}>{confirmState.text}</div>}
    </Modal>
  );
}

export function ToastHost() {
  const { toasts, dismissToast } = useCrm();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: t.tone === "err" ? "var(--c-red-bg)" : t.tone === "info" ? "var(--ink-06)" : "var(--c-green-bg)",
              color: t.tone === "err" ? "var(--c-red-fg)" : t.tone === "info" ? "var(--text-sub)" : "var(--c-green-fg)",
            }}
          >
            <Icon name={t.tone === "err" ? "alert" : t.tone === "info" ? "info" : "check"} size={13} stroke={2.2} />
          </span>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.text}</span>
          {t.action && (
            <button
              className="btn btn-sm"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => dismissToast(t.id)} aria-label="Скрыть">
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── переключатель месяца ─────────────────────────────────────────── */
export function MonthSwitcher({ value, onChange }: { value: MonthKey; onChange: (m: MonthKey) => void }) {
  const cur = currentMonth();
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn btn-sm btn-icon" onClick={() => onChange(addMonths(value, -1))} aria-label="Предыдущий месяц" title="Предыдущий месяц">
        <Icon name="chevL" size={14} />
      </button>
      <MonthPicker value={value} onChange={onChange} />
      <button className="btn btn-sm btn-icon" onClick={() => onChange(addMonths(value, 1))} aria-label="Следующий месяц" title="Следующий месяц">
        <Icon name="chevR" size={14} />
      </button>
      {value !== cur && (
        <button className="btn btn-sm btn-ghost" onClick={() => onChange(cur)}>
          Текущий
        </button>
      )}
    </div>
  );
}

/* ── период: день / неделя / месяц / диапазон ─────────────────────── */
export type PeriodMode = "day" | "week" | "month" | "range";
export interface Period {
  mode: PeriodMode;
  from: DayKey;
  to: DayKey;
}

export function periodFor(mode: PeriodMode, anchor: DayKey): Period {
  if (mode === "day") return { mode, from: anchor, to: anchor };
  if (mode === "week") return { mode, from: weekStart(anchor), to: weekEnd(anchor) };
  if (mode === "month") return { mode, from: monthStart(monthOf(anchor)), to: monthEnd(monthOf(anchor)) };
  return { mode, from: anchor, to: anchor };
}

export function periodLabel(p: Period): string {
  if (p.mode === "month") return fmtMonth(monthOf(p.from));
  return fmtRange(p.from, p.to);
}

export function PeriodPicker({ value, onChange, today }: { value: Period; onChange: (p: Period) => void; today: DayKey }) {
  const shift = (dir: 1 | -1) => {
    if (value.mode === "day") onChange(periodFor("day", addDays(value.from, dir)));
    else if (value.mode === "week") onChange(periodFor("week", addDays(value.from, 7 * dir)));
    else if (value.mode === "month") onChange(periodFor("month", monthStart(addMonths(monthOf(value.from), dir))));
  };
  return (
    <div className="toolbar" style={{ gap: 6 }}>
      <Seg<PeriodMode>
        value={value.mode}
        onChange={(m) => {
          if (m === "range") return onChange({ mode: "range", from: value.from, to: value.to });
          // опорный день: сегодня, если он внутри текущего периода, иначе начало периода
          const anchor = value.from <= today && today <= value.to ? today : value.from;
          onChange(periodFor(m, anchor));
        }}
        options={[
          { value: "day", label: "День" },
          { value: "week", label: "Неделя" },
          { value: "month", label: "Месяц" },
          { value: "range", label: "Период" },
        ]}
      />
      {value.mode !== "range" ? (
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-sm btn-icon" onClick={() => shift(-1)} aria-label="Назад">
            <Icon name="chevL" size={14} />
          </button>
          <span className="btn btn-sm" style={{ minWidth: 120, pointerEvents: "none", fontWeight: 600 }}>
            {periodLabel(value)}
          </span>
          <button className="btn btn-sm btn-icon" onClick={() => shift(1)} aria-label="Вперёд">
            <Icon name="chevR" size={14} />
          </button>
          {!(value.from <= today && value.to >= today) && (
            <button className="btn btn-sm btn-ghost" onClick={() => onChange(periodFor(value.mode, today))}>
              {value.mode === "day" ? "Сегодня" : value.mode === "week" ? "Эта неделя" : "Этот месяц"}
            </button>
          )}
        </div>
      ) : (
        <div className="row" style={{ gap: 4 }}>
          <DateInput size="sm" width={138} value={value.from} onChange={(d) => d && onChange({ ...value, from: d, to: d > value.to ? d : value.to })} ariaLabel="С" />
          <span style={{ color: "var(--dim)" }}>—</span>
          <DateInput size="sm" width={138} value={value.to} onChange={(d) => d && onChange({ ...value, to: d, from: d < value.from ? d : value.from })} ariaLabel="По" />
        </div>
      )}
    </div>
  );
}

/* ── сортировка таблиц ────────────────────────────────────────────── */
export type SortState<K extends string> = { key: K; dir: 1 | -1 };

export function SortTh<K extends string>({
  k,
  sort,
  setSort,
  children,
  className = "",
  title,
  style,
}: {
  k: K;
  sort: SortState<K>;
  setSort: (s: SortState<K>) => void;
  children: ReactNode;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const on = sort.key === k;
  return (
    <th
      className={`sortable ${className}`}
      title={title}
      style={style}
      onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : -1 })}
      aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {children}
      {/* стрелка — поверх поля ячейки: не расширяет столбец и не сдвигает его при смене сортировки */}
      {on && <span className="sort-arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
    </th>
  );
}

/* ── файлы ────────────────────────────────────────────────────────── */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV для Excel: разделитель «;», BOM для кириллицы. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

/* ── горячие клавиши ──────────────────────────────────────────────── */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
