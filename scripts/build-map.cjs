// Пересборка lib/geo/ru-map.json (контуры «Карты городов»).
// Данные: Natural Earth 50m (общественное достояние), github.com/nvkelso/natural-earth-vector/geojson:
//   ne_50m_land.geojson, ne_50m_admin_1_states_provinces.geojson
// Запуск: node scripts/build-map.cjs <ne_50m_land.geojson> <ne_50m_admin_1…geojson> lib/geo/ru-cities.json lib/geo/ru-map.json
const fs = require("fs");
const [, , landF, admF, citiesJson, out] = process.argv;
const RAD = Math.PI / 180, P1 = 52 * RAD, P2 = 64 * RAD, L0 = 100 * RAD;
const N = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(Math.tan(Math.PI / 4 + P2 / 2) / Math.tan(Math.PI / 4 + P1 / 2));
const F = (Math.cos(P1) * Math.tan(Math.PI / 4 + P1 / 2) ** N) / N;
const RHO0 = F / Math.tan(Math.PI / 4 + (60 * RAD) / 2) ** N;
const K = 6371;
const proj = ([lon, lat]) => { const rho = F / Math.tan(Math.PI / 4 + (lat * RAD) / 2) ** N; const th = N * (lon * RAD - L0); return [K * rho * Math.sin(th), -K * (RHO0 - rho * Math.cos(th))]; };

const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
const shift = (ring) => (Math.max(...ring.map((p) => p[0])) < -100 ? ring.map(([x, y]) => [x + 360, y]) : ring);

// Сазерленд — Ходжмен по прямоугольнику долгота/широта
function clip(ring, x0, y0, x1, y1) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]]];
  let pts = ring;
  for (const [inside, cut] of edges) {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) res.push(a);
      if (ia !== ib) res.push(cut(a, b));
    }
    pts = res;
    if (!pts.length) break;
  }
  return pts;
}
function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// кольцо замкнуто: режем его на две дуги в самой дальней от начала точке
function dpRing(r, tol) {
  const pts = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
  if (pts.length < 4) return pts;
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
  const a = dp(pts.slice(0, far + 1), tol), b = dp([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return s / 2; };
function path(rings) {
  let d = "";
  for (const r of rings) {
    let [px, py] = [Math.round(r[0][0]), Math.round(r[0][1])];
    d += `M${px} ${py}`;
    let seg = "";
    for (let i = 1; i < r.length; i++) {
      const x = Math.round(r[i][0]), y = Math.round(r[i][1]);
      const dx = x - px, dy = y - py; if (!dx && !dy) continue;
      seg += `${seg && dx >= 0 ? " " : ""}${dx}${dy >= 0 ? " " : ""}${dy}`; px = x; py = y;
    }
    d += `l${seg}z`;
  }
  return d;
}
const prep = (ring, tol, minArea) => {
  const c = clip(shift(ring), 5, 30, 200, 85); if (c.length < 3) return null;
  const p = dpRing(c.map(proj), tol); if (p.length < 3 || Math.abs(area(p)) < minArea) return null; return p;
};

// суша
const land = JSON.parse(fs.readFileSync(landF, "utf8"));
const landRings = [];
for (const f of land.features) for (const poly of polysOf(f.geometry)) { const p = prep(poly[0], 2.5, 250); if (p) landRings.push(p); }

// регионы России: имя — из справочника городов (по центру региона внутри контура)
const cities = JSON.parse(fs.readFileSync(citiesJson, "utf8"));
const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const adm = JSON.parse(fs.readFileSync(admF, "utf8")).features.filter((f) => f.properties.admin === "Russia");
const regions = [];
for (const f of adm) {
  const polys = polysOf(f.geometry).map((poly) => poly.map(shift));
  const projPolys = polys.map((poly) => poly.map((r) => r.map(proj)));
  const inside = (pt) => projPolys.some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));
  // центр региона из справочника, иначе — самый крупный город внутри
  let name = null;
  const inCities = cities.cities.filter((c) => inside(proj([c[3], c[2]])));
  const cap = inCities.find((c) => c[6] === 1) ?? inCities[0];
  if (cap) name = cities.regions[cap[1]];
  if (!name) { const n0 = f.properties.name_ru.toLowerCase(); name = cities.regions.find((r) => r.toLowerCase().includes(n0)) ?? null; }
  const rings = [];
  for (const poly of polys) for (const r of [poly[0]]) { const p = dpRing(r.map(proj), 1.6); if (p.length >= 3 && Math.abs(area(p)) > 30) rings.push(p); }
  if (!rings.length) for (const poly of polys) rings.push(poly[0].map(proj));
  // точка подписи — центр тяжести крупнейшего кольца
  const big = rings.reduce((a, r) => (Math.abs(area(r)) > Math.abs(area(a)) ? r : a), rings[0]);
  let cx = 0, cy = 0, A = 0; for (let i = 0; i < big.length; i++) { const [x1, y1] = big[i], [x2, y2] = big[(i + 1) % big.length]; const k = x1 * y2 - x2 * y1; A += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k; }
  A /= 2; cx /= 6 * A; cy /= 6 * A;
  regions.push({ n: name ?? f.properties.name_ru, iso: f.properties.iso_3166_2, d: path(rings), x: Math.round(cx), y: Math.round(cy), a: Math.round(Math.abs(rings.reduce((s, r) => s + area(r), 0))) });
}
const dup = regions.map((r) => r.n).filter((n, i, a) => a.indexOf(n) !== i);
const missing = cities.regions.filter((n) => !regions.some((r) => r.n === n));
console.error("regions", regions.length, "dup", dup, "missing", missing, "unnamed", regions.filter((r) => !cities.regions.includes(r.n)).map((r) => r.n + " " + r.iso));
const res = { land: path(landRings), regions };
fs.writeFileSync(out, JSON.stringify(res));
console.error("land rings", landRings.length, "bytes", JSON.stringify(res).length, "land", res.land.length);
