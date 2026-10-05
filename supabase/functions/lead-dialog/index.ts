// ============================================================================
// Edge Function: lead-dialog — расшифровка разговора и разбор для карточки лида.
// ----------------------------------------------------------------------------
// Ссылка лида из Скорозвона: https://app.skorozvon.ru/#/leads/<лид>/answer/<звонок>/+7…
// Число после /answer/ — id звонка. По нему:
//   1. Скорозвон API → звонок (оператор, длительность, recording_url);
//   2. mp3 записи → Memo AI (POST /transcriptions) вместе с отчётом-разбором (?reports=…);
//   3. следующие вызовы опрашивают Memo: реплики и разбор пишутся в public.lead_dialogs.
// Вебхуков у Memo нет, поэтому опрашивает карточка лида: открыта и что-то не готово —
// зовёт функцию раз в несколько секунд. Каждый вызов — один шаг, без долгого ожидания внутри.
//
// Разбор — свой шаблон отчёта в Memo AI (Настройки → AI-отчёты), текст шаблона —
// supabase/README.md, пункт 12. Его идентификатор — секрет MEMO_REPORT. Пока секрета нет, разбор
// не заказывается вовсе (сейчас выключен и в карточке: SHOW_REPORT в components/app/LeadDialog.tsx).
//
// Деплой: Supabase → Edge Functions → lead-dialog → вставить этот файл → Deploy.
// (CLI: supabase functions deploy lead-dialog)
// Секреты (Edge Functions → Secrets):
//   SKOROZVON_USERNAME, SKOROZVON_API_KEY, SKOROZVON_CLIENT_ID, SKOROZVON_CLIENT_SECRET — «Интеграции → API» в Скорозвоне;
//   MEMO_API_KEY — Memo AI → API, ключ с правами «Загрузка» и «AI-отчёты»;
//   MEMO_REPORT — необязательно, идентификатор шаблона разбора (proverka-lida); нет — без разбора.
// Таблица — supabase/migrations/20261005000001_lead_dialogs.sql и 20261006000001_lead_dialog_report.sql.
//
// Клиент: supabase.functions.invoke("lead-dialog", { body: { leadId, action } })
//   action: "sync" (по умолчанию) — сделать следующий шаг; "retry" — расшифровать заново;
//           "swap" — поменять местами оператора и клиента; "report" — запросить разбор ещё раз.
// Звать может любой, кто видит лид: лид читается от имени вызывающего, права решает RLS.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const SK = "https://app.skorozvon.ru";
const MEMO = "https://app.memoai.tech/api/v1/developer";
/** Запись в Скорозвоне готовится не сразу; дольше этого — считаем, что записи нет. */
const WAIT_RECORD_MS = 30 * 60_000;

type Seg = { s: number; e: number; who: string; t: string };
/** none — не запрашивали; missing — в Memo нет шаблона разбора. */
type ReportStatus = "none" | "processing" | "done" | "failed" | "missing";
type Row = {
  lead_id: string;
  call_id: string;
  status: "pending" | "waiting" | "processing" | "done" | "failed";
  error: string;
  memo_id: string | null;
  operator_speaker: string | null;
  segments: Seg[];
  call_at: string | null;
  call_sec: number | null;
  call_user: string;
  record_url: string;
  attempts: number;
  report_status?: ReportStatus;
  report?: string;
  updated_at?: string;
};

class Fail extends Error {}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Fail(`В Supabase не задан секрет ${name} (Edge Functions → Secrets)`);
  return v;
}
const reportSlug = () => (Deno.env.get("MEMO_REPORT") ?? "").trim();

/* ── Скорозвон ─────────────────────────────────────────────────────────── */

let skToken: { value: string; until: number } | null = null;

async function skorozvonToken(): Promise<string> {
  if (skToken && skToken.until > Date.now()) return skToken.value;
  const body = new URLSearchParams({
    grant_type: "password",
    username: env("SKOROZVON_USERNAME"),
    api_key: env("SKOROZVON_API_KEY"),
    client_id: env("SKOROZVON_CLIENT_ID"),
    client_secret: env("SKOROZVON_CLIENT_SECRET"),
  });
  const r = await fetch(`${SK}/oauth/token`, { method: "POST", body });
  if (!r.ok) throw new Fail(`Скорозвон не пустил по ключам API (HTTP ${r.status}) — проверьте секреты SKOROZVON_*`);
  const t = await r.json();
  skToken = { value: t.access_token, until: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 120_000 };
  return skToken.value;
}

type SkCall = {
  id: number;
  phone: string | null;
  duration: number | null;
  recording_url: string | null;
  started_at: string | { utc?: string } | null;
  ended_at: string | { utc?: string } | null;
  user?: { name?: string | null } | null;
};

async function skorozvonCall(callId: string): Promise<SkCall> {
  const r = await fetch(`${SK}/api/v2/calls/${callId}`, { headers: { Authorization: `Bearer ${await skorozvonToken()}` } });
  if (r.status === 404) throw new Fail(`Звонок ${callId} не найден в Скорозвоне — проверьте ссылку лида`);
  if (!r.ok) throw new Error(`Скорозвон: HTTP ${r.status}`);
  const j = await r.json();
  return (j.data ?? j) as SkCall;
}

/** started_at у одного звонка приходит объектом { utc: "2026-10-05 10:09:36 UTC" }, в списке — ISO-строкой. */
function skTime(v: SkCall["started_at"]): string | null {
  const s = typeof v === "string" ? v : v?.utc;
  if (!s) return null;
  const d = new Date(s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const last10 = (p: string | null | undefined) => String(p ?? "").replace(/\D+/g, "").slice(-10);

/* ── Memo AI ───────────────────────────────────────────────────────────── */

async function memo(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${MEMO}${path}`, { ...init, headers: { Authorization: `Bearer ${env("MEMO_API_KEY")}`, ...(init.headers ?? {}) } });
}

async function memoCode(r: Response): Promise<string> {
  try {
    const j = await r.clone().json();
    return String(j?.code ?? j?.detail?.code ?? j?.error?.code ?? "");
  } catch {
    return "";
  }
}

async function memoError(r: Response): Promise<string> {
  const code = await memoCode(r);
  if (r.status === 402 || code === "insufficient_balance") return "В Memo AI закончились минуты — пополните баланс и нажмите «Расшифровать заново»";
  if (r.status === 401) return "Memo AI не принял ключ — проверьте секрет MEMO_API_KEY";
  if (code === "upload_scope_required") return "У ключа Memo AI нет права «Загрузка» — создайте ключ с ним";
  return `Memo AI: HTTP ${r.status}${code ? ` (${code})` : ""}`;
}

/** Нет шаблона разбора или у ключа нет права на отчёты — расшифровка всё равно нужна. */
const reportUnavailable = (status: number, code: string) =>
  status === 422 && /prompt_not_found/.test(code) ? true : status === 403 && /reports_scope_required/.test(code);

/**
 * Кто из спикеров оператор. Memo различает голоса, но не роли. Оператор представляется,
 * называет компанию и спрашивает про удобство, — ищем эти слова; не нашли — оператор тот,
 * кто говорит больше (в лидогенерации ведёт разговор он).
 */
function guessOperator(segs: Seg[]): string | null {
  const ids = [...new Set(segs.map((s) => s.who))];
  if (ids.length < 2) return ids[0] ?? null;
  const cue = /меня зовут|компани|звоню|вас беспокоит|удобно (сейчас )?говорить|оставляли заявку|ваша заявка|автосалон|дилерск|представля/i;
  const score = new Map<string, number>();
  for (const s of segs) {
    let v = s.t.length;
    if (cue.test(s.t)) v += 400;
    score.set(s.who, (score.get(s.who) ?? 0) + v);
  }
  return ids.sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))[0];
}

type MemoReport = { slug?: string | null; status: string; text?: string | null };

/** Разбор из prompt_results расшифровки → поля строки. */
function reportFrom(row: Row, results: MemoReport[] | undefined): Pick<Row, "report_status" | "report"> {
  const r = (results ?? []).find((x) => x.slug === reportSlug());
  if (!r) return { report_status: row.report_status === "processing" ? "processing" : row.report_status ?? "none", report: row.report ?? "" };
  if (r.status === "completed") return { report_status: "done", report: String(r.text ?? "").trim() };
  if (r.status === "failed") return { report_status: "failed", report: "" };
  return { report_status: "processing", report: "" };
}

/* ── шаги ──────────────────────────────────────────────────────────────── */

function blank(leadId: string, callId: string, attempts = 0): Row {
  return {
    lead_id: leadId,
    call_id: callId,
    status: "pending",
    error: "",
    memo_id: null,
    operator_speaker: null,
    segments: [],
    call_at: null,
    call_sec: null,
    call_user: "",
    record_url: "",
    attempts,
    report_status: "none",
    report: "",
  };
}

/**
 * Расшифровка этого звонка, которую Memo уже принял раньше (по X-External-Id): готовая или в работе.
 * Нужна, когда прошлая попытка не дошла до базы — например, два вызова загрузили файл
 * одновременно и второй получил 409: файл у Memo есть, а в CRM записалась ошибка.
 */
async function findExisting(callId: string): Promise<string | null> {
  const ext = encodeURIComponent(`skorozvon-call-${callId}`);
  for (const st of ["completed", "processing", "queued"]) {
    const r = await memo(`/transcriptions?external_id=${ext}&status=${st}&limit=1&sort=-created_at`);
    if (!r.ok) continue;
    const it = (await r.json())?.items?.[0];
    if (it?.id) return String(it.id);
  }
  return null;
}

/**
 * pending / waiting → берём запись в Скорозвоне и отдаём в Memo вместе с заказом разбора.
 * lookup — сначала поискать уже принятую Memo расшифровку (повтор после сбоя): без новой загрузки и списания.
 */
async function start(row: Row, leadPhone: string, lookup = false): Promise<Row> {
  const call = await skorozvonCall(row.call_id);
  const next: Row = {
    ...row,
    call_at: skTime(call.started_at),
    call_sec: call.duration ?? null,
    call_user: call.user?.name ?? "",
  };
  const a = last10(call.phone);
  const b = last10(leadPhone);
  if (a && b && a !== b) throw new Fail(`Звонок по ссылке был на другой номер (…${a.slice(-4)}), а у лида …${b.slice(-4)}`);
  if (!call.recording_url) {
    const ended = Date.parse(skTime(call.ended_at) ?? "") || Date.parse(next.call_at ?? "") || 0;
    if (ended && Date.now() - ended > WAIT_RECORD_MS) throw new Fail("У звонка в Скорозвоне нет записи разговора");
    return { ...next, status: "waiting", error: "" };
  }
  next.record_url = call.recording_url;

  if (lookup) {
    const found = await findExisting(row.call_id);
    if (found) return { ...next, status: "processing", error: "", memo_id: found, report_status: "none", report: "" };
  }

  const audio = await fetch(call.recording_url); // 302 → хранилище Скорозвона
  if (!audio.ok) throw new Error(`Не скачалась запись из Скорозвона: HTTP ${audio.status}`);
  const bytes = new Uint8Array(await audio.arrayBuffer());

  const upload = (withReport: boolean) =>
    memo(`/transcriptions?language=ru&speakers_count=2${withReport && reportSlug() ? `&reports=${encodeURIComponent(reportSlug())}` : ""}`, {
      method: "POST",
      headers: {
        "Content-Disposition": `attachment; filename="call-${row.call_id}.mp3"`,
        // повтор того же шага (сеть, двойной клик) не создаст вторую расшифровку и не спишет минуты дважды
        "Idempotency-Key": `lead-${row.lead_id}-${row.call_id}-${row.attempts}`,
        "X-External-Id": `skorozvon-call-${row.call_id}`,
      },
      body: bytes,
    });
  let report: ReportStatus = reportSlug() ? "processing" : "missing";
  let up = await upload(report === "processing");
  // нет шаблона разбора — отчёты проверяются до чтения файла, повтор без них ничего не стоит
  if (!up.ok && report === "processing" && reportUnavailable(up.status, await memoCode(up))) {
    report = "missing";
    up = await upload(false);
  }
  if (!up.ok) {
    // тот же файл уже грузится параллельным вызовом (409) или Memo просит подождать (429) —
    // это не ошибка лида: шаг не засчитываем, следующий вызов получит ту же расшифровку
    if (up.status === 409 || up.status === 429) throw new Error(await memoError(up));
    throw new Fail(await memoError(up));
  }
  const t = await up.json();
  return { ...next, status: "processing", error: "", memo_id: String(t.uuid ?? t.id), report_status: report, report: "" };
}

/** processing → спрашиваем Memo, готово ли; done с разбором в работе — догружаем разбор. */
async function poll(row: Row): Promise<Row> {
  const r = await memo(`/transcriptions/${row.memo_id}`);
  if (r.status === 404) throw new Fail("Расшифровка пропала из Memo AI — нажмите «Расшифровать заново»");
  if (!r.ok) throw new Error(await memoError(r));
  const t = await r.json();
  if (t.status === "queued" || t.status === "processing") return row;
  if (t.status === "insufficient_balance") throw new Fail("В Memo AI закончились минуты — пополните баланс и нажмите «Расшифровать заново»");
  if (t.status !== "completed") throw new Fail(`Memo AI не смог расшифровать запись${t.error_code ? ` (${t.error_code})` : ""}`);
  const rep = reportFrom(row, t.prompt_results);
  if (row.status === "done") return { ...row, ...rep };
  const segments: Seg[] = (t.segments ?? [])
    .filter((s: { text?: string }) => (s.text ?? "").trim())
    .map((s: { start: number | null; end: number | null; speaker_id: string | null; text: string }) => ({
      s: Math.round((s.start ?? 0) * 10) / 10,
      e: Math.round((s.end ?? 0) * 10) / 10,
      who: s.speaker_id ?? "1",
      t: s.text.trim(),
    }));
  if (!segments.length) throw new Fail("В записи не нашлось речи");
  return { ...row, ...rep, status: "done", error: "", segments, operator_speaker: guessOperator(segments) };
}

/** Разбор для уже готовой расшифровки (старые лиды, шаблон появился позже, «запросить ещё раз»). */
async function orderReport(row: Row): Promise<Row> {
  if (!reportSlug()) return { ...row, report_status: "missing" };
  const r = await memo(`/transcriptions/${row.memo_id}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reports: [reportSlug()] }),
  });
  if (!r.ok) {
    if (reportUnavailable(r.status, await memoCode(r))) return { ...row, report_status: "missing" };
    throw new Error(await memoError(r));
  }
  return { ...row, report_status: "processing", report: "" };
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
    const leadId = String(body.leadId ?? "").trim();
    const action = String(body.action ?? "sync");
    if (!leadId) return json({ error: "Нет leadId" }, 400);

    // видит ли вызывающий этот лид — решает RLS лидов, как и везде в CRM
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: lead, error: lErr } = await asCaller.from("leads").select("id, link, phone").eq("id", leadId).maybeSingle();
    if (lErr) return json({ error: lErr.message }, 401);
    if (!lead) return json({ error: "Лид не найден или нет доступа" }, 404);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: saved, error: rErr } = await admin.from("lead_dialogs").select("*").eq("lead_id", leadId).maybeSingle();
    if (rErr) return json({ error: /lead_dialogs/.test(rErr.message) ? "В базе нет таблицы lead_dialogs — выполните supabase/migrations/20261005000001_lead_dialogs.sql" : rErr.message }, 500);
    // колонок разбора нет, пока не выполнена 20261006000001_lead_dialog_report.sql — тогда без разбора
    const hasReport = !saved || "report_status" in (saved as object);

    const callId = String(lead.link ?? "").match(/\/answer\/(\d+)/)?.[1] ?? "";
    let row: Row = (saved as Row | null) ?? blank(leadId, callId);
    row.report_status ??= "none";
    row.report ??= "";
    // ссылку в лиде поменяли — это уже другой звонок
    if (row.call_id !== callId) row = blank(leadId, callId, row.attempts + 1);

    const save = async (r: Row) => {
      const rec: Record<string, unknown> = { ...r, updated_at: new Date().toISOString() };
      if (!hasReport) {
        delete rec.report_status;
        delete rec.report;
      }
      let { error } = await admin.from("lead_dialogs").upsert(rec);
      // новая строка, а колонок разбора ещё нет
      if (error && /report/.test(error.message)) {
        delete rec.report_status;
        delete rec.report;
        ({ error } = await admin.from("lead_dialogs").upsert(rec));
      }
      if (error) throw new Error(error.message);
      return { ...r, ...(hasReport ? {} : { report_status: "missing" as const, report: "" }) };
    };

    if (!callId) {
      return json(await save({ ...row, status: "failed", error: "В ссылке лида нет номера звонка (…/answer/<звонок>/…) — вставьте ссылку из звонка в Скорозвоне" }));
    }

    if (action === "swap") {
      if (row.status !== "done") return json(row);
      const other = row.segments.map((s) => s.who).find((w) => w !== row.operator_speaker) ?? row.operator_speaker;
      return json(await save({ ...row, operator_speaker: other }));
    }
    // «заново»: если Memo файл так и не принял (memo_id нет) — тот же ключ, и Memo вернёт уже
    // принятую расшифровку без второго списания; новый ключ — только для пересчёта готовой
    // прошлая попытка споткнулась о параллельную загрузку (409) — файл у Memo, скорее всего, уже есть:
    // доводим сами, без кнопки (так лечатся и лиды, записанные до этого исправления)
    const stuck = row.status === "failed" && /409|idempotency/i.test(row.error);
    const lookup = stuck || action === "retry" || !!row.error;
    if (stuck && action !== "retry") row = { ...blank(leadId, callId, row.attempts), call_at: row.call_at };
    if (action === "retry" && row.status !== "processing") row = blank(leadId, callId, row.memo_id ? row.attempts + 1 : row.attempts);

    try {
      if (row.status === "pending" || row.status === "waiting") row = await start(row, String(lead.phone ?? ""), lookup);
      else if (row.status === "processing" && row.memo_id) row = await poll(row);
      else if (row.status === "done" && row.memo_id && hasReport) {
        if (row.report_status === "processing") row = await poll(row);
        else if (row.report_status === "none" || action === "report") row = await orderReport(row);
      }
    } catch (e) {
      if (e instanceof Fail) row = { ...row, status: row.status === "done" ? "done" : "failed", error: e.message };
      else {
        // сбой сети / 5xx / параллельный вызов — шаг не засчитываем и в базу не пишем
        // (иначе можно затереть то, что параллельный вызов уже сохранил), карточка повторит
        return json({ ...row, error: String((e as Error).message ?? e) }, 502);
      }
    }
    return json(await save(row));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, 500);
    return json({ error: String(e) }, 500);
  }
});
