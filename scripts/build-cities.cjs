// Пересборка lib/geo/ru-cities.json (справочник «Карты городов»).
// Данные: github.com/hflabs/city (MIT) — city.csv.
// Запуск: node scripts/build-cities.cjs <city.csv> lib/geo/ru-cities.json
// Формат: { regions: [...], cities: [[имя, № региона, широта, долгота, население, UTC±, центр региона 0/1]] }, крупные первыми.
const fs = require("fs");
const [, , csv, out] = process.argv;
const lines = fs.readFileSync(csv, "utf8").trim().split(/\r?\n/);
const parse = (l) => {
  const o = [];
  let c = "", q = false;
  for (const ch of l) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { o.push(c); c = ""; continue; }
    c += ch;
  }
  o.push(c);
  return o;
};
const head = parse(lines[0]);
const rows = lines.slice(1).map(parse).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
// официальные названия там, где в датасете сокращения
const FIX = {
  "Республика Кабардино-Балкарская": "Кабардино-Балкарская Республика",
  "Республика Карачаево-Черкесская": "Карачаево-Черкесская Республика",
  "Кемеровская область - Кузбасс область": "Кемеровская область — Кузбасс",
  "Ненецкий АО": "Ненецкий автономный округ",
  "Республика Северная Осетия - Алания": "Республика Северная Осетия — Алания",
  "Республика Удмуртская": "Удмуртская Республика",
  "Ханты-Мансийский Автономный округ - Югра АО": "Ханты-Мансийский автономный округ — Югра",
  "Республика Чеченская": "Чеченская Республика",
  "Чукотский АО": "Чукотский автономный округ",
  "Республика Саха /Якутия/": "Республика Саха (Якутия)",
  "Ямало-Ненецкий АО": "Ямало-Ненецкий автономный округ",
};
const regName = (r) => {
  const n = r.region, t = r.region_type;
  const raw = t === "обл" ? `${n} область` : t === "край" ? `${n} край` : t === "Респ" ? `Республика ${n}` : t === "Аобл" ? `${n} автономная область` : t === "АО" ? `${n} АО` : n;
  return FIX[raw] ?? raw;
};
const regions = [];
const ri = new Map();
const cities = rows.map((r) => {
  const rn = regName(r);
  if (!ri.has(rn)) { ri.set(rn, regions.length); regions.push(rn); }
  const name = r.address.split(",").pop().trim().replace(/^(г|пгт|рп|п|с)\s+/, "");
  const utc = Number((r.timezone || "UTC+3").replace("UTC", ""));
  return [name, ri.get(rn), +(+r.geo_lat).toFixed(4), +(+r.geo_lon).toFixed(4), +r.population || 0, utc, r.capital_marker === "2" || r.region_type === "г" ? 1 : 0];
});
cities.sort((a, b) => b[4] - a[4]);
fs.writeFileSync(out, JSON.stringify({ regions, cities }));
console.log(`городов ${cities.length}, регионов ${regions.length}`);
