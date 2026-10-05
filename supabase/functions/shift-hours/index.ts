// ============================================================================
// Edge Function: shift-hours — часы в график из Скорозвона.
// ----------------------------------------------------------------------------
// Каждый день в 21:01 по Москве (pg_cron, supabase/migrations/20261007000001_shift_hours_cron.sql)
// берёт отчёт Скорозвона «Занятость сотрудников» за сегодня и каждому, у кого в графике
// смена (работа или обучение), ставит часы = доступен + гудки + разговор + заполняет карточку.
// Перерывы, «не беспокоить» и офлайн не считаются. Оператор CRM ↔ сотрудник Скорозвона —
// по фамилии (и имени, если фамилия встречается дважды). Не нашёлся или нашлись двое —
// смену не трогаем, а в ответе и в журнале пишем, кого не сопоставили.
// В комментарий смены дописывается строка «Скорозвон: …» с разбивкой по статусам;
// то, что в комментарии написали руками, остаётся.
//
// Деплой: Supabase → Edge Functions → Deploy a new function → Via Editor → имя shift-hours →
// вставить этот файл → Deploy. (CLI: supabase functions deploy shift-hours)
// Секреты (Edge Functions → Secrets): SKOROZVON_USERNAME, SKOROZVON_API_KEY, SKOROZVON_CLIENT_ID,
// SKOROZVON_CLIENT_SECRET — те же, что у lead-dialog; CRON_SECRET — любая длинная строка,
// та же, что в SQL расписания.
//
// Вызов: POST { date?: "YYYY-MM-DD" (по умолчанию — сегодня по Москве), dry?: true (только посчитать) }
//   — расписание: заголовок x-cron-secret;
//   — из CRM: вход руководителя отдела (supabase.functions.invoke("shift-hours", { body })).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const SK = "https://app.skorozvon.ru";
/** Статусы Скорозвона, которые считаются рабочим временем. */
const WORK = { speaking: "разговор", wrapup: "карточка", ringing: "гудки", normal: "доступен" } as const;
type WorkKey = keyof typeof WORK;
const MARK = "Скорозвон:";
const MSK = 3 * 3600_000;

class Fail extends Error {}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Fail(`В Supabase не задан секрет ${name} (Edge Functions → Secrets)`);
  return v;
}

async function skorozvonToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    username: env("SKOROZVON_USERNAME"),
    api_key: env("SKOROZVON_API_KEY"),
    client_id: env("SKOROZVON_CLIENT_ID"),
    client_secret: env("SKOROZVON_CLIENT_SECRET"),
  });
  const r = await fetch(`${SK}/oauth/token`, { method: "POST", body });
  if (!r.ok) throw new Fail(`Скорозвон не пустил по ключам API (HTTP ${r.status}) — проверьте секреты SKOROZVON_*`);
  return (await r.json()).access_token;
}

type EmpRow = { date: string; user_id: number; full_name: string; statuses: Record<string, number> };

/** «Занятость сотрудников» за московские сутки date — все страницы (Скорозвон отдаёт по 10). */
async function employment(date: string): Promise<EmpRow[]> {
  const token = await skorozvonToken();
  const from = Date.parse(`${date}T00:00:00Z`) - MSK;
  const to = Math.min(from + 24 * 3600_000 - 1000, Date.now());
  const ru = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  const out: EmpRow[] = [];
  for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
    let j: { data?: EmpRow[]; total_pages?: number } | null = null;
    for (let k = 0; k < 3 && !j; k++) {
      const r = await fetch(`${SK}/api/reports/managers_employment.json`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ start_time: Math.floor(from / 1000), end_time: Math.floor(to / 1000), length: 100, page }),
      });
      if (r.ok) j = await r.json();
      else if (r.status < 500 && r.status !== 429) throw new Fail(`Скорозвон: отчёт «Занятость сотрудников» — HTTP ${r.status}`);
      else await new Promise((res) => setTimeout(res, 1500));
    }
    if (!j) throw new Error("Скорозвон не отдал отчёт «Занятость сотрудников» — попробуйте позже");
    pages = Number(j.total_pages) || 1;
    for (const row of j.data ?? []) if (row.date === ru) out.push(row);
  }
  return out;
}

/* ── сопоставление по ФИО ──────────────────────────────────────────────── */

/** «Азимова Наима ( 13:00)» → ["азимова", "наима"]. */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-zа-я]+/i)
    .filter((w) => w.length >= 2);

type Op = { id: string; name: string };

/** Сотрудник Скорозвона для оператора CRM: фамилия совпала у одного; у нескольких — ещё и имя. */
function matchOp(op: Op, rows: { w: Set<string>; row: EmpRow }[]): { row?: EmpRow; why?: string } {
  const [surname, first] = words(op.name);
  if (!surname) return { why: "пустое имя" };
  let hit = rows.filter((r) => r.w.has(surname));
  if (hit.length > 1 && first) hit = hit.filter((r) => r.w.has(first));
  if (hit.length === 1) return { row: hit[0].row };
  return { why: hit.length ? `в Скорозвоне ${hit.length} с такой фамилией` : "нет в Скорозвоне" };
}

const hhmm = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

/** Комментарий смены: своя строка «Скорозвон: …» заменяется, написанное руками остаётся. */
function withMark(comment: string, line: string): string {
  const keep = comment
    .split("\n")
    .filter((l) => !l.trim().startsWith(MARK))
    .join("\n")
    .trim();
  return keep ? `${keep}\n${line}` : line;
}

/* ── вход ──────────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));

    // кто зовёт: расписание (секрет) или руководитель отдела из CRM
    const cron = Deno.env.get("CRON_SECRET");
    const byCron = !!cron && req.headers.get("x-cron-secret") === cron;
    let who = "Скорозвон (авто)";
    if (!byCron) {
      const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: isHead, error } = await asCaller.rpc("crm_is_head");
      if (error) return json({ error: error.message }, 401);
      if (isHead !== true) return json({ error: "Подтягивать часы из Скорозвона может только руководитель отдела" }, 403);
      const { data: u } = await asCaller.auth.getUser();
      who = `${u.user?.user_metadata?.name || u.user?.email || "РОП"} · из Скорозвона`;
    }

    const today = new Date(Date.now() + MSK).toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : today;
    if (date > today) return json({ error: "Этот день ещё не наступил" }, 400);
    const dry = body.dry === true;

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const [{ data: shifts, error: sErr }, { data: ops, error: oErr }] = await Promise.all([
      admin.from("shifts").select("id, date, operator_id, hours, type, comment").eq("date", date).in("type", ["work", "training"]),
      admin.from("operators").select("id, name, deleted_at"),
    ]);
    if (sErr || oErr) return json({ error: (sErr ?? oErr)!.message }, 500);
    if (!shifts?.length) return json({ date, updated: [], skipped: [], note: "В графике на этот день нет смен" });

    const rows = (await employment(date)).map((row) => ({ w: new Set(words(row.full_name)), row }));
    const opById = new Map((ops ?? []).filter((o) => !o.deleted_at).map((o) => [o.id as string, o as Op]));

    const updated: { name: string; from: number; to: number; parts: Record<string, number> }[] = [];
    const skipped: { name: string; why: string }[] = [];
    const recs: { id: string; hours: number; comment: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    for (const s of shifts) {
      const op = opById.get(s.operator_id);
      if (!op) continue;
      const m = matchOp(op, rows);
      if (!m.row) {
        skipped.push({ name: op.name, why: m.why ?? "" });
        continue;
      }
      const parts = Object.fromEntries((Object.keys(WORK) as WorkKey[]).map((k) => [k, Math.max(0, Number(m.row!.statuses?.[k]) || 0)]));
      const sec = Object.values(parts).reduce((a, b) => a + b, 0);
      const hours = Math.round((sec / 3600) * 100) / 100;
      const line = `${MARK} ${(Object.keys(WORK) as WorkKey[]).map((k) => `${WORK[k]} ${hhmm(parts[k])}`).join(" · ")}`;
      updated.push({ name: op.name, from: Number(s.hours) || 0, to: hours, parts });
      recs.push({ id: s.id, hours, comment: withMark(String(s.comment ?? ""), line), updated_at: now });
    }

    if (!dry && recs.length) {
      // только часы и комментарий: тип смены, группа и всё остальное не трогаем
      for (const r of recs) {
        const { error } = await admin.from("shifts").update({ hours: r.hours, comment: r.comment, updated_at: r.updated_at }).eq("id", r.id);
        if (error) return json({ error: `Не сохранилась смена ${r.id}: ${error.message}`, updated, skipped }, 500);
      }
      const ru = `${date.slice(8, 10)}.${date.slice(5, 7)}`;
      await admin.from("audit").insert({
        id: `au-sk-${date}-${Date.now().toString(36)}`,
        at: now,
        account_id: "",
        account_name: who,
        entity: "shift",
        entity_id: date,
        summary: `Часы из Скорозвона за ${ru}: ${updated.length} смен${skipped.length ? `, не сопоставлено ${skipped.length}: ${skipped.map((x) => x.name).join(", ")}` : ""}`,
        changes: updated.map((u) => ({ f: u.name, from: `${u.from} ч`, to: `${u.to} ч` })),
      });
    }
    return json({ date, dry, updated, skipped });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof Fail ? 400 : 500);
  }
});
