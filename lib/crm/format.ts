/** Числа, проценты, деньги, склонения. Всё безопасно к NaN/Infinity. */

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Деление без деления на ноль. */
export function safeDiv(a: number, b: number, fallback = 0): number {
  if (!b || !Number.isFinite(a) || !Number.isFinite(b)) return fallback;
  const r = a / b;
  return Number.isFinite(r) ? r : fallback;
}

export function fmtInt(n: number): string {
  return nf0.format(Math.round(finite(n)));
}

export function fmtNum(n: number, digits: 0 | 1 | 2 = 1): string {
  const v = finite(n);
  return (digits === 0 ? nf0 : digits === 1 ? nf1 : nf2).format(v);
}

export function fmtPct(ratio: number, digits: 0 | 1 = 0): string {
  const v = finite(ratio) * 100;
  return `${digits ? nf1.format(v) : nf0.format(Math.round(v))}%`;
}

export function fmtSigned(n: number, digits: 0 | 1 = 0): string {
  const v = finite(n);
  const r = digits ? Math.round(v * 10) / 10 : Math.round(v);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "−"}${digits ? nf1.format(Math.abs(r)) : nf0.format(Math.abs(r))}`;
}

export function fmtSignedPct(ratio: number): string {
  const v = Math.round(finite(ratio) * 100);
  if (v === 0) return "0%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
}

export function fmtMoney(n: number): string {
  const v = Math.round(finite(n));
  return `${v < 0 ? "−" : ""}${money.format(Math.abs(v))} ₽`;
}

export function fmtHours(n: number): string {
  return `${nf1.format(finite(n))} ч`;
}

export function round2(n: number): number {
  return Math.round(finite(n) * 100) / 100;
}

/** plural(5, ["лид", "лида", "лидов"]) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const LEADS: [string, string, string] = ["лид", "лида", "лидов"];
export const OPS: [string, string, string] = ["оператор", "оператора", "операторов"];
export const DAYS: [string, string, string] = ["день", "дня", "дней"];

/** Нормализация телефона: только цифры, 8XXXXXXXXXX → 7XXXXXXXXXX. */
export function normPhone(raw: string): string {
  let d = (raw || "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d;
}

/** +7 (912) 345-67-89 для 11-значных российских, иначе как есть. */
export function fmtPhone(p: string): string {
  const d = (p || "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("7")) {
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  }
  return p || "";
}

/** Инициалы для аватарки. */
export function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** «Иванов Иван Иванович» → «Иванов И. И.» */
export function shortName(name: string): string {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return name;
  return `${p[0]} ${p.slice(1).map((x) => x[0] + ".").join(" ")}`;
}

/** Как обратиться к человеку: из «Фамилия Имя Отчество» берём имя, иначе первое слово. */
export function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return parts.length >= 3 ? parts[1] : parts[0];
}
