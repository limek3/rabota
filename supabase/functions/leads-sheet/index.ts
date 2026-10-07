// ============================================================================
// Edge Function: leads-sheet — лиды в таблицу ОКК (Google Таблица «Авто недозвоны»).
// ----------------------------------------------------------------------------
// Каждый день в 13:00 и 19:00 по Москве, и в выходные (pg_cron,
// supabase/migrations/20261008000002_leads_sheet_cron.sql) берёт лиды за вчера и сегодня, которых
// ещё нет в таблице, и дописывает их снизу в лист месяца «Октябрь Борис» через веб-приложение
// Apps Script таблицы. Отправленные лиды отмечаются (kv «leadSheetMarks») — второй раз не уйдут,
// даже если строку в таблице удалили. Скрипт сам тоже не дублирует лид, который уже на листе.
// «Доведен», «почему» и «Проверка ОКК» пустые — их ставит человек.
// Из CRM («Лиды» → «Таблица ОКК» → «В Google Таблицу») РОП шлёт сюда список лидов (ids) —
// браузер не может прочитать ответ Google после его переадресации, а сервер может.
// Ссылка /exec, секрет и «чей лист» — из настроек CRM (Настройки → Данные → «Таблица лидов
// для ОКК»; строка kv «sheets», поле leads). Переключатель «Выгружать автоматически» там же:
// выключен — расписание ничего не делает.
// Столбцы и строки — как в lib/crm/leadsheet.ts: меняете одно, меняйте и другое.
//
// Деплой: Supabase → Edge Functions → Deploy a new function → Via Editor → имя leads-sheet →
// вставить этот файл → Deploy. (CLI: supabase functions deploy leads-sheet)
// Секрет (Edge Functions → Secrets): CRON_SECRET — тот же, что у shift-hours.
//
// Вызов: POST
//   { from?, to? }        — лиды за период (по умолчанию вчера–сегодня по Москве), только ещё не отправленные;
//   { ids, from?, to? }   — эти лиды (из CRM, с фильтрами страницы); from/to — для истории выгрузок.
//   — расписание: заголовок x-cron-secret;
//   — из CRM: вход руководителя отдела (supabase.functions.invoke("leads-sheet", { body })).
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

const MSK = 3 * 3600_000;
const DAY = 24 * 3600_000;
/** Отметки «уже в таблице» старше — забываем, чтобы строка kv не росла бесконечно. */
const MARKS_KEEP_DAYS = 180;
const HEAD = ["Дата", "Ссылка", "Телефон", "Имя", "Оператор", "Доведен", "Если не доведен, почему", "Проверка ОКК"];
const DONE = ["Да", "Нет"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

type LeadRow = { id: string; at: string; link: string | null; phone: string; client: string; operator_id: string };
type Cfg = { url?: string; token?: string; owner?: string; auto?: boolean };
type Push = { added: number; skipped: number; created: boolean; unconfirmed: boolean };

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ru = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const tabOf = (d: string, owner: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${owner}`.trim();

function sheetPhone(p: string): string {
  const d = (p || "").replace(/\D+/g, "");
  return d.length === 11 && /^[78]/.test(d) ? `7${d.slice(1)}` : d.length === 10 ? `7${d}` : (p || "").trim();
}

function row(l: LeadRow, opName: (id: string) => string): string[] {
  return [
    ru(l.at.slice(0, 10)),
    (l.link ?? "").trim(),
    sheetPhone(l.phone),
    (l.client ?? "").trim(),
    opName(l.operator_id),
    // «Доведен», «Если не доведен, почему», «Проверка ОКК» заполняет человек в таблице
    "",
    "",
    "",
  ];
}

/**
 * POST в веб-приложение Apps Script. Google выполняет doPost и отвечает переадресацией на страницу
 * с результатом — идём за ней сами. Переадресация пришла, а страница с ответом не открылась —
 * скрипт уже отработал (ошибки он тоже отдаёт через неё): считаем отправленным, но без подтверждения.
 */
async function push(cfg: Cfg, tab: string, rows: string[][]): Promise<Push> {
  const first = await fetch(cfg.url!, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: cfg.token, tab, header: HEAD, rows, done: DONE }),
    redirect: "manual",
  });
  const moved = first.status >= 300 && first.status < 400;
  let res = first;
  if (moved) {
    const loc = first.headers.get("location");
    await first.body?.cancel();
    if (!loc) return { added: 0, skipped: 0, created: false, unconfirmed: true };
    res = await fetch(loc);
  }
  const text = await res.text();
  let body: { ok?: boolean; error?: string; added?: number; skipped?: number; created?: boolean };
  try {
    body = JSON.parse(text);
  } catch {
    if (moved) return { added: 0, skipped: 0, created: false, unconfirmed: true };
    throw new Error(`Скрипт таблицы ответил не JSON (HTTP ${res.status}) — проверьте ссылку /exec, развёртывание и доступ «Все»`);
  }
  if (!body.ok) throw new Error(`«${tab}»: ${body.error || "скрипт вернул ошибку"}`);
  return { added: Number(body.added ?? 0), skipped: Number(body.skipped ?? 0), created: body.created === true, unconfirmed: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));

    const nowMsk = new Date(Date.now() + MSK).toISOString();
    const today = nowMsk.slice(0, 10);
    // кто зовёт: расписание (секрет) или руководитель отдела из CRM
    const cron = Deno.env.get("CRON_SECRET");
    const byCron = !!cron && req.headers.get("x-cron-secret") === cron;
    let who = `Авто ${nowMsk.slice(11, 13)}:00`;
    if (!byCron) {
      const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
      const { data: isHead, error } = await asCaller.rpc("crm_is_head");
      if (error) return json({ error: error.message }, 401);
      if (isHead !== true) return json({ error: "Выгружать лиды в таблицу может только руководитель отдела" }, 403);
      const { data: u } = await asCaller.auth.getUser();
      who = `${u.user?.user_metadata?.name || u.user?.email || "РОП"} · Google`;
    }

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: kv, error: kErr } = await admin.from("kv").select("key, value").in("key", ["sheets", "leadSheetMarks"]);
    if (kErr) return json({ error: kErr.message }, 500);
    const val = (k: string) => kv?.find((r) => r.key === k)?.value as unknown;
    const sheets = (val("sheets") ?? {}) as { leads?: Cfg; drops?: Cfg };
    const cfg: Cfg = sheets.leads ?? sheets.drops ?? {};
    if (!cfg.url || !cfg.token) return json({ skipped: "Таблица лидов не настроена (Настройки → Данные → «Таблица лидов для ОКК»)" });
    if (byCron && cfg.auto !== true) return json({ skipped: "Автовыгрузка выключена в настройках CRM" });
    const owner = (cfg.owner ?? "").trim() || "Борис";
    const marks = { ...((val("leadSheetMarks") ?? {}) as Record<string, string>) };

    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 10000) : [];
    const byIds = !byCron && ids.length > 0;
    const from = isDay(body.from) ? body.from : yesterday;
    const to = isDay(body.to) ? body.to : today;
    if (from > to) return json({ error: "Начало периода позже конца" }, 400);

    const cols = "id, at, link, phone, client, operator_id";
    let leads: LeadRow[] = [];
    if (byIds) {
      // выбранные в CRM лиды — пачками по 200 id
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await admin.from("leads").select(cols).in("id", ids.slice(i, i + 200));
        if (error) return json({ error: error.message }, 500);
        leads.push(...((data ?? []) as LeadRow[]));
      }
    } else {
      // за период — страницами (PostgREST отдаёт не больше 1000 за раз); только ещё не отправленные
      for (let off = 0; ; off += 1000) {
        const { data, error } = await admin.from("leads").select(cols).gte("at", from).lte("at", `${to}T23:59`).order("at").range(off, off + 999);
        if (error) return json({ error: error.message }, 500);
        leads.push(...((data ?? []) as LeadRow[]));
        if (!data || data.length < 1000) break;
      }
      leads = leads.filter((l) => !marks[l.id]);
    }
    leads.sort((a, b) => a.at.localeCompare(b.at));
    if (!leads.length) return json({ from, to, leads: 0, added: 0, skipped: 0, unconfirmed: 0, created: [], note: "Новых лидов для таблицы нет" });

    const { data: ops, error: oErr } = await admin.from("operators").select("id, name");
    if (oErr) return json({ error: oErr.message }, 500);
    const names = new Map<string, string>(((ops ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
    const opName = (id: string) => names.get(id) ?? "";

    // по листам месяца: вчера могло быть в прошлом месяце
    const byTab = new Map<string, LeadRow[]>();
    for (const l of leads) {
      const t = tabOf(l.at.slice(0, 10), owner);
      byTab.set(t, [...(byTab.get(t) ?? []), l]);
    }
    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;
    let unconfirmed = 0;
    const created: string[] = [];
    let failed = "";
    for (const [tab, list] of byTab) {
      try {
        const r = await push(cfg, tab, list.map((l) => row(l, opName)));
        added += r.added;
        skipped += r.skipped;
        if (r.unconfirmed) unconfirmed += list.length;
        if (r.created) created.push(tab);
        // отправленные — отмечаем: и дописанные, и те, что уже были на листе
        for (const l of list) marks[l.id] = now;
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
        break;
      }
    }

    // отметки «уже в таблице» (старые забываем) и строка в истории выгрузок CRM
    const keepFrom = new Date(Date.now() - MARKS_KEEP_DAYS * DAY).toISOString();
    for (const [id, at] of Object.entries(marks)) if (at < keepFrom) delete marks[id];
    const { data: logRow } = await admin.from("kv").select("value").eq("key", "leadExportLog").maybeSingle();
    const prev = Array.isArray(logRow?.value) ? (logRow!.value as unknown[]) : [];
    const sent = added + unconfirmed;
    const entry = { at: now, by: who, count: sent, from, to, kind: "sheet" };
    await admin.from("kv").upsert(
      [
        { key: "leadSheetMarks", value: marks, updated_at: now },
        ...(sent || created.length ? [{ key: "leadExportLog", value: [entry, ...prev].slice(0, 200), updated_at: now }] : []),
      ],
      { onConflict: "key" },
    );
    if (sent || created.length) {
      await admin.from("audit").insert({
        id: `au-ls-${Date.now().toString(36)}`,
        at: now,
        account_id: "",
        account_name: who,
        entity: "lead",
        entity_id: "sheet",
        summary: `Лиды в таблицу ОКК за ${ru(from).slice(0, 5)}–${ru(to).slice(0, 5)}: добавлено ${added}${unconfirmed ? `, без подтверждения ${unconfirmed}` : ""}, уже были ${skipped}${created.length ? `, новый лист «${created.join("», «")}»` : ""}`,
      });
    }
    if (failed) return json({ error: failed, added, skipped, unconfirmed }, 502);
    return json({ from, to, leads: leads.length, added, skipped, unconfirmed, created, tabs: [...byTab.keys()] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
