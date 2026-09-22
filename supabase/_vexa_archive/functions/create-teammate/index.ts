// ============================================================================
// Edge Function: create-teammate
// ----------------------------------------------------------------------------
// Владелец или руководитель заводит аккаунт сотрудника. Реальное создание
// auth-юзера требует service_role — его нельзя светить на клиенте, поэтому это
// серверная функция.
//
// Деплой:
//   supabase functions deploy create-teammate
// Секреты (в проекте Supabase есть по умолчанию — проверить `supabase secrets list`):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Клиент зовёт:
//   supabase.functions.invoke("create-teammate", { body: { workspaceId, email, name, role, password } })
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Клиент от имени вызывающего — узнать, кто он.
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: uErr,
    } = await asCaller.auth.getUser();
    if (uErr || !user) return json({ error: "not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role: "member" | "lead" = body.role === "lead" ? "lead" : "member";
    const password = String(body.password ?? "");
    if (!workspaceId || !email.includes("@") || password.length < 8) {
      return json({ error: "workspaceId, email and password (min 8) required" }, 400);
    }

    // service_role: обходит RLS, но не триггеры (лимит мест уже снят миграцией).
    const admin = createClient(url, service, { auth: { persistSession: false } });

    // Роль вызывающего в этом воркспейсе.
    const { data: mem } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!mem || (mem.role !== "owner" && mem.role !== "lead")) return json({ error: "forbidden" }, 403);
    // Руководителя может назначить только владелец.
    if (role === "lead" && mem.role !== "owner") return json({ error: "only the owner can create leads" }, 403);

    // Уже есть такой профиль? Тогда просто добавим его в воркспейс.
    const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();

    let uid: string;
    if (existingProfile) {
      uid = existingProfile.id;
    } else {
      // Создаём auth-юзера; триггер handle_new_user заведёт profiles.
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: name || email.split("@")[0] },
      });
      if (cErr || !created.user) return json({ error: cErr?.message ?? "create failed" }, 400);
      uid = created.user.id;
      if (name) await admin.from("profiles").update({ display_name: name }).eq("id", uid);
    }

    // Сажаем в воркспейс.
    const { error: mErr } = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: uid, role });
    if (mErr) {
      // Откат: не оставляем «висячего» свежесозданного юзера без воркспейса.
      if (!existingProfile) await admin.auth.admin.deleteUser(uid);
      return json({ error: mErr.message }, 400);
    }

    return json({ ok: true, userId: uid, email, name, role, reused: !!existingProfile });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
