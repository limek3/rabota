"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as RKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import {
  WEEKDAYS_SHORT,
  addDays,
  addMonths,
  currentMonth,
  fmtDate,
  fmtMonth,
  isDayKey,
  isWorkday,
  monthOf,
  todayKey,
  weekStart,
} from "@/lib/crm/dates";
import type { DayKey, MonthKey } from "@/lib/crm/types";

/**
 * Выпадающие элементы вместо системных <select>, календаря и выбора месяца.
 *
 * Системные списки в Windows рисуются белым прямоугольником поверх тёмной темы,
 * не умеют поиск, аватарки и подсказки. Здесь всё в стиле приложения:
 *   - всплывашка в портале с position: fixed — её не обрезают таблицы и модалки;
 *   - открывается вниз или вверх — куда хватает места, и едет за полем при прокрутке;
 *   - клавиатура: ↑↓, Home/End, Enter, Esc, поиск по первым буквам;
 *   - в длинных списках (от 8 пунктов) — строка поиска.
 * Esc закрывает только список, а не модалку под ним (defaultPrevented).
 */

/* ── всплывающий слой ─────────────────────────────────────────────── */

interface Anchor {
  left: number;
  top: number;
  bottom: number;
  right: number;
  width: number;
}

function readAnchor(el: HTMLElement | null): Anchor | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.right, width: r.width };
}

/** Позиция всплывашки: под полем или над ним, в пределах окна. */
export function usePopover(open: boolean, anchorRef: React.RefObject<HTMLElement>, popRef: React.RefObject<HTMLElement>, onClose: () => void) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const measure = useCallback(() => setAnchor(readAnchor(anchorRef.current)), [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    if (r.width !== size.w || r.height !== size.h) setSize({ w: r.width, h: r.height });
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closeRef.current();
    };
    const onMove = (e: Event) => {
      if (popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return;
      measure();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, anchorRef, popRef, measure]);

  let style: CSSProperties = { position: "fixed", visibility: "hidden", left: 0, top: 0 };
  if (anchor && typeof window !== "undefined") {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = size.h || 280;
    const w = Math.max(size.w, anchor.width);
    const below = vh - anchor.bottom - 8;
    const up = below < h && anchor.top - 8 > below;
    const left = Math.max(8, Math.min(anchor.left, vw - w - 8));
    style = {
      position: "fixed",
      left,
      minWidth: anchor.width,
      ...(up ? { bottom: vh - anchor.top + 4 } : { top: anchor.bottom + 4 }),
      maxHeight: Math.max(160, (up ? anchor.top : vh - anchor.bottom) - 16),
    };
    // полностью за краем окна (поле прокрутили из вида) — закрываем
    if (anchor.bottom < 0 || anchor.top > vh) queueMicrotask(() => closeRef.current());
  }
  return { style, measure };
}

export function Layer({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok ? createPortal(children, document.body) : null;
}

/* ── Select ───────────────────────────────────────────────────────── */

export interface Opt<V extends string = string> {
  value: V;
  label: string;
  /** Подсказка справа: группа оператора, число лидов и т.п. */
  hint?: string;
  /** Значок слева: цвет проекта, аватар, иконка. */
  icon?: ReactNode;
  /** Заголовок группы — пункты с одинаковым group идут под одним заголовком. */
  group?: string;
  disabled?: boolean;
}

const SEARCH_FROM = 8;

export function Select<V extends string = string>({
  value,
  options,
  onChange,
  placeholder = "— выберите —",
  size = "md",
  width,
  minPopWidth = 200,
  searchable,
  invalid,
  disabled,
  ariaLabel,
  autoFocus,
  style,
  title,
  resetOnPick,
}: {
  value: V | "" | null | undefined;
  options: Opt<V>[];
  onChange: (v: V) => void;
  placeholder?: string;
  size?: "md" | "sm";
  width?: number | string;
  minPopWidth?: number;
  searchable?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  style?: CSSProperties;
  title?: string;
  /** Список-действие («Перевести сюда…»): после выбора снова показывает заглушку. */
  resetOnPick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeBuf = useRef({ s: "", t: 0 });
  const listId = useId();

  const close = useCallback(() => setOpen(false), []);
  const { style: popStyle } = usePopover(open, btnRef, popRef, close);

  const withSearch = searchable ?? options.length >= SEARCH_FROM;
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.label.toLowerCase().includes(s) || (o.hint ?? "").toLowerCase().includes(s) || (o.group ?? "").toLowerCase().includes(s));
  }, [q, options]);

  const snap = useRef({ options, value });
  snap.current = { options, value };
  useEffect(() => {
    if (!open) return;
    setQ("");
    const idx = snap.current.options.findIndex((o) => o.value === snap.current.value);
    setHi(Math.max(0, idx));
    window.setTimeout(() => (withSearch ? searchRef.current?.focus() : popRef.current?.focus()), 0);
  }, [open, withSearch]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  const pick = (o: Opt<V> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const move = (dir: 1 | -1, from = hi) => {
    const n = shown.length;
    if (!n) return;
    let i = from;
    for (let k = 0; k < n; k++) {
      i = Math.min(n - 1, Math.max(0, i + dir));
      if (!shown[i]?.disabled) break;
    }
    setHi(i);
  };

  const onKey = (e: RKeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // список открыт: клавиши принадлежат ему, а не странице и не модалке
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(1, -1);
    } else if (e.key === "End") {
      e.preventDefault();
      move(-1, shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[hi]);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // поиск по первым буквам, как в системном списке
      const now = Date.now();
      typeBuf.current = { s: (now - typeBuf.current.t < 700 ? typeBuf.current.s : "") + e.key.toLowerCase(), t: now };
      const i = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typeBuf.current.s));
      if (i >= 0) setHi(i);
    }
  };

  const h = size === "sm" ? 28 : 34;
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`inp sel-trigger ${size === "sm" ? "inp-sm" : ""}`}
        style={{ width: width ?? "100%", height: h, ...style }}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        data-open={open || undefined}
        autoFocus={autoFocus}
        title={title ?? (current && !resetOnPick ? current.label : undefined)}
      >
        {!resetOnPick && current?.icon && <span className="sel-icon">{current.icon}</span>}
        <span className={`sel-value ${!current || resetOnPick ? "sel-ph" : ""}`}>{current && !resetOnPick ? current.label : placeholder}</span>
        {/* в закрытом поле показываем только короткую подсказку (группа, единица):
           длинные пояснения всё равно не влезали и обрывались многоточием */}
        {/* подсказка в поле — только если влезает вместе с названием, иначе обрезалось бы само значение (ФИО) */}
        {!resetOnPick && current?.hint && current.hint.length <= 14 && current.label.length + current.hint.length <= 24 && size === "md" && (
          <span className="sel-hint">{current.hint}</span>
        )}
        <Icon name="chevD" size={size === "sm" ? 12 : 13} stroke={2} className="sel-chev" />
      </button>
      {open && (
        <Layer>
          <div
            ref={popRef}
            className="sel-pop"
            style={{ ...popStyle, minWidth: Math.max(Number(popStyle.minWidth) || 0, minPopWidth) }}
            tabIndex={-1}
            onKeyDown={onKey}
            role="presentation"
          >
            {withSearch && (
              <div className="sel-search">
                <Icon name="search" size={13} style={{ color: "var(--dim)" }} />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setHi(0);
                  }}
                  placeholder="Поиск…"
                  aria-label="Поиск в списке"
                />
              </div>
            )}
            <div ref={listRef} id={listId} role="listbox" className="sel-list">
              {shown.map((o, i) => {
                const header = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                const on = o.value === value;
                return (
                  <div key={`${o.group ?? ""}|${o.value}`}>
                    {header && <div className="sel-group">{header}</div>}
                    <div
                      data-idx={i}
                      role="option"
                      aria-selected={on}
                      aria-disabled={o.disabled || undefined}
                      className={`sel-opt ${i === hi ? "is-hi" : ""} ${on ? "is-on" : ""} ${o.disabled ? "is-dis" : ""}`}
                      onMouseEnter={() => !o.disabled && setHi(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      <span className="sel-check">{on ? <Icon name="check" size={13} stroke={2.4} /> : null}</span>
                      {o.icon && <span className="sel-icon">{o.icon}</span>}
                      <span className="sel-label">{o.label}</span>
                      {o.hint && <span className="sel-hint">{o.hint}</span>}
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && <div className="sel-empty">Ничего не найдено</div>}
            </div>
          </div>
        </Layer>
      )}
    </>
  );
}

/* ── календарь ───────────────────────────────────────────────────── */

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function parseRu(s: string): DayKey | null {
  const m = s.trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const k = `${y}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return isDayKey(k) ? k : null;
}

function Calendar({
  value,
  onPick,
  min,
  max,
  workdays,
  onClear,
}: {
  value: DayKey | "";
  onPick: (d: DayKey) => void;
  min?: DayKey;
  max?: DayKey;
  workdays?: { workdays: number[]; holidays: DayKey[] };
  onClear?: () => void;
}) {
  const today = todayKey();
  const [view, setView] = useState<MonthKey>(monthOf(value || today));
  const [focus, setFocus] = useState<DayKey>(value || today);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => setView(monthOf(focus)), [focus]);
  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus, view]);

  const start = weekStart(`${view}-01`);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const off = (d: DayKey) => (min && d < min) || (max && d > max);

  const onKey = (e: RKeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] != null) {
      e.preventDefault();
      setFocus((f) => addDays(f, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setFocus((f) => {
        const m = addMonths(monthOf(f), e.key === "PageUp" ? -1 : 1);
        const d = Math.min(Number(f.slice(8)), 28);
        return `${m}-${String(d).padStart(2, "0")}`;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!off(focus)) onPick(focus);
    }
  };

  return (
    <div className="cal" onKeyDown={onKey}>
      <div className="cal-head">
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setView((v) => addMonths(v, -1))} aria-label="Предыдущий месяц">
          <Icon name="chevL" size={14} />
        </button>
        <span className="cal-title">{fmtMonth(view)}</span>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setView((v) => addMonths(v, 1))} aria-label="Следующий месяц">
          <Icon name="chevR" size={14} />
        </button>
      </div>
      <div className="cal-grid" ref={gridRef} role="grid">
        {WEEKDAYS_SHORT.map((w, i) => (
          <span key={w} className={`cal-wd ${i >= 5 ? "is-we" : ""}`}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const out = monthOf(d) !== view;
          const dis = off(d);
          const rest = workdays ? !isWorkday(d, workdays) : false;
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              tabIndex={d === focus ? 0 : -1}
              disabled={!!dis}
              className={`cal-day ${out ? "is-out" : ""} ${d === value ? "is-on" : ""} ${d === today ? "is-today" : ""} ${rest ? "is-rest" : ""}`}
              onClick={() => onPick(d)}
              aria-label={fmtDate(d)}
              aria-selected={d === value}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="cal-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => !off(today) && onPick(today)} disabled={!!off(today)}>
          Сегодня
        </button>
        {onClear && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            Очистить
          </button>
        )}
      </div>
    </div>
  );
}

/** Поле даты: можно набрать «20.09.2026» руками или выбрать в календаре. */
export function DateInput({
  value,
  onChange,
  min,
  max,
  clearable,
  placeholder = "дд.мм.гггг",
  size = "md",
  width,
  ariaLabel,
  invalid,
  disabled,
  workdays,
}: {
  value: DayKey | "";
  onChange: (v: DayKey | "") => void;
  min?: DayKey;
  max?: DayKey;
  clearable?: boolean;
  placeholder?: string;
  size?: "md" | "sm";
  width?: number | string;
  ariaLabel?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Подсветить выходные по настройкам рабочей недели. */
  workdays?: { workdays: number[]; holidays: DayKey[] };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? fmtDate(value) : "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { style } = usePopover(open, wrapRef, popRef, close);

  useEffect(() => setText(value ? fmtDate(value) : ""), [value]);

  const commit = () => {
    if (!text.trim()) {
      if (clearable) onChange("");
      else setText(value ? fmtDate(value) : "");
      return;
    }
    const d = parseRu(text);
    if (d && !(min && d < min) && !(max && d > max)) onChange(d);
    else setText(value ? fmtDate(value) : "");
  };

  return (
    <>
      <div
        ref={wrapRef}
        className={`inp date-inp ${size === "sm" ? "inp-sm" : ""}`}
        style={{ width: width ?? "100%" }}
        aria-invalid={invalid || undefined}
        data-open={open || undefined}
        data-disabled={disabled || undefined}
      >
        <input
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value.replace(/[^\d./-]/g, "").slice(0, 10))}
          onFocus={() => !disabled && setOpen(true)}
          onClick={() => !disabled && setOpen(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              setOpen(false);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "ArrowDown" && open) {
              e.preventDefault();
              popRef.current?.querySelector<HTMLElement>(".cal-day[tabindex='0']")?.focus();
            }
          }}
          placeholder={placeholder}
          inputMode="numeric"
          aria-label={ariaLabel}
        />
        <button type="button" tabIndex={-1} className="date-btn" onClick={() => !disabled && setOpen((o) => !o)} aria-label="Календарь">
          <Icon name="calendar" size={size === "sm" ? 13 : 14} />
        </button>
      </div>
      {open && (
        <Layer>
          <div
            ref={popRef}
            className="sel-pop"
            style={{ ...style, minWidth: 0, maxHeight: "none" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <Calendar
              value={value}
              min={min}
              max={max}
              workdays={workdays}
              onPick={(d) => {
                onChange(d);
                setText(fmtDate(d));
                setOpen(false);
              }}
              onClear={
                clearable
                  ? () => {
                      onChange("");
                      setText("");
                      setOpen(false);
                    }
                  : undefined
              }
            />
          </div>
        </Layer>
      )}
    </>
  );
}

/** Время «ЧЧ:ММ» с автоподстановкой двоеточия. */
export function TimeInput({ value, onChange, width = 76, size = "md" }: { value: string; onChange: (v: string) => void; width?: number; size?: "md" | "sm" }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const m = text.trim().match(/^(\d{1,2})[:.\s]?(\d{2})$/);
    if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
      const v = `${m[1].padStart(2, "0")}:${m[2]}`;
      setText(v);
      onChange(v);
    } else setText(value);
  };
  return (
    <input
      className={`inp num ${size === "sm" ? "inp-sm" : ""}`}
      style={{ width, textAlign: "center" }}
      value={text}
      inputMode="numeric"
      placeholder="чч:мм"
      aria-label="Время"
      onChange={(e) => {
        let t = e.target.value.replace(/[^\d:]/g, "").slice(0, 5);
        if (/^\d{3}$/.test(t)) t = `${t.slice(0, 2)}:${t.slice(2)}`;
        setText(t);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Дата и время передачи лида: "YYYY-MM-DDTHH:mm". */
export function DateTimeInput({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: DayKey }) {
  const d = value.slice(0, 10);
  const t = value.slice(11, 16) || "00:00";
  return (
    <div className="row" style={{ gap: 6 }}>
      <DateInput value={isDayKey(d) ? d : ""} onChange={(nd) => nd && onChange(`${nd}T${t}`)} max={max} ariaLabel="Дата" />
      <TimeInput value={t} onChange={(nt) => onChange(`${d}T${nt}`)} />
    </div>
  );
}

/* ── выбор месяца ────────────────────────────────────────────────── */

export function MonthPicker({ value, onChange, size = "sm", minWidth = 150 }: { value: MonthKey; onChange: (m: MonthKey) => void; size?: "sm" | "md"; minWidth?: number }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { style } = usePopover(open, btnRef, popRef, close);
  const cur = currentMonth();

  useEffect(() => {
    if (open) setYear(Number(value.slice(0, 4)));
  }, [open, value]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`btn ${size === "sm" ? "btn-sm" : ""}`}
        style={{ minWidth, fontWeight: 600 }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Выбрать месяц"
      >
        <Icon name="calendar" size={13} />
        {fmtMonth(value)}
        <Icon name="chevD" size={12} stroke={2} style={{ color: "var(--dim)", transform: open ? "rotate(180deg)" : undefined, transition: "transform var(--dur-1) var(--ease)" }} />
      </button>
      {open && (
        <Layer>
          <div
            ref={popRef}
            className="sel-pop"
            style={{ ...style, minWidth: 248, maxHeight: "none", padding: 10 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <div className="cal-head">
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setYear((y) => y - 1)} aria-label="Предыдущий год">
                <Icon name="chevL" size={14} />
              </button>
              <span className="cal-title num">{year}</span>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setYear((y) => y + 1)} aria-label="Следующий год">
                <Icon name="chevR" size={14} />
              </button>
            </div>
            <div className="month-grid">
              {MONTHS_SHORT.map((m, i) => {
                const key = `${year}-${String(i + 1).padStart(2, "0")}`;
                return (
                  <button
                    key={m}
                    type="button"
                    className={`month-cell ${key === value ? "is-on" : ""} ${key === cur ? "is-today" : ""}`}
                    title={`${MONTHS[i]} ${year}`}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    autoFocus={key === value}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {value !== cur && (
              <div className="cal-foot">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    onChange(cur);
                    setOpen(false);
                  }}
                >
                  Текущий месяц
                </button>
              </div>
            )}
          </div>
        </Layer>
      )}
    </>
  );
}

/* ── готовые наборы опций ─────────────────────────────────────────── */

export function dot(color: string): ReactNode {
  return <span className="swatch" style={{ background: `var(--c-${color}-fg)`, width: 9, height: 9, borderRadius: 3 }} />;
}
