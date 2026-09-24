import type { Account, Adjustment, DataState, DayKey, Group, Lead, Operator, Project, Shift } from "./types";
import { LEAD_SOURCE } from "./types";
import { DEFAULT_SETTINGS, newAccount } from "./defaults";
import { addDays, addMonths, isWorkday, monthDays, monthOf, monthStart } from "./dates";

/**
 * Тестовый набор для scripts/test-calc.cjs — в приложении не подключается.
 * Три группы, ~14 операторов, два проекта, лиды и смены за прошлый
 * и текущий месяц. Генератор детерминированный (seed), поэтому демо всегда
 * одинаковое и по нему удобно проверять расчёты.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Анна", "Мария", "Екатерина", "Ольга", "Дарья", "Алина", "Ирина", "Полина", "Сергей", "Дмитрий", "Алексей", "Максим", "Иван", "Никита", "Артём", "Юлия", "Виктория", "Кирилл"];
const LAST_F = ["Иванова", "Смирнова", "Кузнецова", "Попова", "Соколова", "Лебедева", "Козлова", "Новикова", "Морозова", "Волкова", "Павлова", "Семёнова"];
const LAST_M = ["Иванов", "Смирнов", "Кузнецов", "Попов", "Соколов", "Лебедев", "Козлов", "Новиков", "Морозов", "Волков", "Павлов", "Семёнов"];
const MID_F = ["Андреевна", "Сергеевна", "Игоревна", "Павловна", "Олеговна", "Дмитриевна"];
const MID_M = ["Андреевич", "Сергеевич", "Игоревич", "Павлович", "Олегович", "Дмитриевич"];
const CITIES = ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург", "Новосибирск", "Краснодар", "Самара", "Воронеж", "Тула", "Тверь", "Ярославль"];
const DEALERS = ["ДЦ Север", "ДЦ Юг", "ДЦ Запад", "ДЦ Восток", "ДЦ Центр"];
const COMMENTS = ["", "", "", "Перезвонить после 18:00", "Интересует trade-in", "Нужна ипотека", "Сравнивает с конкурентом", "Готов на встречу в выходные", "Просил прислать КП"];

const pad = (n: number) => String(n).padStart(2, "0");

function isFemale(first: string) {
  return /[ая]$/.test(first) && first !== "Никита";
}

export function buildDemo(today: DayKey): DataState {
  const r = rng(77);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const stamp = `${today}T09:00:00.000Z`;
  const cur = monthOf(today);
  const prev = addMonths(cur, -1);

  // план 110 лидов ≈ конверсия 0,65 лида/час на полном графике (норма — не ниже 60%, в идеале лид в час)
  const settings = { ...DEFAULT_SETTINGS, teamPlan: 0, defaultOperatorPlan: 110, withholdPct: 0 };

  const projects: Project[] = [
    // два реальных направления отдела: «Авто.ру без подбора» и реактивация базы по новостройкам
    { id: "pr_auto", name: "Авто", active: true, color: "blue", sort: 0, createdAt: stamp, updatedAt: stamp },
    { id: "pr_estate", name: "Недвижимость", active: true, color: "green", sort: 1, createdAt: stamp, updatedAt: stamp },
  ];

  const groups: Group[] = [
    { id: "gr_alpha", name: "Альфа", supervisorId: null, supervisorName: "", monthlyPlan: 0, active: true, color: "purple", createdAt: stamp, updatedAt: stamp },
    { id: "gr_beta", name: "Бета", supervisorId: null, supervisorName: "", monthlyPlan: 0, active: true, color: "teal", createdAt: stamp, updatedAt: stamp },
    { id: "gr_gamma", name: "Гамма", supervisorId: null, supervisorName: "Орлова Наталья", monthlyPlan: 400, active: true, color: "pink", createdAt: stamp, updatedAt: stamp },
  ];

  // [группа, производительность лидов/час, часы в день, план, особенности]
  // выработка как в отделе: 0,6–1,1 лида в час, то есть 5–9 лидов за 8-часовую смену —
  // смены попадают на разные ступени сетки (200–260 ₽/ч, 70–90 ₽ за лид), выходит 40–55 тыс. в месяц
  const spec: [string, number, number, number | null, string?][] = [
    ["gr_alpha", 1.0, 8, 160, "supervisor"],
    ["gr_alpha", 0.85, 8, null],
    ["gr_alpha", 0.75, 8, null],
    ["gr_alpha", 0.62, 8, null],
    ["gr_alpha", 0.8, 6, 100],
    ["gr_beta", 0.95, 8, null, "supervisor"],
    ["gr_beta", 0.7, 8, null],
    ["gr_beta", 0.55, 8, null, "idle"],
    ["gr_beta", 0.8, 8, null],
    ["gr_beta", 0.68, 8, null, "pause"],
    ["gr_gamma", 0.88, 8, null],
    ["gr_gamma", 0.66, 8, null, "trainee"],
    ["gr_gamma", 1.05, 8, 170],
    ["gr_gamma", 0.6, 8, null, "fired"],
  ];

  const operators: Operator[] = [];
  const usedNames = new Set<string>();
  spec.forEach(([groupId, , hrs, plan, flag], i) => {
    let name = "";
    for (let tries = 0; tries < 20 && (!name || usedNames.has(name)); tries++) {
      const first = pick(FIRST);
      const f = isFemale(first);
      name = `${pick(f ? LAST_F : LAST_M)} ${first} ${pick(f ? MID_F : MID_M)}`;
    }
    usedNames.add(name);
    const hired = flag === "trainee" ? addDays(monthStart(cur), 4) : addDays(monthStart(prev), -40 - i * 11);
    // операторы все на сетке: ставка часа и бонус за лид — по числу лидов в смене.
    // супервайзеры — оклад плюс бонус за объём лидов группы за месяц.
    const payType = flag === "supervisor" ? "sv_volume" : "tiered";
    operators.push({
      id: `op_demo${pad(i + 1)}`,
      name,
      groupId,
      role: flag === "supervisor" ? "senior" : flag === "trainee" ? "trainee" : "operator",
      status: flag === "pause" ? "pause" : flag === "fired" ? "fired" : "active",
      hireDate: hired,
      fireDate: flag === "fired" ? addDays(monthStart(cur), -6) : "",
      monthlyPlan: plan,
      normHours: hrs === 6 ? 120 : null,
      payType,
      // 0 — берём из сетки: оклад супервайзера и ступени оператора живут в настройках
      salary: 0,
      hourlyRate: 0,
      leadBonus: null,
      rateGridId: null,
      grade: i === 5 ? "jr" : "mid",
      track: groupId === "gr_beta" ? "auto" : "re",
      contact: `+7 9${pad(10 + i)} ${100 + i * 7}-${pad(10 + i)}-${pad(30 + i)}`,
      comment: flag === "pause" ? "Пауза по семейным обстоятельствам" : "",
      createdAt: stamp,
      updatedAt: stamp,
    });
  });
  groups[0].supervisorId = operators[0].id;
  groups[1].supervisorId = operators[5].id;

  const leads: Lead[] = [];
  const shifts: Shift[] = [];
  let seq = 0;

  const days = [...monthDays(prev), ...monthDays(cur).filter((d) => d <= today)];
  const nowH = new Date().getHours();

  for (const d of days) {
    const work = isWorkday(d, settings);
    operators.forEach((op, i) => {
      const [, rate, hrs, , flag] = spec[i];
      if (op.hireDate && d < op.hireDate) return;
      if (op.fireDate && d > op.fireDate) return;
      if (flag === "pause" && d >= addDays(monthStart(cur), 7)) return;
      if (!work) return;
      // отпуск/больничный изредка
      const roll = r();
      let type: Shift["type"] = "work";
      if (roll < 0.03) type = "sick";
      else if (roll < 0.05) type = "vacation";
      else if (flag === "trainee" && d < addDays(op.hireDate, 3)) type = "training";
      const isToday = d === today;
      let hours = type === "work" || type === "training" ? hrs : 0;
      if (isToday) hours = Math.max(0, Math.min(hrs, nowH - 9));
      if (type === "work" && r() < 0.08) hours = Math.max(0, hours - 2); // ушёл раньше
      shifts.push({
        id: `${d}|${op.id}`,
        date: d,
        operatorId: op.id,
        groupId: op.groupId,
        hours,
        type,
        comment: type === "sick" ? "Больничный лист" : "",
        updatedAt: stamp,
      });
      if (type !== "work" || hours <= 0) return;
      // «практически не работает» — последние дни без лидов
      if (flag === "idle" && d >= addDays(today, -5)) return;
      // темп: немного случайности + лёгкий рост к концу месяца
      const lambda = rate * hours * (0.75 + r() * 0.5);
      let n = Math.floor(lambda);
      if (r() < lambda - n) n++;
      for (let k = 0; k < n; k++) {
        const h = 9 + Math.floor(r() * Math.max(1, hours));
        const m = Math.floor(r() * 60);
        if (isToday && h >= nowH) continue;
        // авто даёт больше половины объёма — как в реальном распределении смен
        const project = r() < 0.62 ? projects[0] : projects[1];
        const first = pick(FIRST);
        const f = isFemale(first);
        const direction = project.id === "pr_auto" ? `${pick(CITIES)} · ${pick(DEALERS)}` : pick(CITIES);
        seq++;
        leads.push({
          id: `ld_demo${String(seq).padStart(5, "0")}`,
          at: `${d}T${pad(h)}:${pad(m)}`,
          client: `${first} ${pick(f ? LAST_F : LAST_M)}`,
          phone: `79${String(Math.floor(r() * 1e9)).padStart(9, "0")}`,
          projectId: project.id,
          operatorId: op.id,
          groupId: op.groupId,
          direction,
          link: "",
          comment: pick(COMMENTS),
          source: LEAD_SOURCE,
          // проверенные супервайзером — старше двух дней; малая доля не доведена
          ...(d < addDays(today, -2)
            ? r() < 0.06
              ? { status: "failed" as const, statusReason: "Клиент отказался на встрече", statusAt: stamp, statusBy: "Руководитель отдела" }
              : { status: "done" as const, statusReason: "", statusAt: stamp, statusBy: "Руководитель отдела" }
            : { status: "work" as const, statusReason: "" }),
          createdAt: stamp,
          updatedAt: stamp,
        });
      }
    });
  }

  const adjustments: Adjustment[] = [
    { id: "adj_demo1", month: prev, operatorId: operators[0].id, type: "bonus", amount: 5000, date: `${prev}-28`, comment: "Лучший результат месяца", createdAt: stamp, updatedAt: stamp },
    { id: "adj_demo2", month: prev, operatorId: operators[2].id, type: "advance", amount: 15000, date: `${prev}-15`, comment: "Аванс", createdAt: stamp, updatedAt: stamp },
    { id: "adj_demo3", month: cur, operatorId: operators[1].id, type: "advance", amount: 15000, date: `${cur}-15`, comment: "Аванс", createdAt: stamp, updatedAt: stamp },
    { id: "adj_demo4", month: cur, operatorId: operators[4].id, type: "compensation", amount: 1200, date: `${cur}-05`, comment: "Гарнитура", createdAt: stamp, updatedAt: stamp },
  ];

  // аккаунты: РОП, три супервайзера (двое — из числа операторов, одна — «внешняя»), операторы
  const translit = (n: string) => n.split(" ")[0].toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? "");
  const accounts: Account[] = [
    newAccount("acc_head", "head", "Руководитель отдела", { login: "rop@leadup.ru" }),
    newAccount("acc_sup_alpha", "supervisor", operators[0].name, { operatorId: operators[0].id, login: `${translit(operators[0].name)}@leadup.ru` }),
    newAccount("acc_sup_beta", "supervisor", operators[5].name, { operatorId: operators[5].id, login: `${translit(operators[5].name)}@leadup.ru` }),
    newAccount("acc_sup_gamma", "supervisor", "Орлова Наталья", { groupIds: ["gr_gamma"], login: "orlova@leadup.ru" }),
    ...operators
      .filter((o) => o.status !== "fired" && o.id !== operators[0].id && o.id !== operators[5].id)
      .map((o, i) => newAccount(`acc_op${String(i + 1).padStart(2, "0")}`, "operator", o.name, { operatorId: o.id, login: `${translit(o.name)}${i + 1}@leadup.ru` })),
  ];

  return {
    settings,
    operators,
    groups,
    projects,
    leads: leads.sort((a, b) => a.at.localeCompare(b.at)),
    shifts,
    plans: [],
    adjustments,
    accounts,
    learn: [],
    approves: [],
    candidates: [],
    audit: [],
    frozenMonths: [],
  };
}

const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
