// ============================================================================
// Edge Function: send-due-reminders
// ----------------------------------------------------------------------------
// Напоминания и сроки задач, дозревшие к этой минуте, — в Telegram.
//
// Зачем сервер. Сторож напоминаний живёт в клиенте (lib/store.tsx, интервал раз
// в минуту), поэтому напоминание существует ровно пока открыта вкладка: закрыл
// ноутбук — «позвонить в 19:00» не придёт вовсе. Отсюда всё остальное: функцию
// дёргает расписание в БД (pg_cron → pg_net, см. 20260722000007), а не клиент.
//
// Кому шлём. bot_recipients.user_id — привязка «этот телеграм = этот сотрудник».
// Адресату уходит только его: напоминание про свою сделку, а не сводка команды.
// Некому слать (никто не привязан / нет chat_id) — не шлём никому: рассылка
// чужих напоминаний всей команде хуже молчания.
//
// Деплой:
//   supabase functions deploy send-due-reminders
//   supabase secrets set TELEGRAM_BOT_TOKEN=...
// Расписание: см. хвост миграции 20260722000007_server_reminders.sql.
//
// Вызов вручную (для проверки):
//   curl -X POST https://<ref>.supabase.co/functions/v1/send-due-reminders \
//        -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Статусы, на которых сделка закончена: напоминание по ней — хвост, а не дело. */
const TERMINAL = new Set(["paid", "minus"]);

const DAY_MS = 86_400_000;

const esc = (s: string) => s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

const RU_MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «14 июл, 15:00» — тот же вид, что человек видит в интерфейсе. */
function fmtDue(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  const day = `${String(d.getUTCDate()).padStart(2, "0")} ${RU_MONTHS[d.getUTCMonth()]}`;
  if (allDay) return day;
  return `${day}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

async function sendTelegram(token: string, chatId: number, html: string): Promise<string> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const body = await r.json().catch(() => ({}));
    // Ошибку возвращаем текстом, а не бросаем: одна недоставка не должна
    // отменять рассылку остальным, но и потеряться молча не должна.
    return r.ok && body?.ok ? "" : String(body?.description ?? `http ${r.status}`);
  } catch (e) {
    return String(e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!url || !service) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, 500);
  if (!token) return json({ error: "TELEGRAM_BOT_TOKEN missing" }, 500);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Кому вообще есть куда слать. Одним запросом на всех: получателей десятки,
  // а запрос на каждое напоминание превратил бы тик в сотню round-trip-ов.
  const { data: recips, error: rErr } = await admin
    .from("bot_recipients")
    .select("workspace_id, user_id, chat_id, muted")
    .not("user_id", "is", null)
    .not("chat_id", "is", null)
    .eq("muted", false);
  if (rErr) return json({ error: rErr.message }, 500);

  const chatOf = new Map<string, number>();
  for (const r of recips ?? []) chatOf.set(`${r.workspace_id}:${r.user_id}`, Number(r.chat_id));
  if (!chatOf.size) return json({ ok: true, sent: 0, note: "no linked recipients" });

  type Job = { workspace_id: string; kind: "reminder" | "task"; ref_id: string; dueAt: string; chat: number; text: string };
  const jobs: Job[] = [];

  // ── напоминания по контактам ──────────────────────────────────────────
  const { data: cands, error: cErr } = await admin
    .from("candidates")
    .select("id, workspace_id, name, assignee, status, reminder_at, reminder_label")
    .not("reminder_at", "is", null)
    .lte("reminder_at", nowIso);
  if (cErr) return json({ error: cErr.message }, 500);

  for (const c of cands ?? []) {
    if (!c.assignee || TERMINAL.has(String(c.status ?? ""))) continue;
    const chat = chatOf.get(`${c.workspace_id}:${c.assignee}`);
    if (!chat) continue;
    jobs.push({
      workspace_id: c.workspace_id,
      kind: "reminder",
      ref_id: c.id,
      dueAt: new Date(c.reminder_at).toISOString(),
      chat,
      text: `🔔 <b>Напоминание</b>\n${esc(c.name ?? "")}${c.reminder_label ? `\n${esc(c.reminder_label)}` : ""}`,
    });
  }

  // ── сроки задач ───────────────────────────────────────────────────────
  //
  // Срок задачи в БД — due_at (timestamptz) плюс флаг due_all_day; строка вида
  // «14 июл, 15:00» существует только в интерфейсе, разбирать её здесь нечего.
  //
  // Фильтр `due_at <= now` — намеренно широкий: у задачи без времени due_at
  // указывает на начало дня, а «горит» она в конце — иначе задача на сегодня
  // улетала бы в телеграм ночью, до начала рабочего дня. Такие отсеиваем ниже.
  const { data: tasks, error: tErr } = await admin
    .from("crm_tasks")
    .select("id, workspace_id, title, assignee, due_at, due_all_day, done")
    .eq("done", false)
    .not("due_at", "is", null)
    .lte("due_at", nowIso);
  if (tErr) return json({ error: tErr.message }, 500);

  for (const t of tasks ?? []) {
    if (!t.assignee) continue;
    const chat = chatOf.get(`${t.workspace_id}:${t.assignee}`);
    if (!chat) continue;
    const base = new Date(t.due_at).getTime();
    const dueMs = t.due_all_day ? base + DAY_MS - 1 : base;
    if (dueMs > now) continue;
    jobs.push({
      workspace_id: t.workspace_id,
      kind: "task",
      ref_id: t.id,
      // Ключ идемпотентности — исходный due_at, а не вычисленный момент: сдвиг
      // срока обязан дать новую отправку, пересчёт «конца дня» — нет.
      dueAt: new Date(base).toISOString(),
      chat,
      text: `⏰ <b>Задача к сроку</b>\n${esc(t.title ?? "")}\n${esc(fmtDue(t.due_at, t.due_all_day))}`,
    });
  }

  if (!jobs.length) return json({ ok: true, sent: 0 });

  // Что уже отправляли. Проверяем до отправки, а не только уникальным индексом:
  // индекс спасёт от дубля в журнале, но сообщение к тому моменту уже уйдёт.
  const { data: already } = await admin
    .from("reminder_deliveries")
    .select("kind, ref_id, due_at")
    .in("ref_id", jobs.map((j) => j.ref_id));
  const seen = new Set((already ?? []).map((d) => `${d.kind}:${d.ref_id}:${new Date(d.due_at).toISOString()}`));

  let sent = 0;
  let failed = 0;
  for (const j of jobs) {
    if (seen.has(`${j.kind}:${j.ref_id}:${j.dueAt}`)) continue;

    // Отметку ставим ДО отправки. Если функция упадёт между отправкой и записью,
    // человек получит напоминание дважды; при обратном порядке — не получит
    // вовсе. Из двух отказов повтор безобиднее пропажи.
    const { error: insErr } = await admin.from("reminder_deliveries").insert({
      workspace_id: j.workspace_id,
      kind: j.kind,
      ref_id: j.ref_id,
      due_at: j.dueAt,
      chat_id: j.chat,
    });
    // Уникальный индекс сработал — значит параллельный запуск уже занял слот.
    if (insErr) continue;

    const err = await sendTelegram(token, j.chat, j.text);
    if (err) {
      failed++;
      await admin
        .from("reminder_deliveries")
        .update({ error: err.slice(0, 500) })
        .eq("kind", j.kind)
        .eq("ref_id", j.ref_id)
        .eq("due_at", j.dueAt);
    } else {
      sent++;
    }
  }

  return json({ ok: true, sent, failed, due: jobs.length });
});
