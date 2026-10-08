import type { AccessSettings, Account, AccountPrefs, AccountRole, DataState, ID, Operator, PaySlot, PayType, RateGrid, RateTier, RegionSettings, RopSettings, Settings, SvBonusGrid, Track } from "./types";
import { addDays } from "./dates";

export const DEFAULT_ACCESS: AccessSettings = {
  supervisor: {
    seeAllGroups: false,
    createLeads: true,
    editLeads: true,
    manageOperators: true,
    editShifts: true,
    viewPayroll: true,
    editPayroll: false,
    editPlans: true,
    manageProjects: false,
  },
  operator: {
    createOwnLeads: true,
    editOwnLeadsHours: 24,
    deleteOwnLeads: false,
    editOwnShifts: false,
    viewOwnPay: true,
    viewGroupProgress: true,
    viewTeamProgress: false,
  },
};

/**
 * Сетка по умолчанию: чем больше лидов за смену, тем дороже час и сам лид.
 * Значения — действующие ставки отдела из «Академии обзвона», меняются в настройках.
 */
export const DEFAULT_GRID: RateGrid = {
  id: "grid_base",
  name: "Базовая сетка оператора",
  tiers: [
    { from: 0, hourlyRate: 200, leadBonus: 70 },
    { from: 6, hourlyRate: 230, leadBonus: 75 },
    { from: 8, hourlyRate: 240, leadBonus: 80 },
    { from: 11, hourlyRate: 260, leadBonus: 90 },
  ],
};

/** Сетка супервайзера: оклад + бонус по объёму лидов группы, грейду и направлению. */
export const DEFAULT_SV_BONUS: SvBonusGrid = {
  salary: 45000,
  minLeads: 700,
  rows: [
    { from: 300, re: [0, 0, 0], auto: [0, 0, 0] },
    { from: 500, re: [0, 0, 0], auto: [0, 0, 0] },
    { from: 700, re: [4000, 4500, 5000], auto: [3500, 4000, 4500] },
    { from: 1000, re: [16000, 18000, 20000], auto: [15000, 17000, 19000] },
    { from: 1200, re: [25000, 27000, 30000], auto: [24000, 26000, 29000] },
    { from: 1500, re: [40000, 43000, 45000], auto: [40000, 42000, 44000] },
    { from: 1750, re: [50000, 52000, 55000], auto: [49000, 51000, 54000] },
    { from: 2000, re: [60000, 65000, 70000], auto: [58000, 63000, 68000] },
  ],
  approve: [
    { from: 30, k: 1 },
    { from: 25, k: 0.95 },
    { from: 20, k: 0.9 },
    { from: 0, k: 0 },
  ],
  noGrowthK: 0.85,
  defaultApprovePct: 30,
};

/** Регионы и их экономика — как задал руководитель: регион — апрув 10%, 4 000 ₽ за лид. */
export const DEFAULT_REGIONS: RegionSettings = {
  main: ["Москва", "Санкт-Петербург", "Екатеринбург"],
  regional: ["Челябинск", "Волгоград", "Краснодарский край", "Ставрополь"],
  regionalApprovePct: 10,
  regionalLeadRevenue: 4000,
};

/** Отчёт РОП: лимиты себестоимости лида — авто не более 300 ₽, недвижимость не более 350 ₽. */
export const DEFAULT_ROP: RopSettings = { telecomMonth: 0, overheadMonth: 0, capAuto: 300, capRe: 350, groupTrack: {}, hirePlan: {} };

/**
 * График выплат: периоды пн–вс, во вторник после периода — реестр сумм к переводу, в пятницу —
 * выплата (вс → пт = 5 дней). Первый период длиннее и кончается в понедельник: 16.09–05.10,
 * реестр 06.10, выплата 09.10. Второй добирает до воскресенья: 06.10–18.10 → 23.10.
 * Дальше по правилу: 19.10–01.11 → 06.11 и т. д.
 */
export const PAY_SCHEDULE_2026: PaySlot[] = [
  { from: "2026-09-16", to: "2026-10-05", pay: "2026-10-09" },
  { from: "2026-10-06", to: "2026-10-18", pay: "2026-10-23" },
];

export const DEFAULT_SETTINGS: Settings = {
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
  rop: DEFAULT_ROP,
};

/** Палитра для групп и проектов — алиасы на токены чипов из globals.css. */
/** Пастельная палитра проектов и групп — в тон графитовой теме; порядок = порядок в выборе цвета. */
export const HUES = ["slate", "blue", "sky", "teal", "green", "amber", "peach", "red", "pink", "purple", "indigo", "gray"] as const;
export const HUE_LABEL: Record<Hue, string> = {
  slate: "Графит",
  blue: "Синий",
  sky: "Небесный",
  teal: "Бирюзовый",
  green: "Шалфей",
  amber: "Песочный",
  peach: "Персиковый",
  red: "Пыльная роза",
  pink: "Розовый",
  purple: "Лавандовый",
  indigo: "Индиго",
  gray: "Серый",
};
export type Hue = (typeof HUES)[number];

export function emptyState(): DataState {
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
    leadExportLog: [],
  };
}

export function defaultHome(role: AccountRole): string {
  return role === "operator" ? "/me" : "/dashboard";
}

export function normalizePrefs(raw: Partial<AccountPrefs> | null | undefined, role: AccountRole, theme: Settings["theme"] = "light"): AccountPrefs {
  const p = raw || {};
  return {
    theme: p.theme === "dark" || p.theme === "system" || p.theme === "light" ? p.theme : theme,
    homePage: typeof p.homePage === "string" && p.homePage.startsWith("/") ? p.homePage : defaultHome(role),
    defaultProjectId: typeof p.defaultProjectId === "string" ? p.defaultProjectId : null,
    compact: p.compact === true,
    ...(isAvatar(p.avatar) ? { avatar: p.avatar } : {}),
    ...(cleanCols(p.cols) ? { cols: cleanCols(p.cols) } : {}),
  };
}

/** Порядок столбцов: только { таблица: [ключи] } из коротких строк, без мусора и повторов. */
function cleanCols(v: unknown): Record<string, string[]> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [table, keys] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(table) || !Array.isArray(keys)) continue;
    const list = Array.from(new Set(keys.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 30))).slice(0, 60);
    if (list.length) out[table] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Аватарка — только картинка в data URL и не больше ~150 КБ (мы сами сжимаем до 160×160). */
export function isAvatar(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 150_000;
}

/** Новая карточка сотрудника: условия по умолчанию из настроек; ставку и план поправят в карточке. */
export function operatorDraft(
  s: Settings,
  extra: Pick<Operator, "name" | "groupId" | "role" | "hireDate"> & Partial<Operator>,
): Omit<Operator, "id" | "createdAt" | "updatedAt" | "deletedAt"> {
  return {
    status: "active",
    fireDate: "",
    monthlyPlan: null,
    normHours: null,
    payType: s.defaultPayType,
    salary: s.defaultSalary,
    hourlyRate: s.defaultHourlyRate,
    leadBonus: null,
    rateGridId: null,
    grade: "mid",
    track: "re",
    contact: "",
    comment: "",
    ...extra,
  };
}

export function newAccount(id: ID, role: AccountRole, name: string, extra: Partial<Account> = {}, theme: Settings["theme"] = "light"): Account {
  const now = new Date().toISOString();
  const operatorId = extra.operatorId ?? null;
  return {
    id,
    name,
    login: "",
    role,
    operatorId,
    groupIds: [],
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...extra,
    prefs: normalizePrefs(extra.prefs, role, theme),
  };
}

/** Ступени по возрастанию, первая всегда от 0, без отрицательных сумм. */
export function normalizeTiers(raw: unknown): RateTier[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = list
    .map((t) => {
      const x = (t ?? {}) as Partial<RateTier>;
      return {
        from: Math.max(0, Math.round(Number(x.from) || 0)),
        hourlyRate: Math.max(0, Number(x.hourlyRate) || 0),
        leadBonus: Math.max(0, Number(x.leadBonus) || 0),
      };
    })
    .sort((a, b) => a.from - b.from)
    .filter((t, i, arr) => i === 0 || t.from !== arr[i - 1].from);
  if (!out.length) return [{ from: 0, hourlyRate: 0, leadBonus: 0 }];
  out[0] = { ...out[0], from: 0 };
  return out;
}

export function normalizeGrids(raw: unknown): RateGrid[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: RateGrid[] = [];
  const seen = new Set<ID>();
  list.forEach((g, i) => {
    const x = (g ?? {}) as Partial<RateGrid>;
    const id = typeof x.id === "string" && x.id && !seen.has(x.id) ? x.id : `grid_${i + 1}_${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    out.push({ id, name: (typeof x.name === "string" && x.name.trim()) || `Сетка ${i + 1}`, tiers: normalizeTiers(x.tiers) });
  });
  return out;
}

export function normalizeSvBonus(raw: unknown): SvBonusGrid {
  const x = (raw ?? {}) as Partial<SvBonusGrid>;
  const n = (v: unknown, d: number, min = 0, max = 1e9) => {
    const z = Number(v);
    return Number.isFinite(z) ? Math.min(max, Math.max(min, z)) : d;
  };
  const trio = (v: unknown, d: [number, number, number]): [number, number, number] => {
    const a = Array.isArray(v) ? v : [];
    return [n(a[0], d[0]), n(a[1], d[1]), n(a[2], d[2])];
  };
  const rows = (Array.isArray(x.rows) && x.rows.length ? x.rows : DEFAULT_SV_BONUS.rows)
    .map((r) => ({ from: Math.round(n(r?.from, 0)), re: trio(r?.re, [0, 0, 0]), auto: trio(r?.auto, [0, 0, 0]) }))
    .sort((a, b) => a.from - b.from);
  const approve = (Array.isArray(x.approve) && x.approve.length ? x.approve : DEFAULT_SV_BONUS.approve)
    .map((a) => ({ from: n(a?.from, 0, 0, 100), k: n(a?.k, 1, 0, 5) }))
    .sort((a, b) => b.from - a.from);
  return {
    salary: n(x.salary, DEFAULT_SV_BONUS.salary, 0, 10_000_000),
    minLeads: Math.round(n(x.minLeads, DEFAULT_SV_BONUS.minLeads)),
    rows,
    approve,
    noGrowthK: n(x.noGrowthK, DEFAULT_SV_BONUS.noGrowthK, 0, 2),
    defaultApprovePct: n(x.defaultApprovePct, DEFAULT_SV_BONUS.defaultApprovePct, 0, 100),
  };
}

/** Дополняет настройки из старой/чужой версии недостающими полями и чистит типы. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) } as Settings;
  const num = (v: unknown, d: number, min = 0, max = 1e9) => {
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
  // старые значения по умолчанию (250 ₽/ч, 300 ₽ за лид, оклад 40 000) — не наши ставки:
  // переводим на сетку, иначе в кабинете всплывает «следующий лид +300 ₽»
  if (s.defaultHourlyRate === 250 && s.defaultLeadBonus === 300) {
    s.defaultHourlyRate = DEFAULT_SETTINGS.defaultHourlyRate;
    s.defaultLeadBonus = DEFAULT_SETTINGS.defaultLeadBonus;
    if (s.defaultPayType === "hourly_bonus") s.defaultPayType = DEFAULT_SETTINGS.defaultPayType;
    if (s.defaultSalary === 40000) s.defaultSalary = DEFAULT_SETTINGS.defaultSalary;
  }
  s.withholdPct = num(s.withholdPct, 0, 0, 100);
  s.payPeriodStart = typeof s.payPeriodStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.payPeriodStart) ? s.payPeriodStart : DEFAULT_SETTINGS.payPeriodStart;
  // 25.08 — прежнее значение по умолчанию: шаг тот же (14 дней), но первыми шли пустые периоды до начала работы
  if (s.payPeriodStart === "2026-08-25") s.payPeriodStart = "2026-09-22";
  s.payPeriodDays = Math.round(num(s.payPeriodDays, DEFAULT_SETTINGS.payPeriodDays, 7, 31));
  s.payDelayDays = Math.round(num(s.payDelayDays, DEFAULT_SETTINGS.payDelayDays, 0, 30));
  s.paySchedule = normalizeSchedule(s.paySchedule);
  // прежнее правило (вт–пн, выплата через 4 дня) → пн–вс, реестр во вторник, выплата в пятницу
  if (!s.paySchedule.length && s.payPeriodStart === "2026-09-22" && s.payPeriodDays === 14 && s.payDelayDays === 4) {
    s.paySchedule = PAY_SCHEDULE_2026.map((r) => ({ ...r }));
    s.payDelayDays = 5;
  }
  s.leadRevenue = num(s.leadRevenue, DEFAULT_SETTINGS.leadRevenue, 0, 10_000_000);
  s.payrollCapPct = num(s.payrollCapPct, DEFAULT_SETTINGS.payrollCapPct, 0, 100);
  s.aheadPct = num(s.aheadPct, 110, 0, 1000);
  s.normalPct = num(s.normalPct, 95, 0, 1000);
  s.lagPct = num(s.lagPct, 80, 0, 1000);
  s.idleDays = Math.round(num(s.idleDays, 3, 1, 60));
  s.dayCloseHour = Math.round(num(s.dayCloseHour, 21, 0, 24));
  s.duplicateDays = Math.round(num(s.duplicateDays, 30, 0, 3650));
  s.backupsKeep = Math.round(num(s.backupsKeep, 15, 3, 100));
  s.svBonus = normalizeSvBonus(raw?.svBonus);
  s.probationLeads = Math.round(num(s.probationLeads, 10, 0, 1000));
  s.probationHours = Math.round(num(s.probationHours, 15, 0, 1000));
  s.convNormPct = num(s.convNormPct, DEFAULT_SETTINGS.convNormPct, 0, 1000);
  s.regions = normalizeRegions(raw?.regions);
  s.rop = normalizeRop(raw?.rop);
  const sh = (raw?.sheets ?? {}) as Partial<Settings["sheets"]>;
  // до переименования секция называлась drops
  const dr = (sh.leads ?? (sh as { drops?: unknown }).drops ?? {}) as Partial<Settings["sheets"]["leads"]>;
  s.sheets = {
    url: typeof sh.url === "string" ? sh.url.trim() : "",
    token: typeof sh.token === "string" ? sh.token : "",
    auto: sh.auto === true,
    leads: {
      url: typeof dr.url === "string" ? dr.url.trim() : "",
      token: typeof dr.token === "string" ? dr.token : "",
      owner: typeof dr.owner === "string" && dr.owner.trim() ? dr.owner.trim() : "Борис",
      auto: dr.auto === true,
    },
    registry: {
      url: typeof sh.registry?.url === "string" ? sh.registry.url.trim() : "",
      token: typeof sh.registry?.token === "string" ? sh.registry.token : "",
      auto: sh.registry?.auto === true,
      autoFrom: typeof sh.registry?.autoFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sh.registry.autoFrom) ? sh.registry.autoFrom : "",
      planOkc: Math.round(num(sh.registry?.planOkc, 0, 0, 10_000_000)),
      planSv: Math.round(num(sh.registry?.planSv, 0, 0, 10_000_000)),
    },
  };
  s.rateGrids = normalizeGrids(raw?.rateGrids);
  if (!s.rateGrids.length) s.rateGrids = [{ ...DEFAULT_GRID, tiers: [...DEFAULT_GRID.tiers] }];
  // черновая сетка первых версий (200/200, 250/300, 300/400 ₽) — заменяем реальной из «Академии обзвона»
  const LEGACY = "0:200:200|3:250:300|5:300:400";
  s.rateGrids = s.rateGrids.map((g) =>
    g.id === DEFAULT_GRID.id && g.tiers.map((t) => `${t.from}:${t.hourlyRate}:${t.leadBonus}`).join("|") === LEGACY
      ? { ...DEFAULT_GRID, tiers: DEFAULT_GRID.tiers.map((t) => ({ ...t })) }
      : g,
  );
  s.defaultGridId = s.rateGrids.some((g) => g.id === s.defaultGridId) ? s.defaultGridId : s.rateGrids[0].id;
  s.workdays = Array.isArray(s.workdays)
    ? Array.from(new Set(s.workdays.map(Number).filter((d) => d >= 1 && d <= 7))).sort()
    : [1, 2, 3, 4, 5];
  if (!s.workdays.length) s.workdays = [1, 2, 3, 4, 5];
  s.holidays = Array.isArray(s.holidays) ? s.holidays.filter((d) => typeof d === "string") : [];
  if (!["light", "dark", "system"].includes(s.theme)) s.theme = "light";
  const PAY_TYPES: PayType[] = ["salary", "hourly", "salary_bonus", "hourly_bonus", "tiered", "salary_tiered", "sv_volume"];
  if (!PAY_TYPES.includes(s.defaultPayType)) s.defaultPayType = "tiered";
  if (typeof s.reportMonth !== "string" || (s.reportMonth && !/^\d{4}-\d{2}$/.test(s.reportMonth))) s.reportMonth = "";
  s.directionEnabled = s.directionEnabled !== false;
  s.prorateSalary = s.prorateSalary !== false;
  const a = (raw?.access ?? {}) as Partial<AccessSettings>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const sup = { ...DEFAULT_ACCESS.supervisor };
  for (const k of Object.keys(sup) as (keyof typeof sup)[]) sup[k] = bool(a.supervisor?.[k], sup[k]);
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

/** Параметры отчёта РОП: числа не отрицательные, направления — только авто / недвижимость. */
export function normalizeRop(raw: Partial<RopSettings> | null | undefined): RopSettings {
  const r = raw || {};
  const n = (v: unknown, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(100_000_000, Math.max(0, x)) : d;
  };
  const groupTrack: Record<string, Track> = {};
  for (const [k, v] of Object.entries(r.groupTrack ?? {})) if (v === "auto" || v === "re") groupTrack[k] = v;
  const hirePlan: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.hirePlan ?? {})) {
    const x = Math.round(n(v, 0));
    if (x > 0) hirePlan[k] = Math.min(1000, x);
  }
  return {
    telecomMonth: n(r.telecomMonth, DEFAULT_ROP.telecomMonth),
    overheadMonth: n(r.overheadMonth, DEFAULT_ROP.overheadMonth),
    capAuto: n(r.capAuto, DEFAULT_ROP.capAuto),
    capRe: n(r.capRe, DEFAULT_ROP.capRe),
    groupTrack,
    hirePlan,
  };
}

/** Списки городов без пустых и повторов; город не может быть сразу в «Основе» и в «Регионах». */
export function normalizeRegions(raw: Partial<RegionSettings> | null | undefined): RegionSettings {
  const r = raw || {};
  const list = (v: unknown, d: string[]) =>
    Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))) : [...d];
  const main = list(r.main, DEFAULT_REGIONS.main);
  const regional = list(r.regional, DEFAULT_REGIONS.regional).filter((x) => !main.includes(x));
  const n = (v: unknown, d: number, max: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d;
  };
  return {
    main,
    regional,
    regionalApprovePct: n(r.regionalApprovePct, DEFAULT_REGIONS.regionalApprovePct, 100),
    regionalLeadRevenue: n(r.regionalLeadRevenue, DEFAULT_REGIONS.regionalLeadRevenue, 10_000_000),
  };
}

const isDayKey = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);

/**
 * График выплат: строки по порядку и строго подряд — каждый период начинается на следующий
 * день после предыдущего (иначе дни между ними никто бы не оплатил или оплатил дважды).
 * Выплата не раньше конца периода.
 */
export function normalizeSchedule(v: unknown): PaySlot[] {
  if (!Array.isArray(v)) return [];
  const rows = v
    .filter((r): r is PaySlot => !!r && isDayKey(r.from) && isDayKey(r.to) && isDayKey(r.pay))
    .map((r) => ({ from: r.from, to: r.to, pay: r.pay }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const out: PaySlot[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    const from = prev ? addDays(prev.to, 1) : r.from;
    if (r.to < from) continue;
    out.push({ from, to: r.to, pay: r.pay < r.to ? r.to : r.pay });
  }
  return out;
}
