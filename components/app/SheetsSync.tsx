"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useCrm } from "@/lib/crm/store";
import type { DataState } from "@/lib/crm/types";
import { LEADS_SCRIPT, SHEETS_SCRIPT, buildSheets, isScriptUrl, pushToSheets } from "@/lib/crm/sheets";
import { leadSheetTab } from "@/lib/crm/leadsheet";
import { REGISTRY_SCRIPT } from "@/lib/crm/registryScript";
import { PLAN_DAYS_BEFORE, upcomingSteps } from "@/lib/crm/registryAuto";
import { runRegistryAuto } from "@/lib/crm/registrySync";
import { fmtInt, fmtMoney } from "@/lib/crm/format";
import { fmtDate, fmtStamp } from "@/lib/crm/dates";
import { Collapse, Field, NumInput, Switch } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/* ── состояние последней выгрузки: общее для секции настроек и автовыгрузки ── */

interface SyncState {
  busy: boolean;
  at: string | null;
  ok: boolean | null;
  error: string;
  rows: number;
}

const KEY = "leadup.sheetsSync";
let state: SyncState = { busy: false, at: null, ok: null, error: "", rows: 0 };
try {
  if (typeof window !== "undefined") state = { ...state, ...JSON.parse(localStorage.getItem(KEY) || "{}"), busy: false };
} catch {
  /* нет доступа к localStorage — начинаем с пустого */
}
const subs = new Set<() => void>();
const setState = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: state.at, ok: state.ok, error: state.error, rows: state.rows }));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const useSyncState = () => useSyncExternalStore(subscribe, () => state, () => state);

async function syncNow(st: DataState): Promise<boolean> {
  const { url, token } = st.settings.sheets;
  if (!url || !token || state.busy) return false;
  setState({ busy: true });
  const res = await pushToSheets(url, token, buildSheets(st));
  setState({ busy: false, at: new Date().toISOString(), ok: res.ok, error: res.error ?? "", rows: res.rows ?? state.rows });
  return res.ok;
}

/** Автовыгрузка: через минуту после последнего изменения базы. Только у РОПа — чтобы не слали все вкладки. */
export function SheetsAutoSync() {
  const { full, access, ready } = useCrm();
  const on = ready && access.can.manageData && full.settings.sheets.auto && !!full.settings.sheets.url && !!full.settings.sheets.token;
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => void syncNow(full), 60_000);
    return () => window.clearTimeout(t);
  }, [on, full]);
  return null;
}

/** Секция «Google Таблица» в настройках → Данные. */
export function SheetsSection() {
  const { full, saveSettings, toast } = useCrm();
  const cfg = full.settings.sheets;
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState(cfg.token);
  const [help, setHelp] = useState(!cfg.url);
  const sync = useSyncState();
  useEffect(() => {
    setUrl(cfg.url);
    setToken(cfg.token);
  }, [cfg.url, cfg.token]);

  const dirty = url.trim() !== cfg.url || token !== cfg.token;
  const urlBad = !!url.trim() && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url.trim());

  const save = async () => {
    await saveSettings({ sheets: { ...cfg, url: url.trim(), token } });
    toast("Настройки выгрузки сохранены");
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} скопирован`);
    } catch {
      toast("Не удалось скопировать — выделите текст вручную", "err");
    }
  };
  const makeToken = () => {
    const abc = "abcdefghijkmnpqrstuvwxyz23456789";
    const buf = new Uint8Array(24);
    crypto.getRandomValues(buf);
    setToken(Array.from(buf, (b) => abc[b % abc.length]).join(""));
  };

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="card-title" style={{ fontSize: 15 }}><Icon name="fill" size={15} className="title-ic" />Google Таблица</h2>
            <p className="card-sub">
              Вся база — лиды со статусами, операторы, группы, график, планы, начисления, аккаунты, журнал — листами в вашей таблице. Таблица перезаписывается целиком и
              повторяет базу; правки в ней обратно в CRM не попадают.
            </p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHelp((v) => !v)}>
            {help ? "Скрыть инструкцию" : "Как настроить"}
          </button>
        </div>

        <Collapse open={help} innerStyle={{ paddingTop: 14 }}>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.65, color: "var(--text-sub)" }}>
            <li>Создайте пустую таблицу на sheets.google.com.</li>
            <li>
              Откройте «Расширения → Apps Script», удалите всё в редакторе и вставьте скрипт (кнопка «Скопировать скрипт» ниже).
            </li>
            <li>
              Нажмите «Сгенерировать» у поля «Секрет», скопируйте его и в скрипте замените <code>ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ</code> на него. Сохраните скрипт (Ctrl+S).
            </li>
            <li>
              «Развернуть → Новое развёртывание» → тип «Веб-приложение». Выполнять от имени: «Меня». Доступ: «Все». Разрешите доступ к таблице, когда Google спросит.
            </li>
            <li>Скопируйте ссылку веб-приложения (заканчивается на /exec), вставьте ниже, сохраните и нажмите «Выгрузить сейчас».</li>
            <li>
              Меняли скрипт — делайте «Развернуть → Управление развёртываниями → Изменить → Новая версия», иначе работает старая.
            </li>
          </ol>
        </Collapse>
      </div>

      <div className="grid2">
        <Field label="Ссылка веб-приложения" error={urlBad ? "Нужна ссылка вида https://script.google.com/macros/s/…/exec" : null}>
          <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" spellCheck={false} />
        </Field>
        <Field label="Секрет" hint="Тот же, что в скрипте. Без него чужой не запишет в вашу таблицу">
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Длинная случайная строка" spellCheck={false} style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={makeToken}>
              Сгенерировать
            </button>
            {token && (
              <button type="button" className="btn btn-sm btn-icon" title="Скопировать секрет" onClick={() => void copy(token, "Секрет")}>
                <Icon name="copy" size={13} />
              </button>
            )}
          </div>
        </Field>
      </div>

      <Switch
        checked={cfg.auto}
        onChange={(v) => void saveSettings({ sheets: { ...cfg, auto: v } })}
        label="Выгружать автоматически"
        hint="Через минуту после последнего изменения, пока CRM открыта у руководителя"
      />

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => void copy(SHEETS_SCRIPT, "Скрипт")}>
          <Icon name="copy" size={14} /> Скопировать скрипт
        </button>
        {dirty && (
          <button type="button" className="btn" onClick={() => void save()} disabled={urlBad}>
            Сохранить
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={sync.busy || dirty || !cfg.url || !cfg.token}
          title={dirty ? "Сначала сохраните ссылку и секрет" : undefined}
          onClick={async () => {
            const ok = await syncNow(full);
            toast(ok ? "Выгружено в Google Таблицу" : `Не выгрузилось: ${state.error}`, ok ? "ok" : "err");
          }}
        >
          <Icon name="upload" size={14} /> {sync.busy ? "Выгружаю…" : "Выгрузить сейчас"}
        </button>
        <span className="spacer" />
        {sync.at && (
          <span style={{ fontSize: 12.5, color: sync.ok ? "var(--dim)" : "var(--c-red-fg)" }}>
            {sync.ok ? `Последняя выгрузка ${fmtStamp(sync.at)} · ${fmtInt(sync.rows)} строк` : `Ошибка ${fmtStamp(sync.at)}: ${sync.error}`}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Секция «Таблица лидов для ОКК» в настройках → Данные: куда «Лиды» → «Таблица ОКК» → «В Google
 * Таблицу» и автовыгрузка (13:00 и 19:00 МСК, Edge Function leads-sheet) дописывают лиды.
 * Лист месяца — «Октябрь Борис»; в новом месяце скрипт создаёт его сам.
 */
export function LeadsSheetSection() {
  const { full, saveSettings, toast, today, data } = useCrm();
  const cfg = full.settings.sheets;
  const ls = cfg.leads;
  const [url, setUrl] = useState(ls.url);
  const [token, setToken] = useState(ls.token);
  const [owner, setOwner] = useState(ls.owner);
  const [help, setHelp] = useState(!ls.url);
  // пришли из «Лиды» → «Таблица ОКК» → «В Google Таблицу»: сразу к этой секции
  useEffect(() => {
    if (window.location.hash === "#leads-sheet") document.getElementById("leads-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => {
    setUrl(ls.url);
    setToken(ls.token);
    setOwner(ls.owner);
  }, [ls.url, ls.token, ls.owner]);

  const dirty = url.trim() !== ls.url || token !== ls.token || owner.trim() !== ls.owner;
  const urlBad = !!url.trim() && !isScriptUrl(url);
  const lastAuto = data.leadExportLog.find((e) => e.kind === "sheet" && e.by.startsWith("Авто"));

  const save = async () => {
    await saveSettings({ sheets: { ...cfg, leads: { ...ls, url: url.trim(), token, owner: owner.trim() || "Борис" } } });
    toast("Таблица лидов сохранена");
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} скопирован`);
    } catch {
      toast("Не удалось скопировать — выделите текст вручную", "err");
    }
  };

  return (
    <section id="leads-sheet" className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14, scrollMarginTop: 80 }}>
      <div>
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="card-title" style={{ fontSize: 15 }}>
              <Icon name="fill" size={15} className="title-ic" />
              Таблица лидов для ОКК
            </h2>
            <p className="card-sub">
              Все лиды — дата, ссылка, телефон, имя, оператор, доведен, почему, проверка ОКК — дописываются в лист месяца, сейчас «{leadSheetTab(today, owner || "Борис")}». В
              новом месяце лист создаётся сам. Повторная выгрузка строки не дублирует, другие листы таблицы не трогаются.
            </p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHelp((v) => !v)}>
            {help ? "Скрыть инструкцию" : "Как настроить"}
          </button>
        </div>

        <Collapse open={help} innerStyle={{ paddingTop: 14 }}>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.65, color: "var(--text-sub)" }}>
            <li>Откройте таблицу («Авто недозвоны») → «Расширения → Apps Script». Нужен доступ на редактирование таблицы.</li>
            <li>Удалите всё в редакторе и вставьте скрипт (кнопка «Скопировать скрипт» ниже).</li>
            <li>
              Нажмите «Сгенерировать» у поля «Секрет» и в скрипте замените <code>ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ</code> на него. Сохраните скрипт (Ctrl+S).
            </li>
            <li>«Развернуть → Новое развёртывание» → «Веб-приложение». Выполнять от имени: «Меня». Доступ: «Все». Разрешите доступ к таблице.</li>
            <li>Ссылку веб-приложения (заканчивается на /exec) вставьте ниже и сохраните.</li>
            <li>
              Для автовыгрузки в 13:00 и 19:00 — функция <code>leads-sheet</code> и расписание в Supabase (supabase/migrations/20261008000002_leads_sheet_cron.sql), затем
              включите переключатель ниже.
            </li>
          </ol>
        </Collapse>
      </div>

      <div className="grid2">
        <Field label="Ссылка веб-приложения" error={urlBad ? "Нужна ссылка вида https://script.google.com/macros/s/…/exec" : null}>
          <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" spellCheck={false} />
        </Field>
        <Field label="Секрет" hint="Тот же, что в скрипте таблицы">
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Длинная случайная строка" spellCheck={false} style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => setToken(randomToken())}>
              Сгенерировать
            </button>
            {token && (
              <button type="button" className="btn btn-sm btn-icon" title="Скопировать секрет" onClick={() => void copy(token, "Секрет")}>
                <Icon name="copy" size={13} />
              </button>
            )}
          </div>
        </Field>
      </div>
      <Field label="Чей лист" hint="Имя после месяца в названии листа: «Октябрь Борис», «Ноябрь Борис»…">
        <input className="inp" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Борис" style={{ maxWidth: 240 }} />
      </Field>

      <Switch
        checked={ls.auto}
        onChange={(v) => void saveSettings({ sheets: { ...cfg, leads: { ...ls, auto: v } } })}
        disabled={!ls.url || !ls.token}
        label="Выгружать автоматически в 13:00 и 19:00 по Москве"
        hint={
          !ls.url || !ls.token
            ? "Сначала сохраните ссылку и секрет"
            : `Каждый день, и в выходные: лиды за вчера и сегодня (повторы не дублируются)${lastAuto ? ` · последняя автовыгрузка ${fmtStamp(lastAuto.at)}, строк ${fmtInt(lastAuto.count)}` : ""}`
        }
      />

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => void copy(LEADS_SCRIPT, "Скрипт")}>
          <Icon name="copy" size={14} /> Скопировать скрипт
        </button>
        {dirty && (
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={urlBad}>
            Сохранить
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Секция «Реестры выплат YouDo» в настройках → Данные. Автомат (lib/crm/registryAuto.ts, функция
 * registry-sheet по расписанию) сам создаёт в таблицах бухгалтера «План» за 2 дня до периода и
 * «Факт» в день реестра; «Выплаты» → «Реестр YouDo» — то же вручную. Скрипт — отдельный проект
 * Apps Script, в таблицы бухгалтера его ставить не нужно (lib/crm/registryScript.ts).
 */
export function RegistrySheetSection() {
  const { full, saveSettings, toast, today, confirm } = useCrm();
  const cfg = full.settings.sheets;
  const rg = cfg.registry;
  const [url, setUrl] = useState(rg.url);
  const [token, setToken] = useState(rg.token);
  const [planOkc, setPlanOkc] = useState(rg.planOkc);
  const [planSv, setPlanSv] = useState(rg.planSv);
  const [help, setHelp] = useState(!rg.url);
  const [check, setCheck] = useState<{ busy: boolean; text: string; bad?: boolean }>({ busy: false, text: "" });
  useEffect(() => {
    if (window.location.hash === "#registry-sheet") document.getElementById("registry-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => {
    setUrl(rg.url);
    setToken(rg.token);
    setPlanOkc(rg.planOkc);
    setPlanSv(rg.planSv);
  }, [rg.url, rg.token, rg.planOkc, rg.planSv]);

  const dirty = url.trim() !== rg.url || token !== rg.token || planOkc !== rg.planOkc || planSv !== rg.planSv;
  const urlBad = !!url.trim() && !isScriptUrl(url);
  const steps = useMemo(() => upcomingSteps(full.settings, today), [full.settings, today]);
  const save = async () => {
    await saveSettings({ sheets: { ...cfg, registry: { ...rg, url: url.trim(), token, planOkc, planSv } } });
    toast("Реестры сохранены");
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} скопирован`);
    } catch {
      toast("Не удалось скопировать — выделите текст вручную", "err");
    }
  };
  const runCheck = async () => {
    setCheck({ busy: true, text: "" });
    try {
      const r = await runRegistryAuto(true);
      const jobs = r.jobs.map((j) => (j.skip ? `«${j.tab ?? j.kind}» — ${j.skip}` : `«${j.tab}»: ${fmtInt(j.rows)} чел., ${fmtMoney(j.sum)} в YouDo`));
      const extra = r.notSmz.length ? ` Не СМЗ, в реестр не попадут: ${r.notSmz.map((x) => `${x.name} ${fmtMoney(x.net)}`).join(", ")}.` : "";
      setCheck({
        busy: false,
        text: (jobs.length ? `Сегодня (${fmtDate(r.today)}) автомат отправит: ${jobs.join("; ")}.` : `Сегодня (${fmtDate(r.today)}) по графику реестров нет — функция на месте.`) + extra,
      });
    } catch (e) {
      setCheck({ busy: false, text: e instanceof Error ? e.message : String(e), bad: true });
    }
  };

  const runTest = async () => {
    const ok = await confirm({
      title: "Тестовый прогон реестров?",
      text: "Прямо сейчас в таблицах бухгалтера появятся листы «ТЕСТ План ОКЦ/СВ» на следующий период и «ТЕСТ Факт ОКЦ/СВ» на текущий (по начислениям на сегодня), итог придёт в Telegram. Настоящие листы не трогаются, автомат их потом не спутает — тестовые можно удалить.",
      ok: "Прогнать",
    });
    if (!ok) return;
    setCheck({ busy: true, text: "" });
    try {
      const r = await runRegistryAuto(false, true);
      const lines = (r.results ?? []).map((x) =>
        x.skip ? `«${x.tab ?? x.kind}» — ${x.skip}` : x.error ? `«${x.tab}» — ошибка: ${x.error}` : `«${x.reply?.tab ?? x.tab}» ${x.reply?.unconfirmed ? "отправлен (Google не подтвердил)" : `готов: ${fmtInt(x.reply?.rows ?? 0)} строк, ${fmtMoney(x.reply?.total ?? 0)}`}${x.reply?.missing?.length ? `, нет ИНН: ${x.reply.missing.map((m) => m.name).join(", ")}` : ""}`,
      );
      const tg = r.telegram ? ` Telegram: ${r.telegram}.` : " Сообщение отправлено в Telegram.";
      setCheck({ busy: false, text: (lines.length ? lines.join("; ") + "." : r.note ?? "Нечего отправлять: нет самозанятых и начислений.") + (lines.length ? tg : ""), bad: (r.results ?? []).some((x) => x.error) });
    } catch (e) {
      setCheck({ busy: false, text: e instanceof Error ? e.message : String(e), bad: true });
    }
  };

  return (
    <section id="registry-sheet" className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14, scrollMarginTop: 80 }}>
      <div>
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="card-title" style={{ fontSize: 15 }}>
              <Icon name="doc" size={15} className="title-ic" />
              Реестры выплат YouDo
            </h2>
            <p className="card-sub">
              Сам по графику выплат: за {PLAN_DAYS_BEFORE} дня до периода — «План» всем самозанятым на условную сумму из настроек, в день реестра — «Факт»: сумма за период по закрытым дням. Листы — в таблицах
              бухгалтера в её формате: ФИО и ИНН из реестра исполнителей, порядок как в плане, в YouDo — на руки ÷ 0,94. Итог — вам в Telegram. ИНН в CRM не хранятся.
            </p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHelp((v) => !v)}>
            {help ? "Скрыть инструкцию" : "Как настроить"}
          </button>
        </div>

        <Collapse open={help} innerStyle={{ paddingTop: 14 }}>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.65, color: "var(--text-sub)" }}>
            <li>
              Откройте <b>script.google.com</b> → «Создать проект» (в таблицы бухгалтера ничего ставить не нужно). Аккаунт Google — тот, у которого есть доступ на
              редактирование к обоим «Реестрам выплат по СЗ».
            </li>
            <li>Удалите всё в редакторе и вставьте скрипт (кнопка «Скопировать скрипт» ниже).</li>
            <li>
              Нажмите «Сгенерировать» у поля «Секрет» и в скрипте замените <code>ЗАМЕНИТЕ_НА_СВОЙ_СЕКРЕТ</code> на него. Сохраните скрипт (Ctrl+S).
            </li>
            <li>
              Проверка: выберите функцию <code>test</code> → «Выполнить», разрешите доступ к таблицам — в журнале появится список людей из реестра исполнителей.
            </li>
            <li>«Развернуть → Новое развёртывание» → «Веб-приложение». Выполнять от имени: «Меня». Доступ: «Все». Ссылку /exec вставьте ниже, сохраните.</li>
            <li>
              Supabase → Edge Functions → <code>registry-sheet</code> → вставить <code>supabase/functions/registry-sheet/index.ts</code> → Deploy. Secrets:{" "}
              <code>TELEGRAM_BOT_TOKEN</code> (токен бота Vexi) и <code>TELEGRAM_CHAT_ID</code> (ваш Telegram ID).
            </li>
            <li>
              Supabase → SQL Editor → <code>supabase/migrations/20261008000003_registry_cron.sql</code> → Run (каждый день в 10:00 МСК). Нажмите «Проверить» ниже и включите
              переключатель.
            </li>
          </ol>
        </Collapse>
      </div>

      <div className="grid2">
        <Field label="Ссылка веб-приложения" error={urlBad ? "Нужна ссылка вида https://script.google.com/macros/s/…/exec" : null}>
          <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" spellCheck={false} />
        </Field>
        <Field label="Секрет" hint="Тот же, что в скрипте реестров">
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Длинная случайная строка" spellCheck={false} style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => setToken(randomToken())}>
              Сгенерировать
            </button>
            {token && (
              <button type="button" className="btn btn-sm btn-icon" title="Скопировать секрет" onClick={() => void copy(token, "Секрет")}>
                <Icon name="copy" size={13} />
              </button>
            )}
          </div>
        </Field>
      </div>
      <div className="grid2">
        <Field label="План ОКЦ — сумма каждому, ₽" hint={planOkc > 0 ? "Пишется в реестр как есть. Факт — по начислениям: на руки ÷ 0,94" : "0 — план операторам не создаётся"}>
          <NumInput value={planOkc} onChange={(v) => setPlanOkc(v ?? 0)} placeholder="0" style={{ maxWidth: 200 }} />
        </Field>
        <Field label="План СВ — сумма каждому, ₽" hint={planSv > 0 ? "Пишется в реестр как есть. Факт — по начислениям: на руки ÷ 0,94" : "0 — план супервайзерам не создаётся"}>
          <NumInput value={planSv} onChange={(v) => setPlanSv(v ?? 0)} placeholder="0" style={{ maxWidth: 200 }} />
        </Field>
      </div>

      <Switch
        checked={rg.auto}
        onChange={(v) => void saveSettings({ sheets: { ...cfg, registry: { ...rg, auto: v, autoFrom: v ? today : rg.autoFrom } } })}
        disabled={!rg.url || !rg.token}
        label="Создавать реестры автоматически"
        hint={!rg.url || !rg.token ? "Сначала сохраните ссылку и секрет" : `Каждый день в 10:00 МСК по графику выплат. Что было до ${rg.auto && rg.autoFrom ? fmtDate(rg.autoFrom) : "дня включения"} — не трогает: это сделано руками`}
      />

      {steps.length > 0 && (
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-sub)" }}>
          <b style={{ color: "var(--text)" }}>Ближайшее:</b>
          {steps.map((x) => (
            <div key={`${x.kind}${x.period.idx}`} className="num">
              {fmtDate(x.date)} — {x.kind === "plan" ? "план" : "факт"} за {fmtDate(x.period.from).slice(0, 5)}–{fmtDate(x.period.to).slice(0, 5)}
              <span className="o2-muted"> · выплата {fmtDate(x.period.pay).slice(0, 5)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn" onClick={() => void copy(REGISTRY_SCRIPT, "Скрипт")}>
          <Icon name="copy" size={14} /> Скопировать скрипт
        </button>
        <button type="button" className="btn" disabled={check.busy || dirty || !rg.url} onClick={() => void runCheck()} title="Что автомат отправил бы сегодня — без отправки">
          <Icon name="check" size={14} /> {check.busy ? "Проверяю…" : "Проверить"}
        </button>
        <button type="button" className="btn" disabled={check.busy || dirty || !rg.url} onClick={() => void runTest()} title="Создать «ТЕСТ …» листы прямо сейчас и прислать итог в Telegram">
          <Icon name="upload" size={14} /> Тестовый прогон
        </button>
        {dirty && (
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={urlBad}>
            Сохранить
          </button>
        )}
      </div>
      {check.text && (
        <div className={`note-line${check.bad ? " warn" : ""}`}>
          <Icon name="info" size={14} />
          <span>{check.text}</span>
        </div>
      )}
    </section>
  );
}

function randomToken(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => abc[b % abc.length]).join("");
}
