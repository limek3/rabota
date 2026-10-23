"use client";

import { supabase } from "@/lib/supabase";

/**
 * Ссылка на лид Скорозвона по номеру клиента (функция skorozvon-link): оператор вставил номер вместо
 * ссылки — находим его последний звонок за 20 минут и собираем …/#/leads/<лид>/answer/<звонок>/+7….
 */
export async function findSkorozvonLink(phone: string): Promise<string> {
  const { data, error } = await supabase().functions.invoke("skorozvon-link", { body: { phone } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      // своя ошибка функции — в error; функции нет — шлюз Supabase пишет «Requested function was not found» в message
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        msg = j.error ?? j.message ?? msg;
      }
    } catch {
      /* не JSON */
    }
    if (/not found|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`) && !/Скорозвон|звон/.test(msg))
      msg = "Поиск по номеру ещё не включён — скопируйте ссылку из Скорозвона (руководителю: supabase/README.md, пункт 16)";
    throw new Error(msg);
  }
  const link = String((data as { link?: string } | null)?.link ?? "");
  if (!link) throw new Error("Скорозвон не вернул ссылку — скопируйте её из карточки звонка");
  return link;
}
