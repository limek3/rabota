/*
 * Фото моделей для «Марок авто» — из Википедии (свободные лицензии, с указанием автора).
 *
 *   node scripts/build-car-photos.cjs          — докачать недостающие
 *   node scripts/build-car-photos.cjs --force  — скачать заново все
 *
 * По каждой модели каталога (lib/cars/data.ts) ищет статью: сначала английскую по названию
 * («Toyota Camry» или своё название в каталоге), потом русскую, потом поиском.
 * В каталоге «ru:Название» — сразу русская статья, «-» — фото не нужно (в Википедии чужая машина). Берёт главное
 * изображение статьи (только свободные — pilicense=free) шириной 400 px и кладёт в
 * public/cars/<id модели>.jpg. Автор и лицензия — в lib/cars/photos.json, карточка их подписывает.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "cars");
const MANIFEST = path.join(ROOT, "lib", "cars", "photos.json");
const BUILD = path.join(ROOT, "node_modules", ".cache", "car-build");
const FORCE = process.argv.includes("--force");
const UA = "LeadupCRM/1.0 (internal CRM; car catalog photos)";
const WIDTH = 400;

// каталог — из TypeScript, как в тестах расчётов
execFileSync(process.execPath, [path.join(ROOT, "node_modules/typescript/bin/tsc"), "lib/cars/catalog.ts", "--outDir", BUILD, "--module", "commonjs", "--target", "es2020", "--skipLibCheck"], { cwd: ROOT, stdio: "inherit" });
const { MODEL_LIST } = require(path.join(BUILD, "catalog.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  // Википедия просит не частить: на 429 и сбои — пауза всё длиннее (3 → 6 → 12 → 24 с)
  for (let k = 0; k < 5; k++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok) return r.json();
    } catch {
      /* сеть — повторим */
    }
    await sleep(3000 * 2 ** k);
  }
  throw new Error(`${host}: не ответил`);
}

/** Главные картинки статей по названиям: название → { thumb, file }. */
async function pageImages(host, titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await api(host, { action: "query", prop: "pageimages", piprop: "thumbnail|name", pithumbsize: String(WIDTH), pilicense: "free", redirects: "1", titles: batch.join("|") });
    const q = j.query ?? {};
    // название запроса → итоговая страница (через нормализацию и перенаправления)
    const step = new Map();
    for (const n of q.normalized ?? []) step.set(n.from, n.to);
    for (const r of q.redirects ?? []) step.set(r.from, r.to);
    const pages = new Map((q.pages ?? []).map((p) => [p.title, p]));
    for (const t of batch) {
      let cur = t;
      for (let k = 0; k < 3 && step.has(cur); k++) cur = step.get(cur);
      const p = pages.get(cur);
      if (p?.thumbnail?.source && p.pageimage) out.set(t, { thumb: p.thumbnail.source, file: p.pageimage, page: p.title, host });
    }
    await sleep(300);
  }
  return out;
}

async function searchTitle(host, q) {
  const j = await api(host, { action: "query", list: "search", srsearch: q, srlimit: "3", srnamespace: "0" });
  return (j.query?.search ?? []).map((s) => s.title);
}

/** Автор и лицензия файлов с Викисклада. */
async function credits(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const j = await api("commons.wikimedia.org", { action: "query", prop: "imageinfo", iiprop: "extmetadata", titles: batch.map((f) => `File:${f}`).join("|") });
    for (const p of j.query?.pages ?? []) {
      const m = p.imageinfo?.[0]?.extmetadata ?? {};
      const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      out.set(p.title.replace(/^File:/, "").replace(/ /g, "_"), { by: strip(m.Artist?.value).slice(0, 80), lic: strip(m.LicenseShortName?.value) });
    }
    await sleep(300);
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = !FORCE && fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  // «-» в каталоге — фото не нужно: старое (чужая машина) убираем
  for (const m of MODEL_LIST.filter((x) => x.wiki === "-")) {
    delete manifest[m.id];
    fs.rmSync(path.join(OUT_DIR, `${m.id}.jpg`), { force: true });
  }
  const todo = MODEL_LIST.filter((m) => m.wiki !== "-" && (FORCE || !manifest[m.id] || !fs.existsSync(path.join(OUT_DIR, `${m.id}.jpg`))));
  const ruOnly = (m) => m.wiki.startsWith("ru:");
  const title = (m) => m.wiki.replace(/^ru:/, "");
  console.log(`моделей ${MODEL_LIST.length}, без фото ${todo.length}`);

  // 1) английская статья по названию, 2) русская, 3) поиск
  const found = new Map();
  const en = await pageImages("en.wikipedia.org", [...new Set(todo.filter((m) => !ruOnly(m)).map(title))]);
  for (const m of todo) if (!ruOnly(m) && en.has(title(m))) found.set(m.id, en.get(title(m)));
  let rest = todo.filter((m) => !found.has(m.id));
  const ru = await pageImages("ru.wikipedia.org", [...new Set(rest.map(title))]);
  for (const m of rest) if (ru.has(title(m))) found.set(m.id, ru.get(title(m)));
  rest = todo.filter((m) => !found.has(m.id) && !ruOnly(m));
  console.log(`по названию: ${found.size}, ищем поиском: ${rest.length}`);
  for (const m of rest) {
    try {
      const titles = await searchTitle("en.wikipedia.org", `${m.brand.wiki} ${m.name}`);
      // статья должна быть про эту марку, иначе поиск притащит чужую машину
      const ok = titles.filter((t) => t.toLowerCase().includes(m.brand.name.toLowerCase().split(/[ -]/)[0]));
      if (ok.length) {
        const img = await pageImages("en.wikipedia.org", ok.slice(0, 1));
        if (img.size) found.set(m.id, [...img.values()][0]);
      }
    } catch (e) {
      console.warn(`${m.full}: поиск не ответил — без фото`);
    }
    await sleep(1000);
  }

  // скачать
  let n = 0;
  for (const m of todo) {
    const f = found.get(m.id);
    if (!f) continue;
    try {
      const r = await fetch(f.thumb, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(path.join(OUT_DIR, `${m.id}.jpg`), Buffer.from(await r.arrayBuffer()));
      manifest[m.id] = { file: f.file, page: f.page, host: f.host };
      if (++n % 50 === 0) console.log(`скачано ${n}`);
    } catch (e) {
      console.warn(`${m.full}: ${e.message}`);
    }
    await sleep(120);
  }

  // авторы и лицензии (не ответил Викисклад — фото остаются, подпись «Википедия»; докачаются в следующий раз)
  const need = [...new Set(Object.values(manifest).filter((v) => !v.lic).map((v) => v.file))];
  const cr = await credits(need).catch(() => new Map());
  for (const v of Object.values(manifest)) {
    const c = cr.get(v.file);
    if (c) Object.assign(v, c);
  }

  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 0).replace(/},"/g, '},\n"') + "\n");
  const missing = MODEL_LIST.filter((m) => !manifest[m.id] && m.wiki !== "-").map((m) => m.full);
  console.log(`готово: с фото ${Object.keys(manifest).length} из ${MODEL_LIST.length}`);
  if (missing.length) console.log(`без фото (${missing.length}): ${missing.join(", ")}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
