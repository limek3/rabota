// @ts-nocheck
// СОБРАНО scripts/build-registry-fn.mjs — не правьте руками: исходник src/main.ts и lib/crm/*.
// Supabase → Edge Functions → registry-sheet → вставить этот файл целиком → Deploy.

// supabase/functions/registry-sheet/src/main.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// lib/crm/dates.ts
var pad = (n) => String(n).padStart(2, "0");
var APP_TZ = validZone(void 0) ?? "Europe/Moscow";
function validZone(tz) {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
var zoned = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});
var clockSkew = 0;
var nowMs = () => Date.now() + clockSkew;
function appStamp(at = new Date(nowMs())) {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  const p = {};
  for (const x of zoned.formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromKey(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}
function addDays(k, n) {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function monthOf(k) {
  return k.slice(0, 7);
}
function addMonths(m, n) {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + n, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthStart(m) {
  return `${m}-01`;
}
function daysInMonth(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm, 0).getDate();
}
function monthEnd(m) {
  return `${m}-${pad(daysInMonth(m))}`;
}
function monthDays(m) {
  const n = daysInMonth(m);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`${m}-${pad(i)}`);
  return out;
}
function rangeDays(from, to) {
  if (from > to) [from, to] = [to, from];
  const out = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard < 4e3) {
    out.push(k);
    k = addDays(k, 1);
    guard++;
  }
  return out;
}
function isoWeekday(k) {
  const w = fromKey(k).getDay();
  return w === 0 ? 7 : w;
}
function isWorkday(k, s) {
  if (s.holidays.includes(k)) return false;
  const wd = s.workdays.length ? s.workdays : [1, 2, 3, 4, 5];
  return wd.includes(isoWeekday(k));
}

// lib/crm/defaults.ts
var DEFAULT_ACCESS = {
  supervisor: {
    seeAllGroups: false,
    createLeads: true,
    editLeads: true,
    manageOperators: true,
    editShifts: true,
    viewPayroll: true,
    editPayroll: false,
    editPlans: true,
    manageProjects: false
  },
  operator: {
    createOwnLeads: true,
    editOwnLeadsHours: 24,
    deleteOwnLeads: false,
    editOwnShifts: false,
    viewOwnPay: true,
    viewGroupProgress: true,
    viewTeamProgress: false
  }
};
var DEFAULT_GRID = {
  id: "grid_base",
  name: "Базовая сетка оператора",
  tiers: [
    { from: 0, hourlyRate: 200, leadBonus: 70 },
    { from: 6, hourlyRate: 230, leadBonus: 75 },
    { from: 8, hourlyRate: 240, leadBonus: 80 },
    { from: 11, hourlyRate: 260, leadBonus: 90 }
  ]
};
var DEFAULT_SV_BONUS = {
  salary: 45e3,
  minLeads: 700,
  rows: [
    { from: 300, re: [0, 0, 0], auto: [0, 0, 0] },
    { from: 500, re: [0, 0, 0], auto: [0, 0, 0] },
    { from: 700, re: [4e3, 4500, 5e3], auto: [3500, 4e3, 4500] },
    { from: 1e3, re: [16e3, 18e3, 2e4], auto: [15e3, 17e3, 19e3] },
    { from: 1200, re: [25e3, 27e3, 3e4], auto: [24e3, 26e3, 29e3] },
    { from: 1500, re: [4e4, 43e3, 45e3], auto: [4e4, 42e3, 44e3] },
    { from: 1750, re: [5e4, 52e3, 55e3], auto: [49e3, 51e3, 54e3] },
    { from: 2e3, re: [6e4, 65e3, 7e4], auto: [58e3, 63e3, 68e3] }
  ],
  approve: [
    { from: 30, k: 1 },
    { from: 25, k: 0.95 },
    { from: 20, k: 0.9 },
    { from: 0, k: 0 }
  ],
  noGrowthK: 0.85,
  defaultApprovePct: 30
};
var DEFAULT_REGIONS = {
  main: ["Москва", "Санкт-Петербург", "Екатеринбург"],
  regional: ["Челябинск", "Волгоград", "Краснодарский край", "Ставрополь"],
  regionalApprovePct: 10,
  regionalLeadRevenue: 4e3
};
var DEFAULT_ROP = { telecomMonth: 0, overheadMonth: 0, capAuto: 300, capRe: 350, groupTrack: {}, hirePlan: {} };
var PAY_SCHEDULE_2026 = [
  { from: "2026-09-16", to: "2026-10-05", pay: "2026-10-09" },
  { from: "2026-10-06", to: "2026-10-18", pay: "2026-10-23" }
];
var DEFAULT_SETTINGS = {
  companyName: "Отдел лидогенерации",
  reportMonth: "",
  teamPlan: 0,
  // 0 — план не задан: руководитель ставит его сам в настройках, карточке или «Планах»
  defaultOperatorPlan: 0,
  defaultNormHours: 160,
  dayHours: 8,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  // по умолчанию — сетка: ставка часа и бонус за лид зависят от числа лидов в смене
  defaultPayType: "tiered",
  defaultSalary: 0,
  // запасные значения для схем без сетки — нижняя ступень, чтобы числа не расходились
  defaultHourlyRate: DEFAULT_GRID.tiers[0].hourlyRate,
  defaultLeadBonus: DEFAULT_GRID.tiers[0].leadBonus,
  // цену лида для заказчика вносит руководитель (0 — не задана, % ФОТ не считается);
  // потолок ФОТ — из мотивации супервайзера: ФОТ группы не выше 24% дохода
  leadRevenue: 0,
  payrollCapPct: 24,
  rateGrids: [DEFAULT_GRID],
  defaultGridId: DEFAULT_GRID.id,
  svBonus: DEFAULT_SV_BONUS,
  probationLeads: 10,
  probationHours: 15,
  // регламент: «конверсия не ниже 60%, в идеале один лид в час»
  convNormPct: 60,
  withholdPct: 0,
  prorateSalary: true,
  payPeriodStart: "2026-09-22",
  payPeriodDays: 14,
  payDelayDays: 5,
  paySchedule: PAY_SCHEDULE_2026,
  aheadPct: 110,
  normalPct: 95,
  lagPct: 80,
  idleDays: 3,
  dayCloseHour: 21,
  directionEnabled: true,
  directionLabel: "Город / ДЦ",
  duplicateDays: 30,
  theme: "light",
  backupsKeep: 15,
  access: DEFAULT_ACCESS,
  sheets: { url: "", token: "", auto: false, leads: { url: "", token: "", owner: "Борис", auto: false }, registry: { url: "", token: "", auto: false, autoFrom: "", planOkc: 0, planSv: 0 } },
  regions: DEFAULT_REGIONS,
  rop: DEFAULT_ROP
};
function emptyState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    operators: [],
    groups: [],
    projects: [],
    leads: [],
    shifts: [],
    plans: [],
    adjustments: [],
    accounts: [],
    learn: [],
    approves: [],
    candidates: [],
    notes: [],
    audit: [],
    frozenMonths: [],
    leadExports: {},
    leadExportLog: []
  };
}
function normalizeTiers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = list.map((t) => {
    const x = t ?? {};
    return {
      from: Math.max(0, Math.round(Number(x.from) || 0)),
      hourlyRate: Math.max(0, Number(x.hourlyRate) || 0),
      leadBonus: Math.max(0, Number(x.leadBonus) || 0)
    };
  }).sort((a, b) => a.from - b.from).filter((t, i, arr) => i === 0 || t.from !== arr[i - 1].from);
  if (!out.length) return [{ from: 0, hourlyRate: 0, leadBonus: 0 }];
  out[0] = { ...out[0], from: 0 };
  return out;
}
function normalizeGrids(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  list.forEach((g, i) => {
    const x = g ?? {};
    const id = typeof x.id === "string" && x.id && !seen.has(x.id) ? x.id : `grid_${i + 1}_${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    out.push({ id, name: typeof x.name === "string" && x.name.trim() || `Сетка ${i + 1}`, tiers: normalizeTiers(x.tiers) });
  });
  return out;
}
function normalizeSvBonus(raw) {
  const x = raw ?? {};
  const n = (v, d, min = 0, max = 1e9) => {
    const z = Number(v);
    return Number.isFinite(z) ? Math.min(max, Math.max(min, z)) : d;
  };
  const trio = (v, d) => {
    const a = Array.isArray(v) ? v : [];
    return [n(a[0], d[0]), n(a[1], d[1]), n(a[2], d[2])];
  };
  const rows = (Array.isArray(x.rows) && x.rows.length ? x.rows : DEFAULT_SV_BONUS.rows).map((r) => ({ from: Math.round(n(r?.from, 0)), re: trio(r?.re, [0, 0, 0]), auto: trio(r?.auto, [0, 0, 0]) })).sort((a, b) => a.from - b.from);
  const approve = (Array.isArray(x.approve) && x.approve.length ? x.approve : DEFAULT_SV_BONUS.approve).map((a) => ({ from: n(a?.from, 0, 0, 100), k: n(a?.k, 1, 0, 5) })).sort((a, b) => b.from - a.from);
  return {
    salary: n(x.salary, DEFAULT_SV_BONUS.salary, 0, 1e7),
    minLeads: Math.round(n(x.minLeads, DEFAULT_SV_BONUS.minLeads)),
    rows,
    approve,
    noGrowthK: n(x.noGrowthK, DEFAULT_SV_BONUS.noGrowthK, 0, 2),
    defaultApprovePct: n(x.defaultApprovePct, DEFAULT_SV_BONUS.defaultApprovePct, 0, 100)
  };
}
function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...raw || {} };
  const num = (v, d, min = 0, max = 1e9) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  s.teamPlan = num(s.teamPlan, 0);
  s.defaultOperatorPlan = num(s.defaultOperatorPlan, DEFAULT_SETTINGS.defaultOperatorPlan);
  s.defaultNormHours = num(s.defaultNormHours, DEFAULT_SETTINGS.defaultNormHours, 0, 744);
  s.dayHours = num(s.dayHours, 8, 0.5, 24);
  s.defaultSalary = num(s.defaultSalary, 0);
  s.defaultHourlyRate = num(s.defaultHourlyRate, 0);
  s.defaultLeadBonus = num(s.defaultLeadBonus, 0);
  if (s.defaultHourlyRate === 250 && s.defaultLeadBonus === 300) {
    s.defaultHourlyRate = DEFAULT_SETTINGS.defaultHourlyRate;
    s.defaultLeadBonus = DEFAULT_SETTINGS.defaultLeadBonus;
    if (s.defaultPayType === "hourly_bonus") s.defaultPayType = DEFAULT_SETTINGS.defaultPayType;
    if (s.defaultSalary === 4e4) s.defaultSalary = DEFAULT_SETTINGS.defaultSalary;
  }
  s.withholdPct = num(s.withholdPct, 0, 0, 100);
  s.payPeriodStart = typeof s.payPeriodStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.payPeriodStart) ? s.payPeriodStart : DEFAULT_SETTINGS.payPeriodStart;
  if (s.payPeriodStart === "2026-08-25") s.payPeriodStart = "2026-09-22";
  s.payPeriodDays = Math.round(num(s.payPeriodDays, DEFAULT_SETTINGS.payPeriodDays, 7, 31));
  s.payDelayDays = Math.round(num(s.payDelayDays, DEFAULT_SETTINGS.payDelayDays, 0, 30));
  s.paySchedule = normalizeSchedule(s.paySchedule);
  if (!s.paySchedule.length && s.payPeriodStart === "2026-09-22" && s.payPeriodDays === 14 && s.payDelayDays === 4) {
    s.paySchedule = PAY_SCHEDULE_2026.map((r) => ({ ...r }));
    s.payDelayDays = 5;
  }
  s.leadRevenue = num(s.leadRevenue, DEFAULT_SETTINGS.leadRevenue, 0, 1e7);
  s.payrollCapPct = num(s.payrollCapPct, DEFAULT_SETTINGS.payrollCapPct, 0, 100);
  s.aheadPct = num(s.aheadPct, 110, 0, 1e3);
  s.normalPct = num(s.normalPct, 95, 0, 1e3);
  s.lagPct = num(s.lagPct, 80, 0, 1e3);
  s.idleDays = Math.round(num(s.idleDays, 3, 1, 60));
  s.dayCloseHour = Math.round(num(s.dayCloseHour, 21, 0, 24));
  s.duplicateDays = Math.round(num(s.duplicateDays, 30, 0, 3650));
  s.backupsKeep = Math.round(num(s.backupsKeep, 15, 3, 100));
  s.svBonus = normalizeSvBonus(raw?.svBonus);
  s.probationLeads = Math.round(num(s.probationLeads, 10, 0, 1e3));
  s.probationHours = Math.round(num(s.probationHours, 15, 0, 1e3));
  s.convNormPct = num(s.convNormPct, DEFAULT_SETTINGS.convNormPct, 0, 1e3);
  s.regions = normalizeRegions(raw?.regions);
  s.rop = normalizeRop(raw?.rop);
  const sh = raw?.sheets ?? {};
  const dr = sh.leads ?? sh.drops ?? {};
  s.sheets = {
    url: typeof sh.url === "string" ? sh.url.trim() : "",
    token: typeof sh.token === "string" ? sh.token : "",
    auto: sh.auto === true,
    leads: {
      url: typeof dr.url === "string" ? dr.url.trim() : "",
      token: typeof dr.token === "string" ? dr.token : "",
      owner: typeof dr.owner === "string" && dr.owner.trim() ? dr.owner.trim() : "Борис",
      auto: dr.auto === true
    },
    registry: {
      url: typeof sh.registry?.url === "string" ? sh.registry.url.trim() : "",
      token: typeof sh.registry?.token === "string" ? sh.registry.token : "",
      auto: sh.registry?.auto === true,
      autoFrom: typeof sh.registry?.autoFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sh.registry.autoFrom) ? sh.registry.autoFrom : "",
      planOkc: Math.round(num(sh.registry?.planOkc, 0, 0, 1e7)),
      planSv: Math.round(num(sh.registry?.planSv, 0, 0, 1e7))
    }
  };
  s.rateGrids = normalizeGrids(raw?.rateGrids);
  if (!s.rateGrids.length) s.rateGrids = [{ ...DEFAULT_GRID, tiers: [...DEFAULT_GRID.tiers] }];
  const LEGACY = "0:200:200|3:250:300|5:300:400";
  s.rateGrids = s.rateGrids.map(
    (g) => g.id === DEFAULT_GRID.id && g.tiers.map((t) => `${t.from}:${t.hourlyRate}:${t.leadBonus}`).join("|") === LEGACY ? { ...DEFAULT_GRID, tiers: DEFAULT_GRID.tiers.map((t) => ({ ...t })) } : g
  );
  s.defaultGridId = s.rateGrids.some((g) => g.id === s.defaultGridId) ? s.defaultGridId : s.rateGrids[0].id;
  s.workdays = Array.isArray(s.workdays) ? Array.from(new Set(s.workdays.map(Number).filter((d) => d >= 1 && d <= 7))).sort() : [1, 2, 3, 4, 5];
  if (!s.workdays.length) s.workdays = [1, 2, 3, 4, 5];
  s.holidays = Array.isArray(s.holidays) ? s.holidays.filter((d) => typeof d === "string") : [];
  if (!["light", "dark", "system"].includes(s.theme)) s.theme = "light";
  const PAY_TYPES = ["salary", "hourly", "salary_bonus", "hourly_bonus", "tiered", "salary_tiered", "sv_volume"];
  if (!PAY_TYPES.includes(s.defaultPayType)) s.defaultPayType = "tiered";
  if (typeof s.reportMonth !== "string" || s.reportMonth && !/^\d{4}-\d{2}$/.test(s.reportMonth)) s.reportMonth = "";
  s.directionEnabled = s.directionEnabled !== false;
  s.prorateSalary = s.prorateSalary !== false;
  const a = raw?.access ?? {};
  const bool = (v, d) => typeof v === "boolean" ? v : d;
  const sup = { ...DEFAULT_ACCESS.supervisor };
  for (const k of Object.keys(sup)) sup[k] = bool(a.supervisor?.[k], sup[k]);
  const op = { ...DEFAULT_ACCESS.operator };
  op.createOwnLeads = bool(a.operator?.createOwnLeads, op.createOwnLeads);
  op.deleteOwnLeads = bool(a.operator?.deleteOwnLeads, op.deleteOwnLeads);
  op.editOwnShifts = bool(a.operator?.editOwnShifts, op.editOwnShifts);
  op.viewOwnPay = bool(a.operator?.viewOwnPay, op.viewOwnPay);
  op.viewGroupProgress = bool(a.operator?.viewGroupProgress, op.viewGroupProgress);
  op.viewTeamProgress = bool(a.operator?.viewTeamProgress, op.viewTeamProgress);
  op.editOwnLeadsHours = Math.round(num(a.operator?.editOwnLeadsHours, op.editOwnLeadsHours, 0, 24 * 31));
  s.access = { supervisor: sup, operator: op };
  return s;
}
function normalizeRop(raw) {
  const r = raw || {};
  const n = (v, d) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(1e8, Math.max(0, x)) : d;
  };
  const groupTrack = {};
  for (const [k, v] of Object.entries(r.groupTrack ?? {})) if (v === "auto" || v === "re") groupTrack[k] = v;
  const hirePlan = {};
  for (const [k, v] of Object.entries(r.hirePlan ?? {})) {
    const x = Math.round(n(v, 0));
    if (x > 0) hirePlan[k] = Math.min(1e3, x);
  }
  return {
    telecomMonth: n(r.telecomMonth, DEFAULT_ROP.telecomMonth),
    overheadMonth: n(r.overheadMonth, DEFAULT_ROP.overheadMonth),
    capAuto: n(r.capAuto, DEFAULT_ROP.capAuto),
    capRe: n(r.capRe, DEFAULT_ROP.capRe),
    groupTrack,
    hirePlan
  };
}
function normalizeRegions(raw) {
  const r = raw || {};
  const list = (v, d) => Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))) : [...d];
  const main = list(r.main, DEFAULT_REGIONS.main);
  const regional = list(r.regional, DEFAULT_REGIONS.regional).filter((x) => !main.includes(x));
  const n = (v, d, max) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d;
  };
  return {
    main,
    regional,
    regionalApprovePct: n(r.regionalApprovePct, DEFAULT_REGIONS.regionalApprovePct, 100),
    regionalLeadRevenue: n(r.regionalLeadRevenue, DEFAULT_REGIONS.regionalLeadRevenue, 1e7)
  };
}
var isDayKey = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
function normalizeSchedule(v) {
  if (!Array.isArray(v)) return [];
  const rows = v.filter((r) => !!r && isDayKey(r.from) && isDayKey(r.to) && isDayKey(r.pay)).map((r) => ({ from: r.from, to: r.to, pay: r.pay })).sort((a, b) => a.from.localeCompare(b.from));
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    const from = prev ? addDays(prev.to, 1) : r.from;
    if (r.to < from) continue;
    out.push({ from, to: r.to, pay: r.pay < r.to ? r.to : r.pay });
  }
  return out;
}

// lib/crm/format.ts
var nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
var nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
var nf2 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
var money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
var finite = (n) => Number.isFinite(n) ? n : 0;
function fmtMoney(n) {
  const v = Math.round(finite(n));
  return `${v < 0 ? "−" : ""}${money.format(Math.abs(v))} ₽`;
}
function round2(n) {
  return Math.round(finite(n) * 100) / 100;
}
function capName(raw) {
  return (raw || "").trim().replace(/\s+/g, " ").split(" ").map(
    (w) => w.split("-").map((p) => {
      const caps = p.length > 2 && /\p{L}/u.test(p) && p === p.toUpperCase();
      const s = caps ? p.toLowerCase() : p;
      return s.charAt(0).toUpperCase() + s.slice(1);
    }).join("-")
  ).join(" ");
}

// lib/crm/rowspec.ts
var TABLES = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "accounts", "learn", "approves", "candidates", "notes", "audit"];
var OPT = Symbol("optional");
var NOW = Symbol("now");
var SPEC = {
  operators: {
    id: "",
    name: "",
    groupId: null,
    role: "operator",
    status: "active",
    hireDate: "",
    fireDate: "",
    monthlyPlan: null,
    normHours: null,
    payType: "tiered",
    salary: 0,
    hourlyRate: 0,
    leadBonus: null,
    rateGridId: null,
    grade: "mid",
    track: "re",
    contact: "",
    comment: "",
    employment: "none",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null
  },
  groups: { id: "", name: "", supervisorId: null, supervisorName: "", monthlyPlan: 0, active: true, color: "gray", createdAt: NOW, updatedAt: NOW, deletedAt: null },
  projects: { id: "", name: "", active: true, color: "gray", sort: 0, createdAt: NOW, updatedAt: NOW, deletedAt: null },
  leads: {
    id: "",
    at: "",
    client: "",
    phone: "",
    projectId: null,
    operatorId: "",
    groupId: null,
    direction: "",
    link: "",
    region: "",
    comment: "",
    source: "Скорозвон",
    status: "work",
    statusReason: "",
    statusAt: OPT,
    statusBy: OPT,
    createdAt: NOW,
    updatedAt: NOW
  },
  shifts: { id: "", date: "", operatorId: "", groupId: null, hours: 0, type: "work", comment: "", updatedAt: NOW },
  plans: {
    id: "",
    month: "",
    scope: "team",
    targetId: null,
    plan: 0,
    normHours: OPT,
    payType: OPT,
    salary: OPT,
    hourlyRate: OPT,
    leadBonus: OPT,
    tiers: OPT,
    grade: OPT,
    track: OPT,
    approvePct: OPT,
    growth: OPT,
    auto: OPT,
    updatedAt: NOW
  },
  adjustments: { id: "", month: "", operatorId: "", type: "accrual", amount: 0, date: "", comment: "", createdAt: NOW, updatedAt: NOW },
  accounts: {
    id: "",
    name: "",
    login: "",
    role: "operator",
    operatorId: null,
    groupIds: [],
    active: true,
    prefs: {},
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: OPT,
    deletedAt: null
  },
  learn: {
    id: "",
    accountId: "",
    courseId: "",
    itemId: "",
    done: false,
    right: OPT,
    total: OPT,
    last: OPT,
    best: OPT,
    tries: OPT,
    pass: OPT,
    at: OPT,
    checks: OPT,
    note: OPT,
    fav: OPT,
    cert: OPT,
    updatedAt: NOW
  },
  approves: { id: "", month: "", projectId: "", pct: 0, comment: "", updatedAt: NOW },
  candidates: {
    id: "",
    name: "",
    contact: "",
    source: "",
    groupId: null,
    stage: "new",
    appliedAt: "",
    interviewAt: "",
    trainingAt: "",
    closedAt: "",
    operatorId: null,
    reason: "",
    comment: "",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null
  },
  notes: { id: "", operatorId: "", date: "", text: "", metric: "lph", authorId: "", authorName: "", createdAt: NOW, updatedAt: NOW, deletedAt: null },
  audit: { id: "", at: NOW, accountId: "", accountName: "", entity: "", entityId: "", summary: "", changes: OPT }
};
var snake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
function fromRow(table, row) {
  const out = {};
  for (const [k, def] of Object.entries(SPEC[table])) {
    const v = row[snake(k)];
    if (v === null || v === void 0) {
      if (def === OPT) continue;
      out[k] = def === NOW ? "" : def;
    } else out[k] = v;
  }
  if (table === "leads" && typeof out.client === "string") out.client = capName(out.client);
  return out;
}

// lib/crm/types.ts
var NO_GROUP = "__none__";

// lib/crm/ids.ts
function planId(month, scope, targetId) {
  return scope === "team" ? `${month}|team` : `${month}|${scope}|${targetId}`;
}

// lib/crm/regions.ts
function regionSegment(region, s) {
  const r = (region || "").trim();
  if (!r) return null;
  return s.regions.regional.includes(r) ? "regional" : "main";
}
var isRegionalLead = (l, s) => regionSegment(l.region, s) === "regional";

// lib/crm/calc.ts
var gk = (groupId) => groupId || NO_GROUP;
function bump(map, key, day, v) {
  let m = map.get(key);
  if (!m) map.set(key, m = /* @__PURE__ */ new Map());
  m.set(day, (m.get(day) ?? 0) + v);
}
function addTo(map, key, v) {
  let s = map.get(key);
  if (!s) map.set(key, s = /* @__PURE__ */ new Set());
  s.add(v);
}
var WORKED_TYPES = /* @__PURE__ */ new Set(["work", "training"]);
var NO_CUTOFF = "9999-12-31";
function closedThrough(today, hour, s) {
  return hour >= s.dayCloseHour ? today : addDays(today, -1);
}
function supervisorIds(st) {
  const out = /* @__PURE__ */ new Set();
  for (const o of st.operators) if (o.role === "supervisor" || o.payType === "sv_volume") out.add(o.id);
  for (const g of st.groups) if (!g.deletedAt && g.supervisorId) out.add(g.supervisorId);
  return out;
}
function buildIndex(st, workedTo = NO_CUTOFF) {
  const ix = {
    opById: new Map(st.operators.map((o) => [o.id, o])),
    groupById: new Map(st.groups.map((g) => [g.id, g])),
    projectById: new Map(st.projects.map((p) => [p.id, p])),
    planById: new Map(st.plans.map((p) => [p.id, p])),
    day: /* @__PURE__ */ new Map(),
    opDay: /* @__PURE__ */ new Map(),
    groupDay: /* @__PURE__ */ new Map(),
    projectDay: /* @__PURE__ */ new Map(),
    hoursDay: /* @__PURE__ */ new Map(),
    hoursOpDay: /* @__PURE__ */ new Map(),
    hoursGroupDay: /* @__PURE__ */ new Map(),
    svIds: supervisorIds(st),
    plannedOpDay: /* @__PURE__ */ new Map(),
    workedTo,
    shift: /* @__PURE__ */ new Map(),
    opMonths: /* @__PURE__ */ new Map(),
    groupMonthOps: /* @__PURE__ */ new Map(),
    months: /* @__PURE__ */ new Set(),
    lastLead: /* @__PURE__ */ new Map()
  };
  for (const l of st.leads) {
    const d = l.at.slice(0, 10);
    const m = d.slice(0, 7);
    if (l.status === "failed") {
      addTo(ix.opMonths, l.operatorId, m);
      ix.months.add(m);
      continue;
    }
    ix.day.set(d, (ix.day.get(d) ?? 0) + 1);
    bump(ix.opDay, l.operatorId, d, 1);
    bump(ix.groupDay, gk(l.groupId), d, 1);
    bump(ix.projectDay, l.projectId || "__none__", d, 1);
    addTo(ix.opMonths, l.operatorId, m);
    addTo(ix.groupMonthOps, `${m}|${gk(l.groupId)}`, l.operatorId);
    ix.months.add(m);
    const last = ix.lastLead.get(l.operatorId);
    if (!last || d > last) ix.lastLead.set(l.operatorId, d);
  }
  for (const s of st.shifts) {
    ix.shift.set(`${s.date}|${s.operatorId}`, s);
    const m = s.date.slice(0, 7);
    addTo(ix.opMonths, s.operatorId, m);
    ix.months.add(m);
    if (WORKED_TYPES.has(s.type) && s.hours > 0) bump(ix.plannedOpDay, s.operatorId, s.date, s.hours);
    if (WORKED_TYPES.has(s.type) && s.hours > 0 && s.date <= workedTo) {
      bump(ix.hoursOpDay, s.operatorId, s.date, s.hours);
      if (ix.svIds.has(s.operatorId)) continue;
      ix.hoursDay.set(s.date, (ix.hoursDay.get(s.date) ?? 0) + s.hours);
      bump(ix.hoursGroupDay, gk(s.groupId), s.date, s.hours);
    }
  }
  for (const a of st.adjustments) {
    addTo(ix.opMonths, a.operatorId, a.month);
    ix.months.add(a.month);
  }
  return ix;
}
function sumRange(map, from, to) {
  if (!map || from > to) return 0;
  let s = 0;
  const span = rangeDays(from, to);
  if (map.size < span.length) {
    for (const [d, v] of map) if (d >= from && d <= to) s += v;
  } else {
    for (const d of span) s += map.get(d) ?? 0;
  }
  return s;
}
function monthCal(month, s, today) {
  const days = monthDays(month);
  let workdays = days.filter((d) => isWorkday(d, s));
  const noWorkdays = workdays.length === 0;
  if (noWorkdays) workdays = days;
  const workSet = new Set(workdays);
  const cum = /* @__PURE__ */ new Map();
  let c = 0;
  for (const d of days) {
    if (workSet.has(d)) c++;
    cum.set(d, c);
  }
  const first = days[0];
  const last = days[days.length - 1];
  const phase = today > last ? "past" : today < first ? "future" : "current";
  const ref = phase === "past" ? last : phase === "future" ? addDays(first, -1) : today;
  return {
    month,
    days,
    workdays,
    W: Math.max(1, workdays.length),
    phase,
    today,
    ref,
    isWork: (d) => workSet.has(d),
    wIdx: (d) => d < first ? 0 : d > last ? c : cum.get(d) ?? 0
  };
}
function workdaysBetween(cal, from, to) {
  if (from > to) return 0;
  return Math.max(0, cal.wIdx(to) - cal.wIdx(addDays(from, -1)));
}
function employmentWindow(op, month) {
  const f = monthStart(month);
  const t = monthEnd(month);
  const from = op.hireDate && op.hireDate > f ? op.hireDate : f;
  const to = op.fireDate && op.fireDate < t ? op.fireDate : t;
  if (from > t || to < f || from > to) return null;
  return { from, to };
}
var isGone = (op) => op.status === "fired" || !!op.deletedAt;
function employedIn(op, month) {
  if (op.status === "fired" && !op.fireDate) return false;
  return employmentWindow(op, month) !== null;
}
function employmentShare(op, cal) {
  const w = employmentWindow(op, cal.month);
  if (!w) return 0;
  return Math.min(1, workdaysBetween(cal, w.from, w.to) / cal.W);
}
var approveCache = /* @__PURE__ */ new WeakMap();
function approvePctFor(st, ix, month) {
  let cache = approveCache.get(ix);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    approveCache.set(ix, cache);
  }
  const hit = cache.get(month);
  if (hit != null) return hit;
  const out = approvePctWhere(st, month, () => true);
  cache.set(month, out);
  return out;
}
function approveTable(st, month) {
  const fallback = st.approves.find((a) => a.month === month && !a.projectId)?.pct ?? st.settings.svBonus.defaultApprovePct;
  const byProject = new Map(st.approves.filter((a) => a.month === month && a.projectId).map((a) => [a.projectId, a.pct]));
  return (l) => isRegionalLead(l, st.settings) ? st.settings.regions.regionalApprovePct : (l.projectId ? byProject.get(l.projectId) : void 0) ?? fallback;
}
function approvePctWhere(st, month, keep) {
  const pctOf = approveTable(st, month);
  const fallback = st.approves.find((a) => a.month === month && !a.projectId)?.pct ?? st.settings.svBonus.defaultApprovePct;
  let sum = 0;
  let weight = 0;
  for (const l of st.leads) {
    if (l.status === "failed" || l.at.slice(0, 7) !== month || !keep(l)) continue;
    sum += pctOf(l);
    weight++;
  }
  return weight > 0 ? Math.round(sum / weight * 10) / 10 : fallback;
}
function opTerms(op, cal, st, ix) {
  const rec = ix.planById.get(planId(cal.month, "operator", op.id));
  const s = st.settings;
  const share = employmentShare(op, cal);
  const basePlan = op.monthlyPlan ?? s.defaultOperatorPlan;
  const baseNorm = op.normHours ?? s.defaultNormHours;
  const grid = s.rateGrids.find((g) => g.id === (op.rateGridId ?? s.defaultGridId)) ?? s.rateGrids.find((g) => g.id === s.defaultGridId) ?? s.rateGrids[0];
  return {
    plan: rec ? rec.plan : Math.round(basePlan * share),
    normHours: rec?.normHours ?? Math.round(baseNorm * share * 10) / 10,
    payType: rec?.payType ?? op.payType,
    salary: rec?.salary ?? (op.payType === "sv_volume" && !op.salary ? s.svBonus.salary : op.salary),
    hourlyRate: rec?.hourlyRate ?? op.hourlyRate,
    leadBonus: rec?.leadBonus ?? op.leadBonus ?? s.defaultLeadBonus,
    tiers: rec?.tiers ?? grid?.tiers ?? [],
    grade: rec?.grade ?? op.grade ?? "mid",
    track: rec?.track ?? op.track ?? "re",
    approvePct: rec?.approvePct ?? approvePctFor(st, ix, cal.month),
    growth: rec?.growth ?? null,
    explicit: !!rec
  };
}
function monthOperators(st, ix, month) {
  return st.operators.filter((op) => {
    const active = ix.opMonths.get(op.id)?.has(month);
    if (active) return true;
    if (op.deletedAt) return false;
    return employedIn(op, month);
  });
}
function supervisedGroups(st, operatorId) {
  return st.groups.filter((g) => g.supervisorId === operatorId).map((g) => g.id);
}
function supervisedLeads(st, ix, operatorId, month) {
  const from = monthStart(month);
  const to = monthEnd(month);
  let n = 0;
  for (const g of supervisedGroups(st, operatorId)) n += sumRange(ix.groupDay.get(g), from, to);
  return n;
}
function freezePastMonths(st, ix, today) {
  const cur = monthOf(today);
  const done = new Set(st.frozenMonths);
  const months = Array.from(ix.months).filter((m) => m < cur && !done.has(m)).sort();
  const plans = [];
  const stamp = (/* @__PURE__ */ new Date()).toISOString();
  for (const m of months) {
    const cal = monthCal(m, st.settings, today);
    for (const op of monthOperators(st, ix, m)) {
      const id = planId(m, "operator", op.id);
      if (ix.planById.has(id)) continue;
      const t = opTerms(op, cal, st, ix);
      plans.push({
        id,
        month: m,
        scope: "operator",
        targetId: op.id,
        plan: t.plan,
        normHours: t.normHours,
        payType: t.payType,
        salary: t.salary,
        hourlyRate: t.hourlyRate,
        leadBonus: t.leadBonus,
        tiers: t.tiers,
        grade: t.grade,
        track: t.track,
        approvePct: t.approvePct,
        growth: t.growth ?? void 0,
        auto: true,
        updatedAt: stamp
      });
    }
    for (const g of st.groups) {
      if (g.monthlyPlan <= 0) continue;
      const id = planId(m, "group", g.id);
      if (ix.planById.has(id)) continue;
      plans.push({ id, month: m, scope: "group", targetId: g.id, plan: g.monthlyPlan, auto: true, updatedAt: stamp });
    }
  }
  return { plans, months };
}

// lib/crm/payroll.ts
var zeroAdj = () => ({
  accrual: 0,
  bonus: 0,
  compensation: 0,
  correction: 0,
  deduction: 0,
  advance: 0,
  payout: 0
});
var isTiered = (t) => t === "tiered" || t === "salary_tiered";
var isSvVolume = (t) => t === "sv_volume";
var hasBonus = (t) => t === "salary_bonus" || t === "hourly_bonus" || isTiered(t);
var isSalary = (t) => t === "salary" || t === "salary_bonus" || t === "salary_tiered" || t === "sv_volume";
var isHourlyTiered = (t) => t === "tiered";
function svBonus(grid, leads, prevLeads, opts) {
  const rows = grid.rows;
  let row = rows[0];
  for (const r of rows) if (leads >= r.from) row = r;
  const col = opts.grade === "jr" ? 0 : opts.grade === "mid" ? 1 : 2;
  const belowMin = leads < grid.minLeads;
  const base = belowMin || !row ? 0 : (opts.track === "auto" ? row.auto : row.re)[col];
  const kApprove = grid.approve.find((a) => opts.approvePct >= a.from)?.k ?? 0;
  const growth = opts.growth ?? leads > prevLeads;
  const kGrowth = growth || opts.grade === "jr" ? 1 : grid.noGrowthK;
  const nextRow = rows.find((r) => r.from > leads && ((opts.track === "auto" ? r.auto : r.re)[col] > base || r.from >= grid.minLeads));
  return {
    leads,
    prevLeads,
    groups: opts.groups ?? 0,
    grade: opts.grade,
    track: opts.track,
    step: row?.from ?? 0,
    base,
    approvePct: opts.approvePct,
    kApprove,
    growth,
    kGrowth,
    bonus: Math.round(base * kApprove * kGrowth),
    belowMin,
    next: nextRow ? { from: nextRow.from, base: (opts.track === "auto" ? nextRow.auto : nextRow.re)[col] } : null
  };
}
function tierFor(tiers, leads) {
  let cur = tiers[0] ?? { from: 0, hourlyRate: 0, leadBonus: 0 };
  for (const t of tiers) if (leads >= t.from) cur = t;
  return cur;
}
function tieredMonth(operatorId, days, ix, tiers, withHourly) {
  const leadMap = ix.opDay.get(operatorId);
  const hourMap = ix.hoursOpDay.get(operatorId);
  const use = /* @__PURE__ */ new Map();
  let hourly = 0;
  let bonus = 0;
  for (const d of days) {
    const leads = leadMap?.get(d) ?? 0;
    const hours = hourMap?.get(d) ?? 0;
    if (!leads && !hours) continue;
    const t = tierFor(tiers, leads);
    const h = withHourly ? hours * t.hourlyRate : 0;
    const b = leads * t.leadBonus;
    hourly += h;
    bonus += b;
    const u = use.get(t.from) ?? { ...t, days: 0, hours: 0, leads: 0, sum: 0 };
    u.days += 1;
    u.hours += hours;
    u.leads += leads;
    u.sum += h + b;
    use.set(t.from, u);
  }
  return { hourly: round2(hourly), bonus: round2(bonus), use: Array.from(use.values()).sort((a, b) => a.from - b.from) };
}
function accrual(op, cal, st, ix, upTo) {
  const t = opTerms(op, cal, st, ix);
  const days = monthDays(cal.month).filter((d) => d <= cal.ref && d <= ix.workedTo && (!upTo || d <= upTo));
  const hours = days.length ? round2(sumRange(ix.hoursOpDay.get(op.id), days[0], days[days.length - 1])) : 0;
  const leads = days.length ? sumRange(ix.opDay.get(op.id), days[0], days[days.length - 1]) : 0;
  let base = 0;
  let leadPay = 0;
  let salaryShare = 0;
  let tierUse = [];
  let sv = null;
  if (isSvVolume(t.payType)) {
    const hasSchedule = cal.days.some((d) => ix.shift.has(`${d}|${op.id}`));
    const credited = hasSchedule ? days.filter((d) => {
      const sh = ix.shift.get(`${d}|${op.id}`);
      return !!sh && WORKED_TYPES.has(sh.type) && sh.hours > 0;
    }).length : days.filter((d) => cal.isWork(d)).length;
    salaryShare = Math.min(1, credited / cal.W);
    base = t.salary * salaryShare;
    const gLeads = supervisedLeads(st, ix, op.id, cal.month);
    const prev = supervisedLeads(st, ix, op.id, addMonths(cal.month, -1));
    sv = svBonus(st.settings.svBonus, gLeads, prev, {
      grade: t.grade,
      track: t.track,
      approvePct: t.approvePct,
      growth: t.growth,
      groups: supervisedGroups(st, op.id).length
    });
    leadPay = sv.bonus;
  } else if (isTiered(t.payType)) {
    const tm = tieredMonth(op.id, days, ix, t.tiers, isHourlyTiered(t.payType));
    tierUse = tm.use;
    leadPay = tm.bonus;
    if (isHourlyTiered(t.payType)) base = tm.hourly;
    else {
      salaryShare = st.settings.prorateSalary ? t.normHours > 0 ? Math.min(1, hours / t.normHours) : 1 : 1;
      base = t.salary * salaryShare;
    }
  } else if (isSalary(t.payType)) {
    salaryShare = st.settings.prorateSalary ? t.normHours > 0 ? Math.min(1, hours / t.normHours) : 1 : 1;
    base = t.salary * salaryShare;
    leadPay = hasBonus(t.payType) ? leads * t.leadBonus : 0;
  } else {
    base = hours * t.hourlyRate;
    leadPay = hasBonus(t.payType) ? leads * t.leadBonus : 0;
  }
  return { t, hours, leads, base, leadPay, salaryShare, tierUse, sv };
}
function withAdjustments(r, adjustments, st) {
  const { base, leadPay } = r;
  const adj = zeroAdj();
  for (const a of adjustments) adj[a.type] += Number(a.amount) || 0;
  const gross = base + leadPay + adj.accrual + adj.bonus + adj.compensation + adj.correction;
  const withholdBase = Math.max(0, gross - adj.compensation);
  const withhold = withholdBase * st.settings.withholdPct / 100;
  const deductions = adj.deduction;
  const net = gross - withhold - deductions;
  const paid = adj.advance + adj.payout;
  return {
    ...r,
    base: round2(base),
    leadPay: round2(leadPay),
    adj,
    adjustments,
    gross: round2(gross),
    withholdBase: round2(withholdBase),
    withhold: round2(withhold),
    deductions: round2(deductions),
    net: round2(net),
    paid: round2(paid),
    toPay: round2(net - paid)
  };
}
function rowsTotal(rows) {
  const total = {
    hours: 0,
    leads: 0,
    base: 0,
    leadPay: 0,
    adj: zeroAdj(),
    gross: 0,
    withholdBase: 0,
    withhold: 0,
    deductions: 0,
    net: 0,
    paid: 0,
    toPay: 0
  };
  for (const r of rows) {
    total.hours += r.hours;
    total.leads += r.leads;
    total.base += r.base;
    total.leadPay += r.leadPay;
    total.gross += r.gross;
    total.withholdBase += r.withholdBase;
    total.withhold += r.withhold;
    total.deductions += r.deductions;
    total.net += r.net;
    total.paid += r.paid;
    total.toPay += r.toPay;
    for (const k of Object.keys(total.adj)) total.adj[k] += r.adj[k];
  }
  return total;
}
var TAX_PCT = 6;
var withTax = (n) => n > 5e-3 ? Math.round(n / (1 - TAX_PCT / 100)) : 0;

// lib/crm/payperiod.ts
var MS_DAY = 864e5;
var REGISTRY_DAYS = 3;
var registryOf = (to, pay) => {
  const d = addDays(pay, -REGISTRY_DAYS);
  return d > to ? d : addDays(to, 1) < pay ? addDays(to, 1) : pay;
};
var dayNum = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / MS_DAY);
function periodAt(s, idx) {
  const list = s.paySchedule;
  if (idx < list.length) return { idx, ...list[idx], registry: registryOf(list[idx].to, list[idx].pay), first: idx === 0 };
  const origin = list.length ? addDays(list[list.length - 1].to, 1) : s.payPeriodStart;
  const from = addDays(origin, (idx - list.length) * s.payPeriodDays);
  const to = addDays(from, s.payPeriodDays - 1);
  const pay = addDays(to, s.payDelayDays);
  return { idx, from, to, pay, registry: registryOf(to, pay), first: idx === 0 };
}
function periodIndexOf(s, d) {
  const list = s.paySchedule;
  if (!list.length) return Math.max(0, Math.floor((dayNum(d) - dayNum(s.payPeriodStart)) / s.payPeriodDays));
  const last = list[list.length - 1];
  if (d > last.to) return list.length + Math.floor((dayNum(d) - dayNum(last.to) - 1) / s.payPeriodDays);
  const i = list.findIndex((p) => d <= p.to);
  return Math.max(0, i);
}
function adjustmentPeriod(s, a) {
  const i = periodIndexOf(s, a.date);
  return a.type === "payout" ? Math.max(0, i - 1) : i;
}
function dataStart(st, periodStart = st.settings.payPeriodStart) {
  let m = periodStart;
  for (const sh of st.shifts) if (sh.date < m && sh.hours > 0 && WORKED_TYPES.has(sh.type)) m = sh.date;
  for (const l of st.leads) {
    const d = l.at.slice(0, 10);
    if (d < m && l.status !== "failed") m = d;
  }
  return m;
}
function periodPayroll(st, ix, today, period) {
  const s = st.settings;
  const start = period.first ? dataStart(st, period.from) : period.from;
  const months = [];
  for (let m = monthOf(start); m <= monthOf(period.to); m = addMonths(m, 1)) months.push(m);
  const adjByOp = /* @__PURE__ */ new Map();
  for (const a of st.adjustments) {
    if (adjustmentPeriod(s, a) !== period.idx) continue;
    adjByOp.set(a.operatorId, [...adjByOp.get(a.operatorId) ?? [], a]);
  }
  const ops = /* @__PURE__ */ new Map();
  for (const m of months) for (const op of monthOperators(st, ix, m)) ops.set(op.id, op);
  for (const id of adjByOp.keys()) {
    const op = ix.opById.get(id);
    if (op) ops.set(id, op);
  }
  const kpiMonths = [];
  for (let m = monthOf(start); m <= monthOf(period.to); m = addMonths(m, 1)) {
    const next = monthStart(addMonths(m, 1));
    if (next <= period.to && (period.first || next >= period.from)) kpiMonths.push(m);
  }
  const cals = new Map(months.map((m) => [m, monthCal(m, s, today)]));
  const rows = [];
  for (const op of ops.values()) {
    const segments = [];
    let base = 0;
    let leadPay = 0;
    let hours = 0;
    let leads = 0;
    let terms = null;
    const tiers = /* @__PURE__ */ new Map();
    let salaryShare = 0;
    const sv = isSvVolume(opTermsType(op, st, ix, cals, months));
    for (const m of months) {
      const cal = cals.get(m);
      const segFrom = start > monthStart(m) ? start : monthStart(m);
      const segTo = period.to < monthEnd(m) ? period.to : monthEnd(m);
      if (segFrom > segTo) continue;
      const end = accrual(op, cal, st, ix, segTo);
      const before = segFrom > monthStart(m) ? accrual(op, cal, st, ix, addDays(segFrom, -1)) : null;
      terms = end.t;
      const seg = {
        month: m,
        from: segFrom,
        to: segTo,
        hours: round2(end.hours - (before?.hours ?? 0)),
        leads: end.leads - (before?.leads ?? 0),
        base: round2(end.base - (before?.base ?? 0)),
        // у супервайзера leadPay в accrual — месячный KPI: в периоде его нет, он приходит отдельно
        leadPay: sv ? 0 : round2(end.leadPay - (before?.leadPay ?? 0)),
        openFrom: null,
        salaryShare: 0
      };
      for (const u of end.tierUse) {
        const k = `${u.from}|${u.hourlyRate}|${u.leadBonus}`;
        const b = before?.tierUse.find((x) => x.from === u.from && x.hourlyRate === u.hourlyRate && x.leadBonus === u.leadBonus);
        const d = { ...u, days: u.days - (b?.days ?? 0), hours: round2(u.hours - (b?.hours ?? 0)), leads: u.leads - (b?.leads ?? 0), sum: round2(u.sum - (b?.sum ?? 0)) };
        if (!d.days) continue;
        const prev = tiers.get(k);
        tiers.set(k, prev ? { ...prev, days: prev.days + d.days, hours: round2(prev.hours + d.hours), leads: prev.leads + d.leads, sum: round2(prev.sum + d.sum) } : d);
      }
      seg.salaryShare = round2(end.salaryShare - (before?.salaryShare ?? 0));
      salaryShare += seg.salaryShare;
      const closedTo = [segTo, cal.ref, ix.workedTo].sort()[0];
      seg.openFrom = closedTo < segTo ? closedTo < segFrom ? segFrom : addDays(closedTo, 1) : null;
      if (seg.hours || seg.leads || seg.base || seg.leadPay || seg.openFrom) segments.push(seg);
      base += seg.base;
      leadPay += seg.leadPay;
      hours += seg.hours;
      leads += seg.leads;
    }
    const kpi = [];
    let kpiPending = null;
    if (sv) {
      for (const m of kpiMonths) {
        const cal = monthCal(m, s, today);
        if (cal.phase !== "past") {
          kpiPending = m;
          continue;
        }
        const a = accrual(op, cal, st, ix);
        if (a.sv && a.sv.bonus) kpi.push({ month: m, amount: round2(a.sv.bonus) });
      }
      if (!kpiPending && months.some((m) => cals.get(m).phase === "current")) kpiPending = months.find((m) => cals.get(m).phase === "current") ?? null;
    }
    const kpiSum = kpi.reduce((a, k) => a + k.amount, 0);
    const adjustments = (adjByOp.get(op.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    if (!segments.some((g) => g.hours || g.leads || g.base || g.leadPay) && !kpiSum && !adjustments.length) continue;
    const t = terms ?? accrual(op, cals.get(months[months.length - 1]), st, ix).t;
    const row = withAdjustments(
      {
        op,
        payType: t.payType,
        salary: t.salary,
        hourlyRate: t.hourlyRate,
        leadBonus: t.leadBonus,
        tiers: t.tiers,
        tierUse: Array.from(tiers.values()).sort((a, b) => a.from - b.from),
        sv: null,
        normHours: t.normHours,
        hours: round2(hours),
        leads,
        salaryShare,
        base,
        leadPay: leadPay + kpiSum,
        explicitTerms: false
      },
      adjustments,
      st
    );
    rows.push({ ...row, segments, kpi, kpiPending });
  }
  rows.sort((a, b) => a.op.name.localeCompare(b.op.name, "ru"));
  return { period, start, rows, total: rowsTotal(rows) };
}
function opTermsType(op, st, ix, cals, months) {
  return opTerms(op, cals.get(months[months.length - 1]), st, ix).payType;
}

// lib/crm/registry.ts
var PROJECT_LABEL = { okc: "ОКЦ", sv: "СВ" };
var KIND_LABEL = { plan: "План", fact: "Факт" };
var dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
var ruDate = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
var registryTab = (kind, project, from, to) => `${KIND_LABEL[kind]} ${PROJECT_LABEL[project]} (${dm(from)}-${dm(to)})`;
var registryLine = (opId, name, net) => {
  const n = Math.max(0, Math.round(net));
  return { opId, name, net: n, sum: withTax(n) };
};
var registryPlanLine = (opId, name, sum) => {
  const s = Math.max(0, Math.round(sum));
  return { opId, name, net: Math.round(s * (1 - TAX_PCT / 100)), sum: s };
};
function registryPayload(kind, project, start, periodTo, taskFrom, taskTo, lines) {
  return {
    project,
    kind,
    tab: registryTab(kind, project, start, periodTo),
    periodTo: dm(periodTo),
    from: ruDate(taskFrom),
    to: ruDate(taskTo),
    rows: lines.map((l) => ({ name: l.name.trim(), net: l.net, sum: l.sum }))
  };
}

// lib/crm/registryAuto.ts
var PLAN_DAYS_BEFORE = 2;
var PROJECTS = ["okc", "sv"];
function isSvOp(op, st) {
  return op.role === "supervisor" || op.payType === "sv_volume" || st.groups.some((g) => !g.deletedAt && g.supervisorId === op.id);
}
var jobKey = (kind, project, tab) => `${kind}|${project}|${tab}`;
function autoJobs(st, today, hour, done) {
  const s = st.settings;
  const cfg = s.sheets.registry;
  const out = { today, jobs: [], notSmz: [] };
  const cur = periodIndexOf(s, today);
  const periods = [cur - 1, cur, cur + 1].filter((i) => i >= 0).map((i) => periodAt(s, i));
  const mine = (day) => !cfg.autoFrom || day >= cfg.autoFrom;
  for (const p of periods) {
    const planDay = addDays(p.from, -PLAN_DAYS_BEFORE);
    if (today >= planDay && today <= p.from && mine(planDay)) planJobs(st, p, today > p.from ? today : p.from, done, out, "");
    if (today >= p.registry && today < p.pay && today > p.to && mine(p.registry)) factJobs(st, p, today, hour, done, out, "");
  }
  return out;
}
var TEST_PREFIX = "ТЕСТ ";
function testJobs(st, today, hour) {
  const s = st.settings;
  const out = { today, jobs: [], notSmz: [] };
  const cur = periodIndexOf(s, today);
  const next = periodAt(s, cur + 1);
  planJobs(st, next, next.from > today ? next.from : today, {}, out, TEST_PREFIX);
  factJobs(st, periodAt(s, cur), today, hour, {}, out, TEST_PREFIX);
  return out;
}
var startOf = (st, p) => p.first ? dataStart(st, p.from) : p.from;
function planJobs(st, p, from, done, out, prefix) {
  const cfg = st.settings.sheets.registry;
  const start = startOf(st, p);
  const by = { okc: [], sv: [] };
  for (const op of st.operators) {
    if (isGone(op) || op.employment !== "smz") continue;
    if (op.hireDate && op.hireDate > p.to) continue;
    by[isSvOp(op, st) ? "sv" : "okc"].push(op);
  }
  for (const project of PROJECTS) {
    const ops = by[project].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!ops.length) continue;
    const amount = project === "sv" ? cfg.planSv : cfg.planOkc;
    const lines = ops.map((op) => registryPlanLine(op.id, op.name, amount));
    const payload = registryPayload("plan", project, start, p.to, from, p.to, lines);
    payload.tab = prefix + payload.tab;
    const key = jobKey("plan", project, payload.tab);
    if (done[key]) continue;
    out.jobs.push(
      amount > 0 ? { key, kind: "plan", project, period: p, start, payload } : { key, kind: "plan", project, period: p, start, payload: null, skip: `не задана сумма плана ${PROJECT_LABEL[project]} (Настройки → Данные → «Реестры выплат YouDo»)` }
    );
  }
}
function factJobs(st, p, today, hour, done, out, prefix) {
  const start = startOf(st, p);
  const ix = buildIndex(st, closedThrough(today, hour, st.settings));
  const pr = periodPayroll(st, ix, today, p);
  const lines = { okc: [], sv: [] };
  const factTab = (pj) => prefix + registryPayload("fact", pj, start, p.to, today, p.pay, []).tab;
  for (const r of pr.rows) {
    if (r.toPay < 0.5) continue;
    const project = isSvOp(r.op, st) ? "sv" : "okc";
    if (r.op.employment !== "smz") {
      if (!done[jobKey("fact", project, factTab(project))]) out.notSmz.push({ name: r.op.name, net: Math.round(r.toPay), tab: factTab(project) });
      continue;
    }
    lines[project].push(registryLine(r.op.id, r.op.name, r.toPay));
  }
  for (const project of PROJECTS) {
    if (!lines[project].length) continue;
    const payload = registryPayload("fact", project, start, p.to, today, p.pay, lines[project]);
    payload.tab = prefix + payload.tab;
    const key = jobKey("fact", project, payload.tab);
    if (done[key]) continue;
    out.jobs.push({ key, kind: "fact", project, period: p, start, payload });
  }
}
var esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var short = (name) => name.trim().split(/\s+/).slice(0, 2).join(" ");
var dmy = (d) => ruDate(d).slice(0, 5);
var rub = (n) => esc(fmtMoney(n));
function autoMessage(plan, results, test = false) {
  if (!results.length && !plan.notSmz.length) return "";
  const out = [test ? "🧪 <b>Реестры YouDo — тестовый прогон</b>\n<i>листы «ТЕСТ …» можно удалить</i>" : "📋 <b>Реестры YouDo</b>"];
  const blocks = /* @__PURE__ */ new Map();
  for (const r of results) {
    const k = `${r.job.kind}|${r.job.period.idx}`;
    blocks.set(k, [...blocks.get(k) ?? [], r]);
  }
  for (const list of blocks.values()) {
    const { kind, period, start } = list[0].job;
    const head = kind === "plan" ? "🗓 <b>ПЛАН</b>" : "💰 <b>ФАКТ</b>";
    const block = [`${head} · ${dmy(start)} – ${dmy(period.to)}`];
    if (kind === "plan") {
      const p = list.find((r) => r.job.payload)?.job.payload;
      if (p) block.push(`<i>задание ${esc(p.from.slice(0, 5))} – ${esc(p.to.slice(0, 5))}, сумма условная — факт заменит</i>`);
    } else block.push(`<i>к выплате ${dmy(period.pay)}</i>`);
    for (const { job, reply, error } of list) {
      const p = job.payload;
      const label = `<b>${PROJECT_LABEL[job.project]}</b>`;
      block.push("");
      if (job.skip) {
        block.push(`${label} — ⚠️ ${esc(job.skip)}`);
        continue;
      }
      if (error) {
        block.push(`${label} — ❌ ${esc(error)}`, "повторю в следующий запуск");
        continue;
      }
      if (!reply || !p) continue;
      if (reply.exists) {
        block.push(`${label} — лист «${esc(reply.tab ?? p.tab)}» уже есть, не трогал`);
        continue;
      }
      const sum = p.rows.reduce((a, r) => a + r.sum, 0);
      const link = reply.url ? ` · <a href="${esc(reply.url)}">открыть</a>` : "";
      block.push(`${label} — ${p.rows.length} чел. · ${rub(sum)}${link}`);
      if (reply.unconfirmed) block.push("⚠️ Google не подтвердил запись — проверьте лист");
      if (kind === "plan" && p.rows[0]) block.push(`по ${rub(p.rows[0].sum)} каждому`);
      if (kind === "fact") {
        if (reply.changed?.length) block.push("Изменилось против плана:", ...reply.changed.map((c) => `• ${esc(short(c.name))}: ${rub(c.from)} → ${rub(c.to)}`));
        if (reply.zeroed?.length) block.push("Обнулить задание (в факте 0):", ...reply.zeroed.map((n) => `• ${esc(short(n))}`));
        if (reply.added?.length) block.push("Новые задания (не было в плане):", ...reply.added.map((n) => `• ${esc(short(n))}`));
        if (!reply.plan && !reply.unconfirmed) block.push("<i>листа плана не нашлось — даты задания с сегодня до выплаты</i>");
      }
      if (reply.missing?.length) block.push("⚠️ Нет ИНН в реестре исполнителей:", ...reply.missing.map((m) => `• ${esc(short(m.name))} — ${esc(m.why)}`));
    }
    out.push("", "━━━━━━━━━━", ...block);
  }
  if (plan.notSmz.length)
    out.push(
      "",
      "━━━━━━━━━━",
      "⚠️ <b>Не попали в реестр — нет СМЗ</b>",
      ...plan.notSmz.map((x) => `• ${esc(short(x.name))} — ${rub(x.net)}`),
      "<i>оформить СМЗ в карточке или выплатить иначе</i>"
    );
  return out.join("\n");
}

// supabase/functions/registry-sheet/src/main.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
var isDm = (v) => typeof v === "string" && /^\d{2}\.\d{2}$/.test(v);
var isRuDate = (v) => typeof v === "string" && /^\d{2}\.\d{2}\.\d{4}$/.test(v);
var NEED = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "approves"];
var LOG_KEEP = 100;
async function push(cfg, body) {
  const first = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: cfg.token, ...body }),
    redirect: "manual"
  });
  const moved = first.status >= 300 && first.status < 400;
  let res = first;
  if (moved) {
    const loc = first.headers.get("location");
    await first.body?.cancel();
    if (!loc) return { ok: true, unconfirmed: true };
    res = await fetch(loc);
  }
  const text = await res.text();
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    if (moved) return { ok: true, unconfirmed: true };
    throw new Error(`Скрипт реестров ответил не JSON (HTTP ${res.status}) — проверьте ссылку /exec, развёртывание и доступ «Все»`);
  }
  if (reply.ok !== true) throw new Error(reply.error || "скрипт вернул ошибку");
  return reply;
}
async function loadState(admin) {
  const fetchAll = async (table) => {
    const out = [];
    for (let off = 0; ; off += 1e3) {
      const { data, error } = await admin.from(table).select("*").range(off, off + 999);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return out;
        throw new Error(`${table}: ${error.message}`);
      }
      out.push(...data ?? []);
      if (!data || data.length < 1e3) break;
    }
    return out;
  };
  const [kvRows, ...rows] = await Promise.all([fetchAll("kv"), ...NEED.map(fetchAll)]);
  const st = emptyState();
  NEED.forEach((t, i) => {
    if (!TABLES.includes(t)) return;
    st[t] = rows[i].map((r) => fromRow(t, r));
  });
  const kv = (k) => kvRows.find((r) => r.key === k)?.value;
  const sheets = kv("sheets");
  st.settings = normalizeSettings({ ...kv("settings") ?? {}, ...sheets ? { sheets } : {} });
  st.frozenMonths = (kv("frozenMonths") ?? []).filter((m) => typeof m === "string");
  st.leads = st.leads.map((l) => l.status ? l : { ...l, status: "work", statusReason: l.statusReason ?? "" });
  return { st, kv };
}
async function telegram(text) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chats = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!token || !chats.length || !text) return token && chats.length ? null : "Telegram не настроен (секреты TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)";
  for (const chat_id of chats) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true })
    });
    if (!r.ok) return `Telegram: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  return null;
}
async function audit(admin, who, summary) {
  await admin.from("audit").insert({
    id: `au-rg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    account_id: "",
    account_name: `${who} · YouDo`,
    entity: "payroll",
    entity_id: "registry",
    summary
  });
}
async function manual(admin, cfg, who, b) {
  if (b.project !== "okc" && b.project !== "sv") return json({ error: "Проект — okc или sv" }, 400);
  if (b.kind !== "plan" && b.kind !== "fact") return json({ error: "Вид — plan или fact" }, 400);
  if (typeof b.tab !== "string" || !b.tab.trim() || b.tab.length > 90) return json({ error: "Нет названия листа" }, 400);
  if (!isDm(b.periodTo) || !isRuDate(b.from) || !isRuDate(b.to)) return json({ error: "Даты периода — дд.мм и дд.мм.гггг" }, 400);
  const rows = (Array.isArray(b.rows) ? b.rows : []).filter((r) => r && typeof r.name === "string" && r.name.trim() && Number.isFinite(r.net) && Number.isFinite(r.sum) && r.net >= 0 && r.sum >= 0).slice(0, 500).map((r) => ({ name: r.name.trim().slice(0, 120), net: Math.round(r.net), sum: Math.round(r.sum) }));
  if (!rows.length) return json({ error: "В реестре нет ни одной строки" }, 400);
  const tab = b.tab.trim();
  let reply;
  try {
    reply = await push(cfg, { project: b.project, kind: b.kind, tab, periodTo: b.periodTo, from: b.from, to: b.to, rows, replace: b.replace === true });
  } catch (e) {
    return json({ error: `«${tab}»: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
  if (!reply.exists) {
    const total = rows.reduce((a, r) => a + r.sum, 0);
    await audit(admin, who, `Реестр YouDo «${tab}»${reply.unconfirmed ? " (без подтверждения)" : reply.created ? " создан" : " перезаписан"}: ${rows.length} чел., ${total.toLocaleString("ru-RU")} ₽ с налогом`);
  }
  return json(reply);
}
async function auto(admin, who, opts) {
  const { st, kv } = await loadState(admin);
  const cfg = st.settings.sheets.registry;
  if (opts.cron && !opts.test && !cfg.auto) return json({ skipped: "Автомат реестров выключен в настройках CRM" });
  const stamp = appStamp();
  const today = stamp.slice(0, 10);
  const hour = Number(stamp.slice(11, 13));
  const fz = freezePastMonths(st, buildIndex(st), today);
  st.plans = [...st.plans, ...fz.plans];
  st.frozenMonths = [...st.frozenMonths, ...fz.months];
  const store = kv("registryAuto") ?? {};
  const done = { ...store.done ?? {} };
  const plan = opts.test ? testJobs(st, today, hour) : autoJobs(st, today, hour, done);
  if (opts.dry)
    return json({
      today,
      configured: !!cfg.url && !!cfg.token,
      auto: cfg.auto,
      jobs: plan.jobs.map((j) => ({ kind: j.kind, project: j.project, tab: j.payload?.tab ?? null, rows: j.payload?.rows.length ?? 0, sum: j.payload?.rows.reduce((a, r) => a + r.sum, 0) ?? 0, skip: j.skip ?? null })),
      notSmz: plan.notSmz
    });
  if (!plan.jobs.length && !plan.notSmz.length) return json({ today, jobs: 0, note: "Сегодня по графику реестров нет" });
  if (!cfg.url || !cfg.token) {
    const tg2 = await telegram("<b>Реестры YouDo</b>\n❌ Пора отправлять реестр, но скрипт не подключён (CRM → Настройки → Данные → «Реестры выплат YouDo»)");
    return json({ error: "Реестры не настроены", telegram: tg2 }, 400);
  }
  const results = [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const job of plan.jobs) {
    if (!job.payload) {
      results.push({ job });
      continue;
    }
    try {
      let reply = await push(cfg, { ...job.payload, replace: opts.test });
      if (reply.exists && reply.tab && reply.tab !== job.payload.tab && reply.tab.toUpperCase().startsWith(TEST_PREFIX.trim())) reply = await push(cfg, { ...job.payload, replace: true });
      results.push({ job, reply });
      if (!opts.test) done[job.key] = now;
    } catch (e) {
      results.push({ job, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const text = autoMessage(plan, results, opts.test);
  const tg = await telegram(text);
  const log = [{ at: now, by: who, today, test: opts.test, text: text.replace(/<[^>]+>/g, ""), telegram: tg }, ...store.log ?? []].slice(0, LOG_KEEP);
  await admin.from("kv").upsert([{ key: "registryAuto", value: { done, log }, updated_at: now }], { onConflict: "key" });
  for (const r of results) {
    if (!r.reply || r.reply.exists || !r.job.payload) continue;
    const p = r.job.payload;
    await audit(admin, who, `Реестр YouDo «${p.tab}» — ${opts.test ? "тестовый прогон" : "автомат"}${r.reply.unconfirmed ? " (без подтверждения)" : ""}: ${p.rows.length} чел., ${p.rows.reduce((a, x) => a + x.sum, 0).toLocaleString("ru-RU")} ₽ с налогом`);
  }
  return json({ today, results: results.map((r) => ({ tab: r.job.payload?.tab, kind: r.job.kind, project: r.job.project, skip: r.job.skip, error: r.error, reply: r.reply })), notSmz: plan.notSmz, telegram: tg });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const b = await req.json().catch(() => ({})) ?? {};
    const cron = Deno.env.get("CRON_SECRET");
    const byCron = !!cron && req.headers.get("x-cron-secret") === cron;
    let who = "Автомат";
    if (!byCron) {
      const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: isHead, error } = await asCaller.rpc("crm_is_head");
      if (error) return json({ error: error.message }, 401);
      if (isHead !== true) return json({ error: "Реестры может отправлять только руководитель отдела" }, 403);
      const { data: u } = await asCaller.auth.getUser();
      who = `${u.user?.user_metadata?.name || u.user?.email || "РОП"}`;
    }
    const admin = createClient(url, service, { auth: { persistSession: false } });
    if (byCron || b.auto === true) return await auto(admin, who, { cron: byCron, dry: !byCron && b.dry === true && b.test !== true, test: b.test === true });
    const { data: kvRow, error: kErr } = await admin.from("kv").select("value").eq("key", "sheets").maybeSingle();
    if (kErr) return json({ error: kErr.message }, 500);
    const cfg = (kvRow?.value ?? {}).registry ?? {};
    if (!cfg.url || !cfg.token) return json({ error: "Реестры не настроены (Настройки → Данные → «Реестры выплат YouDo»)" }, 400);
    return await manual(admin, cfg, who, b);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
