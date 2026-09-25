// Тесты движка расчётов (lib/crm/calc.ts, payroll.ts, validate.ts, demo.ts).
// Запуск: npm run test:calc — компилирует lib/crm в .calc-test/ и проверяет формулы на демо-данных.
const path = require("path");
const R = (m) => require(path.join(__dirname, "..", ".calc-test", m));

/* ── базовые формулы, пустая база, импорт ── */
(() => {
const assert = require("assert");
const { buildIndex, monthModel, pace, monthCal, dailyRows, weeklyRows, freezePastMonths, filterLeads, findDuplicate } = R("calc");
const { payroll } = R("payroll");
const { buildDemo } = R("demo");
const { sanitize, checkIntegrity, toSnapshot } = R("validate");
const { emptyState, DEFAULT_SETTINGS } = R("defaults");

const today = "2026-09-19"; // суббота
// 1. Пустая база — без ошибок и NaN
const empty = emptyState();
const ixE = buildIndex(empty);
const mE = monthModel(empty, ixE, "2026-09", today);
const noNaN = (o, path = "") => {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "number") assert(Number.isFinite(v), `NaN/Inf at ${path}.${k}=${v}`);
    else if (v && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set) && typeof v !== "function") noNaN(v, path + "." + k);
  }
};
noNaN(mE.team, "emptyTeam");
console.log("empty ok", mE.team.plan, mE.team.pace.fact, mE.groups.length, mE.ops.length);
payroll(empty, ixE, mE.cal);

// 2. Ручной пример: план 50, сентябрь 2026 = 22 рабочих дня; к 18.09 (пт) прошло 14 раб. дней
const cal = monthCal("2026-09", DEFAULT_SETTINGS, "2026-09-18");
console.log("W", cal.W, "phase", cal.phase);
assert.equal(cal.W, 22);
const counts = new Map();
for (const d of cal.days) if (d <= "2026-09-18" && cal.isWork(d)) counts.set(d, 2); // 14 days * 2 = 28
const p = pace(cal, 50, counts, DEFAULT_SETTINGS);
console.log(JSON.stringify({ fact: p.fact, elapsed: p.elapsedW, ptd: p.planToDate.toFixed(2), rr: p.rr.toFixed(2), need: p.needPerDay.toFixed(3), remW: p.remainingW, avg: p.avgPerDay, best: p.best, worst: p.worst, met: p.daysMet, cnt: p.daysCounted, week: p.thisWeek, prev: p.prevWeek, wch: p.weekChange }));
assert.equal(p.fact, 28);
assert.equal(p.elapsedW, 14);
assert(Math.abs(p.planToDate - 50 * 14 / 22) < 1e-9);
assert(Math.abs(p.rr - 28 / 14 * 22) < 1e-9);
// нужно в день: сегодня (пт) рабочий -> база = факт без сегодняшних (26), осталось 9 раб.дней включая сегодня
assert.equal(p.remainingW, 9);
assert(Math.abs(p.needPerDay - (50 - 26) / 9) < 1e-9);

// 3. Прошлый месяц: RR = факт, needPerDay = null
const calP = monthCal("2026-08", DEFAULT_SETTINGS, today);
const pp = pace(calP, 40, counts, DEFAULT_SETTINGS);
assert.equal(pp.needPerDay, null); assert.equal(pp.rr, pp.fact);

// 4. Будущий месяц
const calF = monthCal("2026-10", DEFAULT_SETTINGS, today);
const pf = pace(calF, 44, new Map(), DEFAULT_SETTINGS);
assert.equal(pf.elapsedW, 0); assert.equal(pf.planToDate, 0); assert(Math.abs(pf.needPerDay - 44 / calF.W) < 1e-9);

// 5. Без рабочих дней (все дни выходные) — нет деления на ноль
const s0 = { ...DEFAULT_SETTINGS, workdays: [], holidays: [] };
const c0 = monthCal("2026-09", { ...s0, workdays: [1,2,3,4,5,6,7], holidays: cal.days }, today);
noNaN(pace(c0, 10, counts, s0), "noWork");

// 6. Демо
const demo = buildDemo(today);
const ix = buildIndex(demo);
const m = monthModel(demo, ix, "2026-09", today);
noNaN(m.team, "demoTeam");
m.ops.forEach((r) => noNaN({ ...r.pace, hours: r.hours, normPct: r.normPct, avg: r.avgPerWorkday }, r.op.name));
console.log("demo leads", demo.leads.length, "shifts", demo.shifts.length);
console.log("team", JSON.stringify({ plan: m.team.plan, src: m.team.planSource, fact: m.team.pace.fact, pct: m.team.pace.pct.toFixed(2), rr: m.team.pace.rr.toFixed(1), need: m.team.pace.needPerDay?.toFixed(2), hours: m.team.hours, lph: m.team.lph?.toFixed(3), heads: m.team.headcount, needOps: m.team.neededOps?.toFixed(1), perOpDay: m.team.perOpDay.toFixed(2) }));
console.log("status", JSON.stringify(m.statusCount));
m.ops.forEach((r) => console.log(" ", r.op.name.padEnd(34), r.op.status.padEnd(6), r.status.padEnd(9), "plan", r.terms.plan, "fact", r.pace.fact, "ptd", r.pace.planToDate.toFixed(1), "h", r.hours, "norm", r.norm, "lph", r.lph?.toFixed(2), r.isLeader ? "LEADER" : ""));
m.groups.forEach((g) => console.log(" G", g.name, "plan", g.plan, "fact", g.pace.fact, "heads", g.headcount, "contrib", g.contributors, "h", g.hours));
const sumGroupFact = m.groups.reduce((a, g) => a + g.pace.fact, 0);
assert.equal(sumGroupFact, m.team.pace.fact, "group facts sum to team");
const sumOpFact = m.ops.reduce((a, r) => a + r.pace.fact, 0);
assert.equal(sumOpFact, m.team.pace.fact, "op facts sum to team");

// prev month
const mp = monthModel(demo, ix, "2026-08", today);
console.log("prev", mp.team.plan, mp.team.pace.fact, mp.team.pace.pct.toFixed(2), mp.cal.phase);

// dynamics
const dr = dailyRows(m.cal, m.team.plan, ix.day, ix.hoursDay);
const wr = weeklyRows(m.cal, m.team.plan, ix.day);
assert.equal(dr[dr.length - 1].cumPlan.toFixed(6), m.team.plan.toFixed(6));
console.log("weeks", wr.map((w) => `${w.from}..${w.to} p${w.plan.toFixed(1)} f${w.fact} ch${w.change==null?'-':w.change.toFixed(2)}`).join(" | "));
assert.equal(wr.reduce((a, w) => a + w.fact, 0), m.team.pace.fact);

// payroll
const pr = payroll(demo, ix, m.cal);
pr.rows.slice(0, 4).forEach((r) => console.log(" P", r.op.name.padEnd(34), r.payType, "h", r.hours, "leads", r.leads, "base", r.base, "lead", r.leadPay, "gross", r.gross, "wh", r.withhold, "net", r.net, "paid", r.paid, "toPay", r.toPay));
console.log("payroll total gross", pr.total.gross.toFixed(0), "toPay", pr.total.toPay.toFixed(0));
pr.rows.forEach((r) => noNaN({ a: r.gross, b: r.net, c: r.toPay }, r.op.name));

// freeze
const fz = freezePastMonths(demo, ix, today);
console.log("freeze", fz.months, fz.plans.length);

// filter & dup
const L = demo.leads.find((l) => l.at >= "2026-09"); const f = filterLeads(demo.leads, { from: "2026-09-01", to: "2026-09-30", q: L.phone.slice(-5) });
assert(f.length >= 1);
const dup = findDuplicate(demo.leads, demo.leads[5].phone, demo.leads[5].at, 30);
assert(dup);

// sanitize roundtrip
const snap = JSON.parse(JSON.stringify(toSnapshot(demo)));
snap.leads.push({ ...snap.leads[0] }); // дубль
snap.leads.push({ id: "x", at: "bad", operatorId: "op" });
snap.leads.push({ ...snap.leads[1], id: "ld_orphan", operatorId: "op_missing" });
const san = sanitize(snap);
console.log("sanitize warnings", san.warnings);
assert.equal(san.state.leads.length, demo.leads.length + 1);
assert(san.state.operators.find((o) => o.id === "op_missing"));
console.log("integrity", checkIntegrity(san.state));
// sanitize garbage
sanitize(null); sanitize({ leads: "x" }); sanitize([1,2]);
console.log("ALL OK");
})();

/* ── сценарии: удаление, группы, новички, зарплата, фиксация месяцев ── */
(() => {
const assert = require("assert");
const { buildIndex, monthModel, monthOperators, opTerms, monthCal, freezePastMonths } = R("calc");
const { payroll } = R("payroll");
const { buildDemo } = R("demo");
const { DEFAULT_SETTINGS } = R("defaults");
const today = "2026-09-18";
const demo = buildDemo(today);

// 1. Удалённый оператор: скрыт из текущего штата, но его история остаётся в месяце и в сумме команды
const st = JSON.parse(JSON.stringify(demo));
const victim = st.operators[2];
victim.deletedAt = "2026-09-18T10:00:00Z";
const ix = buildIndex(st);
const m = monthModel(st, ix, "2026-09", today);
const before = monthModel(demo, buildIndex(demo), "2026-09", today);
assert.equal(m.team.pace.fact, before.team.pace.fact, "факт команды не меняется после удаления оператора");
assert(m.ops.find((r) => r.op.id === victim.id), "удалённый с лидами остаётся в месяце");
const empty = JSON.parse(JSON.stringify(st)); empty.leads = empty.leads.filter(l => l.operatorId !== victim.id); empty.shifts = empty.shifts.filter(s => s.operatorId !== victim.id); empty.adjustments = empty.adjustments.filter(a=>a.operatorId!==victim.id);
assert(!monthOperators(empty, buildIndex(empty), "2026-10").find(o => o.id === victim.id), "удалённый без истории не попадает в будущие месяцы");
console.log("1 ok: удаление оператора сохраняет историю");

// 2. Удалённая группа: операторы в «Без группы», лиды остаются в истории группы
const st2 = JSON.parse(JSON.stringify(demo));
st2.groups[0].deletedAt = "2026-09-18T10:00:00Z";
st2.operators.forEach(o => { if (o.groupId === "gr_alpha") o.groupId = null; });
const m2 = monthModel(st2, buildIndex(st2), "2026-09", today);
const alpha = m2.groups.find(g => g.key === "gr_alpha");
const none = m2.groups.find(g => g.key === "__none__");
assert(alpha && alpha.pace.fact === before.groups.find(g => g.key === "gr_alpha").pace.fact, "история удалённой группы сохранена");
assert(none && none.members.length === 5, "5 операторов перешли в «Без группы»");
assert.equal(m2.groups.reduce((a,g)=>a+g.pace.fact,0), m2.team.pace.fact, "сумма групп = команда");
console.log("2 ok: удаление группы ->", alpha.name, "/", none.name, none.members.length, "чел.");

// 3. Приём посреди месяца: план пропорционален рабочим дням
const cal = monthCal("2026-09", DEFAULT_SETTINGS, today);
const op = { ...demo.operators[1], hireDate: "2026-09-16", monthlyPlan: 44, fireDate: "", status: "active" };
const t = opTerms(op, cal, demo, buildIndex(demo));
// сентябрь: 22 раб. дня; с 16 по 30 — 11 раб. дней → 44*11/22 = 22
assert.equal(t.plan, 22, "план новичка = 22");
console.log("3 ok: план новичка", t.plan);

// 4. Зарплата: почасовая + бонус, оклад пропорционально, удержание без компенсаций
const s4 = JSON.parse(JSON.stringify(demo));
s4.settings.withholdPct = 10;
const ix4 = buildIndex(s4);
const pr = payroll(s4, ix4, monthCal("2026-09", s4.settings, today));
for (const r of pr.rows) {
  // сетка проверяется отдельным блоком ниже — здесь сверяем фиксированные схемы
  const tiered = r.payType === "tiered" || r.payType === "salary_tiered";
  const sv = r.payType === "sv_volume";
  const base = sv
    ? r.salary
    : r.payType.startsWith("salary")
    ? r.salary * Math.min(1, r.hours / r.normHours)
    : tiered
      ? r.base
      : r.hours * r.hourlyRate;
  assert(Math.abs(r.base - Math.round(base*100)/100) < 0.01, "база " + r.op.name);
  const lp = tiered || sv ? r.leadPay : r.payType.endsWith("bonus") ? r.leads * r.leadBonus : 0;
  assert(Math.abs(r.leadPay - lp) < 0.01);
  const gross = base + lp + r.adj.accrual + r.adj.bonus + r.adj.compensation + r.adj.correction;
  const wh = (gross - r.adj.compensation) * 0.1;
  assert(Math.abs(r.toPay - (gross - wh - r.adj.deduction - r.adj.advance - r.adj.payout)) < 0.02, "остаток " + r.op.name);
}
const comp = pr.rows.find(r => r.adj.compensation > 0);
console.log("4 ok: ведомость;", comp.op.name, "компенсация", comp.adj.compensation, "не облагается: база удержания", comp.withholdBase, "из", comp.gross);

// 5. Фиксация прошлого месяца: смена плана в карточке не меняет август
const s5 = JSON.parse(JSON.stringify(demo));
const ix5 = buildIndex(s5);
const fz = freezePastMonths(s5, ix5, today);
s5.plans.push(...fz.plans); s5.frozenMonths = fz.months;
const augBefore = monthModel(s5, buildIndex(s5), "2026-08", today).team.plan;
s5.operators.forEach(o => o.monthlyPlan = 999); s5.settings.defaultOperatorPlan = 999;
const augAfter = monthModel(s5, buildIndex(s5), "2026-08", today).team.plan;
const sepAfter = monthModel(s5, buildIndex(s5), "2026-09", today).team.plan;
assert.equal(augBefore, augAfter, "август зафиксирован");
assert(sepAfter > augAfter, "сентябрь пересчитан по новым планам");
assert.equal(freezePastMonths(s5, buildIndex(s5), today).plans.length, 0, "повторная фиксация ничего не пишет");
console.log("5 ok: август", augBefore, "=", augAfter, "; сентябрь стал", sepAfter);

// 6. Один оператор, без групп, без смен
const one = { ...JSON.parse(JSON.stringify(demo)), groups: [], shifts: [] };
one.operators = [ { ...one.operators[0], groupId: null } ];
one.leads = one.leads.filter(l => l.operatorId === one.operators[0].id).map(l => ({ ...l, groupId: null }));
one.adjustments = [];
const m6 = monthModel(one, buildIndex(one), "2026-09", today);
assert.equal(m6.groups.length, 1); assert.equal(m6.groups[0].key, "__none__");
assert.equal(m6.team.plan, 160); assert(m6.team.lph === null, "нет часов -> лид/час = null, не деление на ноль");
console.log("6 ok: один оператор без групп/смен, план", m6.team.plan, "факт", m6.team.pace.fact);
console.log("ALL OK");
})();

/* ── сетка: ставка и бонус зависят от лидов в смене ── */
(() => {
  const assert = require("assert");
  const { buildIndex, monthCal, opTerms } = R("calc");
  const { payroll, tierFor, isHourlyTiered } = R("payroll");
  const { buildDemo } = R("demo");
  const { monthDays } = R("dates");
  const today = "2026-09-18";
  const st = buildDemo(today);
  const ix = buildIndex(st);
  const cal = monthCal("2026-09", st.settings, today);
  const pr = payroll(st, ix, cal);
  const tiered = pr.rows.filter((r) => r.payType === "tiered" || r.payType === "salary_tiered");
  assert(tiered.length, "в демо есть операторы на сетке");
  for (const r of tiered) {
    const t = opTerms(r.op, cal, st, ix);
    let base = 0, bonus = 0, days = 0;
    for (const d of monthDays("2026-09")) {
      const leads = ix.opDay.get(r.op.id)?.get(d) ?? 0;
      const hours = ix.hoursOpDay.get(r.op.id)?.get(d) ?? 0;
      if (!leads && !hours) continue;
      days++;
      const tier = tierFor(t.tiers, leads);
      if (isHourlyTiered(r.payType)) base += hours * tier.hourlyRate;
      bonus += leads * tier.leadBonus;
    }
    if (isHourlyTiered(r.payType)) assert(Math.abs(r.base - Math.round(base * 100) / 100) < 0.01, "база по сетке " + r.op.name);
    assert(Math.abs(r.leadPay - Math.round(bonus * 100) / 100) < 0.01, "бонус по сетке " + r.op.name);
    assert.equal(r.tierUse.reduce((a, u) => a + u.days, 0), days, "смены разложены по ступеням " + r.op.name);
  }
  const ex = tiered[0];
  const hiTier = ex.tierUse[ex.tierUse.length - 1];
  const loTier = ex.tierUse[0];
  console.log("7 ok: сетка;", ex.op.name, "- смен по нижней ступени", loTier.days, "(бонус", loTier.leadBonus + "₽)", "по верхней", hiTier.days, "(бонус", hiTier.leadBonus + "₽)", "итого база", ex.base, "бонус", ex.leadPay);
  // один и тот же день с разным числом лидов даёт разную оплату
  const tiers = [{ from: 0, hourlyRate: 100, leadBonus: 100 }, { from: 3, hourlyRate: 200, leadBonus: 300 }];
  assert.equal(tierFor(tiers, 2).hourlyRate, 100);
  assert.equal(tierFor(tiers, 3).hourlyRate, 200);
  assert.equal(tierFor(tiers, 99).leadBonus, 300);
  console.log("8 ok: ступень по числу лидов за смену (2 лида -> 100 ₽/ч, 3 лида -> 200 ₽/ч)");
})();

/* ── реальные ставки из «Академии обзвона» ── */
(() => {
  const assert = require("assert");
  const { DEFAULT_SETTINGS } = R("defaults");
  const { tierFor, svBonus } = R("payroll");
  const T = DEFAULT_SETTINGS.rateGrids[0].tiers;
  // смена 8 ч: 5 лидов -> 200 ₽/ч и 70 ₽ за лид = 1950; 8 лидов -> 240 и 80 = 2560
  const shift = (h, l) => tierFor(T, l).hourlyRate * h + tierFor(T, l).leadBonus * l;
  assert.equal(shift(8, 5), 1950, "8 ч и 5 лидов = 1 950 ₽");
  assert.equal(shift(8, 8), 2560, "8 ч и 8 лидов = 2 560 ₽");
  assert.equal(shift(8, 11), 260 * 8 + 90 * 11, "верхняя ступень");
  assert.deepEqual([tierFor(T, 0).hourlyRate, tierFor(T, 6).hourlyRate, tierFor(T, 10).hourlyRate, tierFor(T, 99).hourlyRate], [200, 230, 240, 260]);
  assert.deepEqual([tierFor(T, 5).leadBonus, tierFor(T, 7).leadBonus, tierFor(T, 8).leadBonus, tierFor(T, 11).leadBonus], [70, 75, 80, 90]);
  console.log("9 ok: смена 8 ч ·", shift(8, 5), "₽ при 5 лидах и", shift(8, 8), "₽ при 8 лидах (+610 ₽ за 3 лида)");

  const G = DEFAULT_SETTINGS.svBonus;
  const sv = (leads, o) => svBonus(G, leads, o.prev ?? 0, { grade: o.grade ?? "mid", track: o.track ?? "re", approvePct: o.apr ?? 30, growth: o.growth ?? null });
  assert.equal(sv(1000, {}).bonus, 18000, "1000 лидов, Middle, недвижимость = 18 000");
  assert.equal(sv(1000, { grade: "sr" }).bonus, 20000);
  assert.equal(sv(1000, { track: "auto", grade: "jr" }).bonus, 15000);
  assert.equal(sv(699, {}).bonus, 0, "ниже 700 лидов бонуса нет");
  assert.equal(sv(700, {}).bonus, 4500);
  assert.equal(sv(1000, { apr: 25 }).bonus, 17100, "апрув 25% -> коэффициент 0,95");
  assert.equal(sv(1000, { apr: 22 }).bonus, 16200, "апрув 22% -> 0,9");
  assert.equal(sv(1000, { apr: 19 }).bonus, 0, "апрув ниже 20% обнуляет бонус");
  assert.equal(sv(1000, { growth: false }).bonus, 15300, "нет роста -> 0,85 для Middle");
  assert.equal(sv(1000, { growth: false, grade: "jr" }).bonus, 16000, "у Junior коэффициента за динамику нет");
  const s2 = sv(1100, {});
  assert.deepEqual([s2.step, s2.next.from, s2.next.base], [1000, 1200, 27000]);
  console.log("10 ok: супервайзер; 1000 лидов Middle =", sv(1000, {}).bonus, "₽ бонуса + оклад", G.salary, "₽; апрув 22% ->", sv(1000, { apr: 22 }).bonus);
})();

/* 11. ФОТ: фонд против дохода и норматив */
{
  const assert = require("assert");
  const { fundStat } = R("payroll");
  const f = fundStat(240000, 400, 3000, 24);
  assert.equal(f.revenue, 1200000);
  assert.equal(Math.round(f.pct * 100), 20);
  assert.equal(f.ok, true);
  assert.equal(f.over, 0);
  const bad = fundStat(360000, 400, 3000, 24);
  assert.equal(bad.ok, false);
  assert.equal(bad.over, 72000); // 360 000 − 24% от 1 200 000
  const empty = fundStat(50000, 0, 3000, 24);
  assert.equal(empty.ok, true, "без лидов норматив не считаем");
  console.log("11 ok: ФОТ 240 000 ₽ при доходе 1 200 000 ₽ = 20% (норма), 360 000 ₽ = 30% и перебор 72 000 ₽");
}

/* 12. Прогноз ФОТ и апрув по проектам */
{
  const assert = require("assert");
  const { fundForecast } = R("payroll");
  const { buildIndex, approvePctFor } = R("calc");
  const { buildDemo } = R("demo");

  // фонд 100 000 за 10 отработанных дней из 20, лиды 200 → RR 400
  const f = fundForecast(100000, 200, 400, 10, 20, 3000, 24, ["2026-09-22", "2026-09-23", "2026-09-24"]);
  assert.equal(f.fund, 200000);
  assert.equal(f.revenue, 1200000);
  assert.equal(Math.round(f.pct * 100), 17);
  assert.equal(f.ok, true, "17% ниже норматива 24%");

  // темп дороже норматива: 30 000 в день при 20 лидах в день (доход 60 000, норматив 14 400)
  const over = fundForecast(30000, 20, 400, 1, 20, 3000, 24, ["2026-09-22", "2026-09-23", "2026-09-24"]);
  assert.equal(over.alreadyOver, true);
  assert.ok(over.leadsNeeded > 400, "чтобы уложиться, лидов нужно больше прогноза");

  // апрув: средневзвешенный по проектам
  const st = buildDemo("2026-09-19");
  const ix = buildIndex(st);
  const base = approvePctFor(st, ix, "2026-09");
  assert.equal(base, st.settings.svBonus.defaultApprovePct, "без записей берём значение по умолчанию");
  const auto = st.projects.find((p) => p.name === "Авто");
  st.approves = [{ id: `2026-09|${auto.id}`, month: "2026-09", projectId: auto.id, pct: 10, comment: "", updatedAt: "" }];
  const ix2 = buildIndex(st);
  const mixed = approvePctFor(st, ix2, "2026-09");
  assert.ok(mixed < base && mixed > 10, `средневзвешенный между 10% и ${base}%, получили ${mixed}`);
  console.log(`12 ok: прогноз ФОТ 200 000 ₽ = 17% (норма), перерасход ловится; апрув по проектам ${base}% → ${mixed}%`);
}

/* 13. Статусы лидов: «не доведён» выпадает из факта, проверяет супервайзер своей группы */
{
  const assert = require("assert");
  const { buildIndex, monthModel, filterLeads } = R("calc");
  const { buildDemo } = R("demo");
  const { computeAccess, canReviewLead } = R("access");
  const st = buildDemo("2026-09-19");
  const failed = st.leads.filter((l) => l.status === "failed");
  assert.ok(failed.length > 0 && failed.every((l) => l.statusReason), "у не доведённых есть причина");
  const ix = buildIndex(st);
  let counted = 0;
  for (const m of ix.opDay.values()) for (const v of m.values()) counted += v;
  assert.equal(counted, st.leads.length - failed.length, "в факт идут все, кроме «не доведён»");
  const sep = filterLeads(st.leads, { from: "2026-09-01", to: "2026-09-30", status: "counted" }).length;
  assert.equal(monthModel(st, ix, "2026-09", "2026-09-19").team.pace.fact, sep, "факт месяца = лиды без «не доведён»");

  const head = computeAccess(st.accounts.find((a) => a.role === "head"), st);
  const opAcc = st.accounts.find((a) => a.role === "operator");
  const op = computeAccess(opAcc, st);
  const sup = computeAccess(st.accounts.find((a) => a.id === "acc_sup_alpha"), st);
  const alphaLead = st.leads.find((l) => l.groupId === "gr_alpha" && l.operatorId !== sup.opId);
  const betaLead = st.leads.find((l) => l.groupId === "gr_beta");
  const ownLead = st.leads.find((l) => l.operatorId === sup.opId);
  assert.ok(canReviewLead(head, betaLead), "РОП — любой лид");
  assert.ok(canReviewLead(sup, alphaLead), "супервайзер — лиды своей группы");
  assert.ok(!canReviewLead(sup, betaLead), "чужую группу — нет");
  assert.ok(!canReviewLead(sup, ownLead), "свои лиды супервайзер не проверяет");
  assert.ok(!canReviewLead(op, st.leads.find((l) => l.operatorId === opAcc.operatorId)), "оператор статус не ставит");
  console.log(`13 ok: статусы; не доведено ${failed.length} из ${st.leads.length}, в факт идут ${counted}`);
}

/* 14. Очистка демо-данных прежних версий: настоящие записи остаются */
{
  const assert = require("assert");
  const { buildDemo } = R("demo");
  const { stripDemo } = R("purge");
  const st = buildDemo("2026-09-19");
  const clean = stripDemo(st);
  assert.ok(clean.any);
  const c = clean.state;
  assert.equal(c.operators.length + c.leads.length + c.shifts.length + c.groups.length + c.projects.length + c.adjustments.length, 0, "демо удалено целиком");
  assert.deepEqual(c.accounts.map((a) => a.id), ["acc_head"], "остаётся только РОП");
  assert.equal(stripDemo(c).any, false, "повторно удалять нечего");

  // настоящий оператор в демо-группе и его лид по демо-проекту — группа и проект остаются
  const mixed = JSON.parse(JSON.stringify(st));
  mixed.operators.push({ ...mixed.operators[1], id: "op_mf3k2a01abcdef", name: "Настоящий Оператор" });
  mixed.leads.push({ ...mixed.leads[0], id: "ld_mf3k2a01abcdef", operatorId: "op_mf3k2a01abcdef", groupId: "gr_alpha", projectId: "pr_auto" });
  const m = stripDemo(mixed).state;
  assert.deepEqual(m.operators.map((o) => o.id), ["op_mf3k2a01abcdef"]);
  assert.equal(m.leads.length, 1);
  assert.deepEqual(m.groups.map((g) => g.id), ["gr_alpha"]);
  assert.deepEqual(m.projects.map((p) => p.id), ["pr_auto"]);
  console.log("14 ok: демо удалено (" + clean.removed.operators + " операторов, " + clean.removed.leads + " лидов), настоящие записи целы");
}

/* 15. Выгрузка в Google Таблицу: все листы, строки по ширине заголовка, секрет не уходит */
{
  const assert = require("assert");
  const { buildDemo } = R("demo");
  const { buildSheets } = R("sheets");
  const st = buildDemo("2026-09-19");
  st.settings.sheets = { url: "https://script.google.com/macros/s/x/exec", token: "SECRET-123", auto: true };
  const sheets = buildSheets(st);
  const names = sheets.map((s) => s.name);
  for (const n of ["Лиды", "Операторы", "Группы", "Проекты", "График", "Планы", "Начисления", "Апрув", "Аккаунты", "Обучение", "Журнал", "Настройки"]) assert.ok(names.includes(n), "лист " + n);
  for (const s of sheets) for (const r of s.rows) assert.equal(r.length, s.header.length, `ширина строки на листе «${s.name}»`);
  const leads = sheets.find((s) => s.name === "Лиды");
  assert.equal(leads.rows.length, st.leads.length);
  assert.ok(leads.rows.some((r) => r[3] === "Не доведён" && r[4]), "статус и причина в выгрузке");
  assert.ok(!JSON.stringify(sheets).includes("SECRET-123"), "секрет не выгружается");
  console.log(`15 ok: выгрузка — ${sheets.length} листов, ${sheets.reduce((n, s) => n + s.rows.length, 0)} строк`);
}

/* 16. Зарплата и часы — по факту: смены, запланированные наперёд, не считаются */
{
  const assert = require("assert");
  const { buildIndex, monthCal, monthModel } = R("calc");
  const { payroll } = R("payroll");
  const { buildDemo } = R("demo");
  const today = "2026-09-18";
  const st = buildDemo(today);
  const cal = monthCal("2026-09", st.settings, today);
  const op = st.operators.find((o) => o.status === "active" && o.payType === "tiered");
  const before = payroll(st, buildIndex(st), cal).rows.find((r) => r.op.id === op.id);
  const mBefore = monthModel(st, buildIndex(st), "2026-09", today).ops.find((r) => r.op.id === op.id);
  const plan = JSON.parse(JSON.stringify(st));
  for (const d of ["2026-09-21", "2026-09-22", "2026-09-23"]) plan.shifts.push({ id: `${d}|${op.id}`, date: d, operatorId: op.id, groupId: op.groupId, hours: 8, type: "work", comment: "", updatedAt: "" });
  const ix = buildIndex(plan);
  const after = payroll(plan, ix, cal).rows.find((r) => r.op.id === op.id);
  const mAfter = monthModel(plan, ix, "2026-09", today).ops.find((r) => r.op.id === op.id);
  assert.equal(after.hours, before.hours, "часы в ведомости — по сегодня");
  assert.equal(after.gross, before.gross, "начислено — по сегодня");
  assert.equal(mAfter.hours, mBefore.hours, "часы в аналитике — по сегодня");
  assert.equal(mAfter.lph, mBefore.lph, "лидов на час не падает от будущих смен");
  // прошлый месяц — весь
  const aug = payroll(st, buildIndex(st), monthCal("2026-08", st.settings, today)).rows.find((r) => r.op.id === op.id);
  assert.ok(aug.hours > 0);
  console.log(`16 ok: будущие смены не в зарплате — ${op.name}: ${after.hours} ч, ${after.gross} ₽ (план +24 ч не учтён)`);
}

/* 17. Отчёты за день и неделю: факт как в CRM, неделя = сумма дней, план по дням */
{
  const assert = require("assert");
  const { buildIndex, sumRange } = R("calc");
  const { buildDemo } = R("demo");
  const { buildReport } = R("report");
  const today = "2026-09-18";
  const st = buildDemo(today);
  const ix = buildIndex(st);
  const day = buildReport(st, ix, "day", "2026-09-17", "", today);
  assert.equal(day.total.leads, ix.day.get("2026-09-17") ?? 0, "лиды дня = факт по индексу (без «не доведён»)");
  const failedDay = st.leads.filter((l) => l.at.startsWith("2026-09-17") && l.status === "failed").length;
  assert.equal(day.total.failed, failedDay, "не доведённые посчитаны отдельно");
  assert.ok(day.total.plan > 0 && day.total.hours > 0, "есть план и часы");
  const week = buildReport(st, ix, "week", "2026-09-16", "", today);
  assert.equal(week.from, "2026-09-14");
  assert.equal(week.factTo, today, "неделя в процессе — факт по сегодня");
  assert.equal(week.total.leads, sumRange(ix.day, "2026-09-14", today), "неделя = сумма дней");
  assert.equal(week.byDay.reduce((a, d) => a + d.leads, 0), week.total.leads);
  assert.equal(week.byDay.filter((d) => d.day > today).reduce((a, d) => a + d.plan + d.leads, 0), 0, "будущие дни пустые");
  const g = buildReport(st, ix, "week", "2026-09-16", "gr_alpha", today);
  assert.ok(g.total.leads < week.total.leads && g.rows.every((r) => r.op.groupId === "gr_alpha" || r.leads > 0), "фильтр по группе");
  console.log(`17 ok: отчёты — день ${day.total.leads} лидов из плана ${day.total.plan.toFixed(1)}, неделя ${week.total.leads}, Альфа ${g.total.leads}`);
}

/* 18. Лиды по часам: клетки, «не доведён» отдельно, среднее за день, лучшее окно смены */
{
  const assert = require("assert");
  const { hourGrid, bestWindow, perDay } = R("hours");
  const L = (at, status = "work") => ({ id: at + status, at, client: "", phone: "", projectId: null, operatorId: "o1", groupId: null, direction: "", comment: "", source: "Скорозвон", status, statusReason: status === "failed" ? "x" : "", createdAt: "", updatedAt: "" });
  const leads = [
    L("2026-09-14T11:05"), L("2026-09-14T11:40"), L("2026-09-14T15:00"), // пн
    L("2026-09-21T11:10"), L("2026-09-21T11:20", "failed"), // пн, следующая неделя
    L("2026-09-16T19:59"), // ср
    L("2026-08-31T11:00"), // вне периода
    L("2026-09-17"), // без времени — пропускаем
  ];
  const g = hourGrid(leads, "2026-09-01", "2026-09-30");
  assert.equal(g.total, 5, "в факт — без «не доведён» и без лидов вне периода");
  assert.equal(g.failedTotal, 1);
  assert.equal(g.leads[0][11], 3, "пн 11:00 — три лида за два понедельника");
  assert.equal(g.failed[0][11], 1);
  assert.equal(g.leads[2][19], 1, "ср 19:59 — в час 19");
  assert.equal(g.daysByWd[0], 2, "два понедельника с лидами");
  assert.equal(perDay(g, 0, 11), 1.5, "в среднем за понедельник");
  assert.deepEqual([g.hourFrom, g.hourTo], [11, 19]);
  assert.deepEqual(g.peak, { wd: 0, hour: 11, leads: 3 });
  const w = bestWindow(g.byHour, 8);
  assert.equal(w.leads, 4, "окно 8 ч забирает 11:00 и 15:00, но не 19:00");
  assert.deepEqual([w.from, w.to], [11, 19], "окно по центру часов с лидами, а не с 8 утра");
  assert.equal(bestWindow(new Array(24).fill(0), 8), null);
  const e = hourGrid([], "2026-09-01", "2026-09-30");
  assert.equal(e.total, 0); assert.equal(e.peak, null); assert.ok(e.hourFrom < e.hourTo);
  console.log(`18 ok: лиды по часам — пик пн 11:00 (${g.peak.leads}), окно ${w.from}–${w.to} ч = ${Math.round(w.share * 100)}%`);
}

/* 19. Найм: воронка вложенная, текучесть сходится (было + принято − ушло = стало), доля оставшихся */
{
  const assert = require("assert");
  const { buildIndex } = R("calc");
  const { emptyState } = R("defaults");
  const { hiringFunnel, hiresIn, turnoverByMonth, staffStat, stints, leaversIn, daysBetween } = R("hiring");
  const today = "2026-09-23";
  const st = emptyState();
  st.settings = { ...st.settings, probationLeads: 2, probationHours: 8 };
  const op = (id, hireDate, fireDate = "", extra = {}) => ({ id, name: id, groupId: null, role: "operator", status: fireDate ? "fired" : "active", hireDate, fireDate, monthlyPlan: null, normHours: null, payType: "tiered", salary: 0, hourlyRate: 0, leadBonus: null, rateGridId: null, grade: "mid", track: "re", contact: "", comment: "", createdAt: "", updatedAt: "", deletedAt: null, ...extra });
  st.operators = [
    op("a", "2026-06-01"), // старичок
    op("b", "2026-08-10", "2026-08-25"), // ушёл через 15 дней
    op("c", "2026-09-01"), // принят из кандидатов, закрыл стажировку
    op("d", "2026-09-10"), // принят из кандидатов, стажируется
    op("x", "", "", { deletedAt: "2026-09-02T00:00:00Z", status: "fired" }), // заведён по ошибке — не в счёт
  ];
  const shift = (d, o, hours) => ({ id: `${d}|${o}`, date: d, operatorId: o, groupId: null, hours, type: "work", comment: "", updatedAt: "" });
  st.shifts = [shift("2026-09-02", "c", 8), shift("2026-09-11", "d", 4)];
  const lead = (at, o) => ({ id: at + o, at, client: "", phone: "", projectId: null, operatorId: o, groupId: null, direction: "", comment: "", source: "Скорозвон", status: "work", statusReason: "", createdAt: "", updatedAt: "" });
  st.leads = [lead("2026-09-02T10:00", "c"), lead("2026-09-02T12:00", "c"), lead("2026-09-11T10:00", "d")];
  const cand = (id, stage, extra = {}) => ({ id, name: id, contact: "", source: "hh", groupId: null, stage, appliedAt: "2026-08-20", interviewAt: "", trainingAt: "", closedAt: "", operatorId: null, reason: "", comment: "", createdAt: "", updatedAt: "", deletedAt: null, ...extra });
  st.candidates = [
    cand("k1", "hired", { operatorId: "c", closedAt: "2026-09-01", interviewAt: "2026-08-22" }),
    cand("k2", "hired", { operatorId: "d", closedAt: "2026-09-10", source: "Авито" }), // без дат этапов — всё равно их прошёл
    cand("k3", "rejected", { trainingAt: "2026-08-25", reason: "не прошёл обучение" }),
    cand("k4", "declined", { reason: "зарплата" }),
    cand("k5", "interview"),
    cand("k6", "new", { deletedAt: "2026-09-01T00:00:00Z" }), // удалён — не в счёт
  ];
  const ix = buildIndex(st);
  const f = hiringFunnel(st, ix, "2026-08-01", "2026-09-30", today);
  const n = Object.fromEntries(f.steps.map((s) => [s.key, s.count]));
  assert.deepEqual(n, { applied: 5, interview: 4, training: 3, hired: 2, probation: 1 }, JSON.stringify(n));
  for (let i = 1; i < f.steps.length; i++) assert.ok(f.steps[i].count <= f.steps[i - 1].count, "этапы вложены");
  assert.equal(f.open, 1); assert.equal(f.rejected, 1); assert.equal(f.declined, 1);
  assert.equal(f.working, 2); assert.equal(f.onProbation, 1); assert.equal(f.fired, 0);
  assert.equal(f.avgDaysToHire, (daysBetween("2026-08-20", "2026-09-01") + daysBetween("2026-08-20", "2026-09-10")) / 2);
  assert.equal(f.sources.find((s) => s.source === "hh").hired, 1);
  assert.equal(f.reasons.length, 2);

  assert.equal(stints(st, ix).length, 4, "карточка без дат и работы, удалённая, — не в счёт");
  const hires = hiresIn(st, ix, "2026-08-01", "2026-09-30", today);
  assert.deepEqual(hires.map((h) => h.stint.op.id).sort(), ["b", "c", "d"]);
  assert.equal(hires.find((h) => h.stint.op.id === "b").early, true, "ушёл в первые 30 дней");
  assert.equal(hires.find((h) => h.stint.op.id === "c").daysToPass, 1);
  assert.equal(hires.find((h) => h.stint.op.id === "c").candidate.id, "k1");

  const rows = turnoverByMonth(st, ix, ["2026-07", "2026-08", "2026-09", "2026-10"], today);
  assert.equal(rows.length, 3, "будущий месяц не считается");
  for (const r of rows) assert.equal(r.end, r.start + r.hired - r.fired, `баланс ${r.month}`);
  const aug = rows.find((r) => r.month === "2026-08");
  assert.deepEqual([aug.start, aug.hired, aug.fired, aug.end, aug.early], [1, 1, 1, 1, 1]);
  assert.equal(aug.rate, 1, "ушёл 1 при средней численности 1");
  const sep = rows.find((r) => r.month === "2026-09");
  assert.deepEqual([sep.start, sep.hired, sep.fired, sep.end], [1, 2, 0, 3]);
  assert.ok(sep.current);

  const ss = staffStat(st, ix, today);
  assert.equal(ss.staff.length, 3);
  assert.equal(ss.buckets.reduce((a, b) => a + b.count, 0), 3);
  // приняты не позже 24.08: a и b; b ушёл через 15 дней
  assert.deepEqual([ss.retention30.kept, ss.retention30.base], [1, 2]);
  const lv = leaversIn(st, ix, "2026-08-01", "2026-09-30", today);
  assert.equal(lv.length, 1); assert.equal(lv[0].days, 15);
  console.log(`19 ok: найм — воронка ${f.steps.map((s) => s.count).join("→")}, август: ${aug.start}+${aug.hired}−${aug.fired}=${aug.end}, удержание 30 дн. ${ss.retention30.kept}/${ss.retention30.base}`);
}

/* 20. Расчётный лист = ведомость: строки сходятся к остатку, по сменам — та же ступень */
{
  const assert = require("assert");
  const { buildIndex, monthCal } = R("calc");
  const { payroll } = R("payroll");
  const { buildDemo } = R("demo");
  const { buildPayslip } = R("payslip");
  const today = "2026-09-18";
  const st = buildDemo(today);
  st.settings = { ...st.settings, withholdPct: 13 };
  const op0 = st.operators.find((o) => !o.deletedAt);
  st.adjustments = [
    { id: "t1", month: "2026-09", operatorId: op0.id, type: "bonus", amount: 1000, date: "2026-09-05", comment: "лучший день", createdAt: "", updatedAt: "" },
    { id: "t2", month: "2026-09", operatorId: op0.id, type: "compensation", amount: 500, date: "2026-09-06", comment: "такси", createdAt: "", updatedAt: "" },
    { id: "t3", month: "2026-09", operatorId: op0.id, type: "deduction", amount: 300, date: "2026-09-07", comment: "", createdAt: "", updatedAt: "" },
    { id: "t4", month: "2026-09", operatorId: op0.id, type: "advance", amount: 5000, date: "2026-09-15", comment: "аванс", createdAt: "", updatedAt: "" },
  ];
  const ix = buildIndex(st);
  const cal = monthCal("2026-09", st.settings, today);
  const p = payroll(st, ix, cal);
  let checked = 0;
  for (const r of p.rows) {
    const s = buildPayslip(st, ix, cal, r);
    const plus = s.lines.filter((l) => l.kind === "plus").reduce((a, l) => a + l.value, 0);
    const minus = s.lines.filter((l) => l.kind === "minus").reduce((a, l) => a + l.value, 0);
    const gross = s.lines.find((l) => l.label === "Начислено").value;
    assert.ok(Math.abs(plus - gross) < 0.05, `${r.op.name}: плюсы = начислено (${plus} / ${gross})`);
    assert.ok(Math.abs(gross - minus - r.toPay) < 0.05, `${r.op.name}: начислено − минусы = остаток`);
    assert.equal(s.lines[s.lines.length - 1].value, r.toPay);
    const sums = s.days.filter((d) => d.sum != null);
    if (r.payType === "tiered" || r.payType === "hourly" || r.payType === "hourly_bonus") {
      const total = sums.reduce((a, d) => a + d.sum, 0);
      assert.ok(Math.abs(total - (r.base + r.leadPay)) < 0.05, `${r.op.name}: сумма по сменам = база + бонус (${total} / ${r.base + r.leadPay})`);
      checked++;
    }
    assert.ok(s.days.every((d) => d.day <= today), "будущие смены в лист не попадают");
    assert.equal(s.preliminary, true);
  }
  const s0 = buildPayslip(st, ix, cal, p.rows.find((r) => r.op.id === op0.id));
  assert.ok(s0.lines.some((l) => l.label === "Премия" && l.note.includes("лучший день")), "начисление со своей датой и причиной");
  assert.ok(s0.lines.some((l) => l.label === "Аванс" && l.kind === "minus"));
  const calA = monthCal("2026-08", st.settings, today);
  const aug = buildPayslip(st, ix, calA, payroll(st, ix, calA).rows[0]);
  assert.equal(aug.preliminary, false, "прошлый месяц — итог");
  console.log(`20 ok: расчётный лист сходится с ведомостью у ${p.rows.length} сотрудников, по сменам проверено ${checked}`);
}

/* 21. Время платформы: моменты переводятся в Москву, «сегодня» — по Москве, а не по часам компьютера */
{
  const assert = require("assert");
  const { appStamp, fmtStamp, APP_TZ } = R("dates");
  assert.equal(APP_TZ, "Europe/Moscow");
  assert.equal(appStamp("2026-09-24T09:05:00.000Z"), "2026-09-24T12:05", "UTC 09:05 = 12:05 МСК");
  assert.equal(appStamp("2026-09-24T22:30:00Z"), "2026-09-25T01:30", "после 21:00 UTC в Москве уже следующий день");
  assert.equal(appStamp("2026-09-24T16:00:00+04:00"), "2026-09-24T15:00", "16:00 в Самаре = 15:00 МСК");
  assert.equal(fmtStamp("2026-09-24T12:05"), "24.09.2026 12:05", "время лида не пересчитывается");
  assert.equal(fmtStamp("2026-09-24T09:05:00.000Z"), "24.09.2026 12:05", "ISO-момент — в МСК");
  assert.equal(appStamp("не дата"), "");
  console.log(`21 ok: время платформы — ${APP_TZ}, 09:05 UTC → ${appStamp("2026-09-24T09:05:00Z").slice(11)}`);
}

/* 22. Ссылка на лид: без схемы — https, мусор — пусто; поправка часов по серверу */
{
  const assert = require("assert");
  const { normLink } = R("format");
  const { setClockSkew, nowMs, appStamp } = R("dates");
  assert.equal(normLink("crm.site.ru/lead/15"), "https://crm.site.ru/lead/15");
  assert.equal(normLink("  https://amo.ru/leads/detail/77  "), "https://amo.ru/leads/detail/77");
  assert.equal(normLink("http://x.ru"), "http://x.ru/");
  assert.equal(normLink("просто текст"), "");
  assert.equal(normLink("localhost:3000"), "");
  assert.equal(normLink("javascript:alert(1)"), "");
  assert.equal(normLink(""), "");
  const before = Date.now();
  setClockSkew(-20 * 60_000); // часы компьютера спешат на 20 минут
  assert.ok(Math.abs(nowMs() - (before - 20 * 60_000)) < 1000, "«сейчас» — по серверу");
  const shown = appStamp();
  setClockSkew(0);
  assert.ok(shown <= appStamp(), "время лида не убегает вперёд вместе с часами компьютера");
  console.log("22 ok: ссылка на лид и поправка часов");
}

/* 23. Отчёт за день: у кого в графике выходной/отпуск — нет плана на день и нет строки «0%» */
{
  const assert = require("assert");
  const { buildIndex } = R("calc");
  const { buildDemo } = R("demo");
  const { buildReport } = R("report");
  const today = "2026-09-18";
  const day = "2026-09-17";
  const st = buildDemo(today);
  const before = buildReport(st, buildIndex(st), "day", day, "", today);
  const victim = before.rows.find((r) => r.plan > 0 && r.hours > 0);
  assert.ok(victim, "есть работавший с планом");
  // ставим ему выходной и убираем его лиды за этот день
  const id = `${day}|${victim.op.id}`;
  st.shifts = st.shifts.filter((s) => s.id !== id).concat([{ id, date: day, operatorId: victim.op.id, groupId: victim.op.groupId, hours: 0, type: "off", comment: "", updatedAt: "" }]);
  st.leads = st.leads.filter((l) => !(l.operatorId === victim.op.id && l.at.startsWith(day)));
  const after = buildReport(st, buildIndex(st), "day", day, "", today);
  assert.ok(!after.rows.some((r) => r.op.id === victim.op.id), "отдыхающего нет в отчёте");
  assert.ok(Math.abs(after.total.plan - (before.total.plan - victim.plan)) < 1e-9, "план дня уменьшился ровно на его план");
  assert.ok(!after.attention.noShift.includes(victim.op.name), "выходной — не «нет смены»");
  console.log(`23 ok: выходной не тянет отчёт вниз — план дня ${before.total.plan.toFixed(1)} → ${after.total.plan.toFixed(1)}`);
}

/* 24. Уволенный в день отчёта без смены — не в таблице с «0%», а в событиях */
{
  const assert = require("assert");
  const { buildIndex } = R("calc");
  const { buildDemo } = R("demo");
  const { buildReport } = R("report");
  const today = "2026-09-18";
  const day = "2026-09-17";
  const st = buildDemo(today);
  const base = buildReport(st, buildIndex(st), "day", day, "", today);
  const victim = base.rows.find((r) => r.plan > 0 && r.hours > 0);
  const op = st.operators.find((o) => o.id === victim.op.id);
  op.status = "fired";
  op.fireDate = day;
  st.shifts = st.shifts.filter((s) => !(s.operatorId === op.id && s.date === day));
  st.leads = st.leads.filter((l) => !(l.operatorId === op.id && l.at.startsWith(day)));
  const r = buildReport(st, buildIndex(st), "day", day, "", today);
  assert.ok(!r.rows.some((x) => x.op.id === op.id), "уволенного без смены нет в таблице");
  const ev = r.events.find((e) => e.kind === "fired" && e.name === op.name);
  assert.ok(ev && ev.day === day && ev.note.startsWith("уволен"), "увольнение — в событиях");
  // уволенный, который успел отработать, — в конце таблицы
  const r2 = buildReport(buildDemo(today), buildIndex(buildDemo(today)), "day", day, "", today);
  const firedWorked = r2.rows.map((x) => x.op.status === "fired" || !!x.op.deletedAt);
  assert.ok(firedWorked.indexOf(true) === -1 || firedWorked.slice(firedWorked.indexOf(true)).every(Boolean), "уволенные — в конце");
  console.log(`24 ok: увольнение в событиях — ${ev.note}`);
}

/* 25. Регионы: доход с лида и апрув по сегментам; без региональных лидов — всё как раньше */
{
  const assert = require("assert");
  const { buildIndex, approvePctFor, incomePerLead, leadIncome } = R("calc");
  const { buildDemo } = R("demo");
  const { normalizeSettings } = R("defaults");
  const today = "2026-09-18";
  const month = "2026-09";
  const st = buildDemo(today);
  st.settings = normalizeSettings({ ...st.settings, leadRevenue: 3000 });
  // до регионов: доход с лида = цена × апрув (как было)
  const before = incomePerLead(st, month);
  assert.ok(Math.abs(before - leadIncome(3000, approvePctFor(st, buildIndex(st), month))) < 0.01, "без регионов — прежняя формула");
  // старые лиды без региона и лиды «основы» считаются одинаково
  const inMonth = st.leads.filter((l) => l.status !== "failed" && l.at.startsWith(month));
  inMonth.forEach((l, i) => (l.region = i % 2 ? "Москва" : ""));
  assert.ok(Math.abs(incomePerLead(st, month) - before) < 0.01, "основа = лиды без региона");
  // половина лидов — регионы: 4000 × 10% = 400 ₽ с лида
  inMonth.forEach((l, i) => (l.region = i % 2 ? "Челябинск" : "Москва"));
  const nReg = inMonth.filter((l) => l.region === "Челябинск").length;
  const mixed = incomePerLead(st, month);
  const expect = (before * (inMonth.length - nReg) + 400 * nReg) / inMonth.length;
  assert.ok(Math.abs(mixed - expect) < 0.01, `смешанный доход ${mixed} ≈ ${expect}`);
  const ap = approvePctFor(st, buildIndex(st), month);
  assert.ok(ap < approvePctFor(buildDemo(today), buildIndex(buildDemo(today)), month), "апрув регионов 10% тянет общий вниз");
  // города не могут быть сразу в основе и регионах
  const s2 = normalizeSettings({ regions: { main: ["Москва", "Челябинск"], regional: ["Челябинск", "Волгоград"] } });
  assert.deepStrictEqual(s2.regions.regional, ["Волгоград"]);
  console.log(`25 ok: регионы — доход с лида ${Math.round(before)} → ${Math.round(mixed)} ₽ (регион 400 ₽), апрув ${ap}%`);
}
