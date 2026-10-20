// ============================================================================
// Edge Function: shift-hours — часы в график из Скорозвона.
// ----------------------------------------------------------------------------
// Каждый час в :05 по Москве (pg_cron, supabase/migrations/20261014000002_shift_hours_hourly.sql;
// в 00:05 — последний раз за вчера) берёт отчёт Скорозвона «Занятость сотрудников» за день и каждому, у кого в графике
// смена (работа или обучение), ставит часы = доступен + гудки + разговор + заполняет карточку + ручной обзвон.
// Перерывы, «не беспокоить» и офлайн не считаются. (Старые смены вида «ручной обзвон» — как рабочие.) Оператор CRM ↔ сотрудник Скорозвона —
// по фамилии (и имени, если фамилия встречается дважды). Не нашёлся или нашлись двое —
// смену не трогаем, а в ответе и в журнале пишем, кого не сопоставили.
// Смену забыли поставить, а оператор в Скорозвоне отработал (от MIN_NEW_SEC) — заводим рабочую смену
// с этими часами. Только оператору линии (не супервайзеру) и только если в графике на этот день
// у него нет никакой записи: выходной, больничный, отпуск, платформу не перебиваем.
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
/**
 * Ручной обзвон (в Скорозвоне — отдельный статус «Ручной обзвон» на ленте занятости) — тоже рабочее
 * время смены: все статусы, в ключе которых есть manual / hand / «ручн», складываются в часть «manual».
 * Остальные статусы в часы не идут, но возвращаются в other — их видно в окне «Часы из Скорозвона».
 */
const isManual = (k: string) => /manual|hand|ручн/i.test(k);
const MANUAL_LABEL = "ручной обзвон";

/** Секунды по статусам: рабочие (WORK + manual) и остальные — для просмотра, в часы не идут. */
function splitStatuses(st: Record<string, number> | undefined): { parts: Record<string, number>; other: Record<string, number> } {
  const parts: Record<string, number> = Object.fromEntries((Object.keys(WORK) as WorkKey[]).map((k) => [k, 0]));
  parts.manual = 0;
  const other: Record<string, number> = {};
  for (const [k, v] of Object.entries(st ?? {})) {
    const sec = Math.max(0, Number(v) || 0);
    if (!sec) continue;
    if (k in WORK) parts[k] += sec;
    else if (isManual(k)) parts.manual += sec;
    else other[k] = sec;
  }
  return { parts, other };
}
const MARK = "Скорозвон:";
const MSK = 3 * 3600_000;
/** Сколько рабочего времени в Скорозвоне нужно, чтобы завести смену, которой нет в графике: 15 минут. */
const MIN_NEW_SEC = 15 * 60;
const HOURS_TYPES = new Set(["work", "manual", "training"]);

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
    // Скорозвон под нагрузкой отвечает 429/5xx: ждём дольше с каждой попыткой (1,5 → 3 → 6 → 10 с)
    // и уважаем Retry-After; сетевой сбой — тоже повод повторить
    let last = "";
    const waits = [1500, 3000, 6000, 10000];
    for (let k = 0; k <= waits.length && !j; k++) {
      let r: Response;
      try {
        r = await fetch(`${SK}/api/reports/managers_employment.json`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ start_time: Math.floor(from / 1000), end_time: Math.floor(to / 1000), length: 100, page }),
        });
      } catch (e) {
        last = `сеть: ${e instanceof Error ? e.message : String(e)}`;
        if (k < waits.length) await new Promise((res) => setTimeout(res, waits[k]));
        continue;
      }
      if (r.ok) j = await r.json();
      else if (r.status < 500 && r.status !== 429) throw new Fail(`Скорозвон: отчёт «Занятость сотрудников» — HTTP ${r.status}`);
      else {
        last = `HTTP ${r.status}`;
        const ra = Number(r.headers.get("retry-after"));
        if (k < waits.length) await new Promise((res) => setTimeout(res, ra > 0 && ra <= 20 ? ra * 1000 : waits[k]));
      }
    }
    if (!j) throw new Error(`Скорозвон не отдал отчёт «Занятость сотрудников» (${last}, страница ${page}) — попробуйте через пару минут`);
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
    const [{ data: dayShifts, error: sErr }, { data: ops, error: oErr }, { data: groups, error: gErr }] = await Promise.all([
      admin.from("shifts").select("id, date, operator_id, hours, type, comment").eq("date", date),
      admin.from("operators").select("id, name, deleted_at, status, fire_date, hire_date, role, pay_type, group_id"),
      admin.from("groups").select("supervisor_id, deleted_at"),
    ]);
    if (sErr || oErr || gErr) return json({ error: (sErr ?? oErr ?? gErr)!.message }, 500);
    const shifts = (dayShifts ?? []).filter((s) => HOURS_TYPES.has(s.type));

    const rows = (await employment(date)).map((row) => ({ w: new Set(words(row.full_name)), row }));
    // уволенный после даты увольнения не работает: остаток смены в графике часами не заполняем
    const gone = (o: { status?: string; fire_date?: string | null }) => o.status === "fired" && (!o.fire_date || date > o.fire_date);
    const live = (ops ?? []).filter((o) => !o.deleted_at && !gone(o));
    const opById = new Map(live.map((o) => [o.id as string, o as Op]));

    // кому можно завести смену, которой нет в графике: оператор линии, уже принят, на этот день — ни одной записи
    const svIds = new Set<string>(live.filter((o) => o.role === "supervisor" || o.pay_type === "sv_volume").map((o) => o.id));
    for (const g of groups ?? []) if (!g.deleted_at && g.supervisor_id) svIds.add(g.supervisor_id);
    const hasRecord = new Set((dayShifts ?? []).map((s) => s.operator_id as string));
    const noShift = live.filter((o) => !hasRecord.has(o.id) && !svIds.has(o.id) && (!o.hire_date || o.hire_date <= date));

    const updated: { name: string; from: number; to: number; parts: Record<string, number>; other: Record<string, number>; created?: boolean }[] = [];
    const skipped: { name: string; why: string }[] = [];
    const recs: { id: string; hours: number; comment: string; updated_at: string }[] = [];
    const news: { id: string; date: string; operator_id: string; group_id: string | null; type: string; hours: number; comment: string; updated_at: string }[] = [];
    const now = new Date().toISOString();

    const tally = (row: EmpRow) => {
      const { parts, other } = splitStatuses(row.statuses);
      const sec = Object.values(parts).reduce((a, b) => a + b, 0);
      const hours = Math.round((sec / 3600) * 100) / 100;
      const line = `${MARK} ${(Object.keys(WORK) as WorkKey[]).map((k) => `${WORK[k]} ${hhmm(parts[k])}`).join(" · ")}${parts.manual ? ` · ${MANUAL_LABEL} ${hhmm(parts.manual)}` : ""}`;
      return { parts, other, sec, hours, line };
    };

    for (const s of shifts) {
      const op = opById.get(s.operator_id);
      if (!op) continue;
      const m = matchOp(op, rows);
      if (!m.row) {
        skipped.push({ name: op.name, why: m.why ?? "" });
        continue;
      }
      const { parts, other, hours, line } = tally(m.row);
      updated.push({ name: op.name, from: Number(s.hours) || 0, to: hours, parts, other });
      const comment = withMark(String(s.comment ?? ""), line);
      // ничего не поменялось с прошлого часа — не пишем: лишние записи будят все открытые CRM
      if (Math.abs((Number(s.hours) || 0) - hours) < 0.005 && comment === String(s.comment ?? "")) continue;
      recs.push({ id: s.id, hours, comment, updated_at: now });
    }

    // смены нет, а в Скорозвоне работал: не нашёлся или работал меньше MIN_NEW_SEC — молча пропускаем,
    // иначе в «не сопоставлены» попадал бы каждый, у кого выходной
    for (const o of noShift) {
      const m = matchOp(o as Op, rows);
      if (!m.row) continue;
      const { parts, other, sec, hours, line } = tally(m.row);
      if (sec < MIN_NEW_SEC) continue;
      updated.push({ name: o.name, from: 0, to: hours, parts, other, created: true });
      news.push({ id: `${date}|${o.id}`, date, operator_id: o.id, group_id: o.group_id ?? null, type: "work", hours, comment: line, updated_at: now });
    }
    if (!updated.length && !skipped.length) return json({ date, updated: [], skipped: [], note: "В графике на этот день нет смен, в Скорозвоне — никого из операторов" });

    // только часы и комментарий: тип смены, группа и всё остальное не трогаем
    if (!dry) {
      for (const r of recs) {
        const { error } = await admin.from("shifts").update({ hours: r.hours, comment: r.comment, updated_at: r.updated_at }).eq("id", r.id);
        if (error) return json({ error: `Не сохранилась смена ${r.id}: ${error.message}`, updated, skipped }, 500);
      }
      // новые смены; если за это время в графике её уже поставили руками — ту не перезаписываем
      if (news.length) {
        const { error } = await admin.from("shifts").upsert(news, { onConflict: "id", ignoreDuplicates: true });
        if (error) return json({ error: `Не завелись новые смены: ${error.message}`, updated, skipped }, 500);
      }
    }
    // расписание идёт каждый час: в журнал — только итог дня (прогон за вчера в 00:05) и запуски руками
    if (!dry && updated.length && (!byCron || date < today)) {
      const ru = `${date.slice(8, 10)}.${date.slice(5, 7)}`;
      await admin.from("audit").insert({
        id: `au-sk-${date}-${Date.now().toString(36)}`,
        at: now,
        account_id: "",
        account_name: who,
        entity: "shift",
        entity_id: date,
        summary: `Часы из Скорозвона за ${ru}: ${updated.length} смен${news.length ? `, из них новых ${news.length}` : ""}${skipped.length ? `, не сопоставлено ${skipped.length}: ${skipped.map((x) => x.name).join(", ")}` : ""}`,
        changes: updated.map((u) => ({ f: u.name, from: u.created ? "нет смены" : `${u.from} ч`, to: `${u.to} ч` })),
      });
    }
    return json({ date, dry, updated, skipped });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof Fail ? 400 : 500);
  }
});
