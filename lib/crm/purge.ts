import type { DataState, ID } from "./types";

/**
 * Удаление демо-данных, оставшихся от прежних версий (кнопка «Демо-данные» убрана).
 *
 * Демо-записи узнаются по фиксированным ID генератора: op_demo01, ld_demo00001,
 * gr_alpha, pr_auto, adj_demo1, acc_op01… Настоящие записи получают ID с меткой
 * времени (op_m1x2y3…), поэтому пересечений нет. РОП acc_head остаётся — без него
 * некому войти.
 */

const DEMO_GROUPS = new Set(["gr_alpha", "gr_beta", "gr_gamma"]);
const DEMO_PROJECTS = new Set(["pr_auto", "pr_estate", "pr_insure"]);
const DEMO_ACCOUNTS = new Set(["acc_sup_alpha", "acc_sup_beta", "acc_sup_gamma"]);

const isDemoOp = (id: ID | null | undefined) => !!id && /^op_demo\d+$/.test(id);
const isDemoAccount = (id: ID) => DEMO_ACCOUNTS.has(id) || /^acc_op\d{2}$/.test(id);

export interface PurgeResult {
  state: DataState;
  removed: { operators: number; groups: number; projects: number; leads: number; shifts: number; accounts: number; other: number };
  /** Хоть что-то удалено. */
  any: boolean;
}

export function stripDemo(st: DataState): PurgeResult {
  // группы и проекты демо, на которые уже завели настоящие записи, не трогаем
  const realOps = st.operators.filter((o) => !isDemoOp(o.id));
  const realLeads = st.leads.filter((l) => !/^ld_demo\d+$/.test(l.id) && !isDemoOp(l.operatorId));
  const usedGroups = new Set<ID>([...realOps.map((o) => o.groupId), ...realLeads.map((l) => l.groupId)].filter((g): g is ID => !!g));
  const usedProjects = new Set<ID>(realLeads.map((l) => l.projectId).filter((p): p is ID => !!p));
  const dropGroup = (id: ID | null | undefined) => !!id && DEMO_GROUPS.has(id) && !usedGroups.has(id);
  const dropProject = (id: ID | null | undefined) => !!id && DEMO_PROJECTS.has(id) && !usedProjects.has(id);

  const groups = st.groups.filter((g) => !dropGroup(g.id));
  const projects = st.projects.filter((p) => !dropProject(p.id));
  const shifts = st.shifts.filter((s) => !isDemoOp(s.operatorId));
  const adjustments = st.adjustments.filter((a) => !/^adj_demo\d+$/.test(a.id) && !isDemoOp(a.operatorId));
  const accounts = st.accounts.filter((a) => !isDemoAccount(a.id) && !isDemoOp(a.operatorId));
  const liveAcc = new Set(accounts.map((a) => a.id));
  const plans = st.plans.filter((p) => !(p.scope === "operator" && isDemoOp(p.targetId)) && !(p.scope === "group" && dropGroup(p.targetId)));
  const approves = st.approves.filter((a) => !dropProject(a.projectId));
  const learn = st.learn.filter((l) => liveAcc.has(l.accountId));
  const audit = st.audit.filter((a) => !(isDemoOp(a.entityId) || /^ld_demo\d+$/.test(a.entityId) || (a.entity === "data" && a.entityId === "demo")));

  const removed = {
    operators: st.operators.length - realOps.length,
    groups: st.groups.length - groups.length,
    projects: st.projects.length - projects.length,
    leads: st.leads.length - realLeads.length,
    shifts: st.shifts.length - shifts.length,
    accounts: st.accounts.length - accounts.length,
    other:
      st.adjustments.length - adjustments.length +
      (st.plans.length - plans.length) +
      (st.approves.length - approves.length) +
      (st.learn.length - learn.length) +
      (st.audit.length - audit.length),
  };
  const any = Object.values(removed).some((n) => n > 0);
  if (!any) return { state: st, removed, any };

  const empty = realOps.length === 0 && realLeads.length === 0 && shifts.length === 0;
  let settings = st.settings;
  if (removed.operators > 0 || removed.leads > 0) {
    // настройки приехали вместе с демо: план, цену лида и удержание вносит руководитель сам
    settings = {
      ...st.settings,
      defaultOperatorPlan: [50, 110, 120].includes(st.settings.defaultOperatorPlan) ? 0 : st.settings.defaultOperatorPlan,
      leadRevenue: st.settings.leadRevenue === 3000 ? 0 : st.settings.leadRevenue,
      withholdPct: st.settings.withholdPct === 13 ? 0 : st.settings.withholdPct,
    };
  }

  return {
    state: {
      ...st,
      settings,
      operators: realOps,
      groups,
      projects,
      leads: realLeads,
      shifts,
      // база осталась пустой — зафиксированные демо-месяцы и их планы больше не нужны
      plans: empty ? plans.filter((p) => !st.frozenMonths.includes(p.month)) : plans,
      frozenMonths: empty ? [] : st.frozenMonths,
      adjustments,
      accounts,
      learn,
      approves,
      audit,
    },
    removed,
    any,
  };
}
