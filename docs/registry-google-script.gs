// LEADUP CRM → реестры выплат YouDo («Реестр Выплат по СЗ — ОПЕРАТОРЫ» и «— Супервайзеры»).
// CRM присылает: проект (ОКЦ / СВ), вид (план / факт), период, имена и суммы для колонки
// «Сумма включая налог 6%»: в плане — условная из настроек CRM, в факте — на руки за период ÷ 0,94.
// Скрипт создаёт лист «План ОКЦ (06.10-18.10)» или «Факт ОКЦ (06.10-18.10)» в формате реестра:
//   - ФИО полностью и ИНН — из «Реестра исполнителей» и прошлых листов реестров (в CRM ИНН нет);
//   - порядок строк — как в листе плана этого периода, иначе как в последнем листе файла; новые — в конец;
//   - тексты задания (название, адрес, описание, чек) — из того же листа;
//   - 14 колонок, как у бухгалтера; шапка высотой 65, остальные строки — 21;
//   - факт: даты задания — из плана; изменённая сумма подсвечена, в заметке к ячейке — «план X → факт Y»;
//   - внизу итог и строки «СТАТУС НА YouDO» — их заполняет бухгалтер; при перезаписи листа они сохраняются.
// Другие листы не меняет и не удаляет. Лист с таким названием уже есть — без согласия из CRM не трогает.
// Листы «ТЕСТ …» (тестовый прогон из CRM) не считаются ни планом, ни готовым листом периода.
//
// 1) script.google.com → «Создать проект», удалите всё и вставьте этот код, сохраните (Ctrl+S).
// 2) Замените ТОКЕН ниже на секрет из CRM (Настройки → Данные → «Реестры выплат YouDo»).
// 3) «Развернуть → Новое развёртывание → Веб-приложение»: выполнять от имени «Меня», доступ «Все».
//    Google попросит доступ к таблицам — разрешите (у вашего аккаунта должен быть доступ на
//    редактирование к обоим реестрам). Ссылку /exec вставьте в CRM.
// 4) Меняли код — «Управление развёртываниями → Изменить → Новая версия».
// Проверка без CRM: выберите функцию test → «Выполнить» — в журнале будет, кого скрипт нашёл.
const TOKEN = "ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ";

// id файлов — из ссылок docs.google.com/spreadsheets/d/<id>/edit
const FILES = {
  okc: "1-cLGPcrhn2R42z-kgv2E2K9TEkewdSPtzVPfi9vaIaI", // Реестр Выплат по СЗ — ОПЕРАТОРЫ
  sv: "1Ygf96l7sbiYfEPs258j91dW7yT4lTm0uQmIJhLv6Jio", // Реестр Выплат по СЗ — Супервайзеры
};
const PEOPLE = "1BKUr9O0J7F__Wz4nuvu53vfYYuCQsVDhND9vEUyZvsA"; // Реестр исполнителей

const WIDTH = 14;
const ROW_HEIGHT = 21;
const HEAD_HEIGHT = 65;
const HEADER = [
  "Фамилия", "Имя", "Отчество", "ИНН исполнителя", "Название задания", "Адрес задания", "Подробное описание задания",
  "Описание задания для чека \n(до 170 символов)", "Объем услуг", "Единицы измерения", "Сумма включая налог 6% \n(без комиссии YouDo)",
  "Дата начала задания", "Дата окончания задания", "Тип оплаты",
];
const REMOTE = "Оказание услуг производится дистанционно (удаленно) вне места расположения Заказчика (через сеть Интернет)";
// тексты задания, если в файле ещё нет ни одного листа реестра
const TASK = {
  okc: ["Информационный обзвон контактов из клиентской базы", REMOTE, "", "Информационный обзвон клиентской базы, квалификация запросов, фиксация контактов в таблице", 1, "усл."],
  sv: ["Услуги по контролю качества", REMOTE, "", "Услуги по контролю качества", 1, "усл."],
};
const PAY_TYPE = "счет";
const STATUS_LABEL = "СТАТУС НА YouDO";
const STATUSES = ["ПРЕДЛОЖИЛИ", "В РАБОТЕ", "НА ОПЛАТУ", "ОПЛАЧЕНО"];
const MARK = { changed: "#fff2cc", missing: "#f4cccc", zero: "#efefef", added: "#d9ead3" };

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== TOKEN) return reply({ ok: false, error: "Неверный токен" });
    return reply(writeRegistry(data));
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function writeRegistry(data) {
  const fileId = FILES[data.project];
  if (!fileId) throw new Error("Неизвестный проект: " + data.project);
  if (data.kind !== "plan" && data.kind !== "fact") throw new Error("Вид реестра — plan или fact");
  const tab = String(data.tab || "").trim();
  if (!tab) throw new Error("Нет названия листа");
  const rows = Array.isArray(data.rows) ? data.rows : [];

  const ss = SpreadsheetApp.openById(fileId);
  const existing = ss.getSheetByName(tab);
  if (existing && !data.replace) return { ok: true, exists: true, tab: tab };
  // лист этого периода уже сделан руками под другим названием («На выплату - Факт ОКЦ (16.09-05.10)»,
  // «23.10 - выплата - ПЛАН СВ (05.10-18.10)») — тоже не трогаем, если не попросили перезаписать
  if (!existing && !data.replace) {
    const word = data.kind === "fact" ? /факт/i : /план/i;
    const same = ss.getSheets().filter(function (sh) {
      return !/^тест/i.test(sh.getName()) && word.test(sh.getName()) && sh.getName().replace(/\s+/g, "").indexOf("-" + String(data.periodTo || "") + ")") >= 0;
    })[0];
    if (same) return { ok: true, exists: true, tab: same.getName() };
  }

  // листы реестра этого файла (шапка с «ИНН исполнителя»), кроме «ПРОБЛЕМНЫЕ» и самого листа
  const regs = ss.getSheets().filter(function (sh) {
    return sh.getName() !== tab && !/проблем/i.test(sh.getName()) && !/^тест/i.test(sh.getName()) && isRegistry(sh);
  });
  const end = "-" + String(data.periodTo || "") + ")";
  const plan =
    data.kind === "fact"
      ? regs.filter(function (sh) { return /план/i.test(sh.getName()) && sh.getName().replace(/\s+/g, "").indexOf(end) >= 0; }).pop() || null
      : null;
  const source = plan || regs[regs.length - 1] || null;
  const src = source ? readRows(source) : [];
  const task = src.length ? src[0].task : TASK[data.project];

  // кто есть кто: реестр исполнителей + все листы обоих реестров
  const books = [ss];
  [PEOPLE, FILES.okc, FILES.sv].forEach(function (id) {
    if (id === fileId) return;
    try { books.push(SpreadsheetApp.openById(id)); } catch (err) { /* нет доступа — без него */ }
  });
  const people = loadPeople(books);

  const items = rows.map(function (r) {
    return { name: String(r.name || "").trim(), net: num(r.net), sum: num(r.sum), p: findPerson(people, String(r.name || "")) };
  });

  // порядок: как в листе-источнике, новые — в конец
  const used = {};
  const order = [];
  src.forEach(function (s) {
    let hit = -1;
    for (let i = 0; i < items.length; i++) if (!used[i] && items[i].p.inn && innKey(items[i].p.inn) === innKey(s.inn)) { hit = i; break; }
    if (hit >= 0) { used[hit] = true; order.push({ it: items[hit], prev: s }); }
    else if (plan) order.push({ it: null, prev: s });
  });
  items.forEach(function (it, i) { if (!used[i]) order.push({ it: it, prev: null }); });

  const res = { ok: true, tab: tab, created: !existing, rows: 0, total: 0, plan: plan ? plan.getName() : null, source: source ? source.getName() : null, missing: [], changed: [], added: [], zeroed: [] };
  const lines = order.map(function (o) {
    const pr = o.prev;
    const t = pr ? pr.task : task;
    if (!o.it) {
      // был в плане, в CRM за период ничего — оставляем строку с нулём, чтобы задание поправили
      res.zeroed.push(pr.fam + " " + pr.im);
      return { mark: "zero", note: "В плане " + money(pr.sum) + " → в факте 0: задание отменить или обнулить", v: [pr.fam, pr.im, pr.otch, pr.inn].concat(t, [0, pr.from, pr.to, PAY_TYPE]) };
    }
    const it = o.it;
    const p = it.p;
    const fio = p.inn ? [p.fam, p.im, p.otch, p.inn] : splitName(it.name).concat([""]);
    const notes = [];
    let mark = "";
    if (!p.inn) { res.missing.push({ name: it.name, why: p.why }); notes.push("ИНН: " + p.why); mark = "missing"; }
    if (plan) {
      if (!pr) { res.added.push(it.name); notes.push("нет в плане — новое задание"); if (!mark) mark = "added"; }
      else if (Math.round(pr.sum) !== Math.round(it.sum)) {
        res.changed.push({ name: it.name, from: pr.sum, to: it.sum });
        notes.push("план " + money(pr.sum) + " → факт " + money(it.sum));
        if (!mark) mark = "changed";
      }
    }
    const from = plan && pr && pr.from ? pr.from : String(data.from || "");
    const to = plan && pr && pr.to ? pr.to : String(data.to || "");
    return { mark: mark, note: notes.join("; "), v: fio.concat(t, [it.sum, from, to, PAY_TYPE]) };
  });

  // статусы YouDo внизу старого листа — сохраняем
  let statuses = STATUSES.map(function (s) { return [s, ""]; });
  if (existing) {
    const last = existing.getLastRow();
    if (last > 1) {
      const kept = existing.getRange(1, 12, last, 3).getDisplayValues().filter(function (r) { return String(r[0]).trim() === STATUS_LABEL; }).map(function (r) { return [r[1], r[2]]; });
      if (kept.length) statuses = kept;
    }
  }

  const sh = existing || ss.insertSheet(tab, ss.getNumSheets());
  if (existing) { sh.clear(); sh.clearNotes(); }

  // шапка — тексты и вид из листа-источника, недостающие колонки — свои
  const head = HEADER.slice();
  if (source) {
    const sv = source.getRange(1, 1, 1, WIDTH).getValues()[0];
    for (let c = 0; c < WIDTH; c++) if (String(sv[c] || "").trim()) head[c] = sv[c];
    source.getRange(1, 1, 1, WIDTH).copyTo(sh.getRange(1, 1, 1, WIDTH), { formatOnly: true });
    for (let c = 1; c <= WIDTH; c++) sh.setColumnWidth(c, source.getColumnWidth(c));
  } else {
    sh.getRange(1, 1, 1, WIDTH).setFontWeight("bold");
  }
  sh.getRange(1, 1, 1, WIDTH).setValues([head]);
  sh.setFrozenRows(1);

  const n = lines.length;
  if (n) {
    if (source && src.length) source.getRange(src[0].row, 1, 1, WIDTH).copyTo(sh.getRange(2, 1, n, WIDTH), { formatOnly: true });
    // ИНН и даты — текстом: иначе пропадёт ведущий ноль и дата станет числом
    sh.getRange(2, 4, n, 1).setNumberFormat("@");
    sh.getRange(2, 12, n, 2).setNumberFormat("@");
    sh.getRange(2, 1, n, WIDTH).setValues(lines.map(function (l) { return l.v.map(safe); }));
    sh.getRange(2, 11, n, 1).setNumberFormat("#,##0.00");
    lines.forEach(function (l, i) {
      const r = i + 2;
      if (l.mark === "zero") sh.getRange(r, 1, 1, WIDTH).setBackground(MARK.zero);
      if (l.mark === "missing") sh.getRange(r, 4, 1, 1).setBackground(MARK.missing);
      if (l.mark === "changed") sh.getRange(r, 11, 1, 1).setBackground(MARK.changed);
      if (l.mark === "added") sh.getRange(r, 1, 1, 4).setBackground(MARK.added);
      // пояснение — заметкой к сумме (видно при наведении), отдельной колонки нет
      if (l.note) sh.getRange(r, 11, 1, 1).setNote(l.note);
    });
  }

  // итог и статусы YouDo: через пустую строку после данных
  let total = 0;
  lines.forEach(function (l) { total += num(l.v[10]); });
  const top = n + 3;
  const foot = statuses.map(function (s, i) {
    const row = []; for (let c = 0; c < WIDTH; c++) row.push("");
    row[11] = STATUS_LABEL; row[12] = s[0]; row[13] = s[1];
    if (i === 0) row[10] = round2(total);
    return row;
  });
  sh.getRange(top, 14, foot.length, 1).setNumberFormat("@");
  sh.getRange(top, 1, foot.length, WIDTH).setValues(foot);
  sh.getRange(top, 11, 1, 1).setNumberFormat("#,##0.00").setFontWeight("bold");
  // шапка — 65, остальные строки — ровно 21 (Forced: перенос текста их не растянет)
  sh.setRowHeightsForced(1, 1, HEAD_HEIGHT);
  sh.setRowHeightsForced(2, top + foot.length - 2, ROW_HEIGHT);
  SpreadsheetApp.flush();

  res.rows = n;
  res.total = round2(total);
  res.url = ss.getUrl() + "#gid=" + sh.getSheetId();
  return res;
}

function isRegistry(sh) {
  if (sh.getLastRow() < 1) return false;
  return /^инн/.test(norm(sh.getRange(1, 1, 1, 5).getDisplayValues()[0][3]));
}

/** Строки людей листа реестра (без итогов и статусов внизу). */
function readRows(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const disp = sh.getRange(2, 1, last - 1, WIDTH).getDisplayValues();
  const vals = sh.getRange(2, 1, last - 1, WIDTH).getValues();
  const out = [];
  for (let i = 0; i < disp.length; i++) {
    const d = disp[i];
    if (!String(d[0]).trim() || innKey(d[3]).length < 10) continue;
    out.push({ row: i + 2, fam: d[0].trim(), im: d[1].trim(), otch: d[2].trim(), inn: d[3].trim(), task: vals[i].slice(4, 10), sum: num(vals[i][10]), from: d[11].trim(), to: d[12].trim() });
  }
  return out;
}

/** Люди с ИНН из всех листов, где есть шапка «Фамилия … ИНН». */
function loadPeople(books) {
  const out = [];
  const seen = {};
  books.forEach(function (ss) {
    ss.getSheets().forEach(function (sh) {
      if (sh.getLastRow() < 2) return;
      const v = sh.getDataRange().getDisplayValues();
      for (let h = 0; h < Math.min(v.length, 10); h++) {
        const head = v[h].map(norm);
        const fam = head.indexOf("фамилия"), im = head.indexOf("имя"), otch = head.indexOf("отчество");
        let inn = -1;
        head.forEach(function (x, i) { if (inn < 0 && /^инн/.test(x)) inn = i; });
        if (fam < 0 || im < 0 || inn < 0) continue;
        for (let r = h + 1; r < v.length; r++) {
          const k = innKey(v[r][inn]);
          const f = String(v[r][fam]).trim();
          if (k.length < 10 || !f) continue;
          const id = k + "|" + norm(f);
          if (seen[id]) continue;
          seen[id] = true;
          out.push({ fam: f, im: String(v[r][im]).trim(), otch: otch >= 0 ? String(v[r][otch]).trim() : "", inn: String(v[r][inn]).trim() });
        }
        break;
      }
    });
  });
  return out;
}

/** Имя из CRM («Фамилия Имя» или «Имя Фамилия») → человек с ИНН. */
function findPerson(people, name) {
  const t = norm(name).split(" ").filter(String);
  const hits = people.filter(function (p) { return t.indexOf(norm(p.fam)) >= 0 && t.indexOf(norm(p.im)) >= 0; });
  const inns = {};
  hits.forEach(function (p) { inns[innKey(p.inn)] = p; });
  const keys = Object.keys(inns);
  if (keys.length === 1) return inns[keys[0]];
  return { why: keys.length ? "несколько ИНН на это имя — уточнить" : "нет в реестре исполнителей" };
}

function splitName(name) {
  const t = String(name).trim().split(/\s+/);
  return [t[0] || "", t[1] || "", t.slice(2).join(" ")];
}
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }
function innKey(s) { const d = String(s == null ? "" : s).replace(/\D/g, ""); return d.length && d.length < 12 && d.length !== 10 ? ("000000000000" + d).slice(-12) : d; }
function num(v) {
  if (typeof v === "number") return v;
  const s = String(v == null ? "" : v).replace(/[^\d,.\-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function round2(n) { return Math.round(n * 100) / 100; }
function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function safe(v) { return typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : v; }

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Проверка вручную: кого скрипт находит в реестре исполнителей. */
function test() {
  const books = [PEOPLE, FILES.okc, FILES.sv].map(function (id) { return SpreadsheetApp.openById(id); });
  const people = loadPeople(books);
  Logger.log("Людей с ИНН: " + people.length);
  people.forEach(function (p) { Logger.log(p.fam + " " + p.im + " " + p.otch + " — ИНН …" + innKey(p.inn).slice(-4)); });
}
