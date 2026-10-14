// Тесты SQL «супервайзер заводит аккаунты операторам» на настоящем Postgres (PGlite).
//
//   npm run test:accounts-sql
//
// Схема CRM + «Обучение команды» + 20261014000001_supervisor_accounts.sql; дальше — вставки и правки
// аккаунтов от имени РОПа, супервайзера и оператора (роль authenticated + почта в JWT), как их делает CRM.
// Плюс проверка, что ежечасное расписание часов из Скорозвона правильно переписывает тело запроса.

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

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: ожидали ${JSON.stringify(b)}, получили ${JSON.stringify(a)}`);
}

async function as(email, sql, params = []) {
  await db.exec(`set role authenticated; set request.jwt.claims = '${JSON.stringify({ email, role: "authenticated" })}';`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role; reset request.jwt.claims;");
  }
}

async function rejects(p, msg) {
  try {
    await p;
  } catch {
    return;
  }
  throw new Error(`${msg}: ожидали отказ`);
}

const HEAD = "head@x.ru";
const SUP = "sup@x.ru";
const OP2 = "op2@x.ru";

const ins = (id, login, role, op, groups = "{}") =>
  as(SUP, `insert into public.accounts (id, name, login, role, operator_id, group_ids) values ($1, $1, $2, $3, $4, $5::text[])`, [id, login, role, op, groups]);

async function main() {
  db = new PGlite();
  await db.exec(SHIM);
  await db.exec(read("supabase/migrations/20260921000001_crm_schema.sql"));
  await db.exec(read("supabase/migrations/20261001000001_team_learning.sql"));
  await db.exec(read("supabase/migrations/20261014000001_supervisor_accounts.sql"));
  // повторный запуск безопасен
  await db.exec(read("supabase/migrations/20261014000001_supervisor_accounts.sql"));

  await db.exec(`
    insert into public.groups (id, name) values ('g1', 'Альфа'), ('g2', 'Бета');
    insert into public.operators (id, name, group_id, role) values
      ('op_sv', 'Супервайзер', 'g1', 'supervisor'),
      ('op1', 'Оператор Один', 'g1', 'operator'),
      ('op1b', 'Оператор Полтора', 'g1', 'operator'),
      ('op_sv2', 'Второй СВ', 'g1', 'supervisor'),
      ('op2', 'Оператор Два', 'g2', 'operator');
    insert into public.accounts (id, name, login, role, operator_id, group_ids) values
      ('acc_head', 'РОП', '${HEAD}', 'head', null, '{}'),
      ('acc_sup', 'СВ', '${SUP}', 'supervisor', 'op_sv', '{g1}'),
      ('acc_op2', 'Два', '${OP2}', 'operator', 'op2', '{}'),
      ('acc_old_sv', 'Бывший СВ', 'old@x.ru', 'supervisor', null, '{}');
    update public.accounts set deleted_at = now(), active = false where id = 'acc_old_sv';
  `);

  await test("СВ создаёт аккаунт оператору своей группы", async () => {
    await ins("acc_op1", "op1@x.ru", "operator", "op1");
    eq((await as(SUP, "select count(*)::int n from public.accounts where id = 'acc_op1'")).rows[0].n, 1, "видит созданный");
  });
  await test("СВ не создаёт аккаунт оператору чужой группы", () => rejects(ins("acc_x", "x@x.ru", "operator", "op2"), "чужая группа"));
  await test("СВ не создаёт аккаунт супервайзера", () => rejects(ins("acc_y", "y@x.ru", "supervisor", "op1b"), "роль СВ"));
  await test("СВ не создаёт аккаунт на карточку супервайзера", () => rejects(ins("acc_z", "z@x.ru", "operator", "op_sv2"), "карточка СВ"));
  await test("СВ не создаёт оператору аккаунт с группами под управлением", () => rejects(ins("acc_w", "w@x.ru", "operator", "op1b", "{g1}"), "группы"));
  await test("СВ меняет почту и выключает аккаунт своего оператора", async () => {
    const r = await as(SUP, "update public.accounts set login = 'op1new@x.ru', active = false where id = 'acc_op1' returning id");
    eq(r.rows.length, 1, "обновлено");
  });
  await test("СВ не делает своего оператора супервайзером", () =>
    rejects(as(SUP, "update public.accounts set role = 'supervisor' where id = 'acc_op1'"), "смена роли"));
  await test("СВ не перепривязывает аккаунт к оператору чужой группы", () =>
    rejects(as(SUP, "update public.accounts set operator_id = 'op2' where id = 'acc_op1'"), "чужая карточка"));
  await test("СВ не видит и не меняет аккаунт РОПа и чужого оператора", async () => {
    const seen = (await as(SUP, "select id from public.accounts order by id")).rows.map((r) => r.id).join(",");
    eq(seen, "acc_op1,acc_sup", "видимые аккаунты");
    eq((await as(SUP, "update public.accounts set name = 'x' where id = 'acc_op2' returning id")).rows.length, 0, "чужой не меняется");
  });
  await test("Свой аккаунт СВ: имя можно, почту нельзя", async () => {
    eq((await as(SUP, "update public.accounts set name = 'Новое имя' where id = 'acc_sup' returning id")).rows.length, 1, "имя");
    await rejects(as(SUP, "update public.accounts set login = 'me2@x.ru' where id = 'acc_sup'"), "почта своего");
  });
  await test("Пароль: СВ — только почте своего оператора", async () => {
    eq((await as(SUP, "select public.crm_can_set_login('op1new@x.ru') r")).rows[0].r, true, "свой оператор");
    eq((await as(SUP, "select public.crm_can_set_login($1) r", [HEAD])).rows[0].r, false, "почта РОПа");
    eq((await as(SUP, "select public.crm_can_set_login($1) r", [OP2])).rows[0].r, false, "чужой оператор");
    eq((await as(SUP, "select public.crm_can_set_login('nobody@x.ru') r")).rows[0].r, false, "нет аккаунта");
    eq((await as(HEAD, "select public.crm_can_set_login('nobody@x.ru') r")).rows[0].r, true, "РОП — любую");
  });
  await test("Почта бывшего СВ не уходит оператору ради смены пароля", async () => {
    await as(SUP, "update public.accounts set login = 'old@x.ru' where id = 'acc_op1'");
    eq((await as(SUP, "select public.crm_can_set_login('old@x.ru') r")).rows[0].r, false, "почта была у СВ");
  });
  await test("Оператор не создаёт аккаунты", () =>
    rejects(as(OP2, "insert into public.accounts (id, name, login, role, operator_id) values ('acc_q', 'q', 'q@x.ru', 'operator', 'op2')"), "оператор"));
  await test("Право выключено в «Ролях и доступе» — СВ не создаёт", async () => {
    await db.exec(`insert into public.kv (key, value) values ('settings', '{"access":{"supervisor":{"opAccounts":false}}}')`);
    await rejects(ins("acc_v", "v@x.ru", "operator", "op1b"), "флаг выключен");
    await db.exec("delete from public.kv where key = 'settings'");
  });
  await test("РОП по-прежнему ведёт любые аккаунты", async () => {
    await as(HEAD, "insert into public.accounts (id, name, login, role, operator_id, group_ids) values ('acc_s2', 'СВ2', 's2@x.ru', 'supervisor', 'op_sv2', '{g1,g2}')");
    eq((await as(HEAD, "update public.accounts set role = 'operator' where id = 'acc_op2' returning id")).rows.length, 1, "правка");
  });

  // ── ежечасные часы из Скорозвона: тело запроса из старого задания ──
  await test("Расписание часов: тело '{}' → дата по Москве десять минут назад", async () => {
    const sql = read("supabase/migrations/20261014000002_shift_hours_hourly.sql");
    const re = /regexp_replace\(\s*v_cmd,\s*'([^']+)',\s*'((?:[^']|'')+)'\s*\)/.exec(sql);
    if (!re) throw new Error("не нашли regexp_replace в миграции");
    const daily = read("supabase/migrations/20261007000001_shift_hours_cron.sql");
    const cmd = /\$\$\n([\s\S]*?)\n\s*\$\$/.exec(daily)[1];
    const r = await db.query("select regexp_replace($1, $2, $3) as c", [cmd, re[1], re[2].replace(/''/g, "'")]);
    const out = r.rows[0].c;
    if (!out.includes("jsonb_build_object('date', to_char((now() at time zone 'Europe/Moscow') - interval '10 minutes', 'YYYY-MM-DD'))"))
      throw new Error(`тело не заменилось:\n${out}`);
    if (!out.includes("x-cron-secret")) throw new Error("потерялся заголовок секрета");
    // повторный прогон по уже ежечасному заданию ничего не ломает
    const again = (await db.query("select regexp_replace($1, $2, $3) as c", [out, re[1], re[2].replace(/''/g, "'")])).rows[0].c;
    eq(again, out, "повторная замена");
    // выражение из тела — валидный SQL
    await db.query(out.match(/body := (jsonb_build_object\(.*\)\))/)[1].replace(/^/, "select "));
  });

  console.log(`\n${passed} ok, ${failed} fail`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
