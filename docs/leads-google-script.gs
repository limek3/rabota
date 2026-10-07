// LEADUP CRM → таблица лидов для ОКК. Дописывает лиды за день или период в лист месяца
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
          if (!/^https?:\/\//.test(url)) return [SpreadsheetApp.newRichTextValue().setText("").build()];
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
  return "D|" + String(date).trim() + "|" + String(phone).replace(/\D+/g, "").slice(-10);
}

/** «лид 60500425092» для ссылки Скорозвона, иначе «открыть» (как linkLabel в lib/crm/leadsheet.ts). */
function linkLabel(url) {
  const m = /\/leads\/(\d+)/.exec(String(url || ""));
  return m ? "лид " + m[1] : String(url || "").trim() ? "открыть" : "";
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
