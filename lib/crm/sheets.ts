import type { DataState } from "./types";
import {
  ACCOUNT_ROLE_LABEL,
  ADJ_LABEL,
  AUDIT_LABEL,
  CANDIDATE_STAGE_LABEL,
  DAY_LABEL,
  GRADE_LABEL,
  LEAD_STATUS_LABEL,
  NO_GROUP_LABEL,
  PAY_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  TRACK_LABEL,
} from "./types";
import { fmtPhone } from "./format";
import { appStamp } from "./dates";

/**
 * Выгрузка всей базы в Google Таблицу.
 *
 * Приложение собирает листы (заголовок + строки, ID заменены на имена) и шлёт
 * их POST-запросом в веб-приложение Google Apps Script, привязанное к таблице.
 * Скрипт (SHEETS_SCRIPT ниже) перезаписывает листы целиком — таблица всегда
 * повторяет базу. Это копия для просмотра и отчётов: правки в таблице обратно
 * в приложение не попадают.
 */

export type Cell = string | number | boolean;
export interface SheetData {
  name: string;
  header: string[];
  rows: Cell[][];
}

const yes = (b: unknown) => (b ? "да" : "");
// моменты — в поясе платформы, как в самой CRM
const localTime = (iso?: string) => (iso ? appStamp(iso).replace("T", " ") || iso : "");

export function buildSheets(st: DataState, exportedAt = new Date()): SheetData[] {
  const op = new Map(st.operators.map((o) => [o.id, o.name]));
  const gr = new Map(st.groups.map((g) => [g.id, g.name]));
  const pr = new Map(st.projects.map((p) => [p.id, p.name]));
  const acc = new Map(st.accounts.map((a) => [a.id, a.name]));
  const group = (id: string | null | undefined) => (id ? gr.get(id) ?? id : NO_GROUP_LABEL);
  const s = st.settings;
  const dir = s.directionLabel || "Направление";

  const byDate = <T extends { at?: string; date?: string }>(a: T, b: T) => (a.at ?? a.date ?? "").localeCompare(b.at ?? b.date ?? "");

  const sheets: SheetData[] = [
    {
      name: "Лиды",
      header: ["ID", "Дата", "Время", "Статус", "Причина", "Кто проверил", "Когда проверил", "Клиент", "Телефон", "Проект", "Оператор", "Группа", dir, "Комментарий", "Источник", "Создан", "Изменён"],
      rows: [...st.leads].sort(byDate).map((l) => [
        l.id,
        l.at.slice(0, 10),
        l.at.slice(11, 16),
        LEAD_STATUS_LABEL[l.status] ?? l.status,
        l.status === "failed" ? l.statusReason : "",
        l.statusBy ?? "",
        localTime(l.statusAt),
        l.client,
        fmtPhone(l.phone),
        l.projectId ? pr.get(l.projectId) ?? l.projectId : "",
        op.get(l.operatorId) ?? l.operatorId,
        group(l.groupId),
        l.direction,
        l.comment,
        l.source,
        localTime(l.createdAt),
        localTime(l.updatedAt),
      ]),
    },
    {
      name: "Операторы",
      header: ["ID", "ФИО", "Группа", "Роль", "Статус", "Принят", "Уволен", "Личный план", "Норма часов", "Схема оплаты", "Оклад", "Ставка ₽/ч", "Бонус за лид", "Грейд", "Направление", "Контакт", "Комментарий", "Удалён"],
      rows: st.operators.map((o) => [
        o.id,
        o.name,
        group(o.groupId),
        ROLE_LABEL[o.role] ?? o.role,
        STATUS_LABEL[o.status] ?? o.status,
        o.hireDate,
        o.fireDate,
        o.monthlyPlan ?? "",
        o.normHours ?? "",
        PAY_LABEL[o.payType] ?? o.payType,
        o.salary || "",
        o.hourlyRate || "",
        o.leadBonus ?? "",
        GRADE_LABEL[o.grade] ?? "",
        TRACK_LABEL[o.track] ?? "",
        o.contact,
        o.comment,
        yes(o.deletedAt),
      ]),
    },
    {
      name: "Группы",
      header: ["ID", "Название", "Супервайзер", "План в месяц", "Активна", "Удалена"],
      rows: st.groups.map((g) => [g.id, g.name, (g.supervisorId ? op.get(g.supervisorId) : "") || g.supervisorName, g.monthlyPlan || "", yes(g.active), yes(g.deletedAt)]),
    },
    {
      name: "Проекты",
      header: ["ID", "Название", "Активен", "Удалён"],
      rows: st.projects.map((p) => [p.id, p.name, yes(p.active), yes(p.deletedAt)]),
    },
    {
      name: "График",
      header: ["Дата", "Оператор", "Группа", "Тип дня", "Часы", "Комментарий"],
      rows: [...st.shifts].sort(byDate).map((x) => [x.date, op.get(x.operatorId) ?? x.operatorId, group(x.groupId), DAY_LABEL[x.type] ?? x.type, x.hours, x.comment]),
    },
    {
      name: "Планы",
      header: ["Месяц", "Уровень", "Кому", "План", "Норма часов", "Схема оплаты", "Оклад", "Ставка ₽/ч", "Бонус за лид", "Апрув %", "Зафиксирован"],
      rows: [...st.plans]
        .sort((a, b) => a.month.localeCompare(b.month) || a.scope.localeCompare(b.scope))
        .map((p) => [
          p.month,
          p.scope === "team" ? "Отдел" : p.scope === "group" ? "Группа" : "Оператор",
          p.scope === "team" ? "" : p.scope === "group" ? group(p.targetId) : op.get(p.targetId ?? "") ?? p.targetId ?? "",
          p.plan,
          p.normHours ?? "",
          p.payType ? PAY_LABEL[p.payType] ?? p.payType : "",
          p.salary ?? "",
          p.hourlyRate ?? "",
          p.leadBonus ?? "",
          p.approvePct ?? "",
          yes(p.auto),
        ]),
    },
    {
      name: "Начисления",
      header: ["Месяц", "Дата", "Оператор", "Тип", "Сумма", "Комментарий"],
      rows: [...st.adjustments].sort(byDate).map((a) => [a.month, a.date, op.get(a.operatorId) ?? a.operatorId, ADJ_LABEL[a.type] ?? a.type, a.amount, a.comment]),
    },
    {
      name: "Апрув",
      header: ["Месяц", "Проект", "Апрув %", "Комментарий"],
      rows: st.approves.map((a) => [a.month, a.projectId ? pr.get(a.projectId) ?? a.projectId : "Весь месяц", a.pct, a.comment]),
    },
    {
      name: "Кандидаты",
      header: ["ФИО", "Контакт", "Источник", "Группа", "Этап", "Отклик", "Собеседование", "Обучение", "Итог", "Оператор", "Причина отказа", "Комментарий", "Удалён"],
      rows: [...st.candidates]
        .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt))
        .map((c) => [
          c.name,
          c.contact,
          c.source,
          c.groupId ? gr.get(c.groupId) ?? c.groupId : "",
          CANDIDATE_STAGE_LABEL[c.stage] ?? c.stage,
          c.appliedAt,
          c.interviewAt,
          c.trainingAt,
          c.closedAt,
          c.operatorId ? op.get(c.operatorId) ?? c.operatorId : "",
          c.reason,
          c.comment,
          yes(c.deletedAt),
        ]),
    },
    {
      name: "Аккаунты",
      header: ["ID", "Имя", "Логин", "Роль", "Сотрудник", "Группы", "Активен", "Был в системе", "Удалён"],
      rows: st.accounts.map((a) => [
        a.id,
        a.name,
        a.login,
        ACCOUNT_ROLE_LABEL[a.role] ?? a.role,
        a.operatorId ? op.get(a.operatorId) ?? a.operatorId : "",
        a.groupIds.map((g) => gr.get(g) ?? g).join(", "),
        yes(a.active),
        localTime(a.lastSeenAt),
        yes(a.deletedAt),
      ]),
    },
    {
      name: "Обучение",
      header: ["Аккаунт", "Курс", "Материал", "Пройден", "Последний тест %", "Лучший %", "Попыток"],
      rows: st.learn.map((l) => [acc.get(l.accountId) ?? l.accountId, l.courseId, l.itemId, yes(l.done), l.last ?? "", l.best ?? "", l.tries ?? ""]),
    },
    {
      name: "Журнал",
      header: ["Когда", "Кто", "Раздел", "Изменение"],
      rows: [...st.audit].sort((a, b) => a.at.localeCompare(b.at)).map((a) => [localTime(a.at), a.accountName, AUDIT_LABEL[a.entity] ?? a.entity, a.summary]),
    },
    {
      name: "Настройки",
      header: ["Параметр", "Значение"],
      rows: [
        ["Выгружено", localTime(exportedAt.toISOString())],
        ["Компания", s.companyName],
        ["План отдела в месяц", s.teamPlan || ""],
        ["План оператора по умолчанию", s.defaultOperatorPlan || ""],
        ["Норма часов в месяц", s.defaultNormHours],
        ["Часов в рабочем дне", s.dayHours],
        ["Цена лида для заказчика, ₽", s.leadRevenue || ""],
        ["Норматив ФОТ, %", s.payrollCapPct],
        ["Норма конверсии, %", s.convNormPct],
        ["Стажировка: лидов / часов", `${s.probationLeads} / ${s.probationHours}`],
        ["Удержание, %", s.withholdPct],
        ...s.rateGrids.flatMap((g) => g.tiers.map((t, i, arr): Cell[] => [`${g.name}: от ${t.from}${arr[i + 1] ? ` до ${arr[i + 1].from - 1}` : ""} лидов`, `${t.hourlyRate} ₽/ч + ${t.leadBonus} ₽ за лид`])),
      ],
    },
  ];
  return sheets;
}

export interface PushResult {
  ok: boolean;
  error?: string;
  rows?: number;
}

/** Отправка в веб-приложение Apps Script. text/plain — чтобы браузер не делал preflight-запрос. */
export async function pushToSheets(url: string, token: string, sheets: SheetData[]): Promise<PushResult> {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url.trim())) return { ok: false, error: "Ссылка должна вести на script.google.com (веб-приложение Apps Script)" };
  const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
  try {
    const res = await fetch(url.trim(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, sheets }),
      redirect: "follow",
    });
    const text = await res.text();
    let body: { ok?: boolean; error?: string } = {};
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: res.ok ? "Скрипт ответил не JSON — проверьте, что развёрнута последняя версия и доступ «Все»" : `HTTP ${res.status}` };
    }
    return body.ok ? { ok: true, rows } : { ok: false, error: body.error || "Скрипт вернул ошибку" };
  } catch (e) {
    return { ok: false, error: `Нет связи со скриптом: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Код для Google Apps Script — вставляется в «Расширения → Apps Script» таблицы. */
export const SHEETS_SCRIPT = `// LEADUP CRM → Google Таблица. Принимает выгрузку базы и перезаписывает листы.
// 1) Вставьте код в «Расширения → Apps Script», сохраните.
// 2) Замените ТОКЕН ниже на свой секрет (тот же, что в настройках CRM).
// 3) «Развернуть → Новое развёртывание → Веб-приложение»:
//    выполнять от имени «Меня», доступ «Все». Ссылку /exec вставьте в CRM.
const TOKEN = "ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ";

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return reply({ ok: false, error: "Неверный токен" });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    data.sheets.forEach(function (s) {
      const sh = ss.getSheetByName(s.name) || ss.insertSheet(s.name);
      sh.clearContents();
      const values = [s.header].concat(s.rows);
      const width = s.header.length;
      for (let i = 0; i < values.length; i += 5000) {
        const chunk = values.slice(i, i + 5000).map(function (r) {
          // текст вида «=…» не должен стать формулой
          const row = r.slice(0, width).map(function (v) {
            return typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : v;
          });
          while (row.length < width) row.push("");
          return row;
        });
        sh.getRange(i + 1, 1, chunk.length, width).setValues(chunk);
      }
      sh.getRange(1, 1, 1, width).setFontWeight("bold");
      sh.setFrozenRows(1);
    });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
