// Проверка навигации: каждый пункт меню (lib/crm/nav.ts) и каждая внутренняя
// ссылка/переход в коде (href="/…", router.push("/…"), go("/…")) должны вести на
// существующую страницу app/**/page.tsx. Запуск: npm run check:routes
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// существующие маршруты: app/(группа)/путь/page.tsx → /путь
const routes = new Set();
for (const f of walk(join(root, "app"))) {
  if (!f.endsWith(`${sep}page.tsx`)) continue;
  const rel = relative(join(root, "app"), f).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  routes.add("/" + rel.join("/"));
}

const problems = [];
const nav = readFileSync(join(root, "lib/crm/nav.ts"), "utf8");
const navHrefs = [...nav.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
if (!navHrefs.length) problems.push("lib/crm/nav.ts: не найдено ни одного пункта меню");
for (const h of navHrefs) if (!routes.has(h)) problems.push(`Меню: «${h}» — нет страницы app/(crm)${h}/page.tsx`);

const linkRe = /(?:href=\{?[`"]|router\.(?:push|replace)\([`"]|go\([`"])(\/[a-z0-9\-/]*)/gi;
for (const f of [...walk(join(root, "app")), ...walk(join(root, "components")), ...walk(join(root, "lib"))]) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(linkRe)) {
    const path = m[1].replace(/\/$/, "") || "/";
    if (!routes.has(path)) problems.push(`${relative(root, f)}: ссылка на «${path}» — страницы нет`);
  }
}

console.log(`Страниц: ${routes.size} · пунктов меню: ${navHrefs.length}`);
console.log([...routes].sort().join("  "));
if (problems.length) {
  console.error("\nПРОБЛЕМЫ:\n" + problems.map((p) => " - " + p).join("\n"));
  process.exit(1);
}
console.log("OK: все пункты меню и внутренние ссылки ведут на существующие страницы");
