// ============================================================================
// Edge Function: crm-users — вход сотрудника в CRM (почта + пароль).
// ----------------------------------------------------------------------------
// Регистрации в CRM нет: вход сотруднику создаёт руководитель из «Настройки →
// Аккаунты». Создать пользователя Supabase Auth можно только секретным ключом —
// ему место на сервере, поэтому это функция.
//
// Деплой (без CLI): Supabase → Edge Functions → Deploy a new function → Via Editor →
// имя crm-users → вставить этот файл → Deploy. Или CLI: supabase functions deploy crm-users
// Ключи SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY в функциях есть по умолчанию.
//
// Клиент: supabase.functions.invoke("crm-users", { body: { email, password, name } })
//   — нет такого пользователя: создаёт (почта сразу подтверждена);
//   — есть: меняет пароль.
// Звать может только РОП (проверка через public.crm_is_head() от имени вызывающего).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // от имени вызывающего: права решает база, как и везде в CRM
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: isHead, error: hErr } = await asCaller.rpc("crm_is_head");
    if (hErr) return json({ error: hErr.message }, 401);
    if (isHead !== true) return json({ error: "Создавать вход может только руководитель отдела" }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Некорректная почта" }, 400);
    if (password.length < 8) return json({ error: "Пароль — минимум 8 символов" }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || email.split("@")[0] },
    });
    if (!cErr && created.user) return json({ ok: true, created: true });

    // уже есть — находим и меняем пароль
    if (!/already|registered|exists/i.test(cErr?.message ?? "")) return json({ error: cErr?.message ?? "Не удалось создать вход" }, 400);
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ error: error.message }, 400);
      const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
      if (u) {
        const { error: uErr } = await admin.auth.admin.updateUserById(u.id, { password, email_confirm: true });
        if (uErr) return json({ error: uErr.message }, 400);
        return json({ ok: true, created: false });
      }
      if (data.users.length < 200) break;
    }
    return json({ error: "Пользователь с этой почтой не найден" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
