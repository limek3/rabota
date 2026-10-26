// ============================================================================
// Edge Function: lead-dialog — запись разговора из Скорозвона для карточки лида.
// ----------------------------------------------------------------------------
// Ссылка лида из Скорозвона: https://app.skorozvon.ru/#/leads/<лид>/answer/<звонок>/+7…
// Число после /answer/ — id звонка. Ссылка «…/leads/<лид>/call/+7…» звонка не содержит — тогда он
// ищется по лиду Скорозвона в отчёте «Звонки» (findCall). По звонку Скорозвон API отдаёт оператора,
// длительность и запись (recording_url) — это пишется в public.lead_dialogs, карточка играет запись.
// Записи ещё нет (Скорозвон её готовит) — status waiting, карточка спросит снова.
// Расшифровки и разбора больше нет (Memo AI убран): старые строки с репликами остаются как были,
// строки, упавшие на Memo, при следующем открытии берут запись из Скорозвона заново.
//
// Деплой: Supabase → Edge Functions → lead-dialog → вставить этот файл → Deploy.
// (CLI: supabase functions deploy lead-dialog)
// Секреты (Edge Functions → Secrets):
//   SKOROZVON_USERNAME, SKOROZVON_API_KEY, SKOROZVON_CLIENT_ID, SKOROZVON_CLIENT_SECRET — «Интеграции → API» в Скорозвоне.
//   MEMO_API_KEY и MEMO_REPORT больше не нужны — их можно удалить.
// Таблица — supabase/migrations/20261005000001_lead_dialogs.sql.
//
// Клиент: supabase.functions.invoke("lead-dialog", { body: { leadId, action } })
//   action: "sync" (по умолчанию) — сделать следующий шаг; "retry" — взять запись заново;
//           "swap" — поменять местами оператора и клиента (старые разговоры с расшифровкой).
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
/** Запись в Скорозвоне готовится не сразу; дольше этого — считаем, что записи нет. */
const WAIT_RECORD_MS = 30 * 60_000;

type Seg = { s: number; e: number; who: string; t: string };
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
  updated_at?: string;
};

class Fail extends Error {}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Fail(`В Supabase не задан секрет ${name} (Edge Functions → Secrets)`);
  return v;
}

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

/**
 * Что за звонок в ссылке лида. «…/answer/<звонок>/…» — id звонка прямо в ссылке, ключ = id.
 * «…/leads/<лид>/call/+7…» (и просто «…/leads/<лид>») — звонка в ссылке нет, его ищем по лиду
 * Скорозвона; ключ «@<лид>», найденный звонок пишется в call_id как «<звонок>@<лид>».
 */
function linkRef(link: string): { key: string; skLead: string } {
  const answer = link.match(/\/answer\/(\d+)/)?.[1];
  if (answer) return { key: answer, skLead: "" };
  const skLead = link.match(/#\/leads\/(\d+)/)?.[1] ?? "";
  return { key: skLead ? `@${skLead}` : "", skLead };
}
/** Строка расшифровки относится к этой ссылке. */
const sameCall = (callId: string, key: string) => callId === key || (key.startsWith("@") && callId.endsWith(key));
/** id звонка в Скорозвоне из call_id строки ("" — ещё не нашли). */
const skCallId = (callId: string) => callId.split("@")[0];

/** Время последнего звонка по лиду Скорозвона (null — не звонили или нет даты). */
async function skorozvonLastCall(skLead: string): Promise<{ at: number | null; phones: string[] }> {
  const r = await fetch(`${SK}/api/v2/leads/${skLead}`, { headers: { Authorization: `Bearer ${await skorozvonToken()}` } });
  if (r.status === 404) throw new Fail(`Лид ${skLead} не найден в Скорозвоне — проверьте ссылку`);
  if (!r.ok) throw new Error(`Скорозвон: HTTP ${r.status}`);
  const j = await r.json();
  const l = j.data ?? j;
  const at = Date.parse(skTime(l.last_call_date) ?? "");
  const phones = [...(l.lead_phones ?? []), ...String(l.phones ?? "").split(/[,;]/)].map(last10).filter(Boolean);
  return { at: Number.isNaN(at) ? null : at, phones };
}

type TotalRow = {
  id: number;
  phone?: string | null;
  duration?: number | null;
  started_at?: string | { utc?: string } | null;
  lead_id?: number | null;
  lead?: { id?: number } | null;
  main_lead?: { id?: number } | null;
  organization?: { id?: number } | null;
};

/** Одна страница отчёта «Звонки» за [from, to] (секунды unix); 5xx и 429 — повторяем. */
async function callsPage(from: number, to: number, page: number): Promise<{ data: TotalRow[]; total: number }> {
  for (let k = 0; k < 3; k++) {
    const r = await fetch(`${SK}/api/reports/calls_total.json`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await skorozvonToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ start_time: from, end_time: to, length: 500, page }),
    });
    if (r.ok) {
      const j = await r.json();
      return { data: j.data ?? [], total: Number(j.total) || 0 };
    }
    if (r.status < 500 && r.status !== 429) throw new Error(`Скорозвон: отчёт «Звонки» — HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("Скорозвон не отдал отчёт «Звонки» — попробуйте позже");
}

/** Больше страниц за один вызов не листаем — звонков в Скорозвоне сотни в минуту. */
const MAX_PAGES = 60;

/**
 * Звонок лида по ссылке «…/leads/<лид>/call/+7…»: фильтра по лиду или номеру у API нет, поэтому
 * листаем отчёт «Звонки» вокруг времени последнего звонка по лиду (нет его — вокруг записи лида
 * в CRM), сначала узкое окно, потом шире. Берём звонок на этот номер или по этому лиду:
 * состоявшийся, самый поздний.
 */
async function findCall(skLead: string, leadPhone: string, createdAt: string | null): Promise<string> {
  const last = await skorozvonLastCall(skLead);
  const want = new Set([last10(leadPhone), ...last.phones].filter(Boolean));
  const lead = Number(skLead);
  const center = last.at ?? (Date.parse(createdAt ?? "") || Date.now());
  const s = Math.floor(center / 1000);
  // окна от узкого к широкому, без повторов: [начало, конец] в секундах
  const windows: [number, number][] = [
    [s - 3 * 60, s + 60],
    [s - 12 * 60, s - 3 * 60],
    [s - 40 * 60, s - 12 * 60],
  ];
  let budget = MAX_PAGES;
  for (const [from, end] of windows) {
    const to = Math.min(end, Math.floor(Date.now() / 1000));
    if (to <= from) continue;
    const first = await callsPage(from, to, 1);
    const per = first.data.length || 1;
    const pages = Math.ceil(first.total / per);
    const rows = [...first.data];
    budget--;
    for (let p = 2; p <= pages && budget > 0; p += 6) {
      const batch = Array.from({ length: Math.min(6, pages - p + 1, budget) }, (_, i) => callsPage(from, to, p + i));
      budget -= batch.length;
      for (const pg of await Promise.all(batch)) rows.push(...pg.data);
    }
    const hits = rows.filter(
      (x) => want.has(last10(x.phone)) || [x.lead_id, x.lead?.id, x.main_lead?.id, x.organization?.id].some((id) => Number(id) === lead),
    );
    if (hits.length) {
      const t = (x: TotalRow) => Date.parse(skTime(x.started_at ?? null) ?? "") || 0;
      hits.sort((a, b) => Number((b.duration ?? 0) > 0) - Number((a.duration ?? 0) > 0) || t(b) - t(a));
      return String(hits[0].id);
    }
    if (budget <= 0) break;
  }
  throw new Fail("Не нашли в Скорозвоне звонок по этому лиду — вставьте ссылку из самого звонка (…/answer/<звонок>/…)");
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
  };
}

/** pending / waiting → звонок из Скорозвона: оператор, длительность и запись; есть запись — готово. */
async function start(row: Row, leadPhone: string): Promise<Row> {
  const call = await skorozvonCall(skCallId(row.call_id));
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
  return { ...next, status: "done", error: "", record_url: call.recording_url };
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
    const { data: lead, error: lErr } = await asCaller.from("leads").select("id, link, phone, created_at").eq("id", leadId).maybeSingle();
    if (lErr) return json({ error: lErr.message }, 401);
    if (!lead) return json({ error: "Лид не найден или нет доступа" }, 404);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: saved, error: rErr } = await admin.from("lead_dialogs").select("*").eq("lead_id", leadId).maybeSingle();
    if (rErr) return json({ error: /lead_dialogs/.test(rErr.message) ? "В базе нет таблицы lead_dialogs — выполните supabase/migrations/20261005000001_lead_dialogs.sql" : rErr.message }, 500);

    const { key, skLead } = linkRef(String(lead.link ?? ""));
    let row: Row = (saved as Row | null) ?? blank(leadId, key);
    // ссылку в лиде поменяли — это уже другой звонок
    if (!sameCall(row.call_id, key)) row = blank(leadId, key, row.attempts + 1);

    // в строке могут остаться колонки разбора (report_status, report) — их не трогаем
    const save = async (r: Row) => {
      const { error } = await admin.from("lead_dialogs").upsert({ ...r, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return r;
    };

    if (!key) {
      return json(await save({ ...row, status: "failed", error: "Ссылка лида не из Скорозвона — вставьте ссылку на лид или звонок (app.skorozvon.ru/#/leads/…)" }));
    }

    if (action === "swap") {
      // старые разговоры с расшифровкой: поменять местами оператора и клиента на «волне»
      if (row.status !== "done" || !row.segments?.length) return json(row);
      const other = row.segments.map((s) => s.who).find((w) => w !== row.operator_speaker) ?? row.operator_speaker;
      return json(await save({ ...row, operator_speaker: other }));
    }
    // «заново» — звонок по ссылке «…/call/…» ищется тоже заново: вдруг в прошлый раз нашёлся не тот.
    // Строки времён Memo AI (расшифровка в работе или упала на Memo) — берём запись из Скорозвона заново
    const legacy = row.status === "processing" || (row.status === "failed" && /memo/i.test(row.error));
    if (action === "retry") row = blank(leadId, key, row.attempts + 1);
    else if (legacy) row = { ...blank(leadId, row.call_id, row.attempts), call_at: row.call_at };

    try {
      // звонка в ссылке нет — находим его по лиду Скорозвона один раз и запоминаем в call_id
      if (row.status === "pending" && !skCallId(row.call_id))
        row = { ...row, call_id: `${await findCall(skLead, String(lead.phone ?? ""), lead.created_at ?? null)}@${skLead}` };
      if (row.status === "pending" || row.status === "waiting") row = await start(row, String(lead.phone ?? ""));
    } catch (e) {
      if (e instanceof Fail) row = { ...row, status: "failed", error: e.message };
      else {
        // сбой сети / 5xx — шаг не засчитываем и в базу не пишем, карточка повторит
        return json({ ...row, error: String((e as Error).message ?? e) }, 502);
      }
    }
    return json(await save(row));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, 500);
    return json({ error: String(e) }, 500);
  }
});
