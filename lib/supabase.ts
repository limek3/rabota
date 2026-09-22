"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// новый publishable-ключ (sb_publishable_…) или старый anon — оба публичные
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** true when .env.local is filled in — the app falls back to demo mode otherwise. */
export const supabaseReady = Boolean(url && anon);

let client: SupabaseClient | null = null;

/**
 * Browser-only singleton. The app is a static export (next.config.mjs → output:
 * "export"), so there is no server to hold the session — it lives in
 * localStorage and is refreshed by the SDK.
 */
export function supabase(): SupabaseClient {
  if (!supabaseReady) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local"
    );
  }
  if (!client) {
    client = createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "leadup-auth",
      },
    });
  }
  return client;
}
