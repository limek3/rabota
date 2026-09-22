// Импорт «Академии обзвона» из исходного HTML в lib/learn/content.json.
//
// Исходник — автономная страница академии, весь контент в ней лежит в объекте
// `const DB={…}` (курсы, модули, уроки, тесты и справочники). Скрипт достаёт
// этот объект и кладёт как данные платформы: структура курсов сохраняется
// один в один, меняется только оболочка (рендер — components/learn).
//
// Запуск:  node scripts/import-academy.mjs <путь-к-файлу.html> [ещё файлы…]
// Берём файл с самым полным набором курсов (версия супервайзера — надмножество
// операторской); при нескольких файлах курсы объединяются по id.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib", "learn", "content.json");

/** Вырезает `const ИМЯ={…}` целиком, считая скобки и не спотыкаясь о строки. */
function extractObj(src, name) {
  const at = src.indexOf(`const ${name}=`);
  if (at < 0) throw new Error(`В файле нет \`const ${name}=\` — это не страница академии`);
  const start = src.indexOf("{", at);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error(`Не нашёл конец объекта ${name}`);
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Укажите файл(ы) академии: node scripts/import-academy.mjs academy.html");
  process.exit(1);
}

const courses = new Map();
let refs = null;
let dataAsOf = "";
let dataSrc = null;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const db = extractObj(src, "DB");
  for (const c of db.COURSES ?? []) if (!courses.has(c.id)) courses.set(c.id, c);
  // актуальность справочников и источники данных живут рядом со скриптом страницы
  dataAsOf ||= (src.match(/const DATA_AS_OF="([^"]*)"/) ?? [])[1] ?? "";
  dataSrc ??= (() => {
    try {
      return extractObj(src, "DATA_SRC");
    } catch {
      return {};
    }
  })();
  refs ??= {
    prices: db.PRICES ?? [],
    statusesRealty: db.ST_RE ?? [],
    statusesAuto: db.ST_AUTO ?? [],
    objections: db.OBJ ?? [],
    glossary: db.GLOSS ?? [],
    autoPrices: db.AUTO_PRICES ?? [],
    autoCities: db.AUTO_CITIES ?? [],
  };
}

// пункты-ссылки ({id, ref}) заменяем на сам материал, чтобы рендер не знал о них
const byId = new Map();
for (const c of courses.values()) for (const m of c.modules ?? []) for (const it of m.items ?? []) if (!it.ref) byId.set(it.id, it);
let resolved = 0;
for (const c of courses.values())
  for (const m of c.modules ?? [])
    m.items = (m.items ?? []).map((it) => {
      if (!it.ref) return it;
      const src = byId.get(it.ref);
      if (!src) return it;
      resolved++;
      return { ...src, id: it.id, from: it.ref };
    });

const content = { courses: Array.from(courses.values()), refs, dataAsOf, dataSrc: dataSrc ?? {}, importedAt: new Date().toISOString() };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(content), "utf8");

const items = content.courses.reduce((a, c) => a + c.modules.reduce((b, m) => b + m.items.length, 0), 0);
console.log(`Курсов: ${content.courses.length}, материалов: ${items}, ссылок раскрыто: ${resolved}`);
console.log(`Справочники: цены ${refs.prices.length}, статусы НД ${refs.statusesRealty.length}, статусы авто ${refs.statusesAuto.length}, возражения ${refs.objections.length}, термины ${refs.glossary.length}, авто ${refs.autoPrices.length}, города ${refs.autoCities.length}`);
console.log(`→ ${OUT} (${(JSON.stringify(content).length / 1024).toFixed(0)} КБ)`);
