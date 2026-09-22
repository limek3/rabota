// Отдача статического экспорта (next.config.mjs → output: "export") для Railway.
//
// Без зависимостей намеренно. `next start` с output:"export" не работает вообще,
// а тянуть ради раздачи файлов отдельный пакет значит держать package-lock.json
// в синхроне ради одной команды — лишний повод упасть на деплое. Здесь только
// node:*, поэтому сервер поднимется на любом образе, где вообще есть node.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** out/ рядом с этим файлом, а не относительно cwd: Railway запускает откуда угодно. */
const ROOT = resolve(fileURLToPath(new URL("./out", import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function fileAt(p) {
  try {
    return (await stat(p)).isFile() ? p : null;
  } catch {
    return null;
  }
}

/**
 * URL → файл внутри out/. null, если файла нет или путь вылез за пределы out/.
 *
 * Проверка на выход из ROOT обязательна: без неё GET /../../.env.local отдал бы
 * ключи Supabase. normalize() схлопывает "..", но полагаться только на него
 * нельзя — сравниваем уже собранный абсолютный путь.
 */
async function resolveFile(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null; // битый percent-encoding
  }
  if (rel.includes("\0")) return null;

  const target = resolve(join(ROOT, normalize(rel)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;

  // trailingSlash: true → /crm/ лежит как out/crm/index.html.
  // Порядок: точный файл → index.html в папке → тот же путь с .html.
  return (await fileAt(target)) ?? (await fileAt(join(target, "index.html"))) ?? (await fileAt(`${target}.html`));
}

function send(res, status, file, immutable) {
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(status, {
    "content-type": type,
    // /_next/static/* содержит хэш в имени — его можно кэшировать навсегда.
    // HTML кэшировать нельзя: иначе тестеры будут неделю сидеть на старой сборке.
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end("Method Not Allowed");
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400).end("Bad Request");
    return;
  }

  const file = await resolveFile(pathname);
  if (file) {
    send(res, 200, file, pathname.startsWith("/_next/static/"));
    return;
  }

  const notFound = await fileAt(join(ROOT, "404.html"));
  if (notFound) send(res, 404, notFound, false);
  else res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`serving ${ROOT} on :${PORT}`);
});
