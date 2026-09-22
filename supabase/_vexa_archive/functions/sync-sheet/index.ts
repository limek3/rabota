// ============================================================================
// Edge Function: sync-sheet
// ----------------------------------------------------------------------------
// База контактов воркспейса ↔ его лист в Google Sheets. В обе стороны: сперва
// забираем правки из листа в базу (pullEdits), затем перезаписываем лист
// свежими данными. Обратно едет только набор редактируемых колонок (EDIT_COLS),
// сверяясь со снимком прошлой выгрузки (crm_sheets.last_snapshot).
//
// Зачем сервер. Приложение собрано статикой (next.config.mjs, output:"export"):
// сервера нет, Electron раздаёт ./out. Ключ сервисного аккаунта в браузере
// означал бы, что его скачал каждый пользователь, — а Sheets API и так не
// пустит service account из браузера по CORS.
//
// Таблица у каждого воркспейса своя (crm_sheets.url), робот один на всех.
// Владелец таблицы обязан выдать роботному email доступ «Редактор» — иначе
// Google вернёт 403, и это осядет в crm_sheets.last_error.
//
// Режимы вызова:
//   {"all":true}                        — из расписания, service_role. Все воркспейсы
//                                         с подключённой таблицей и включённым автосинком.
//   {"workspaceId":"<uuid>"}            — выгрузка сейчас, из интерфейса, с JWT
//                                         пользователя. Проверяем, что зовущий —
//                                         руководитель этого воркспейса.
//   {"action":"info"}                   — email робота, чтобы интерфейс мог его
//                                         показать: без него человек не знает,
//                                         кому открывать доступ к своей таблице.
//
// Таблицу робот не создаёт и создать не может: у сервисного аккаунта вне Google
// Workspace нет собственной квоты Диска, и Drive отвечает «The user's Drive
// storage quota has been exceeded» на любой файл. Владелец таблицы — человек,
// робот только пишет в неё по выданному доступу.
//
// Деплой:
//   supabase functions deploy sync-sheet
//   supabase secrets set GOOGLE_SERVICE_ACCOUNT='<весь JSON-ключ одной строкой>'
// Расписание: см. хвост миграции 20260722000008_sheets_sync.sql.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ── доступ к Google ───────────────────────────────────────────────────── */

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * PEM (`-----BEGIN PRIVATE KEY-----`) → DER, как того хочет importKey.
 *
 * Отдаём именно ArrayBuffer, а не Uint8Array: importKey принимает BufferSource,
 * и вид с возможным SharedArrayBuffer под ним туда не подходит.
 *
 * В JSON-ключе от Google переводы строк записаны как «\n», и если ключ клали в
 * секрет через оболочку, они могли остаться двумя символами. Разворачиваем
 * обратно — иначе base64 не разберётся.
 */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/**
 * Токен доступа по сервисному аккаунту.
 *
 * Google принимает самоподписанный JWT и меняет его на access token. Подписываем
 * через WebCrypto: тянуть ради одной подписи RS256 стороннюю библиотеку в Deno
 * незачем.
 */
// Только Sheets: робот пишет в таблицы, которые ему открыли, и ничего больше.
// Скоупы Drive не просим — файлов он не заводит и не удаляет.
const SCOPES = "https://www.googleapis.com/auth/spreadsheets";

async function googleToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    enc.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: SCOPES,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const unsigned = `${head}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const assertion = `${unsigned}.${b64url(sig)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body?.access_token) throw new Error(`google auth: ${body?.error_description ?? body?.error ?? r.status}`);
  return body.access_token as string;
}

async function gapi(token: string, url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? `sheets: http ${r.status}`);
  return body;
}

/* ── данные ───────────────────────────────────────────────────────────── */

const HEADERS = [
  "ID", "Имя", "Позиция", "Статус", "Рекрутёр", "Телефон", "Почта", "Telegram",
  "Вакансия", "Зарплата", "Опыт", "Гео", "Навыки", "Источник", "Метки",
  "Хэштеги", "Создан", "Обновлён", "Дней в статусе",
];

const STATUS_RU: Record<string, string> = {
  response: "Отклик", working: "В работе", office: "В офис", employed: "Устроен",
  adapt: "Адапт", paid: "Оплачен", referral: "Есть знакомый", reserve: "Резерв", minus: "Минус",
};

const day = (iso: string | null) => (iso ? String(iso).slice(0, 10) : "");

/** Строки листа: заголовок + по строке на контакт. */
function buildRows(
  cands: Record<string, unknown>[],
  names: Map<string, string>,
  jobs: Map<string, string>
): string[][] {
  const now = Date.now();
  const rows = cands.map((c) => {
    const statusAt = c.status_at ?? c.stage_at ?? c.created_at;
    const days = statusAt ? Math.floor((now - new Date(String(statusAt)).getTime()) / 86_400_000) : "";
    return [
      String(c.id ?? ""),
      String(c.name ?? ""),
      String(c.position ?? ""),
      STATUS_RU[String(c.status ?? "")] ?? "",
      names.get(String(c.assignee ?? "")) ?? "",
      String(c.phone ?? ""),
      String(c.email ?? ""),
      String(c.tg ?? ""),
      jobs.get(String(c.job_id ?? "")) ?? "",
      String(c.salary ?? ""),
      String(c.exp ?? ""),
      String(c.location ?? ""),
      (c.skills as string[] | null)?.join(", ") ?? "",
      String(c.source ?? ""),
      (c.labels as string[] | null)?.join(", ") ?? "",
      (c.tags as string[] | null)?.join(", ") ?? "",
      day(c.created_at as string | null),
      day(c.updated_at as string | null),
      String(days),
    ];
  });
  return [HEADERS, ...rows];
}

/** ID таблицы из любой формы ссылки: с /edit, с #gid, с ?usp=sharing. */
export function sheetIdFromUrl(url: string): string {
  return url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? "";
}

/* ── оформление листа ─────────────────────────────────────────────────── */

/** #rrggbb → доли, как их ждёт Sheets API. */
function rgb(hex: string) {
  return {
    red: parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/**
 * Цвета статусов — те же, что у бейджей в CRM (светлая тема, lib/crmData.ts
 * statusDefs + globals.css). Ключ — подпись в ячейке: по ней же работают и
 * выпадающий список, и правила заливки.
 */
const STATUS_COLORS: [string, string, string][] = [
  ["Отклик", "#6f6e69", "#f1f1ef"],
  ["В работе", "#2f749b", "#e9f3f8"],
  ["В офис", "#ad1a72", "#faf1f5"],
  ["Устроен", "#0f796a", "#e4efec"],
  ["Адапт", "#6940a5", "#f4f0fa"],
  ["Оплачен", "#3f7a5a", "#eef3ed"],
  ["Есть знакомый", "#93671b", "#fbf3db"],
  ["Резерв", "#3f51a3", "#eceff9"],
  ["Минус", "#c0403a", "#fdebec"],
];

const COL = { id: 0, status: 3, created: 16, updated: 17, days: 18 } as const;

/**
 * Привести лист в человеческий вид: шапка, фильтры, выпадающий список статусов
 * с цветами CRM, скрытый ID.
 *
 * Гоняем на каждой выгрузке, а не один раз при подключении: значения мы
 * перезаписываем, а оформление живёт отдельно — и если его сбили руками или
 * лист пересоздали, следующий синк всё вернёт.
 *
 * `rules` — сколько правил заливки уже висит на листе. Их снимаем перед тем как
 * поставить свои: иначе за неделю синков лист накопит сотню одинаковых.
 */
async function decorate(token: string, id: string, gid: number, rows: number, rules: number) {
  const last = Math.max(rows, 2);
  const statusRange = { sheetId: gid, startRowIndex: 1, startColumnIndex: COL.status, endColumnIndex: COL.status + 1 };

  const requests: Record<string, unknown>[] = [];

  // Снимаем прошлые правила с конца: индексы после каждого удаления съезжают.
  for (let i = rules - 1; i >= 0; i--) requests.push({ deleteConditionalFormatRule: { sheetId: gid, index: i } });

  requests.push(
    // Шапка на месте при прокрутке, и вместе с ней имя: без закреплённой
    // колонки на «Навыках» уже не понять, чья это строка.
    {
      updateSheetProperties: {
        properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } },
        fields: "gridProperties(frozenRowCount,frozenColumnCount)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb("#f1f1ef"),
            textFormat: { bold: true, foregroundColor: rgb("#37352f") },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
      },
    },
    // ID нужен только нам — чтобы сопоставить строку с карточкой. Человеку он
    // мешает, поэтому колонка скрыта, а не удалена.
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: "COLUMNS", startIndex: COL.id, endIndex: COL.id + 1 },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    },
    // Длинные «Навыки» и «Хэштеги» иначе растягивают строку на пол-экрана.
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 1 },
        cell: { userEnteredFormat: { wrapStrategy: "CLIP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 1, startColumnIndex: COL.created, endColumnIndex: COL.days + 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat(horizontalAlignment)",
      },
    },
    // Фильтр по всей шапке — «фильтры везде» из коробки.
    { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: last, startColumnIndex: 0, endColumnIndex: HEADERS.length } } } },
    // Выпадающий список статусов. strict:false — Google предупредит о чужом
    // значении, но не заблокирует: блокировка мешала бы нашей же записи, если
    // в CRM появится новый статус раньше, чем мы обновим этот список.
    {
      setDataValidation: {
        range: statusRange,
        rule: {
          condition: { type: "ONE_OF_LIST", values: STATUS_COLORS.map(([label]) => ({ userEnteredValue: label })) },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId: gid, dimension: "COLUMNS", startIndex: 1, endIndex: HEADERS.length },
      },
    }
  );

  // Цвет статуса правилом, а не заливкой ячейки: поменяли статус в таблице —
  // цвет переехал сам, без ожидания следующего синка.
  for (const [label, fg, bg] of STATUS_COLORS) {
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [statusRange],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: label }] },
            format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg), bold: true } },
          },
        },
      },
    });
  }

  await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

/* ── обратный синк: правки из листа → в базу ──────────────────────────── */

// Колонки, которые человек вправе править в таблице, а мы забираем обратно:
// имя, позиция, статус, телефон, почта, telegram, зарплата, метки (индексы в
// HEADERS). Остальное — только чтение: ID и даты служебные; рекрутёр, вакансия,
// навыки, хэштеги неоднозначно ложатся обратно, поэтому их не трогаем.
const EDIT_COLS = [1, 2, 3, 5, 6, 7, 9, 14] as const;

// Русская подпись статуса → ключ в базе. Инверсия STATUS_RU: в листе «Устроен»,
// в базе "employed".
const KEY_BY_RU: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_RU).map(([k, v]) => [v, k])
);

// Метки — фиксированный набор (lib/types.ts ContactLabel). В лист уходят ключами
// через запятую; обратно принимаем только известные, мусор молча отбрасываем.
const LABEL_KEYS = new Set(["referral", "compliance", "local", "urgent", "medical"]);

function parseLabels(cell: string): string[] {
  const out: string[] = [];
  for (const raw of cell.split(",")) {
    const k = raw.trim().toLowerCase();
    if (LABEL_KEYS.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Снимок редактируемых значений после выгрузки: id → ячейки колонок EDIT_COLS в
 * их порядке.
 *
 * По нему следующий синк отличит правку в листе от правки в приложении: ячейка
 * разошлась со снимком — значит её тронул человек в таблице, забираем в базу;
 * совпала — значение приедет из приложения на прямой выгрузке.
 */
function buildSnapshot(rows: string[][]): Record<string, string[]> {
  const snap: Record<string, string[]> = {};
  for (let r = 1; r < rows.length; r++) {
    const id = rows[r][0];
    if (id) snap[id] = EDIT_COLS.map((c) => rows[r][c] ?? "");
  }
  return snap;
}

/** Прочитать лист целиком (колонки A–S). Пустые хвостовые ячейки Google опускает. */
async function readValues(token: string, id: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${tab}'!A:S`);
  const body = await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`);
  return (body.values ?? []) as string[][];
}

/**
 * Забрать правки из листа в базу.
 *
 * Каждую редактируемую ячейку сверяем со снимком прошлой выгрузки (base).
 * Разошлась — значит её поменяли в таблице: пишем в базу (для этих полей лист
 * главнее). Совпала — не трогаем, значение приедет из приложения на выгрузке.
 *
 * Только по ID: добавленные строки (без ID) и удалённые строки игнорируем —
 * таблица не создаёт и не удаляет контакты. Возвращает число тронутых контактов.
 */
async function pullEdits(
  admin: SupabaseClient,
  ws: string,
  values: string[][],
  snapshot: Record<string, string[]>
): Promise<number> {
  let touched = 0;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const id = (row[0] ?? "").trim();
    if (!id) continue; // строку добавили в листе — не наша, пропускаем
    const base = snapshot[id];
    if (!base) continue; // строки нет в снимке — тоже мимо

    const patch: Record<string, unknown> = {};
    EDIT_COLS.forEach((col, k) => {
      const cell = (row[col] ?? "").trim();
      if (cell === (base[k] ?? "").trim()) return; // в листе не меняли — оставляем приложению
      switch (col) {
        case 1: if (cell) patch.name = cell; break; // имя не обнуляем — по нему опознают строку
        case 2: patch.position = cell; break;
        case 3:
          if (!cell) patch.status = null; // очистили ячейку → «без статуса»
          else if (KEY_BY_RU[cell]) patch.status = KEY_BY_RU[cell]; // неизвестный статус игнорируем
          break;
        case 5: patch.phone = cell || null; break;
        case 6: patch.email = cell || null; break;
        case 7: patch.tg = cell || null; break;
        case 9: patch.salary = cell || null; break;
        case 14: patch.labels = parseLabels(cell); break;
      }
    });

    if (!Object.keys(patch).length) continue;
    const { error } = await admin.from("candidates").update(patch).eq("workspace_id", ws).eq("id", id);
    if (!error) touched++;
    // Ошибку одной строки глотаем: остальные правки и прямая выгрузка должны пройти.
  }
  return touched;
}

/* ── синхронизация одного воркспейса ──────────────────────────────────── */

async function syncOne(admin: SupabaseClient, token: string, ws: string, sheet: Record<string, unknown>) {
  const id = String(sheet.spreadsheet_id || sheetIdFromUrl(String(sheet.url ?? "")));
  if (!id) throw new Error("в ссылке нет id таблицы");
  const tab = String(sheet.tab_name || "Контакты");

  // Метаданные листа: есть ли наша вкладка, её gid и сколько правил заливки уже
  // висит (decorate ниже снимает свои прошлые — для этого нужно знать, сколько).
  type SheetMeta = { properties?: { title?: string; sheetId?: number }; conditionalFormats?: unknown[] };
  const meta = await gapi(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(title,sheetId),conditionalFormats)`
  );
  let mine: SheetMeta | undefined = (meta.sheets ?? []).find((s: SheetMeta) => s.properties?.title === tab);

  // Обратный синк — ДО перезаписи листа, и только когда вкладка уже есть и
  // остался снимок прошлой выгрузки: на первом подключении сверять не с чем.
  let pulled = 0;
  const snapshot = (sheet.last_snapshot ?? {}) as Record<string, string[]>;
  if (mine && Object.keys(snapshot).length) {
    try {
      const values = await readValues(token, id, tab);
      pulled = await pullEdits(admin, ws, values, snapshot);
    } catch {
      /* не прочли/не применили — прямой синк важнее, из-за этого его не роняем */
    }
  }

  // Прямой синк: база (уже с забранными правками) → лист.
  const [{ data: cands, error: cErr }, { data: members }, { data: jobList }] = await Promise.all([
    admin
      .from("candidates")
      .select("id, name, position, status, assignee, phone, email, tg, job_id, salary, exp, location, skills, source, labels, tags, created_at, updated_at, status_at, stage_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: false }),
    admin.from("workspace_members").select("user_id, profiles(display_name, email)").eq("workspace_id", ws),
    admin.from("jobs").select("id, title").eq("workspace_id", ws),
  ]);
  if (cErr) throw new Error(cErr.message);

  const names = new Map<string, string>();
  for (const m of members ?? []) {
    const p = (m as { profiles?: { display_name?: string; email?: string } }).profiles;
    names.set(String((m as { user_id: string }).user_id), p?.display_name || p?.email || "");
  }
  const jobs = new Map<string, string>();
  for (const j of jobList ?? []) jobs.set(String(j.id), String(j.title ?? ""));

  const rows = buildRows((cands ?? []) as Record<string, unknown>[], names, jobs);

  // Вкладки ещё нет (первый синк) — создаём. Иначе Google ответит «Unable to
  // parse range», и человек будет гадать, что не так со ссылкой.
  if (!mine) {
    const made = await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    mine = { properties: made.replies?.[0]?.addSheet?.properties, conditionalFormats: [] };
  }
  const gid = Number(mine?.properties?.sheetId ?? 0);
  const rulesNow = (mine?.conditionalFormats ?? []).length;

  // Сначала пишем новые строки, только потом стираем хвост от прошлой, более
  // длинной выгрузки. Обратный порядок означал бы, что упавший запрос оставляет
  // человека с пустым листом.
  const range = `${encodeURIComponent(`'${tab}'!A1`)}`;
  await gapi(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: rows }) }
  );

  const prev = Number(sheet.last_rows ?? 0);
  if (prev > rows.length) {
    const tail = encodeURIComponent(`'${tab}'!A${rows.length + 1}:Z${prev + 1}`);
    await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tail}:clear`, {
      method: "POST",
      body: "{}",
    });
  }

  // Оформление — последним и мягко: данные уже в листе, и если Google откажет
  // на форматировании, выгрузка всё равно состоялась. Ронять её из-за ширины
  // колонок было бы обидно.
  try {
    await decorate(token, id, gid, rows.length, rulesNow);
  } catch {
    /* значения на месте — с оформлением разберётся следующий синк */
  }

  // Снимок для следующего обратного синка — по строкам, что реально ушли в лист.
  return { rows: rows.length, spreadsheetId: id, pulled, snapshot: buildSnapshot(rows) };
}

/* ── создание таблицы ─────────────────────────────────────────────────── */

// Здесь была функция createSheet: робот заводил таблицу сам и выдавал на неё
// доступ человеку. Убрана — Google отвечает на любой такой файл «The user's
// Drive storage quota has been exceeded». У сервисного аккаунта вне Workspace
// собственной квоты Диска нет вообще, то есть владеть файлами он не может, и
// обойти это настройками нельзя. Таблицу заводит человек, робот в неё пишет.

/* ── вход ─────────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!url || !anon || !service) return json({ error: "supabase env missing" }, 500);
  if (!saRaw) return json({ error: "GOOGLE_SERVICE_ACCOUNT missing" }, 500);

  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(saRaw);
    if (!sa.client_email || !sa.private_key) throw new Error("нет client_email / private_key");
  } catch (e) {
    return json({ error: `GOOGLE_SERVICE_ACCOUNT не разобрался: ${e}` }, 500);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "sync");

  /** Кто зовёт. null — не авторизован. */
  const caller = async () => {
    const asCaller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asCaller.auth.getUser();
    return user;
  };

  /**
   * Вправе ли зовущий распоряжаться таблицей воркспейса.
   *
   * Таблица — общий канал наружу: и адрес, куда уезжает вся база контактов, и
   * запуск выгрузки не должен менять любой участник.
   */
  const managerOf = async (ws: string, userId: string) => {
    const { data: mem } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", ws)
      .eq("user_id", userId)
      .maybeSingle();
    return !!mem && (mem.role === "owner" || mem.role === "lead");
  };

  // Email робота. Не секрет — наоборот, без него человек не знает, кому в своей
  // таблице открывать доступ, а без доступа Google ответит 403.
  if (action === "info") {
    if (!(await caller())) return json({ error: "not authenticated" }, 401);
    return json({ clientEmail: sa.client_email });
  }

  // Какие воркспейсы синхронизируем.
  let targets: string[];
  if (body.all === true) {
    const { data } = await admin.from("crm_sheets").select("workspace_id").eq("connected", true).eq("auto_sync", true);
    targets = (data ?? []).map((r) => String(r.workspace_id));
  } else {
    const ws = String(body.workspaceId ?? "");
    if (!ws) return json({ error: "workspaceId required" }, 400);
    const user = await caller();
    if (!user) return json({ error: "not authenticated" }, 401);
    if (!(await managerOf(ws, user.id))) return json({ error: "forbidden" }, 403);
    targets = [ws];
  }

  if (!targets.length) return json({ ok: true, synced: 0 });

  let token: string;
  try {
    token = await googleToken(sa);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }

  const results: Record<string, unknown>[] = [];
  for (const ws of targets) {
    const { data: sheet } = await admin.from("crm_sheets").select("*").eq("workspace_id", ws).maybeSingle();
    if (!sheet) {
      results.push({ ws, error: "нет строки crm_sheets" });
      continue;
    }
    try {
      const { rows, spreadsheetId, pulled, snapshot } = await syncOne(admin, token, ws, sheet as Record<string, unknown>);
      await admin
        .from("crm_sheets")
        .update({
          connected: true,
          spreadsheet_id: spreadsheetId,
          last_sync_at: new Date().toISOString(),
          last_rows: rows,
          last_error: "",
          last_snapshot: snapshot,
        })
        .eq("workspace_id", ws);
      results.push({ ws, rows, pulled });
    } catch (e) {
      // Ошибку кладём в строку, а не только возвращаем: расписание никто не
      // читает, а «почему не синхронизировалось» спросят через неделю.
      const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
      await admin.from("crm_sheets").update({ last_error: msg }).eq("workspace_id", ws);
      results.push({ ws, error: msg });
    }
  }

  const failed = results.filter((r) => r.error).length;
  return json({ ok: failed === 0, synced: results.length - failed, failed, results }, failed && targets.length === 1 ? 502 : 200);
});
