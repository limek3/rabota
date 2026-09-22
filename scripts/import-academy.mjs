// Импорт «Академии обзвона» из исходных HTML в lib/learn/content.json.
//
// Исходник — автономная страница академии, весь контент в ней лежит в объекте
// `const DB={…}` (курсы, модули, уроки, тесты и справочники). Скрипт достаёт
// этот объект и кладёт как данные платформы: структура курсов сохраняется
// один в один, меняется только оболочка (рендер — components/learn).
//
// У каждой роли своя академия: оператор видит операторский файл, супервайзер
// (и РОП) — супервайзерский. Роль файла берётся из `const ROLE_LOCK="…"`.
//
// Запуск:  node scripts/import-academy.mjs <файл.html> [ещё файл…]
// Можно передать один файл — тогда обновится только его роль, вторая останется
// из текущего content.json. Курсы, совпадающие у ролей до байта, хранятся один раз.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib", "learn", "content.json");
const ROLES = ["operator", "supervisor"];

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

/** Пункты-ссылки ({id, ref}) заменяем на сам материал, чтобы рендер не знал о них. */
function resolveRefs(courses) {
  const byId = new Map();
  for (const c of courses) for (const m of c.modules ?? []) for (const it of m.items ?? []) if (!it.ref) byId.set(it.id, it);
  let n = 0;
  for (const c of courses)
    for (const m of c.modules ?? [])
      m.items = (m.items ?? []).map((it) => {
        if (!it.ref) return it;
        const src = byId.get(it.ref);
        if (!src) return it;
        n++;
        return { ...src, id: it.id, from: it.ref };
      });
  return n;
}

/** Роль файла: ROLE_LOCK, а в старых выгрузках без него — по наличию курсов супервайзера. */
function roleOf(src, db) {
  const lock = (src.match(/const ROLE_LOCK="([^"]*)"/) ?? [])[1];
  if (ROLES.includes(lock)) return lock;
  return (db.COURSES ?? []).some((c) => c.role === "supervisor") ? "supervisor" : "operator";
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Укажите файл(ы) академии: node scripts/import-academy.mjs operator.html supervisor.html");
  process.exit(1);
}

// что уже импортировано: роль, которой нет среди файлов, остаётся как была
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const sets = {};
if (prev?.roles && prev?.library) {
  const lib = new Map(prev.library.map((c) => [c.key, c]));
  for (const r of ROLES) {
    const p = prev.roles[r];
    if (!p) continue;
    sets[r] = {
      ...p,
      courses: p.courses.map((k) => {
        const { key, ...c } = lib.get(k);
        return c;
      }),
      refs: prev.refs,
      dataAsOf: prev.dataAsOf,
      dataSrc: prev.dataSrc,
    };
  }
}

const now = new Date().toISOString();
let lastRole = "";
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const db = extractObj(src, "DB");
  const role = roleOf(src, db);
  lastRole = role;
  const courses = db.COURSES ?? [];
  const resolved = resolveRefs(courses);
  sets[role] = {
    courses,
    // оболочка исходника тоже бывает разной: у оператора — режим «Только реплики»,
    // у супервайзера — кнопка «Скопировать» у реплик
    features: { runMode: /data-runmode=/.test(src), copy: /data-copy=/.test(src) },
    source: basename(f),
    importedAt: now,
    refs: {
      prices: db.PRICES ?? [],
      statusesRealty: db.ST_RE ?? [],
      statusesAuto: db.ST_AUTO ?? [],
      objections: db.OBJ ?? [],
      glossary: db.GLOSS ?? [],
      autoPrices: db.AUTO_PRICES ?? [],
      autoCities: db.AUTO_CITIES ?? [],
    },
    // актуальность справочников и источники данных живут рядом со скриптом страницы
    dataAsOf: (src.match(/const DATA_AS_OF="([^"]*)"/) ?? [])[1] ?? "",
    dataSrc: (() => {
      try {
        return extractObj(src, "DATA_SRC");
      } catch {
        return {};
      }
    })(),
  };
  const items = courses.reduce((a, c) => a + c.modules.reduce((b, m) => b + m.items.length, 0), 0);
  console.log(`${role}: ${basename(f)} — курсов ${courses.length}, материалов ${items}, ссылок раскрыто ${resolved}`);
}

const missing = ROLES.filter((r) => !sets[r]);
if (missing.length) {
  console.error(`Нет академии для роли: ${missing.join(", ")}. Передайте файл этой роли.`);
  process.exit(1);
}

// справочники общие: берём из последнего переданного файла и предупреждаем, если у ролей они разошлись
const last = sets[lastRole];
const S = JSON.stringify;
if (S(sets.operator.refs) !== S(sets.supervisor.refs)) console.warn("Внимание: справочники у ролей различаются — взяты из", last.source);

// библиотека курсов: одинаковый у ролей курс — одна запись с ключом = id,
// разный — по записи на роль с ключом id@роль
const library = [];
const roles = {};
const seen = new Map();
for (const r of ROLES) {
  const keys = [];
  for (const c of sets[r].courses) {
    const shared = ROLES.every((o) => {
      const x = sets[o].courses.find((y) => y.id === c.id);
      return !x || S(x) === S(c);
    });
    const key = shared ? c.id : `${c.id}@${r}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      library.push({ key, ...c });
    }
    keys.push(key);
  }
  const { features, source, importedAt } = sets[r];
  roles[r] = { courses: keys, features, source, importedAt };
}

const content = { library, roles, refs: last.refs, dataAsOf: last.dataAsOf, dataSrc: last.dataSrc, importedAt: now };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, S(content), "utf8");

const own = library.filter((c) => c.key.includes("@")).map((c) => c.key);
const refs = content.refs;
console.log(`Своя версия у ролей: ${own.length ? own.join(", ") : "нет — все курсы общие"}`);
console.log(`Справочники: цены ${refs.prices.length}, статусы НД ${refs.statusesRealty.length}, статусы авто ${refs.statusesAuto.length}, возражения ${refs.objections.length}, термины ${refs.glossary.length}, авто ${refs.autoPrices.length}, города ${refs.autoCities.length}`);
console.log(`→ ${OUT} (${(S(content).length / 1024).toFixed(0)} КБ)`);
