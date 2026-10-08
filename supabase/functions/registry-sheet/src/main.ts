// ============================================================================
// Edge Function: registry-sheet — реестры выплат YouDo в таблицы бухгалтера.
// ----------------------------------------------------------------------------
// ИСХОДНИК. В Supabase вставляется собранный файл ../index.ts: npm run build:registry-fn
// (scripts/build-registry-fn.mjs — тот же расчёт зарплаты, что в CRM, одним файлом).
//
// Три режима (POST):
//   { rows, project, kind, tab, periodTo, from, to, replace? }
//       — вручную из CRM («Зарплата → По периодам → Реестр YouDo»): лист как прислали. Только РОП.
//   {} с заголовком x-cron-secret — каждый день в 10:00 МСК (pg_cron,
//       supabase/migrations/20261008000003_registry_cron.sql): по графику выплат сам создаёт
//       «План» за 2 дня до периода и «Факт» в день реестра (lib/crm/registryAuto.ts), пишет в Telegram.
//       Выключено в настройках CRM — ничего не делает.
//   { auto: true, dry?: true } — то же из CRM руками (РОП): dry — только показать, что будет сделано.
//   { auto: true, test: true } — тестовый прогон сейчас (РОП или cron-секрет): «ТЕСТ План» на следующий
//       период и «ТЕСТ Факт» на текущий, в Telegram с пометкой; отправленным не отмечается.
//
// Лист пишет веб-приложение Apps Script (lib/crm/registry.ts → REGISTRY_SCRIPT): ФИО и ИНН —
// из реестра исполнителей, порядок — как в плане. ИНН через функцию не ходят.
// Что уже отправлено автоматом — kv «registryAuto» (done), повторно тот же лист не шлётся.
//
// Секреты (Edge Functions → Secrets): CRON_SECRET — тот же, что у shift-hours и leads-sheet;
// TELEGRAM_BOT_TOKEN — токен бота Vexi; TELEGRAM_CHAT_ID — ваш Telegram ID (несколько — через запятую).
// Без Telegram-секретов автомат работает, итог — в журнале CRM.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DataState } from "../../../../lib/crm/types";
import { emptyState, normalizeSettings } from "../../../../lib/crm/defaults";
import { TABLES, fromRow, type Table } from "../../../../lib/crm/rowspec";
import { buildIndex, freezePastMonths } from "../../../../lib/crm/calc";
import { appStamp } from "../../../../lib/crm/dates";
import { TEST_PREFIX, autoJobs, autoMessage, testJobs, type AutoResult } from "../../../../lib/crm/registryAuto";
import type { RegistryReply } from "../../../../lib/crm/registry";

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

type Cfg = { url?: string; token?: string };
type Row = { name: string; net: number; sum: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const isDm = (v: unknown): v is string => typeof v === "string" && /^\d{2}\.\d{2}$/.test(v);
const isRuDate = (v: unknown): v is string => typeof v === "string" && /^\d{2}\.\d{2}\.\d{4}$/.test(v);
// для расчёта зарплаты: остальные таблицы (обучение, журнал, аккаунты…) не нужны
const NEED: Table[] = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "approves"];
const LOG_KEEP = 100;

/**
 * POST в веб-приложение Apps Script. Google выполняет doPost и отвечает переадресацией на страницу
 * с результатом — идём за ней сами. Страница не открылась — скрипт уже отработал: без подтверждения.
 */
async function push(cfg: Cfg, body: Record<string, unknown>): Promise<RegistryReply> {
  const first = await fetch(cfg.url!, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: cfg.token, ...body }),
    redirect: "manual",
  });
  const moved = first.status >= 300 && first.status < 400;
  let res = first;
  if (moved) {
    const loc = first.headers.get("location");
    await first.body?.cancel();
    if (!loc) return { ok: true, unconfirmed: true };
    res = await fetch(loc);
  }
  const text = await res.text();
  let reply: RegistryReply;
  try {
    reply = JSON.parse(text);
  } catch {
    if (moved) return { ok: true, unconfirmed: true };
    throw new Error(`Скрипт реестров ответил не JSON (HTTP ${res.status}) — проверьте ссылку /exec, развёртывание и доступ «Все»`);
  }
  if (reply.ok !== true) throw new Error(reply.error || "скрипт вернул ошибку");
  return reply;
}

/** База целиком (нужные таблицы) — как loadAll в CRM, только сервисным ключом. */
async function loadState(admin: Db): Promise<{ st: DataState; kv: (k: string) => unknown }> {
  const fetchAll = async (table: string) => {
    const out: Record<string, unknown>[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin.from(table).select("*").range(off, off + 999);
      if (error) {
        // таблицы ещё нет (не выполнена миграция) — без неё
        if (/does not exist|schema cache/i.test(error.message)) return out;
        throw new Error(`${table}: ${error.message}`);
      }
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [kvRows, ...rows] = await Promise.all([fetchAll("kv"), ...NEED.map(fetchAll)]);
  const st = emptyState();
  NEED.forEach((t, i) => {
    if (!TABLES.includes(t)) return;
    (st as unknown as Record<string, unknown[]>)[t] = rows[i].map((r) => fromRow(t, r));
  });
  const kv = (k: string) => kvRows.find((r) => r.key === k)?.value as unknown;
  const sheets = kv("sheets") as DataState["settings"]["sheets"] | undefined;
  st.settings = normalizeSettings({ ...((kv("settings") ?? {}) as object), ...(sheets ? { sheets } : {}) });
  st.frozenMonths = ((kv("frozenMonths") as string[] | undefined) ?? []).filter((m) => typeof m === "string");
  // как при загрузке CRM: лиды без статуса — «в работе», прошедшие месяцы зафиксированы (в памяти)
  st.leads = st.leads.map((l) => (l.status ? l : { ...l, status: "work", statusReason: l.statusReason ?? "" }));
  return { st, kv };
}

async function telegram(text: string): Promise<string | null> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chats = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!token || !chats.length || !text) return token && chats.length ? null : "Telegram не настроен (секреты TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)";
  for (const chat_id of chats) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return `Telegram: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
  }
  return null;
}

async function audit(admin: Db, who: string, summary: string) {
  await admin.from("audit").insert({
    id: `au-rg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    account_id: "",
    account_name: `${who} · YouDo`,
    entity: "payroll",
    entity_id: "registry",
    summary,
  });
}

/** Ручная отправка листа из CRM. */
async function manual(admin: Db, cfg: Cfg, who: string, b: Record<string, unknown>): Promise<Response> {
  if (b.project !== "okc" && b.project !== "sv") return json({ error: "Проект — okc или sv" }, 400);
  if (b.kind !== "plan" && b.kind !== "fact") return json({ error: "Вид — plan или fact" }, 400);
  if (typeof b.tab !== "string" || !b.tab.trim() || b.tab.length > 90) return json({ error: "Нет названия листа" }, 400);
  if (!isDm(b.periodTo) || !isRuDate(b.from) || !isRuDate(b.to)) return json({ error: "Даты периода — дд.мм и дд.мм.гггг" }, 400);
  const rows: Row[] = (Array.isArray(b.rows) ? (b.rows as Row[]) : [])
    .filter((r) => r && typeof r.name === "string" && r.name.trim() && Number.isFinite(r.net) && Number.isFinite(r.sum) && r.net >= 0 && r.sum >= 0)
    .slice(0, 500)
    .map((r) => ({ name: r.name.trim().slice(0, 120), net: Math.round(r.net), sum: Math.round(r.sum) }));
  if (!rows.length) return json({ error: "В реестре нет ни одной строки" }, 400);
  const tab = b.tab.trim();
  let reply: RegistryReply;
  try {
    reply = await push(cfg, { project: b.project, kind: b.kind, tab, periodTo: b.periodTo, from: b.from, to: b.to, rows, replace: b.replace === true });
  } catch (e) {
    return json({ error: `«${tab}»: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
  if (!reply.exists) {
    const total = rows.reduce((a, r) => a + r.sum, 0);
    await audit(admin, who, `Реестр YouDo «${tab}»${reply.unconfirmed ? " (без подтверждения)" : reply.created ? " создан" : " перезаписан"}: ${rows.length} чел., ${total.toLocaleString("ru-RU")} ₽ с налогом`);
  }
  return json(reply);
}

/** Автомат: что пора — отправить, отметить, сообщить. */
async function auto(admin: Db, who: string, opts: { cron: boolean; dry: boolean; test: boolean }): Promise<Response> {
  const { st, kv } = await loadState(admin);
  const cfg = st.settings.sheets.registry;
  if (opts.cron && !opts.test && !cfg.auto) return json({ skipped: "Автомат реестров выключен в настройках CRM" });

  const stamp = appStamp();
  const today = stamp.slice(0, 10);
  const hour = Number(stamp.slice(11, 13));
  const fz = freezePastMonths(st, buildIndex(st), today);
  st.plans = [...st.plans, ...fz.plans];
  st.frozenMonths = [...st.frozenMonths, ...fz.months];

  const store = (kv("registryAuto") ?? {}) as { done?: Record<string, string>; log?: unknown[] };
  const done = { ...(store.done ?? {}) };
  const plan = opts.test ? testJobs(st, today, hour) : autoJobs(st, today, hour, done);

  if (opts.dry)
    return json({
      today,
      configured: !!cfg.url && !!cfg.token,
      auto: cfg.auto,
      jobs: plan.jobs.map((j) => ({ kind: j.kind, project: j.project, tab: j.payload?.tab ?? null, rows: j.payload?.rows.length ?? 0, sum: j.payload?.rows.reduce((a, r) => a + r.sum, 0) ?? 0, skip: j.skip ?? null })),
      notSmz: plan.notSmz,
    });

  if (!plan.jobs.length && !plan.notSmz.length) return json({ today, jobs: 0, note: "Сегодня по графику реестров нет" });
  if (!cfg.url || !cfg.token) {
    const tg = await telegram("<b>Реестры YouDo</b>\n❌ Пора отправлять реестр, но скрипт не подключён (CRM → Настройки → Данные → «Реестры выплат YouDo»)");
    return json({ error: "Реестры не настроены", telegram: tg }, 400);
  }

  const results: AutoResult[] = [];
  const now = new Date().toISOString();
  for (const job of plan.jobs) {
    if (!job.payload) {
      results.push({ job });
      continue;
    }
    try {
      // тест — перезаписываем свой «ТЕСТ …» лист, если прогоняли раньше
      let reply = await push(cfg, { ...job.payload, replace: opts.test });
      // «готовым» скрипт счёл тестовый лист — это не настоящий реестр, создаём свой
      if (reply.exists && reply.tab && reply.tab !== job.payload.tab && reply.tab.toUpperCase().startsWith(TEST_PREFIX.trim())) reply = await push(cfg, { ...job.payload, replace: true });
      results.push({ job, reply });
      // отправлено или лист уже был — второй раз не шлём; ошибка — повторим в следующий запуск
      if (!opts.test) done[job.key] = now;
    } catch (e) {
      results.push({ job, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const text = autoMessage(plan, results, opts.test);
  const tg = await telegram(text);
  const log = [{ at: now, by: who, today, test: opts.test, text: text.replace(/<[^>]+>/g, ""), telegram: tg }, ...(store.log ?? [])].slice(0, LOG_KEEP);
  await admin.from("kv").upsert([{ key: "registryAuto", value: { done, log }, updated_at: now }], { onConflict: "key" });
  for (const r of results) {
    if (!r.reply || r.reply.exists || !r.job.payload) continue;
    const p = r.job.payload;
    await audit(admin, who, `Реестр YouDo «${p.tab}» — ${opts.test ? "тестовый прогон" : "автомат"}${r.reply.unconfirmed ? " (без подтверждения)" : ""}: ${p.rows.length} чел., ${p.rows.reduce((a, x) => a + x.sum, 0).toLocaleString("ru-RU")} ₽ с налогом`);
  }
  return json({ today, results: results.map((r) => ({ tab: r.job.payload?.tab, kind: r.job.kind, project: r.job.project, skip: r.job.skip, error: r.error, reply: r.reply })), notSmz: plan.notSmz, telegram: tg });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    // кто зовёт: расписание (секрет) или руководитель отдела из CRM
    const cron = Deno.env.get("CRON_SECRET");
    const byCron = !!cron && req.headers.get("x-cron-secret") === cron;
    let who = "Автомат";
    if (!byCron) {
      const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: isHead, error } = await asCaller.rpc("crm_is_head");
      if (error) return json({ error: error.message }, 401);
      if (isHead !== true) return json({ error: "Реестры может отправлять только руководитель отдела" }, 403);
      const { data: u } = await asCaller.auth.getUser();
      who = `${u.user?.user_metadata?.name || u.user?.email || "РОП"}`;
    }

    const admin = createClient(url, service, { auth: { persistSession: false } });
    if (byCron || b.auto === true) return await auto(admin, who, { cron: byCron, dry: !byCron && b.dry === true && b.test !== true, test: b.test === true });

    const { data: kvRow, error: kErr } = await admin.from("kv").select("value").eq("key", "sheets").maybeSingle();
    if (kErr) return json({ error: kErr.message }, 500);
    const cfg: Cfg = ((kvRow?.value ?? {}) as { registry?: Cfg }).registry ?? {};
    if (!cfg.url || !cfg.token) return json({ error: "Реестры не настроены (Настройки → Данные → «Реестры выплат YouDo»)" }, 400);
    return await manual(admin, cfg, who, b);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
