import type { Account, AccountRole, DataState, ID, Lead, Operator } from "./types";

/**
 * Права доступа. Чистые функции: по аккаунту и данным решают, что человек видит
 * и что может менять.
 *
 *   РОП          — всё.
 *   Супервайзер  — свои группы (из аккаунта + где он руководитель в карточке группы);
 *                  что именно можно делать — настраивает РОП (settings.access.supervisor).
 *   Оператор     — только своё: лиды, план, часы, заработок (settings.access.operator).
 *
 * Видимость реализована срезом данных (scopeData): все расчёты и страницы
 * работают с тем же DataState, только урезанным. Поэтому ни одна страница не
 * может случайно показать чужое — у неё просто нет этих записей.
 *
 * Пока вход выключен и данные лежат в браузере, это ограничение интерфейса,
 * а не защита данных: настоящая изоляция появится вместе с сервером.
 */

export interface Access {
  account: Account;
  role: AccountRole;
  isHead: boolean;
  isSup: boolean;
  isOp: boolean;
  /** Карточка сотрудника, связанная с аккаунтом. */
  opId: ID | null;
  /** Группы, которыми управляет супервайзер. */
  ownGroups: Set<ID>;
  /** Операторы, чьи данные можно менять (null — все). */
  editOps: Set<ID> | null;
  /** Видит весь отдел (null-срез не нужен). */
  viewAll: boolean;
  can: {
    createLeads: boolean;
    editLeads: boolean;
    manageOperators: boolean;
    manageGroups: boolean;
    editShifts: boolean;
    viewPayroll: boolean;
    editPayroll: boolean;
    editPlans: boolean;
    editTeamPlan: boolean;
    manageProjects: boolean;
    systemSettings: boolean;
    manageData: boolean;
    manageAccounts: boolean;
  };
  /** Разрешённые страницы. */
  routes: Set<string>;
  /** Подпись зоны видимости: «Альфа, Бета», «Мои данные». */
  scopeLabel: string;
}

export const ALL_ROUTES = ["/dashboard", "/me", "/stats", "/leads", "/operators", "/groups", "/schedule", "/payroll", "/dynamics", "/reports", "/projects", "/plans", "/learn", "/settings"];

export function supervisorGroups(acc: Account, st: DataState): Set<ID> {
  const live = new Set(st.groups.filter((g) => !g.deletedAt).map((g) => g.id));
  const out = new Set<ID>(acc.groupIds.filter((g) => live.has(g)));
  if (acc.operatorId) for (const g of st.groups) if (!g.deletedAt && g.supervisorId === acc.operatorId) out.add(g.id);
  return out;
}

export function computeAccess(acc: Account, st: DataState): Access {
  const A = st.settings.access;
  const isHead = acc.role === "head";
  const isSup = acc.role === "supervisor";
  const isOp = acc.role === "operator";
  const opId = acc.operatorId && st.operators.some((o) => o.id === acc.operatorId) ? acc.operatorId : null;

  const ownGroups = isSup ? supervisorGroups(acc, st) : new Set<ID>();
  let editOps: Set<ID> | null = null;
  if (isSup) {
    editOps = new Set(st.operators.filter((o) => !o.deletedAt && o.groupId && ownGroups.has(o.groupId)).map((o) => o.id));
    if (opId) editOps.add(opId);
  } else if (isOp) {
    editOps = new Set(opId ? [opId] : []);
  }

  const S = A.supervisor;
  const O = A.operator;
  const can: Access["can"] = isHead
    ? {
        createLeads: true, editLeads: true, manageOperators: true, manageGroups: true, editShifts: true, viewPayroll: true,
        editPayroll: true, editPlans: true, editTeamPlan: true, manageProjects: true, systemSettings: true, manageData: true, manageAccounts: true,
      }
    : isSup
      ? {
          createLeads: S.createLeads, editLeads: S.editLeads, manageOperators: S.manageOperators, manageGroups: false,
          editShifts: S.editShifts, viewPayroll: S.viewPayroll, editPayroll: S.viewPayroll && S.editPayroll, editPlans: S.editPlans,
          editTeamPlan: false, manageProjects: S.manageProjects, systemSettings: false, manageData: false, manageAccounts: false,
        }
      : {
          createLeads: O.createOwnLeads && !!opId, editLeads: O.editOwnLeadsHours > 0 && !!opId, manageOperators: false, manageGroups: false,
          editShifts: O.editOwnShifts && !!opId, viewPayroll: O.viewOwnPay && !!opId, editPayroll: false, editPlans: false,
          editTeamPlan: false, manageProjects: false, systemSettings: false, manageData: false, manageAccounts: false,
        };

  const routes = new Set<string>();
  if (isHead) ALL_ROUTES.forEach((r) => routes.add(r));
  else if (isSup) ["/dashboard", "/leads", "/operators", "/groups", "/schedule", "/dynamics", "/reports", "/projects", "/plans", "/learn", "/settings"].forEach((r) => routes.add(r));
  else ["/me", "/stats", "/leads", "/schedule", "/dynamics", "/learn", "/settings"].forEach((r) => routes.add(r));
  if (can.viewPayroll) routes.add("/payroll");
  // личные разделы — только у аккаунта с карточкой оператора
  for (const r of ["/me", "/stats"]) {
    if (opId) routes.add(r);
    else routes.delete(r);
  }

  const groupNames = Array.from(ownGroups)
    .map((g) => st.groups.find((x) => x.id === g)?.name)
    .filter(Boolean)
    .join(", ");
  const scopeLabel = isHead ? "Весь отдел" : isSup ? (S.seeAllGroups ? `Весь отдел · свои: ${groupNames || "—"}` : groupNames || "Группы не назначены") : "Мои данные";

  return { account: acc, role: acc.role, isHead, isSup, isOp, opId, ownGroups, editOps, viewAll: isHead || (isSup && S.seeAllGroups), can, routes, scopeLabel };
}

/** Может ли менять данные этого оператора (лиды, смены, карточку — дальше решают флаги can). */
export function canTouchOp(a: Access, operatorId: ID | null | undefined): boolean {
  if (!operatorId) return false;
  return a.editOps === null || a.editOps.has(operatorId);
}

export function canCreateLeadFor(a: Access, operatorId: ID): boolean {
  return a.can.createLeads && canTouchOp(a, operatorId);
}

/** Правка/удаление конкретного лида. Оператор — только свои и только первые N часов. */
export function canEditLead(a: Access, lead: Lead, st: DataState, del = false): boolean {
  if (a.isHead) return true;
  if (!canTouchOp(a, lead.operatorId) && !(a.isSup && lead.groupId && a.ownGroups.has(lead.groupId))) return false;
  if (a.isSup) return a.can.editLeads;
  const O = st.settings.access.operator;
  if (del && !O.deleteOwnLeads) return false;
  if (O.editOwnLeadsHours <= 0) return false;
  const created = Date.parse(lead.createdAt);
  return Number.isFinite(created) && Date.now() - created <= O.editOwnLeadsHours * 3600_000;
}

/**
 * Статус лида («доведён» / «не доведён») ставит РОП и супервайзер своих групп.
 * Оператор — нет; супервайзер, который сам звонит, свои лиды не проверяет.
 */
export function canReviewLead(a: Access, lead: Lead): boolean {
  if (a.isHead) return true;
  if (!a.isSup || lead.operatorId === a.opId) return false;
  return canTouchOp(a, lead.operatorId) || (!!lead.groupId && a.ownGroups.has(lead.groupId));
}

export function canManageOperator(a: Access, op: Operator | null, targetGroupId?: ID | null): boolean {
  if (a.isHead) return true;
  if (!a.isSup || !a.can.manageOperators) return false;
  const inOwn = (g: ID | null | undefined) => !!g && a.ownGroups.has(g);
  if (op && !inOwn(op.groupId) && op.id !== a.opId) return false;
  // переводить можно только между своими группами (или новенького — в свою)
  if (targetGroupId !== undefined && !inOwn(targetGroupId)) return false;
  return true;
}

export function canEditShift(a: Access, operatorId: ID): boolean {
  return a.can.editShifts && canTouchOp(a, operatorId);
}

export function canEditPlan(a: Access, scope: "team" | "group" | "operator", targetId: ID | null): boolean {
  if (a.isHead) return true;
  if (!a.can.editPlans) return false;
  if (scope === "team") return false;
  if (scope === "group") return !!targetId && a.ownGroups.has(targetId);
  return canTouchOp(a, targetId);
}

export function canEditPay(a: Access, operatorId: ID): boolean {
  return a.can.editPayroll && canTouchOp(a, operatorId);
}

/**
 * Срез данных по правам. РОП получает всё как есть. Остальные — только свою
 * зону; план команды в срезе = сумма планов их групп (общий план отдела им не нужен).
 */
export function scopeData(st: DataState, a: Access): DataState {
  if (a.isHead) return st;
  const A = st.settings.access;

  let opIds: Set<ID>;
  let groupIds: Set<ID>;
  let leads: Lead[];

  if (a.isSup && A.supervisor.seeAllGroups) {
    // видит весь отдел, но деньги — только своих
    return {
      ...st,
      adjustments: a.can.viewPayroll ? st.adjustments.filter((x) => canTouchOp(a, x.operatorId)) : [],
      accounts: st.accounts.filter((x) => x.id === a.account.id),
    };
  }
  if (a.isSup) {
    groupIds = new Set(a.ownGroups);
    opIds = new Set(a.editOps ?? []);
    leads = st.leads.filter((l) => (l.groupId && groupIds.has(l.groupId)) || opIds.has(l.operatorId));
    // люди, чья история есть в группе (переведённые, удалённые), — видны в отчётах группы
    for (const l of leads) opIds.add(l.operatorId);
  } else {
    opIds = new Set(a.opId ? [a.opId] : []);
    const own = a.opId ? st.operators.find((o) => o.id === a.opId) : null;
    groupIds = new Set(own?.groupId ? [own.groupId] : []);
    leads = st.leads.filter((l) => opIds.has(l.operatorId));
  }

  const shifts = st.shifts.filter((s) => opIds.has(s.operatorId) || (a.isSup && !!s.groupId && groupIds.has(s.groupId)));
  for (const s of shifts) opIds.add(s.operatorId);
  const canPay = a.can.viewPayroll;

  return {
    ...st,
    settings: { ...st.settings, teamPlan: 0 },
    operators: st.operators.filter((o) => opIds.has(o.id)),
    groups: st.groups.filter((g) => groupIds.has(g.id)),
    leads,
    shifts,
    plans: st.plans.filter(
      (p) => (p.scope === "group" && p.targetId != null && groupIds.has(p.targetId)) || (p.scope === "operator" && p.targetId != null && opIds.has(p.targetId)),
    ),
    adjustments: canPay ? st.adjustments.filter((x) => opIds.has(x.operatorId)) : [],
    accounts: st.accounts.filter((x) => x.id === a.account.id),
    // прогресс обучения не режем: оператору нужен свой, руководителю — своей команды
    learn: st.learn,
  };
}

/** Куда вести после входа/переключения: личная стартовая, если она доступна. */
export function homeFor(a: Access): string {
  const pref = a.account.prefs.homePage;
  if (pref && a.routes.has(pref)) return pref;
  if (a.isOp && a.routes.has("/me")) return "/me";
  return a.routes.has("/dashboard") ? "/dashboard" : "/leads";
}
