// Тесты SQL-миграции привязки Telegram на настоящем Postgres (PGlite — Postgres в WASM).
//
//   npm run test:telegram-sql
//
// Поднимает пустую базу, эмулирует то, что даёт Supabase (роли anon / authenticated /
// service_role, auth.jwt()), применяет схему CRM и миграцию Telegram и проверяет
// поведение RPC и прав ровно так, как их вызовет CRM (роль authenticated + почта в JWT)
// и бот (service_role).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

let db;
let failed = 0;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.stack : e}`);
  } finally {
    await db.exec("reset role; reset request.jwt.claims;");
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: ожидали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`);
}

/** Выполнить как вошедший в CRM пользователь с этой почтой. */
async function asUser(email, sql, params = []) {
  await db.exec(`set role authenticated; set request.jwt.claims = '${JSON.stringify({ email, role: "authenticated" })}';`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role; reset request.jwt.claims;");
  }
}
async function asService(sql, params = []) {
  await db.exec("set role service_role;");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
async function asAnon(sql, params = []) {
  await db.exec("set role anon;");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
async function rejects(p, re, msg) {
  try {
    await p;
  } catch (e) {
    if (re && !re.test(String(e?.message ?? e))) throw new Error(`${msg}: неожиданная ошибка ${e?.message ?? e}`);
    return;
  }
  throw new Error(`${msg}: ожидали ошибку`);
}

const createCode = async (email) => (await asUser(email, "select public.crm_telegram_link_create() as r")).rows[0].r;
const consume = async (code, tg, username = "maria", first = "Мария", last = "Соколова") =>
  (await asService("select public.telegram_link_consume($1, $2, $3, $4, $5) as r", [code, tg, username, first, last])).rows[0].r;
const status = async (email, op = null) => (await asUser(email, "select public.crm_telegram_status($1) as r", [op])).rows[0].r;

async function main() {
  db = new PGlite();
  await db.exec(SHIM);
  await db.exec(read("supabase/migrations/20260921000001_crm_schema.sql"));
  const migration = read("supabase/migrations/20260923000001_telegram_link.sql");
  await db.exec(migration);
  // повторный запуск миграции безопасен
  await db.exec(migration);

  await db.exec(`
    insert into public.groups (id, name) values ('g1', 'Авто');
    insert into public.operators (id, name, group_id) values
      ('op_maria', 'Мария Соколова', 'g1'), ('op_ivan', 'Иван Петров', 'g1'), ('op_fired', 'Пётр Уволенный', 'g1');
    update public.operators set status = 'fired' where id = 'op_fired';
    insert into public.accounts (id, name, login, role, operator_id) values
      ('acc_head', 'РОП', 'head@x.ru', 'head', null),
      ('acc_maria', 'Мария', 'maria@x.ru', 'operator', 'op_maria'),
      ('acc_ivan', 'Иван', 'ivan@x.ru', 'operator', 'op_ivan'),
      ('acc_nocard', 'Без карточки', 'nocard@x.ru', 'operator', null);
    insert into public.telegram_bot_state (key, value) values ('bot_username', 'VexiLeadupBot');
  `);

  console.log("telegram link SQL");

  await test("1. код создаётся: 6 цифр, 15 минут, в базе только хэш", async () => {
    const r = await createCode("maria@x.ru");
    assert(/^[0-9]{6}$/.test(r.code), `код: ${r.code}`);
    eq(r.ttl_seconds, 900, "срок жизни");
    eq(r.bot_username, "VexiLeadupBot", "имя бота из telegram_bot_state");
    const ms = new Date(r.expires_at).getTime() - Date.now();
    assert(ms > 14 * 60_000 && ms <= 15 * 60_000 + 5000, `expires_at через ${ms} мс`);
    const row = (await db.query("select * from public.telegram_link_codes where operator_id = 'op_maria' and used_at is null and revoked_at is null")).rows;
    eq(row.length, 1, "один живой код");
    assert(row[0].code_hash !== r.code && row[0].code_hash.length === 64, "хранится sha256, не код");
    const st = await status("maria@x.ru");
    assert(st.pending_code_expires_at, "статус видит ожидающий код");
    eq(st.linked, false, "ещё не привязан");
  });

  await test("новый код гасит предыдущий", async () => {
    const a = await createCode("maria@x.ru");
    const b = await createCode("maria@x.ru");
    const live = (await db.query("select count(*)::int n from public.telegram_link_codes where operator_id = 'op_maria' and used_at is null and revoked_at is null")).rows[0].n;
    eq(live, 1, "живой код один");
    if (a.code !== b.code) eq((await consume(a.code, 111)).reason, "revoked", "старый код");
  });

  await test("без карточки оператора код не выдаётся; аноним RPC не вызывает", async () => {
    await rejects(createCode("nocard@x.ru"), /не привязан к карточке/, "аккаунт без карточки");
    await rejects(createCode("stranger@x.ru"), /Нет доступа/, "чужая почта");
    await rejects(asAnon("select public.crm_telegram_link_create()"), /permission denied/, "anon");
  });

  await test("2. просроченный код не принимается", async () => {
    const r = await createCode("maria@x.ru");
    await db.exec("update public.telegram_link_codes set expires_at = now() - interval '1 second' where operator_id = 'op_maria' and used_at is null and revoked_at is null");
    const res = await consume(r.code, 222);
    eq(res.ok, false, "ok");
    eq(res.reason, "expired", "причина");
    eq((await db.query("select count(*)::int n from public.operator_telegram")).rows[0].n, 0, "привязки нет");
  });

  await test("5. привязка по коду: пишет Telegram ID и профиль, гасит код", async () => {
    const r = await createCode("maria@x.ru");
    const res = await consume(r.code, 5550001, "@maria_s", "Мария", "Соколова");
    eq(res.ok, true, "ok");
    eq(res.operator_id, "op_maria", "оператор");
    eq(res.operator_name, "Мария Соколова", "имя для ответа");
    const link = (await db.query("select * from public.operator_telegram where operator_id = 'op_maria'")).rows[0];
    eq(Number(link.telegram_user_id), 5550001, "telegram_user_id");
    eq(link.telegram_username, "maria_s", "username без @");
    const code = (await db.query("select * from public.telegram_link_codes where operator_id = 'op_maria' order by created_at desc limit 1")).rows[0];
    assert(code.used_at && Number(code.used_by) === 5550001, "код помечен использованным");
    const st = await status("maria@x.ru");
    eq(st.linked, true, "статус: привязан");
    eq(st.username, "maria_s", "статус: username");
    eq(st.pending_code_expires_at, null, "ожидающего кода нет");
    assert(!("telegram_user_id" in st), "Telegram ID в статус не попадает");
  });

  await test("3. использованный код второй раз не работает (другой человек)", async () => {
    const r = await createCode("ivan@x.ru");
    eq((await consume(r.code, 7770001, "ivan")).ok, true, "первая привязка");
    const again = await consume(r.code, 7770002, "other");
    eq(again.ok, false, "повтор");
    eq(again.reason, "used", "причина");
    eq(Number((await db.query("select telegram_user_id from public.operator_telegram where operator_id = 'op_ivan'")).rows[0].telegram_user_id), 7770001, "привязка не перезаписана");
  });

  await test("18. повтор той же ссылки тем же человеком идемпотентен", async () => {
    const r = await createCode("ivan@x.ru");
    eq((await consume(r.code, 7770001)).ok, true, "первый раз");
    const again = await consume(r.code, 7770001);
    eq(again.ok, true, "второй раз не ошибка");
    eq(again.repeat, true, "помечен как повтор");
    eq((await db.query("select count(*)::int n from public.operator_telegram where telegram_user_id = 7770001")).rows[0].n, 1, "одна привязка");
  });

  await test("4. один Telegram нельзя привязать к двум операторам", async () => {
    const r = await createCode("ivan@x.ru");
    const res = await consume(r.code, 5550001); // это Telegram Марии
    eq(res.ok, false, "ok");
    eq(res.reason, "telegram_taken", "причина");
    const live = (await db.query("select count(*)::int n from public.telegram_link_codes where operator_id = 'op_ivan' and used_at is null and revoked_at is null")).rows[0].n;
    eq(live, 1, "код Ивана не сгорел — можно повторить из своего Telegram");
    await rejects(db.query("insert into public.operator_telegram (operator_id, telegram_user_id) values ('op_x', 5550001)"), /duplicate key|unique/, "уникальный индекс");
  });

  await test("переподключение на другой Telegram: старый уходит в очередь снятия тега", async () => {
    const r = await createCode("maria@x.ru");
    const res = await consume(r.code, 5550002, "maria_new");
    eq(res.ok, true, "ok");
    eq(Number(res.previous_telegram_user_id), 5550001, "прошлый Telegram");
    const q = (await db.query("select * from public.telegram_unlinks where telegram_user_id = 5550001 and processed_at is null")).rows;
    eq(q.length, 1, "в очереди");
    eq(q[0].reason, "relink", "причина");
  });

  await test("Telegram уволенного оператора можно привязать заново", async () => {
    await db.exec("insert into public.operator_telegram (operator_id, telegram_user_id) values ('op_fired', 9990001)");
    await db.exec("delete from public.operator_telegram where operator_id = 'op_ivan'");
    const r = await createCode("ivan@x.ru");
    const res = await consume(r.code, 9990001);
    eq(res.ok, true, "ok");
    eq((await db.query("select count(*)::int n from public.operator_telegram where operator_id = 'op_fired'")).rows[0].n, 0, "старая привязка снята");
  });

  await test("неверный формат и перебор кодов ограничены", async () => {
    eq((await consume("12ab56", 4440001)).reason, "bad_format", "формат");
    for (let i = 0; i < 8; i++) await consume(String(100000 + i), 4440002);
    eq((await consume("999999", 4440002)).reason, "rate_limited", "после 8 промахов — пауза");
  });

  await test("права: чужие привязки, коды и соль не читаются", async () => {
    const own = await asUser("maria@x.ru", "select operator_id from public.operator_telegram");
    eq(own.rows.length, 1, "оператор видит только свою строку");
    eq(own.rows[0].operator_id, "op_maria", "свою");
    await rejects(asUser("maria@x.ru", "select * from public.telegram_link_codes"), /permission denied/, "коды");
    await rejects(asUser("maria@x.ru", "select * from public.telegram_secrets"), /permission denied/, "соль");
    await rejects(asUser("maria@x.ru", "update public.operator_telegram set telegram_user_id = 1"), /permission denied/, "запись напрямую");
    await rejects(asAnon("select * from public.operator_telegram"), /permission denied/, "anon");
    await rejects(asUser("maria@x.ru", "select public.telegram_link_consume('123456', 1)"), /permission denied/, "consume из CRM");
    await rejects(status("maria@x.ru", "op_ivan"), /Нет доступа/, "чужой статус");
    eq((await status("head@x.ru", "op_maria")).linked, true, "РОП видит статус оператора");
  });

  await test("9. отключение: привязка удаляется, Telegram в архиве и очереди", async () => {
    const res = (await asUser("maria@x.ru", "select public.crm_telegram_unlink() as r")).rows[0].r;
    eq(res.was_linked, true, "был привязан");
    eq((await status("maria@x.ru")).linked, false, "статус");
    const q = (await db.query("select * from public.telegram_unlinks where telegram_user_id = 5550002 and reason = 'unlink'")).rows;
    eq(q.length, 1, "архив");
    const again = (await asUser("maria@x.ru", "select public.crm_telegram_unlink() as r")).rows[0].r;
    eq(again.was_linked, false, "повторное отключение безопасно");
    await rejects(asUser("maria@x.ru", "select public.crm_telegram_unlink('op_ivan')"), /Нет доступа/, "чужой Telegram не отключить");
  });

  await test("восстановление копии (crm_replace_all) не ломается о привязки", async () => {
    // CRM присылает полные строки (remote.ts → toRow) — берём снимок текущих
    const snap = (
      await db.query(`select jsonb_build_object(
        'groups', (select jsonb_agg(g) from public.groups g),
        'operators', (select jsonb_agg(o) from public.operators o),
        'accounts', (select jsonb_agg(a) from public.accounts a)) as p`)
    ).rows[0].p;
    await asUser("head@x.ru", "select public.crm_replace_all($1)", [snap]);
    eq((await db.query("select count(*)::int n from public.operator_telegram where operator_id = 'op_ivan'")).rows[0].n, 1, "привязка пережила восстановление");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
