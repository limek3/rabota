/**
 * Модель данных CRM лидогенерации.
 *
 * Исходные данные (операторы, группы, проекты, лиды, смены, планы, корректировки
 * зарплаты, настройки) хранятся отдельно от аналитики: все показатели считаются
 * на лету в lib/crm/calc.ts и lib/crm/payroll.ts и нигде не сохраняются.
 * Перестройка любого экрана не трогает исходные записи.
 *
 * Связи — только по стабильным ID. Имена групп/операторов/проектов в записях
 * лидов не дублируются: переименование видно сразу во всей истории.
 *
 * Даты — локальные строки без часового пояса:
 *   день     "YYYY-MM-DD"
 *   месяц    "YYYY-MM"
 *   момент   "YYYY-MM-DDTHH:mm"
 * Так лид, переданный в 23:50, никогда не «уедет» в соседний день из-за UTC.
 */

export type ID = string;
export type DayKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export type OperatorStatus = "active" | "pause" | "fired";
export type OperatorRole = "operator" | "senior" | "supervisor" | "trainee";
export type PayType = "salary" | "hourly" | "salary_bonus" | "hourly_bonus" | "tiered" | "salary_tiered" | "sv_volume";

/** Грейд супервайзера: от него зависит колонка в сетке бонуса. */
export type Grade = "jr" | "mid" | "sr";
/** Направление проекта для сетки бонуса супервайзера. */
export type Track = "re" | "auto";

/**
 * Ступень тарифной сетки: «от N переданных лидов за смену — такая ставка за час
 * и такой бонус за лид». Считается по каждой смене отдельно: сделал в этот день
 * больше — весь день оплачен по более высокой ступени.
 */
export interface RateTier {
  /** Лидов за смену, от (включительно). Первая ступень всегда от 0. */
  from: number;
  hourlyRate: number;
  leadBonus: number;
}

export interface RateGrid {
  id: ID;
  name: string;
  tiers: RateTier[];
}

/** Ступень бонуса супервайзера: «от N лидов группы за месяц — столько по грейдам». */
export interface SvBonusRow {
  from: number;
  /** Недвижимость: [Junior, Middle, Senior]. */
  re: [number, number, number];
  /** Авто: [Junior, Middle, Senior]. */
  auto: [number, number, number];
}

/** Коэффициент за апрув заказчика: «апрув от X% — множитель K». */
export interface ApproveStep {
  from: number;
  k: number;
}

export interface SvBonusGrid {
  /** Оклад супервайзера. */
  salary: number;
  /** Ниже этого объёма бонуса нет вообще. */
  minLeads: number;
  rows: SvBonusRow[];
  approve: ApproveStep[];
  /** Множитель, если нет роста к прошлым месяцам (кроме Junior). */
  noGrowthK: number;
  /** Апрув по умолчанию, если за месяц не проставлен. */
  defaultApprovePct: number;
}
export type DayType = "work" | "off" | "training" | "vacation" | "sick";
export type AdjustmentType =
  | "accrual" // дополнительное начисление
  | "bonus" // премия
  | "compensation" // компенсация (не облагается удержанием)
  | "correction" // ручная корректировка ±
  | "deduction" // удержание (штраф и т.п.)
  | "advance" // аванс (уже выплачено)
  | "payout"; // выплата (уже выплачено)

export interface Operator {
  id: ID;
  name: string;
  groupId: ID | null;
  role: OperatorRole;
  status: OperatorStatus;
  hireDate: DayKey | "";
  fireDate: DayKey | "";
  /** Личный месячный план по переданным лидам; null — по умолчанию из настроек. */
  monthlyPlan: number | null;
  /** Месячная норма часов; null — по умолчанию из настроек. */
  normHours: number | null;
  payType: PayType;
  salary: number;
  hourlyRate: number;
  /** Бонус за один переданный лид; null — по умолчанию из настроек. */
  leadBonus: number | null;
  /** Тарифная сетка для схем «по сетке»; null — сетка по умолчанию из настроек. */
  rateGridId: ID | null;
  /** Грейд супервайзера (схема «оклад + бонус за объём группы»). */
  grade: Grade;
  /** Направление для сетки бонуса супервайзера. */
  track: Track;
  contact: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  /** Мягкое удаление: оператор скрыт из списков, история (лиды, смены, начисления) цела. */
  deletedAt?: string | null;
}

export interface Group {
  id: ID;
  name: string;
  /** Руководитель из числа сотрудников (по ID)… */
  supervisorId: ID | null;
  /** …или просто ФИО, если руководитель не заведён как сотрудник. */
  supervisorName: string;
  /** Месячный план группы; 0 — сумма планов участников. */
  monthlyPlan: number;
  active: boolean;
  color: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Project {
  id: ID;
  name: string;
  active: boolean;
  color: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * Переданный менеджеру лид. Сама запись = успешная передача, статуса нет.
 * Источник всегда «Скорозвон».
 */
export interface Lead {
  id: ID;
  /** Дата и время передачи, локальное "YYYY-MM-DDTHH:mm". */
  at: string;
  client: string;
  phone: string;
  projectId: ID | null;
  operatorId: ID;
  /** Группа оператора на момент передачи (снимок, не меняется при переводах). */
  groupId: ID | null;
  /** Город / дилерский центр / направление — если используется. */
  direction: string;
  /** Ссылка на лид (карточка в CRM заказчика, запись звонка) — обязательна для новых лидов. */
  link: string;
  /**
   * Регион лида — из списков «Основа» и «Регионы» в настройках. От него зависят цена лида
   * и апрув в расчёте дохода. Пусто — лиды до появления регионов: считаются основой.
   */
  region?: string;
  comment: string;
  source: "Скорозвон";
  /** Оператор записал — «в работе»; супервайзер ставит «доведён» или «не доведён» (с причиной). */
  status: LeadStatus;
  /** Причина, если «не доведён». */
  statusReason: string;
  /** Кто и когда последним менял статус (у только что записанного лида — пусто). */
  statusAt?: string;
  statusBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeadStatus = "work" | "done" | "failed";
export const LEAD_STATUSES: LeadStatus[] = ["work", "done", "failed"];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { work: "В работе", done: "Доведён", failed: "Не доведён" };
export const LEAD_STATUS_HUE: Record<LeadStatus, "amber" | "green" | "red"> = { work: "amber", done: "green", failed: "red" };

/** Смена: одна запись на оператора в день (id = `${date}|${operatorId}`). */
export interface Shift {
  id: ID;
  date: DayKey;
  operatorId: ID;
  /** Группа оператора на день смены (снимок). */
  groupId: ID | null;
  hours: number;
  type: DayType;
  comment: string;
  updatedAt: string;
}

export type PlanScope = "team" | "group" | "operator";

/**
 * План/условия конкретного месяца. Если записи нет — берутся текущие значения
 * из карточки оператора/группы и настроек. Прошедшие месяцы фиксируются
 * автоматически (freezePastMonths), поэтому смена плана или ставки сегодня
 * не переписывает историю.
 */
export interface MonthPlan {
  id: ID; // `${month}|team` | `${month}|group|${id}` | `${month}|operator|${id}`
  month: MonthKey;
  scope: PlanScope;
  targetId: ID | null;
  plan: number;
  // только для scope = operator — условия оплаты и норма на этот месяц
  normHours?: number;
  payType?: PayType;
  salary?: number;
  hourlyRate?: number;
  leadBonus?: number;
  /** Снимок тарифной сетки на этот месяц. */
  tiers?: RateTier[];
  grade?: Grade;
  track?: Track;
  /** Апрув заказчика за месяц, % (схема супервайзера). */
  approvePct?: number;
  /** Рост объёма к прошлым месяцам; не задано — считается автоматически. */
  growth?: boolean | null;
  /** true — запись создана автоматической фиксацией месяца. */
  auto?: boolean;
  updatedAt: string;
}

export interface Adjustment {
  id: ID;
  month: MonthKey;
  operatorId: ID;
  type: AdjustmentType;
  /** Сумма. Для correction может быть отрицательной, остальные — положительные. */
  amount: number;
  date: DayKey;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  companyName: string;
  /** Отчётный месяц; "" — всегда текущий календарный. */
  reportMonth: MonthKey | "";
  /** Общий месячный план переданных лидов; 0 — сумма планов групп/операторов. */
  teamPlan: number;
  defaultOperatorPlan: number;
  defaultNormHours: number;
  dayHours: number;
  /** Рабочие дни недели: 1 = пн … 7 = вс. */
  workdays: number[];
  /** Нерабочие праздничные дни. */
  holidays: DayKey[];
  defaultPayType: PayType;
  defaultSalary: number;
  defaultHourlyRate: number;
  defaultLeadBonus: number;
  /** Тарифные сетки: ставка и бонус по числу лидов за смену. */
  rateGrids: RateGrid[];
  /** Сетка бонуса супервайзера по объёму лидов группы за месяц. */
  svBonus: SvBonusGrid;
  /** Стажировка закрывается: столько лидов за столько часов. */
  probationLeads: number;
  probationHours: number;
  /** Норма конверсии, % (лидов на отработанный час × 100): ниже — оператор в «Утре руководителя». */
  convNormPct: number;
  /** Сетка по умолчанию. */
  defaultGridId: ID | "";
  /** Процент удержания (например, НДФЛ). */
  withholdPct: number;
  /** Сколько заказчик платит за переданный лид, ₽ — база для расчёта ФОТ. */
  leadRevenue: number;
  /** Норматив ФОТ: доля фонда оплаты труда от дохода, % (превышать нельзя). */
  payrollCapPct: number;
  /** Пропорциональный оклад: оклад × часы / норма, если норма не выполнена. */
  prorateSalary: boolean;
  /** Пороги темпа к плану на дату, %. */
  aheadPct: number;
  normalPct: number;
  lagPct: number;
  /** Сколько рабочих дней без лидов = «практически не работает». */
  idleDays: number;
  directionEnabled: boolean;
  directionLabel: string;
  /** Предупреждать о повторном телефоне за N дней. */
  duplicateDays: number;
  /** Тема по умолчанию для новых аккаунтов. */
  theme: "light" | "dark" | "system";
  backupsKeep: number;
  access: AccessSettings;
  /** Выгрузка базы в Google Таблицу через веб-приложение Apps Script. */
  sheets: SheetsSync;
  regions: RegionSettings;
}

/**
 * Регионы: «Основа» — города с обычной ценой лида и апрувом по проектам; «Регионы» —
 * свои цена и апрув (заказчик платит по-другому). Лид без региона считается основой.
 */
export interface RegionSettings {
  main: string[];
  regional: string[];
  /** Апрув заказчика по региональным лидам, %. */
  regionalApprovePct: number;
  /** Цена регионального лида для заказчика, ₽. */
  regionalLeadRevenue: number;
}

export interface SheetsSync {
  /** Ссылка веб-приложения …/exec. */
  url: string;
  /** Секрет — тот же, что в скрипте таблицы. */
  token: string;
  /** Выгружать сама через минуту после изменений. */
  auto: boolean;
}

/* ── аккаунты и роли ─────────────────────────────────────────────── */

export type AccountRole = "head" | "supervisor" | "operator";

export interface AccountPrefs {
  theme: "light" | "dark" | "system";
  /** Стартовая страница после входа. */
  homePage: string;
  /** Проект по умолчанию в форме лида. */
  defaultProjectId: ID | null;
  /** Плотные таблицы. */
  compact: boolean;
}

/**
 * Аккаунт пользователя системы. Пока вход выключен (lib/appMode.ts), аккаунты
 * переключаются из меню без пароля; когда вход вернётся, login станет почтой/телефоном
 * для входа, а права останутся теми же.
 */
export interface Account {
  id: ID;
  name: string;
  login: string;
  role: AccountRole;
  /** Связанная карточка сотрудника: у оператора обязательна, у супервайзера — если он сам тоже звонит. */
  operatorId: ID | null;
  /** Группы супервайзера (плюс те, где он указан руководителем в карточке группы). */
  groupIds: ID[];
  active: boolean;
  prefs: AccountPrefs;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  deletedAt?: string | null;
}

/** Что РОП разрешает супервайзерам. */
export interface SupervisorAccess {
  /** Видеть показатели всех групп (править — всё равно только свои). */
  seeAllGroups: boolean;
  createLeads: boolean;
  editLeads: boolean;
  manageOperators: boolean;
  editShifts: boolean;
  viewPayroll: boolean;
  editPayroll: boolean;
  editPlans: boolean;
  manageProjects: boolean;
}

/** Что РОП разрешает операторам. */
export interface OperatorAccess {
  createOwnLeads: boolean;
  /** Сколько часов после записи оператор может исправить свой лид; 0 — нельзя. */
  editOwnLeadsHours: number;
  deleteOwnLeads: boolean;
  editOwnShifts: boolean;
  viewOwnPay: boolean;
  viewGroupProgress: boolean;
  viewTeamProgress: boolean;
}

export interface AccessSettings {
  supervisor: SupervisorAccess;
  operator: OperatorAccess;
}

/**
 * Прогресс обучения: одна запись на материал и аккаунт.
 * Живёт отдельно от контента академии — обновление материалов не стирает
 * то, что человек уже прошёл.
 */
export interface LearnProgress {
  id: ID; // `${accountId}|${itemId}`
  accountId: ID;
  courseId: string;
  itemId: string;
  done: boolean;
  /** Последняя попытка теста: правильных из скольких. */
  right?: number;
  total?: number;
  /** Процент последней попытки и лучший результат — как в исходной академии. */
  last?: number;
  best?: number;
  tries?: number;
  /** Тест сдан хотя бы раз на 80% и выше. */
  pass?: boolean;
  /** Когда была последняя попытка. */
  at?: string;
  /** Отмеченные пункты чек-листов внутри материала. */
  checks?: string[];
  /** Личная заметка к материалу. */
  note?: string;
  /** Материал в избранном. */
  fav?: boolean;
  /** Сертификат за итоговую аттестацию. */
  cert?: { at: string; pct: number; name: string };
  updatedAt: string;
}

export interface Backup {
  id: ID;
  createdAt: string;
  reason: string;
  counts: Record<string, number>;
  data: Snapshot;
}

/** Полный слепок исходных данных — формат экспорта/импорта и резервных копий. */
export interface Snapshot {
  app: "leadup-crm";
  version: number;
  exportedAt: string;
  settings: Settings;
  operators: Operator[];
  groups: Group[];
  projects: Project[];
  leads: Lead[];
  shifts: Shift[];
  plans: MonthPlan[];
  adjustments: Adjustment[];
  accounts: Account[];
  learn: LearnProgress[];
  approves: Approve[];
  candidates: Candidate[];
  audit: AuditEntry[];
  frozenMonths: MonthKey[];
}

/**
 * Апрув заказчика за месяц: какая доля переданных лидов принята.
 * Хранится по проектам (и общий на месяц, projectId = ""), отсюда берётся
 * коэффициент бонуса супервайзера — без ручного ввода в ведомости.
 */
export interface Approve {
  id: ID; // `${month}|${projectId || "all"}`
  month: MonthKey;
  projectId: ID | "";
  pct: number;
  comment: string;
  updatedAt: string;
}

/**
 * Кандидат на работу оператором — воронка найма до карточки сотрудника.
 *
 * Этапы идут по порядку: отклик → собеседование → обучение → принят. Даты этапов
 * хранятся отдельно от текущего этапа: кандидат, которому отказали после обучения,
 * всё равно считается дошедшим до обучения — иначе воронка врала бы о конверсии.
 * При приёме создаётся карточка оператора (operatorId); стажировка, стаж и
 * увольнение дальше считаются по ней.
 */
export type CandidateStage = "new" | "interview" | "training" | "hired" | "rejected" | "declined";
export const CANDIDATE_STAGES: CandidateStage[] = ["new", "interview", "training", "hired", "rejected", "declined"];

export interface Candidate {
  id: ID;
  name: string;
  contact: string;
  /** Откуда пришёл: hh.ru, Авито, рекомендация… — свободный текст. */
  source: string;
  /** Группа, куда планируется. */
  groupId: ID | null;
  stage: CandidateStage;
  /** Отклик. */
  appliedAt: DayKey;
  interviewAt: DayKey | "";
  trainingAt: DayKey | "";
  /** Принят / отказ / отказался. */
  closedAt: DayKey | "";
  /** Карточка оператора, созданная при приёме. */
  operatorId: ID | null;
  /** Причина отказа (наш отказ или кандидат отказался). */
  reason: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export const CANDIDATE_STAGE_LABEL: Record<CandidateStage, string> = {
  new: "Отклик",
  interview: "Собеседование",
  training: "Обучение",
  hired: "Принят",
  rejected: "Отказ",
  declined: "Отказался",
};
export const CANDIDATE_STAGE_HUE: Record<CandidateStage, string> = {
  new: "gray",
  interview: "blue",
  training: "purple",
  hired: "green",
  rejected: "red",
  declined: "amber",
};

/** Что менялось — для журнала изменений. */
export type AuditEntity = "operator" | "group" | "lead" | "shift" | "plan" | "payroll" | "project" | "account" | "settings" | "approve" | "candidate" | "data";

export interface AuditEntry {
  id: ID;
  at: string;
  accountId: ID;
  accountName: string;
  entity: AuditEntity;
  entityId: ID;
  /** Человеческая строка: «Ставка: 200 → 230 ₽». */
  summary: string;
}

export const AUDIT_LABEL: Record<AuditEntity, string> = {
  operator: "Оператор",
  group: "Группа",
  lead: "Лид",
  shift: "Смена",
  plan: "План",
  payroll: "Ведомость",
  project: "Проект",
  account: "Аккаунт",
  settings: "Настройки",
  approve: "Апрув",
  candidate: "Кандидат",
  data: "Данные",
};

export interface DataState {
  settings: Settings;
  operators: Operator[];
  groups: Group[];
  projects: Project[];
  leads: Lead[];
  shifts: Shift[];
  plans: MonthPlan[];
  adjustments: Adjustment[];
  accounts: Account[];
  learn: LearnProgress[];
  approves: Approve[];
  candidates: Candidate[];
  audit: AuditEntry[];
  frozenMonths: MonthKey[];
}

/* ── подписи ───────────────────────────────────────────────────────── */

export const STATUS_LABEL: Record<OperatorStatus, string> = {
  active: "Активен",
  pause: "Пауза",
  fired: "Уволен",
};

export const ROLE_LABEL: Record<OperatorRole, string> = {
  operator: "Оператор",
  senior: "Старший оператор",
  supervisor: "Супервайзер",
  trainee: "Стажёр",
};

export const PAY_LABEL: Record<PayType, string> = {
  salary: "Оклад",
  hourly: "Почасовая",
  salary_bonus: "Оклад + бонус за лид",
  hourly_bonus: "Почасовая + бонус за лид",
  tiered: "По сетке за смену",
  salary_tiered: "Оклад + бонус по сетке",
  sv_volume: "Оклад + бонус за объём группы",
};

export const GRADE_LABEL: Record<Grade, string> = { jr: "Junior", mid: "Middle", sr: "Senior" };
export const TRACK_LABEL: Record<Track, string> = { re: "Недвижимость", auto: "Авто" };

export const PAY_HINT: Record<PayType, string> = {
  salary: "Фиксированный оклад за месяц",
  hourly: "Часы × ставка",
  salary_bonus: "Оклад + фиксированный бонус за каждый лид",
  hourly_bonus: "Часы × ставка + фиксированный бонус за лид",
  tiered: "Ставка за час и бонус за лид берутся по числу лидов в этой смене",
  salary_tiered: "Оклад + бонус за лид по ступени этой смены",
  sv_volume: "Оклад + бонус по сетке от объёма лидов его групп за месяц",
};

export const DAY_LABEL: Record<DayType, string> = {
  work: "Рабочий день",
  off: "Выходной",
  training: "Обучение",
  vacation: "Отпуск",
  sick: "Больничный",
};

/** Короткая буква для клетки графика. */
export const DAY_SHORT: Record<DayType, string> = {
  work: "",
  off: "В",
  training: "Об",
  vacation: "О",
  sick: "Б",
};

export const ADJ_LABEL: Record<AdjustmentType, string> = {
  accrual: "Доп. начисление",
  bonus: "Премия",
  compensation: "Компенсация",
  correction: "Корректировка",
  deduction: "Удержание",
  advance: "Аванс",
  payout: "Выплата",
};

export const ACCOUNT_ROLE_LABEL: Record<AccountRole, string> = {
  head: "РОП",
  supervisor: "Супервайзер",
  operator: "Оператор",
};

export const ACCOUNT_ROLE_HINT: Record<AccountRole, string> = {
  head: "Руководитель отдела: весь отдел, зарплата, настройки, данные",
  supervisor: "Ведёт свои группы: лиды, смены, планы — в рамках прав от РОПа",
  operator: "Личный кабинет: свои лиды, план, часы и заработок",
};

export const NO_GROUP = "__none__";
export const NO_GROUP_LABEL = "Без группы";
export const LEAD_SOURCE = "Скорозвон" as const;
