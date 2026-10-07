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
import { SEGMENT_LABEL, regionSegment } from "./regions";
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
      header: ["ID", "Дата", "Время", "Статус", "Причина", "Кто проверил", "Когда проверил", "Клиент", "Телефон", "Ссылка", "Проект", "Оператор", "Группа", dir, "Комментарий", "Источник", "Создан", "Изменён", "Регион", "Основа / регионы"],
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
        l.link,
        l.projectId ? pr.get(l.projectId) ?? l.projectId : "",
        op.get(l.operatorId) ?? l.operatorId,
        group(l.groupId),
        l.direction,
        l.comment,
        l.source,
        localTime(l.createdAt),
        localTime(l.updatedAt),
        l.region ?? "",
        (() => {
          const seg = regionSegment(l.region, s);
          return seg ? SEGMENT_LABEL[seg] : "";
        })(),
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

export const isScriptUrl = (url: string) => /^https:\/\/script\.google(usercontent)?\.com\//.test(url.trim());

type ScriptReply = { ok?: boolean; error?: string; [k: string]: unknown };

/** POST в веб-приложение Apps Script. text/plain — чтобы браузер не делал preflight-запрос. */
async function postScript(url: string, body: unknown): Promise<{ ok: true; body: ScriptReply } | { ok: false; error: string }> {
  if (!isScriptUrl(url)) return { ok: false, error: "Ссылка должна вести на script.google.com (веб-приложение Apps Script)" };
  try {
    const res = await fetch(url.trim(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
    });
    const text = await res.text();
    let reply: ScriptReply = {};
    try {
      reply = JSON.parse(text);
    } catch {
      return { ok: false, error: res.ok ? "Скрипт ответил не JSON — проверьте, что развёрнута последняя версия и доступ «Все»" : `HTTP ${res.status}` };
    }
    return reply.ok ? { ok: true, body: reply } : { ok: false, error: reply.error || "Скрипт вернул ошибку" };
  } catch (e) {
    return { ok: false, error: `Нет связи со скриптом: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Выгрузка всей базы в веб-приложение Apps Script. */
export async function pushToSheets(url: string, token: string, sheets: SheetData[]): Promise<PushResult> {
  const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
  const r = await postScript(url, { token, sheets });
  return r.ok ? { ok: true, rows } : { ok: false, error: r.error };
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

/** Код Apps Script для таблицы лидов ОКК («Авто недозвоны»): дописывает строки в лист месяца. Копия — docs/leads-google-script.gs. */
export const LEADS_SCRIPT = `// LEADUP CRM → таблица лидов для ОКК. Дописывает лиды за день или период в лист месяца
// («Октябрь Борис»); листа нового месяца нет — создаёт его и оформляет.
// Повтор не дублирует: тот же лид (ссылка) или, без ссылки, та же дата + телефон.
// Безопасность: работает только с одним листом — тем, что прислала CRM. Другие листы не читает
// и не меняет, ничего не удаляет и не стирает: строки только дописываются в конец.
// Лист с таким названием уже есть, но шапка у него другая — не пишет ничего и возвращает ошибку.
//
// 1) Таблица → «Расширения → Apps Script», вставьте код, сохраните.
// 2) Замените ТОКЕН ниже на секрет из настроек CRM (раздел «Таблица лидов для ОКК»).
// 3) «Развернуть → Новое развёртывание → Веб-приложение»: выполнять от имени «Меня», доступ «Все».
//    Ссылку /exec вставьте в CRM. Меняли код — «Управление развёртываниями → Изменить → Новая версия».
// Оформить уже существующий лист этого формата заново: откройте его, в редакторе выберите функцию
// formatCurrentSheet → «Выполнить» (меняет только вид).
const TOKEN = "ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ";

const HEADER = ["Дата", "Ссылка", "Телефон", "Имя", "Оператор", "Доведен", "Если не доведен, почему", "Проверка ОКК"];
const DONE = ["Да", "Нет"];

// ── оформление ─────────────────────────────────────────────────────────
const STYLE = {
  font: "Roboto",
  size: 10,
  head: { bg: "#1f2937", fg: "#ffffff", height: 40 },
  rowHeight: 26,
  band: ["#ffffff", "#f6f7f9"],
  line: "#e5e7eb",
  daySep: "#9ca3af",
  tab: "#2563eb",
  link: "#1155cc",
  // ширины: дата, ссылка, телефон, имя, оператор, доведен, почему, проверка ОКК
  widths: [92, 140, 118, 150, 190, 96, 240, 160],
  done: { yes: { bg: "#dcf2e3", fg: "#1e6b34" }, no: { bg: "#fbe1e1", fg: "#9b1c1c" } },
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return reply({ ok: false, error: "Неверный токен" });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const header = data.header || HEADER;
    const done = data.done || DONE;
    const width = header.length;
    let sh = ss.getSheetByName(data.tab);
    const created = !sh;
    if (!sh) sh = ss.insertSheet(data.tab);
    if (sh.getLastRow() === 0) setup(sh, header, done);
    else if (!sameHeader(sh, header)) {
      return reply({ ok: false, error: "На листе «" + data.tab + "» другая шапка — ничего не записано, чтобы не испортить лист. Переименуйте его или укажите в CRM другое имя в «Чей лист»" });
    }

    const col = cols(header);
    // что уже есть на листе
    const seen = {};
    const last = sh.getLastRow();
    if (last > 1) {
      sh.getRange(2, 1, last - 1, width).getDisplayValues().forEach(function (r) {
        seen[key(r[col.date], r[col.phone], r[col.link])] = true;
      });
    }
    const add = data.rows.filter(function (r) {
      const k = key(r[col.date], r[col.phone], col.link >= 0 ? linkLabel(r[col.link]) : "");
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });

    if (add.length) {
      const start = sh.getLastRow() + 1;
      const prevDay = start > 2 ? sh.getRange(start - 1, col.date + 1).getDisplayValue() : "";
      const values = add.map(function (r) {
        const row = r.slice(0, width).map(function (v, i) {
          if (i === col.link) return "";
          return typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : v;
        });
        while (row.length < width) row.push("");
        const d = String(row[col.date]).split(".");
        if (d.length === 3) row[col.date] = new Date(Number(d[2]), Number(d[1]) - 1, Number(d[0]));
        return row;
      });
      sh.getRange(start, 1, values.length, width).setValues(values);
      // ссылка — кликабельный текст «лид 60500425092»
      if (col.link >= 0) {
        const links = add.map(function (r) {
          const url = String(r[col.link] || "").trim();
          if (!/^https?:\\/\\//.test(url)) return [SpreadsheetApp.newRichTextValue().setText("").build()];
          return [SpreadsheetApp.newRichTextValue().setText(linkLabel(url)).setLinkUrl(url).build()];
        });
        sh.getRange(start, col.link + 1, links.length, 1).setRichTextValues(links);
      }
      styleRows(sh, start, values.length, header, done);
      // новый день — линия сверху, чтобы дни читались блоками
      let day = prevDay;
      add.forEach(function (r, i) {
        if (r[col.date] !== day && start + i > 2) {
          sh.getRange(start + i, 1, 1, width).setBorder(true, null, null, null, null, null, STYLE.daySep, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
        }
        day = r[col.date];
      });
    }
    return reply({ ok: true, added: add.length, skipped: data.rows.length - add.length, created: created });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function cols(header) {
  const at = function (name) { return header.indexOf(name); };
  return { date: Math.max(at("Дата"), 0), link: at("Ссылка"), phone: at("Телефон"), done: at("Доведен"), why: at("Если не доведен, почему") };
}

/** Пустой лист: шапка, ширины, фильтр, полосы, список и цвета «Доведен». */
function setup(sh, header, done) {
  const width = header.length;
  const rows = sh.getMaxRows();
  const col = cols(header);

  sh.setHiddenGridlines(true);
  sh.setTabColor(STYLE.tab);
  sh.getRange(1, 1, rows, width).setFontFamily(STYLE.font).setFontSize(STYLE.size).setVerticalAlignment("middle");
  sh.getRange(1, 1, 1, width)
    .setValues([header])
    .setBackground(STYLE.head.bg)
    .setFontColor(STYLE.head.fg)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setWrap(true);
  sh.setRowHeight(1, STYLE.head.height);
  sh.setFrozenRows(1);
  for (let i = 0; i < width && i < STYLE.widths.length; i++) sh.setColumnWidth(i + 1, STYLE.widths[i]);

  sh.getBandings().forEach(function (b) { b.remove(); });
  const band = sh.getRange(1, 1, rows, width).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  band.setHeaderRowColor(STYLE.head.bg).setFirstRowColor(STYLE.band[0]).setSecondRowColor(STYLE.band[1]);

  if (!sh.getFilter()) sh.getRange(1, 1, rows, width).createFilter();

  const rules = [];
  if (col.done >= 0) {
    const r = sh.getRange(2, col.done + 1, rows - 1, 1);
    r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(done, true).setAllowInvalid(false).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(done[0]).setBackground(STYLE.done.yes.bg).setFontColor(STYLE.done.yes.fg).setBold(true).setRanges([r]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(done[1]).setBackground(STYLE.done.no.bg).setFontColor(STYLE.done.no.fg).setBold(true).setRanges([r]).build());
  }
  sh.setConditionalFormatRules(rules);
}

/** Новые строки: форматы, выравнивание, высота, список «Да / Нет». */
function styleRows(sh, start, n, header, done) {
  const width = header.length;
  const col = cols(header);
  sh.getRange(start, 1, n, width).setFontFamily(STYLE.font).setFontSize(STYLE.size).setVerticalAlignment("middle").setFontColor("#111827");
  sh.setRowHeights(start, n, STYLE.rowHeight);
  sh.getRange(start, col.date + 1, n, 1).setNumberFormat("dd.mm.yyyy").setHorizontalAlignment("center");
  if (col.phone >= 0) sh.getRange(start, col.phone + 1, n, 1).setNumberFormat("0").setHorizontalAlignment("center");
  if (col.link >= 0) sh.getRange(start, col.link + 1, n, 1).setFontColor(STYLE.link).setHorizontalAlignment("center");
  if (col.done >= 0) {
    sh.getRange(start, col.done + 1, n, 1)
      .setHorizontalAlignment("center")
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(done, true).setAllowInvalid(false).build());
  }
  if (col.why >= 0) sh.getRange(start, col.why + 1, n, 1).setWrap(true);
  sh.getRange(start, 1, n, width).setBorder(null, null, true, null, null, true, STYLE.line, SpreadsheetApp.BorderStyle.SOLID);
}

/** Совпадает ли первая строка листа с шапкой CRM (регистр и пробелы не важны). */
function sameHeader(sh, header) {
  const row = sh.getRange(1, 1, 1, header.length).getDisplayValues()[0];
  const norm = function (v) { return String(v).trim().toLowerCase(); };
  return header.every(function (h, i) { return norm(h) === norm(row[i]); });
}

/** Оформить открытый лист заново (вручную из редактора). Только вид и только лист с шапкой CRM. */
function formatCurrentSheet() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getLastRow() > 0 && !sameHeader(sh, HEADER)) {
    throw new Error("У листа «" + sh.getName() + "» другая шапка — оформляю только листы CRM (" + HEADER.join(", ") + ")");
  }
  setup(sh, HEADER, DONE);
  if (sh.getLastRow() > 1) styleRows(sh, 2, sh.getLastRow() - 1, HEADER, DONE);
}

/** Ключ повтора: лид по ссылке («лид 605…»), без ссылки — дата + телефон. */
function key(date, phone, label) {
  if (label && label !== "открыть") return "L|" + label;
  return "D|" + String(date).trim() + "|" + String(phone).replace(/\\D+/g, "").slice(-10);
}

/** «лид 60500425092» для ссылки Скорозвона, иначе «открыть» (как linkLabel в lib/crm/leadsheet.ts). */
function linkLabel(url) {
  const m = /\\/leads\\/(\\d+)/.exec(String(url || ""));
  return m ? "лид " + m[1] : String(url || "").trim() ? "открыть" : "";
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
