"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useCrm } from "@/lib/crm/store";
import type { DataState } from "@/lib/crm/types";
import { SHEETS_SCRIPT, buildSheets, pushToSheets } from "@/lib/crm/sheets";
import { fmtInt } from "@/lib/crm/format";
import { Collapse, Field, Switch } from "@/components/ui/kit";
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
            <h2 className="card-title" style={{ fontSize: 15 }}>Google Таблица</h2>
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
            {sync.ok ? `Последняя выгрузка ${new Date(sync.at).toLocaleString("ru-RU")} · ${fmtInt(sync.rows)} строк` : `Ошибка ${new Date(sync.at).toLocaleString("ru-RU")}: ${sync.error}`}
          </span>
        )}
      </div>
    </section>
  );
}
