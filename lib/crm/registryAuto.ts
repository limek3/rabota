import type { DataState, DayKey, Operator } from "./types";
import { buildIndex, closedThrough, isGone } from "./calc";
import { dataStart, periodAt, periodIndexOf, periodPayroll, type PayPeriod } from "./payperiod";
import { addDays } from "./dates";
import { fmtMoney } from "./format";
import { PROJECT_LABEL, KIND_LABEL, registryLine, registryPayload, registryPlanLine, ruDate, type RegistryKind, type RegistryLine, type RegistryPayload, type RegistryProject, type RegistryReply } from "./registry";

/**
 * Реестры YouDo сами, по графику выплат (функция registry-sheet, pg_cron в 10:00 МСК):
 *
 *   План  — за PLAN_DAYS_BEFORE дня до начала периода: условная сумма, одна всем, пишется в реестр
 *           как есть — settings.sheets.registry.planOkc / planSv (15 000 ОП, 22 500 СВ). Самозанятые в штате. Опоздали (сбой) —
 *           догоняем до первого дня периода включительно.
 *   Факт  — в день реестра (period.registry, вт перед выплатой в пт): остаток каждого за период
 *           по закрытым дням, как в «Зарплата → По периодам», в реестр — на руки ÷ 0,94. Догоняем до дня выплаты.
 *
 * В реестр идут только самозанятые (employment = smz): YouDo платит только им. Остальные с
 * деньгами — в уведомлении, их выплачивают иначе. Что уже отправлено — kv «registryAuto».done,
 * второй раз тот же лист не шлём; лист уже есть в таблице (сделали руками) — не трогаем.
 * Шаги, чей день раньше дня включения автомата (registry.autoFrom), — не его: их делали руками.
 */

export const PLAN_DAYS_BEFORE = 2;
export const PROJECTS: RegistryProject[] = ["okc", "sv"];

export interface AutoJob {
  key: string;
  kind: RegistryKind;
  project: RegistryProject;
  period: PayPeriod;
  /** Первый день периода для названия листа. */
  start: DayKey;
  payload: RegistryPayload | null;
  /** Почему не отправляем (payload = null). */
  skip?: string;
}

export interface AutoPlan {
  today: DayKey;
  jobs: AutoJob[];
  /** С деньгами за период факта, но не самозанятые — в реестр не попали. */
  notSmz: { name: string; net: number; tab: string }[];
}

/** Супервайзер — в реестр СВ: роль, схема «оклад + объём группы» или ведёт группу. */
export function isSvOp(op: Operator, st: Pick<DataState, "groups">): boolean {
  return op.role === "supervisor" || op.payType === "sv_volume" || st.groups.some((g) => !g.deletedAt && g.supervisorId === op.id);
}

const jobKey = (kind: RegistryKind, project: RegistryProject, tab: string) => `${kind}|${project}|${tab}`;

/** Что пора отправить сегодня. hour — час по Москве (для закрытия дня). done — уже отправленное. */
export function autoJobs(st: DataState, today: DayKey, hour: number, done: Record<string, string>): AutoPlan {
  const s = st.settings;
  const cfg = s.sheets.registry;
  const out: AutoPlan = { today, jobs: [], notSmz: [] };
  const cur = periodIndexOf(s, today);
  const periods = [cur - 1, cur, cur + 1].filter((i) => i >= 0).map((i) => periodAt(s, i));
  const mine = (day: DayKey) => !cfg.autoFrom || day >= cfg.autoFrom;

  for (const p of periods) {
    // ── план: за 2 дня до начала, догоняем до первого дня ──
    const planDay = addDays(p.from, -PLAN_DAYS_BEFORE);
    // задание в YouDo не начать раньше дня подачи
    if (today >= planDay && today <= p.from && mine(planDay)) planJobs(st, p, today > p.from ? today : p.from, done, out, "");
    // ── факт: в день реестра, догоняем до дня выплаты ──
    if (today >= p.registry && today < p.pay && today > p.to && mine(p.registry)) factJobs(st, p, today, hour, done, out, "");
  }
  return out;
}

/** Префикс тестовых листов: скрипт их не считает ни планом, ни готовым листом периода. */
export const TEST_PREFIX = "ТЕСТ ";

/**
 * Тестовый прогон — прямо сейчас, без графика: «ТЕСТ План» на следующий период и «ТЕСТ Факт»
 * на текущий (по начислениям на сегодня). Отправленным не отмечается — настоящий автомат потом
 * сделает свои листы как обычно.
 */
export function testJobs(st: DataState, today: DayKey, hour: number): AutoPlan {
  const s = st.settings;
  const out: AutoPlan = { today, jobs: [], notSmz: [] };
  const cur = periodIndexOf(s, today);
  const next = periodAt(s, cur + 1);
  planJobs(st, next, next.from > today ? next.from : today, {}, out, TEST_PREFIX);
  factJobs(st, periodAt(s, cur), today, hour, {}, out, TEST_PREFIX);
  return out;
}

const startOf = (st: DataState, p: PayPeriod) => (p.first ? dataStart(st, p.from) : p.from);

/** План периода: самозанятые в штате, условная сумма из настроек. */
function planJobs(st: DataState, p: PayPeriod, from: DayKey, done: Record<string, string>, out: AutoPlan, prefix: string) {
  const cfg = st.settings.sheets.registry;
  const start = startOf(st, p);
  const by: Record<RegistryProject, Operator[]> = { okc: [], sv: [] };
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
      amount > 0
        ? { key, kind: "plan", project, period: p, start, payload }
        : { key, kind: "plan", project, period: p, start, payload: null, skip: `не задана сумма плана ${PROJECT_LABEL[project]} (Настройки → Данные → «Реестры выплат YouDo»)` },
    );
  }
}

/** Факт периода: остаток каждого самозанятого по закрытым дням; не СМЗ — в out.notSmz. */
function factJobs(st: DataState, p: PayPeriod, today: DayKey, hour: number, done: Record<string, string>, out: AutoPlan, prefix: string) {
  const start = startOf(st, p);
  const ix = buildIndex(st, closedThrough(today, hour, st.settings));
  const pr = periodPayroll(st, ix, today, p);
  const lines: Record<RegistryProject, RegistryLine[]> = { okc: [], sv: [] };
  const factTab = (pj: RegistryProject) => prefix + registryPayload("fact", pj, start, p.to, today, p.pay, []).tab;
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
    // даты задания: есть лист плана — скрипт возьмёт его даты; нет — с сегодняшнего дня до выплаты
    const payload = registryPayload("fact", project, start, p.to, today, p.pay, lines[project]);
    payload.tab = prefix + payload.tab;
    const key = jobKey("fact", project, payload.tab);
    if (done[key]) continue;
    out.jobs.push({ key, kind: "fact", project, period: p, start, payload });
  }
}

export interface AutoResult {
  job: AutoJob;
  reply?: RegistryReply;
  error?: string;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** «Шумаков Игнат Владиславович» → «Шумаков Игнат»: в сообщении хватает фамилии и имени. */
const short = (name: string) => name.trim().split(/\s+/).slice(0, 2).join(" ");
const dmy = (d: DayKey) => ruDate(d).slice(0, 5);
const rub = (n: number) => esc(fmtMoney(n));

/**
 * Сообщение в Telegram (HTML) по итогам запуска. Пусто — сообщать нечего. Блоки: план / факт за
 * период, внутри — по реестру (ОКЦ, СВ) строка с итогом и ссылкой, ниже — списки по человеку.
 */
export function autoMessage(plan: AutoPlan, results: AutoResult[], test = false): string {
  if (!results.length && !plan.notSmz.length) return "";
  const out: string[] = [test ? "🧪 <b>Реестры YouDo — тестовый прогон</b>\n<i>листы «ТЕСТ …» можно удалить</i>" : "📋 <b>Реестры YouDo</b>"];

  // блоки: вид + период, в порядке результатов
  const blocks = new Map<string, AutoResult[]>();
  for (const r of results) {
    const k = `${r.job.kind}|${r.job.period.idx}`;
    blocks.set(k, [...(blocks.get(k) ?? []), r]);
  }
  for (const list of blocks.values()) {
    const { kind, period, start } = list[0].job;
    const head = kind === "plan" ? "🗓 <b>ПЛАН</b>" : "💰 <b>ФАКТ</b>";
    const block: string[] = [`${head} · ${dmy(start)} – ${dmy(period.to)}`];
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
      "<i>оформить СМЗ в карточке или выплатить иначе</i>",
    );
  return out.join("\n");
}

/** Ближайшие шаги автомата — для настроек: что и когда создастся. */
export function upcomingSteps(s: DataState["settings"], today: DayKey, n = 4): { date: DayKey; kind: RegistryKind; period: PayPeriod }[] {
  const out: { date: DayKey; kind: RegistryKind; period: PayPeriod }[] = [];
  const cur = periodIndexOf(s, today);
  // автомат ещё не включён — считаем, что включат сегодня: уже начатое не его
  const from = s.sheets.registry.autoFrom || today;
  for (let i = Math.max(0, cur - 1); i <= cur + 3; i++) {
    const p = periodAt(s, i);
    const planDay = addDays(p.from, -PLAN_DAYS_BEFORE);
    if (p.from >= today && planDay >= from) out.push({ date: planDay < today ? today : planDay, kind: "plan", period: p });
    if (p.pay > today && p.registry >= from) out.push({ date: p.registry < today ? today : p.registry, kind: "fact", period: p });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);
}
