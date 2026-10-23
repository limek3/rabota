// ============================================================================
// Edge Function: skorozvon-link — ссылка на лид Скорозвона по номеру клиента.
// ----------------------------------------------------------------------------
// Оператор вставил в поле ссылки не ссылку, а номер клиента. Фильтра по номеру у API Скорозвона нет,
// поэтому, как lead-dialog (findCall), листаем отчёт «Звонки» за последние 20 минут — сначала
// последние минуты, потом шире — и берём самый поздний звонок на этот номер (состоявшийся, если есть).
// Из звонка собираем ту же ссылку, что Скорозвон даёт из карточки звонка:
//   https://app.skorozvon.ru/#/leads/<лид>/answer/<звонок>/+7XXXXXXXXXX
// по ней карточка лида в CRM находит запись разговора (lead-dialog), а номер в конце сверяется с телефоном лида.
//
// Деплой: Supabase → Edge Functions → Deploy a new function → Via Editor → имя skorozvon-link →
// вставить этот файл → Deploy. (CLI: supabase functions deploy skorozvon-link)
// Секреты: SKOROZVON_USERNAME, SKOROZVON_API_KEY, SKOROZVON_CLIENT_ID, SKOROZVON_CLIENT_SECRET — те же, что у lead-dialog.
//
// Вызов из CRM: supabase.functions.invoke("skorozvon-link", { body: { phone } }) — любой вошедший сотрудник.
// Ответ: { link, callId, leadId, at } или { error }.
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

type Ref = { id?: number | string | null } | null | undefined;
type CallRow = {
  id: number;
  phone?: string | null;
  duration?: number | null;
  started_at?: string | { utc?: string } | null;
  lead_id?: number | string | null;
  lead?: Ref;
  main_lead?: Ref;
  organization?: Ref;
};

/** started_at у одного звонка приходит объектом { utc: "2026-10-05 10:09:36 UTC" }, в списке — ISO-строкой. */
function skTime(v: CallRow["started_at"]): number {
  const s = typeof v === "string" ? v : v?.utc;
  if (!s) return 0;
  const t = Date.parse(s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(t) ? 0 : t;
}

const last10 = (p: string | null | undefined) => String(p ?? "").replace(/\D+/g, "").slice(-10);

/** Лид Скорозвона, к которому относится звонок: в отчёте он приходит под разными именами. */
function leadOf(x: CallRow): string {
  for (const v of [x.lead_id, x.lead?.id, x.main_lead?.id, x.organization?.id]) {
    const s = String(v ?? "").trim();
    if (/^\d+$/.test(s)) return s;
  }
  return "";
}

/** Одна страница отчёта «Звонки» за [from, to] (секунды unix); 5xx и 429 — повторяем. */
async function callsPage(from: number, to: number, page: number): Promise<{ data: CallRow[]; total: number }> {
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

/** Звонок целиком — если в отчёте у него не оказалось лида. */
async function callById(id: number): Promise<CallRow | null> {
  const r = await fetch(`${SK}/api/v2/calls/${id}`, { headers: { Authorization: `Bearer ${await skorozvonToken()}` } });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.data ?? j) as CallRow;
}

/** Больше страниц за один вызов не листаем — звонков в Скорозвоне сотни в минуту. */
const MAX_PAGES = 60;

/** Самый поздний звонок на номер за последние 20 минут: сначала последние 5 минут, потом остальные 15. */
async function findByPhone(phone10: string): Promise<CallRow> {
  const now = Math.floor(Date.now() / 1000);
  const windows: [number, number][] = [
    [now - 5 * 60, now],
    [now - 20 * 60, now - 5 * 60],
  ];
  let budget = MAX_PAGES;
  for (const [from, to] of windows) {
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
    const hits = rows.filter((x) => last10(x.phone) === phone10);
    if (hits.length) {
      hits.sort((a, b) => Number((b.duration ?? 0) > 0) - Number((a.duration ?? 0) > 0) || skTime(b.started_at) - skTime(a.started_at));
      return hits[0];
    }
    if (budget <= 0) break;
  }
  throw new Fail("За последние 20 минут звонков на этот номер в Скорозвоне нет — скопируйте ссылку из карточки звонка");
}

/* ── вход ──────────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await asCaller.auth.getUser();
    if (!u?.user) return json({ error: "Войдите в CRM" }, 401);

    const body = await req.json().catch(() => ({}));
    let d = String(body.phone ?? "").replace(/\D+/g, "");
    if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) d = d.slice(1);
    if (d.length !== 10) return json({ error: "Нужен номер из 10–11 цифр" }, 400);

    const call = await findByPhone(d);
    let skLead = leadOf(call);
    if (!skLead) skLead = leadOf((await callById(call.id)) ?? ({ id: call.id } as CallRow));
    if (!skLead) {
      // в ответе — какие поля пришли, чтобы было видно, где Скорозвон держит лид
      throw new Fail(`Звонок нашёлся (${call.id}), но Скорозвон не отдал его лид — скопируйте ссылку из карточки звонка [${Object.keys(call).join(", ")}]`);
    }
    const at = skTime(call.started_at);
    return json({ link: `${SK}/#/leads/${skLead}/answer/${call.id}/+7${d}`, callId: String(call.id), leadId: skLead, at: at ? new Date(at).toISOString() : null });
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, 404);
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
