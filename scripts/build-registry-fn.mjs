// Сборка Edge Function registry-sheet в один файл: supabase/functions/registry-sheet/src/main.ts
// + расчёт зарплаты из lib/crm → supabase/functions/registry-sheet/index.ts (его и вставляют в
// Supabase → Edge Functions → registry-sheet). Запуск: npm run build:registry-fn
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "supabase/functions/registry-sheet/src/main.ts")],
  outfile: path.join(root, "supabase/functions/registry-sheet/index.ts"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // supabase-js — с esm.sh, его грузит Deno
  external: ["https://*"],
  alias: { "@": root },
  // часовой пояс платформы — по умолчанию Москва (lib/crm/dates.ts)
  define: { "process.env.NEXT_PUBLIC_APP_TIMEZONE": "undefined" },
  legalComments: "none",
  charset: "utf8",
  banner: {
    js: [
      "// @ts-nocheck",
      "// СОБРАНО scripts/build-registry-fn.mjs — не правьте руками: исходник src/main.ts и lib/crm/*.",
      "// Supabase → Edge Functions → registry-sheet → вставить этот файл целиком → Deploy.",
    ].join("\n"),
  },
  logLevel: "info",
});

// Скрипт Google — копией в docs/registry-google-script.gs (удобно открыть и скопировать целиком)
import fs from "node:fs";
const src = fs.readFileSync(path.join(root, "lib/crm/registryScript.ts"), "utf8");
const gs = src.match(/REGISTRY_SCRIPT = String\.raw`([\s\S]*?)`;/);
if (!gs) throw new Error("REGISTRY_SCRIPT не найден в lib/crm/registryScript.ts");
fs.writeFileSync(path.join(root, "docs/registry-google-script.gs"), gs[1]);
console.log("  docs/registry-google-script.gs");
