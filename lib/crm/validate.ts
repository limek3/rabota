import type {
  Account,
  Adjustment,
  LearnProgress,
  DataState,
  Group,
  Lead,
  MonthPlan,
  Operator,
  Project,
  Shift,
  Snapshot,
  Approve,
  AuditEntry,
  Candidate,
} from "./types";
import { CANDIDATE_STAGES, LEAD_SOURCE, LEAD_STATUSES } from "./types";
import { normalizePrefs, normalizeSettings, normalizeTiers } from "./defaults";
import { isDayKey, isMonthKey, isStamp } from "./dates";
import { normPhone } from "./format";

/**
 * Проверка целостности и приведение внешних данных (импорт/резервная копия).
 *
 * Правила:
 *   - записи без ID или с битыми датами отбрасываются, о каждой — предупреждение;
 *   - дубли ID: остаётся более свежая по updatedAt;
 *   - лид/смена/начисление ссылается на несуществующего оператора — оператор
 *     восстанавливается как удалённый «(не найден)», чтобы история не пропала;
 *   - ссылки на несуществующие группы/проекты обнуляются (лид остаётся).
 */

export interface Issue {
  level: "error" | "warn";
  text: string;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function dedupe<T extends { id: string; updatedAt?: string }>(list: T[], what: string, warns: string[]): T[] {
  const m = new Map<string, T>();
  let dup = 0;
  for (const r of list) {
    const prev = m.get(r.id);
    if (prev) {
      dup++;
      if ((r.updatedAt ?? "") >= (prev.updatedAt ?? "")) m.set(r.id, r);
    } else m.set(r.id, r);
  }
  if (dup) warns.push(`${what}: объединено дублей ID — ${dup}`);
  return Array.from(m.values());
}

export function sanitize(raw: unknown): { state: DataState; warnings: string[] } {
  const warns: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<Snapshot> & Record<string, unknown>;
  const arr = (k: string): Record<string, unknown>[] => (Array.isArray(src[k]) ? (src[k] as Record<string, unknown>[]) : []);
  const now = new Date().toISOString();

  const operators: Operator[] = dedupe(
    arr("operators")
      .filter((o) => o && typeof o.id === "string" && o.id)
      .map((o) => ({
        id: str(o.id),
        name: str(o.name, "Без имени").trim() || "Без имени",
        groupId: o.groupId ? str(o.groupId) : null,
        role: (["operator", "senior", "supervisor", "trainee"].includes(str(o.role)) ? o.role : "operator") as Operator["role"],
        status: (["active", "pause", "fired"].includes(str(o.status)) ? o.status : "active") as Operator["status"],
        hireDate: isDayKey(o.hireDate) ? (o.hireDate as string) : "",
        fireDate: isDayKey(o.fireDate) ? (o.fireDate as string) : "",
        monthlyPlan: numOrNull(o.monthlyPlan),
        normHours: numOrNull(o.normHours),
        payType: (["salary", "hourly", "salary_bonus", "hourly_bonus", "tiered", "salary_tiered", "sv_volume"].includes(str(o.payType))
          ? o.payType
          : "hourly_bonus") as Operator["payType"],
        salary: Math.max(0, num(o.salary)),
        hourlyRate: Math.max(0, num(o.hourlyRate)),
        leadBonus: numOrNull(o.leadBonus),
        rateGridId: o.rateGridId ? str(o.rateGridId) : null,
        grade: (["jr", "mid", "sr"].includes(str(o.grade)) ? o.grade : "mid") as Operator["grade"],
        track: (["re", "auto"].includes(str(o.track)) ? o.track : "re") as Operator["track"],
        contact: str(o.contact),
        comment: str(o.comment),
        createdAt: str(o.createdAt, now),
        updatedAt: str(o.updatedAt, now),
        deletedAt: o.deletedAt ? str(o.deletedAt) : null,
      })),
    "Операторы",
    warns,
  );

  const groups: Group[] = dedupe(
    arr("groups")
      .filter((g) => g && typeof g.id === "string" && g.id)
      .map((g) => ({
        id: str(g.id),
        name: str(g.name, "Группа").trim() || "Группа",
        supervisorId: g.supervisorId ? str(g.supervisorId) : null,
        supervisorName: str(g.supervisorName),
        monthlyPlan: Math.max(0, num(g.monthlyPlan)),
        active: g.active !== false,
        color: str(g.color, "blue"),
        createdAt: str(g.createdAt, now),
        updatedAt: str(g.updatedAt, now),
        deletedAt: g.deletedAt ? str(g.deletedAt) : null,
      })),
    "Группы",
    warns,
  );

  const projects: Project[] = dedupe(
    arr("projects")
      .filter((p) => p && typeof p.id === "string" && p.id)
      .map((p, i) => ({
        id: str(p.id),
        name: str(p.name, "Проект").trim() || "Проект",
        active: p.active !== false,
        color: str(p.color, "blue"),
        sort: num(p.sort, i),
        createdAt: str(p.createdAt, now),
        updatedAt: str(p.updatedAt, now),
        deletedAt: p.deletedAt ? str(p.deletedAt) : null,
      })),
    "Проекты",
    warns,
  );

  let badLeads = 0;
  const leads: Lead[] = dedupe(
    arr("leads")
      .filter((l) => {
        const ok = l && typeof l.id === "string" && l.id && isStamp(l.at) && typeof l.operatorId === "string" && l.operatorId;
        if (!ok) badLeads++;
        return ok;
      })
      .map((l) => ({
        id: str(l.id),
        at: str(l.at),
        client: str(l.client),
        phone: normPhone(str(l.phone)),
        projectId: l.projectId ? str(l.projectId) : null,
        operatorId: str(l.operatorId),
        groupId: l.groupId ? str(l.groupId) : null,
        direction: str(l.direction),
        link: str(l.link),
        region: str(l.region),
        comment: str(l.comment),
        source: LEAD_SOURCE,
        status: (LEAD_STATUSES as string[]).includes(str(l.status)) ? (l.status as Lead["status"]) : "work",
        statusReason: str(l.statusReason),
        ...(l.statusAt ? { statusAt: str(l.statusAt) } : {}),
        ...(l.statusBy ? { statusBy: str(l.statusBy) } : {}),
        createdAt: str(l.createdAt, now),
        updatedAt: str(l.updatedAt, now),
      })),
    "Лиды",
    warns,
  );
  if (badLeads) warns.push(`Лиды: пропущено записей без ID/даты/оператора — ${badLeads}`);

  let badShifts = 0;
  const shifts: Shift[] = dedupe(
    arr("shifts")
      .filter((s) => {
        const ok = s && isDayKey(s.date) && typeof s.operatorId === "string" && s.operatorId;
        if (!ok) badShifts++;
        return ok;
      })
      .map((s) => ({
        id: `${s.date}|${s.operatorId}`,
        date: str(s.date),
        operatorId: str(s.operatorId),
        groupId: s.groupId ? str(s.groupId) : null,
        hours: Math.min(24, Math.max(0, num(s.hours))),
        type: (["work", "off", "training", "vacation", "sick"].includes(str(s.type)) ? s.type : "work") as Shift["type"],
        comment: str(s.comment),
        updatedAt: str(s.updatedAt, now),
      })),
    "Смены",
    warns,
  );
  if (badShifts) warns.push(`Смены: пропущено битых записей — ${badShifts}`);

  const plans: MonthPlan[] = dedupe(
    arr("plans")
      .filter((p) => p && isMonthKey(p.month) && ["team", "group", "operator"].includes(str(p.scope)))
      .map((p) => {
        const scope = str(p.scope) as MonthPlan["scope"];
        const targetId = scope === "team" ? null : str(p.targetId);
        const rec: MonthPlan = {
          id: scope === "team" ? `${p.month}|team` : `${p.month}|${scope}|${targetId}`,
          month: str(p.month),
          scope,
          targetId,
          plan: Math.max(0, num(p.plan)),
          auto: !!p.auto,
          updatedAt: str(p.updatedAt, now),
        };
        if (scope === "operator") {
          if (p.normHours != null) rec.normHours = Math.max(0, num(p.normHours));
          if (p.payType) rec.payType = p.payType as MonthPlan["payType"];
          if (p.salary != null) rec.salary = Math.max(0, num(p.salary));
          if (p.hourlyRate != null) rec.hourlyRate = Math.max(0, num(p.hourlyRate));
          if (p.leadBonus != null) rec.leadBonus = Math.max(0, num(p.leadBonus));
          if (p.tiers != null) rec.tiers = normalizeTiers(p.tiers);
          if (["jr", "mid", "sr"].includes(str(p.grade))) rec.grade = p.grade as MonthPlan["grade"];
          if (["re", "auto"].includes(str(p.track))) rec.track = p.track as MonthPlan["track"];
          if (p.approvePct != null) rec.approvePct = Math.max(0, Math.min(100, num(p.approvePct)));
          if (typeof p.growth === "boolean") rec.growth = p.growth;
        }
        return rec;
      }),
    "Планы",
    warns,
  );

  const adjustments: Adjustment[] = dedupe(
    arr("adjustments")
      .filter((a) => a && typeof a.id === "string" && isMonthKey(a.month) && typeof a.operatorId === "string")
      .map((a) => ({
        id: str(a.id),
        month: str(a.month),
        operatorId: str(a.operatorId),
        type: (["accrual", "bonus", "compensation", "correction", "deduction", "advance", "payout"].includes(str(a.type))
          ? a.type
          : "correction") as Adjustment["type"],
        amount: num(a.amount),
        date: isDayKey(a.date) ? str(a.date) : `${a.month}-01`,
        comment: str(a.comment),
        createdAt: str(a.createdAt, now),
        updatedAt: str(a.updatedAt, now),
      })),
    "Начисления",
    warns,
  );

  const settings = normalizeSettings(src.settings as never);
  const accounts: Account[] = dedupe(
    arr("accounts")
      .filter((a) => a && typeof a.id === "string" && a.id)
      .map((a) => {
        const role = (["head", "supervisor", "operator"].includes(str(a.role)) ? a.role : "operator") as Account["role"];
        return {
          id: str(a.id),
          name: str(a.name, "Без имени").trim() || "Без имени",
          login: str(a.login),
          role,
          operatorId: a.operatorId ? str(a.operatorId) : null,
          groupIds: Array.isArray(a.groupIds) ? (a.groupIds as unknown[]).filter((g): g is string => typeof g === "string") : [],
          active: a.active !== false,
          prefs: normalizePrefs(a.prefs as never, role, settings.theme),
          createdAt: str(a.createdAt, now),
          updatedAt: str(a.updatedAt, now),
          lastSeenAt: a.lastSeenAt ? str(a.lastSeenAt) : undefined,
          deletedAt: a.deletedAt ? str(a.deletedAt) : null,
        };
      }),
    "Аккаунты",
    warns,
  );

  const learn: LearnProgress[] = dedupe(
    arr("learn")
      .filter((l) => l && typeof l.accountId === "string" && typeof l.itemId === "string")
      .map((l) => ({
        id: str(l.id) || `${str(l.accountId)}|${str(l.itemId)}`,
        accountId: str(l.accountId),
        courseId: str(l.courseId),
        itemId: str(l.itemId),
        done: l.done !== false,
        right: l.right == null ? undefined : Math.max(0, num(l.right)),
        total: l.total == null ? undefined : Math.max(0, num(l.total)),
        checks: Array.isArray(l.checks) ? (l.checks as unknown[]).filter((x): x is string => typeof x === "string") : undefined,
        updatedAt: str(l.updatedAt, now),
      })),
    "Обучение",
    warns,
  );

  const approves: Approve[] = dedupe(
    arr("approves")
      .filter((a) => a && typeof a.month === "string")
      .map((a) => ({
        id: str(a.id) || `${str(a.month)}|${str(a.projectId) || "all"}`,
        month: str(a.month),
        projectId: str(a.projectId),
        pct: Math.min(100, Math.max(0, num(a.pct))),
        comment: str(a.comment),
        updatedAt: str(a.updatedAt, now),
      })),
    "Апрув",
    warns,
  );

  const opIds = new Set(operators.map((o) => o.id));
  const groupIds = new Set(groups.map((g) => g.id));
  const dayOr = (v: unknown) => (isDayKey(v) ? (v as string) : "");
  const candidates: Candidate[] = dedupe(
    arr("candidates")
      .filter((c) => c && typeof c.id === "string" && c.id)
      .map((c) => ({
        id: str(c.id),
        name: str(c.name, "Без имени").trim() || "Без имени",
        contact: str(c.contact),
        source: str(c.source),
        // ссылки на то, чего нет в выгрузке, обнуляем — кандидат остаётся
        groupId: c.groupId && groupIds.has(str(c.groupId)) ? str(c.groupId) : null,
        stage: (CANDIDATE_STAGES as string[]).includes(str(c.stage)) ? (c.stage as Candidate["stage"]) : "new",
        appliedAt: dayOr(c.appliedAt) || str(c.createdAt, now).slice(0, 10),
        interviewAt: dayOr(c.interviewAt),
        trainingAt: dayOr(c.trainingAt),
        closedAt: dayOr(c.closedAt),
        operatorId: c.operatorId && opIds.has(str(c.operatorId)) ? str(c.operatorId) : null,
        reason: str(c.reason),
        comment: str(c.comment),
        createdAt: str(c.createdAt, now),
        updatedAt: str(c.updatedAt, now),
        deletedAt: c.deletedAt ? str(c.deletedAt) : null,
      })),
    "Кандидаты",
    warns,
  );

  const audit: AuditEntry[] = dedupe(
    arr("audit")
      .filter((a) => a && typeof a.summary === "string")
      .map((a) => ({
        id: str(a.id) || `au_${str(a.at, now)}_${Math.random().toString(36).slice(2, 8)}`,
        at: str(a.at, now),
        accountId: str(a.accountId),
        accountName: str(a.accountName),
        entity: (["operator", "group", "lead", "shift", "plan", "payroll", "project", "account", "settings", "approve", "candidate", "data"].includes(String(a.entity))
          ? a.entity
          : "data") as AuditEntry["entity"],
        entityId: str(a.entityId),
        summary: str(a.summary),
        // было → стало: только корректные строки {f, from, to}
        ...(Array.isArray(a.changes)
          ? { changes: (a.changes as unknown[]).filter((c): c is { f: string; from: string; to: string } => !!c && typeof (c as { f?: unknown }).f === "string").map((c) => ({ f: str(c.f), from: str(c.from), to: str(c.to) })) }
          : {}),
      })),
    "Журнал",
    warns,
  );

  const state: DataState = {
    settings,
    operators,
    groups,
    projects,
    leads,
    shifts,
    plans,
    adjustments,
    accounts,
    learn,
    approves,
    candidates,
    audit,
    frozenMonths: Array.isArray(src.frozenMonths) ? (src.frozenMonths as unknown[]).filter(isMonthKey) : [],
  };
  const fixed = repair(state);
  return { state: fixed.state, warnings: [...warns, ...fixed.notes] };
}

/** Чинит ссылки, не теряя истории. Возвращает новое состояние и список исправлений. */
export function repair(st: DataState): { state: DataState; notes: string[]; changed: { operators: Operator[]; leads: Lead[]; shifts: Shift[]; accounts: Account[] } } {
  const notes: string[] = [];
  const now = new Date().toISOString();
  const ops = new Map(st.operators.map((o) => [o.id, o]));
  const liveGroups = new Set(st.groups.filter((g) => !g.deletedAt).map((g) => g.id));
  const allGroups = new Set(st.groups.map((g) => g.id));
  const projects = new Set(st.projects.map((p) => p.id));
  const changedOps: Operator[] = [];
  const changedLeads: Lead[] = [];
  const changedShifts: Shift[] = [];

  const ensureOp = (id: string) => {
    if (ops.has(id)) return;
    const ghost: Operator = {
      id, name: `Оператор ${id.slice(-6)} (не найден)`, groupId: null, role: "operator", status: "fired",
      hireDate: "", fireDate: "", monthlyPlan: 0, normHours: 0, payType: "hourly", salary: 0, hourlyRate: 0,
      leadBonus: 0, rateGridId: null, grade: "mid", track: "re", contact: "", comment: "Восстановлен автоматически: на него ссылаются записи истории",
      createdAt: now, updatedAt: now, deletedAt: now,
    };
    ops.set(id, ghost);
    changedOps.push(ghost);
  };

  for (const l of st.leads) ensureOp(l.operatorId);
  for (const s of st.shifts) ensureOp(s.operatorId);
  for (const a of st.adjustments) ensureOp(a.operatorId);
  if (changedOps.length) notes.push(`Восстановлено операторов для истории — ${changedOps.length}`);

  let movedOps = 0;
  for (const o of Array.from(ops.values())) {
    if (o.groupId && !liveGroups.has(o.groupId)) {
      const fixed = { ...o, groupId: null, updatedAt: now };
      ops.set(o.id, fixed);
      const i = changedOps.findIndex((x) => x.id === o.id);
      if (i >= 0) changedOps[i] = fixed;
      else changedOps.push(fixed);
      movedOps++;
    }
  }
  if (movedOps) notes.push(`Операторов с несуществующей группой переведено в «Без группы» — ${movedOps}`);

  let fixedLeads = 0;
  const leads = st.leads.map((l) => {
    let n = l;
    if (l.projectId && !projects.has(l.projectId)) n = { ...n, projectId: null };
    if (l.groupId && !allGroups.has(l.groupId)) n = { ...n, groupId: null };
    if (n !== l) {
      fixedLeads++;
      changedLeads.push(n);
    }
    return n;
  });
  if (fixedLeads) notes.push(`Лидов с битой ссылкой на проект/группу исправлено — ${fixedLeads}`);

  const shifts = st.shifts.map((s) => {
    if (s.groupId && !allGroups.has(s.groupId)) {
      const n = { ...s, groupId: null };
      changedShifts.push(n);
      return n;
    }
    return s;
  });

  // аккаунт оператора без карточки сотрудника работать не может — выключаем
  const changedAccounts: Account[] = [];
  const accounts = st.accounts.map((a) => {
    if (a.operatorId && !ops.has(a.operatorId)) {
      const n = { ...a, operatorId: null, active: a.role === "operator" ? false : a.active, updatedAt: now };
      changedAccounts.push(n);
      return n;
    }
    return a;
  });
  if (changedAccounts.length) notes.push(`Аккаунтов со ссылкой на несуществующего сотрудника исправлено — ${changedAccounts.length}`);

  return {
    state: { ...st, operators: Array.from(ops.values()), leads, shifts, accounts },
    notes,
    changed: { operators: changedOps, leads: changedLeads, shifts: changedShifts, accounts: changedAccounts },
  };
}

/** Диагностика для экрана настроек. */
export function checkIntegrity(st: DataState): Issue[] {
  const out: Issue[] = [];
  const dupCheck = (list: { id: string }[], what: string) => {
    const seen = new Set<string>();
    let d = 0;
    for (const r of list) {
      if (seen.has(r.id)) d++;
      seen.add(r.id);
    }
    if (d) out.push({ level: "error", text: `${what}: повторяющихся ID — ${d}` });
  };
  dupCheck(st.operators, "Операторы");
  dupCheck(st.groups, "Группы");
  dupCheck(st.projects, "Проекты");
  dupCheck(st.leads, "Лиды");
  dupCheck(st.shifts, "Смены");
  dupCheck(st.adjustments, "Начисления");

  const ops = new Set(st.operators.map((o) => o.id));
  const groups = new Set(st.groups.map((g) => g.id));
  const live = new Set(st.groups.filter((g) => !g.deletedAt).map((g) => g.id));
  const projects = new Set(st.projects.map((p) => p.id));

  const orphanLeads = st.leads.filter((l) => !ops.has(l.operatorId)).length;
  if (orphanLeads) out.push({ level: "error", text: `Лидов без существующего оператора — ${orphanLeads}` });
  const badProj = st.leads.filter((l) => l.projectId && !projects.has(l.projectId)).length;
  if (badProj) out.push({ level: "warn", text: `Лидов со ссылкой на несуществующий проект — ${badProj}` });
  const noProj = st.leads.filter((l) => !l.projectId).length;
  if (noProj) out.push({ level: "warn", text: `Лидов без проекта — ${noProj}` });
  const badGroup = st.leads.filter((l) => l.groupId && !groups.has(l.groupId)).length;
  if (badGroup) out.push({ level: "warn", text: `Лидов со ссылкой на несуществующую группу — ${badGroup}` });
  const badDates = st.leads.filter((l) => !isStamp(l.at)).length;
  if (badDates) out.push({ level: "error", text: `Лидов с некорректной датой — ${badDates}` });
  const orphanShifts = st.shifts.filter((s) => !ops.has(s.operatorId)).length;
  if (orphanShifts) out.push({ level: "error", text: `Смен без существующего оператора — ${orphanShifts}` });
  const badHours = st.shifts.filter((s) => !(s.hours >= 0 && s.hours <= 24)).length;
  if (badHours) out.push({ level: "error", text: `Смен с часами вне 0–24 — ${badHours}` });
  const orphanAdj = st.adjustments.filter((a) => !ops.has(a.operatorId)).length;
  if (orphanAdj) out.push({ level: "error", text: `Начислений без существующего оператора — ${orphanAdj}` });
  const grids = new Set(st.settings.rateGrids.map((g) => g.id));
  const badGrid = st.operators.filter((o) => !o.deletedAt && o.rateGridId && !grids.has(o.rateGridId)).length;
  if (badGrid) out.push({ level: "warn", text: `Операторов со ссылкой на удалённую тарифную сетку — ${badGrid} (считаются по сетке по умолчанию)` });
  const opsBadGroup = st.operators.filter((o) => !o.deletedAt && o.groupId && !live.has(o.groupId)).length;
  if (opsBadGroup) out.push({ level: "warn", text: `Операторов в удалённой/несуществующей группе — ${opsBadGroup}` });
  const badAcc = st.accounts.filter((a) => !a.deletedAt && a.operatorId && !ops.has(a.operatorId)).length;
  if (badAcc) out.push({ level: "warn", text: `Аккаунтов со ссылкой на несуществующего сотрудника — ${badAcc}` });
  const opNoCard = st.accounts.filter((a) => !a.deletedAt && a.active && a.role === "operator" && !a.operatorId).length;
  if (opNoCard) out.push({ level: "warn", text: `Аккаунтов операторов без привязки к карточке — ${opNoCard}` });
  if (!st.accounts.some((a) => !a.deletedAt && a.active && a.role === "head")) out.push({ level: "error", text: "Нет ни одного активного аккаунта РОПа" });
  dupCheck(st.accounts, "Аккаунты");
  const firedNoDate = st.operators.filter((o) => !o.deletedAt && o.status === "fired" && !o.fireDate).length;
  if (firedNoDate) out.push({ level: "warn", text: `Уволенных без даты увольнения — ${firedNoDate}` });
  return out;
}

export function toSnapshot(st: DataState): Snapshot {
  return {
    app: "leadup-crm",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: st.settings,
    operators: st.operators,
    groups: st.groups,
    projects: st.projects,
    leads: st.leads,
    shifts: st.shifts,
    plans: st.plans,
    adjustments: st.adjustments,
    accounts: st.accounts,
    learn: st.learn,
    approves: st.approves,
    candidates: st.candidates,
    audit: st.audit,
    frozenMonths: st.frozenMonths,
  };
}

export function counts(st: DataState): Record<string, number> {
  return {
    operators: st.operators.filter((o) => !o.deletedAt).length,
    groups: st.groups.filter((g) => !g.deletedAt).length,
    projects: st.projects.filter((p) => !p.deletedAt).length,
    leads: st.leads.length,
    shifts: st.shifts.length,
    adjustments: st.adjustments.length,
    accounts: st.accounts.filter((a) => !a.deletedAt).length,
    learn: st.learn.length,
    candidates: st.candidates.filter((c) => !c.deletedAt).length,
  };
}
