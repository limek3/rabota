import type { AccessSettings, Account, AccountPrefs, AccountRole, DataState, ID, PayType, RateGrid, RateTier, Settings, SvBonusGrid } from "./types";

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
  aheadPct: 110,
  normalPct: 95,
  lagPct: 80,
  idleDays: 3,
  directionEnabled: true,
  directionLabel: "Город / ДЦ",
  duplicateDays: 30,
  theme: "light",
  backupsKeep: 15,
  access: DEFAULT_ACCESS,
  sheets: { url: "", token: "", auto: false },
};

/** Палитра для групп и проектов — алиасы на токены чипов из globals.css. */
export const HUES = ["blue", "green", "amber", "purple", "teal", "pink", "indigo", "red", "gray"] as const;
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
    audit: [],
    frozenMonths: [],
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
  s.leadRevenue = num(s.leadRevenue, DEFAULT_SETTINGS.leadRevenue, 0, 10_000_000);
  s.payrollCapPct = num(s.payrollCapPct, DEFAULT_SETTINGS.payrollCapPct, 0, 100);
  s.aheadPct = num(s.aheadPct, 110, 0, 1000);
  s.normalPct = num(s.normalPct, 95, 0, 1000);
  s.lagPct = num(s.lagPct, 80, 0, 1000);
  s.idleDays = Math.round(num(s.idleDays, 3, 1, 60));
  s.duplicateDays = Math.round(num(s.duplicateDays, 30, 0, 3650));
  s.backupsKeep = Math.round(num(s.backupsKeep, 15, 3, 100));
  s.svBonus = normalizeSvBonus(raw?.svBonus);
  s.probationLeads = Math.round(num(s.probationLeads, 10, 0, 1000));
  s.probationHours = Math.round(num(s.probationHours, 15, 0, 1000));
  s.convNormPct = num(s.convNormPct, DEFAULT_SETTINGS.convNormPct, 0, 1000);
  const sh = (raw?.sheets ?? {}) as Partial<Settings["sheets"]>;
  s.sheets = { url: typeof sh.url === "string" ? sh.url.trim() : "", token: typeof sh.token === "string" ? sh.token : "", auto: sh.auto === true };
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
