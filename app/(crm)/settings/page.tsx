"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { PAY_HINT, PAY_LABEL, type PayType, type Settings } from "@/lib/crm/types";
import { WEEKDAYS_SHORT, currentMonth, fmtDate, fmtMonth, fmtStamp, nowStamp } from "@/lib/crm/dates";
import { fmtInt } from "@/lib/crm/format";
import { checkIntegrity, type Issue } from "@/lib/crm/validate";
import * as db from "@/lib/crm/db";
import { AUTH_ENABLED } from "@/lib/appMode";
import { Chip, Field, NumInput, PageHead, SaveBar, Seg, Switch, downloadText } from "@/components/ui/kit";
import { DateInput, MonthPicker, Select, dot } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { AccountsTab, ProfileTab, RolesTab } from "@/components/app/AccountsSettings";
import { RateGridsSection, SvBonusSection } from "@/components/app/RateGrids";
import { ApproveMonthEditor, ApproveRules } from "@/components/app/ApproveSettings";
import { AuditLog } from "@/components/app/AuditLog";
import { SheetsSection } from "@/components/app/SheetsSync";

type Tab = "profile" | "system" | "accounts" | "roles" | "data" | "audit";

function Section({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { data, saveSettings, toast, access, applyGridPay, confirm } = useCrm();
  const [tab, setTab] = useState<Tab>(() => {
    const q = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("tab");
    const t = (q ?? "") as Tab;
    return ["profile", "system", "accounts", "roles", "data", "audit"].includes(t) ? t : "profile";
  });
  /*
   * Черновик вкладки «Система». Сохраняются только поля, которые правили (touched):
   * раньше уходила вся форма целиком и затирала то, что успели поменять в другом
   * месте (роли, выгрузка, другая вкладка). Чужие изменения подтягиваются сразу,
   * свои правки при этом не теряются.
   */
  const [f, setF] = useState<Settings>(data.settings);
  const [touched, setTouched] = useState<Set<keyof Settings>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [approveDirty, setApproveDirty] = useState(false);
  const [holiday, setHoliday] = useState("");
  useEffect(() => {
    setF((cur) => {
      const next = { ...data.settings } as Record<string, unknown>;
      for (const k of touched) next[k] = cur[k];
      return next as unknown as Settings;
    });
  }, [data.settings, touched]);
  const changed = Array.from(touched).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(data.settings[k]));
  const dirty = changed.length > 0;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
  };
  const reset = () => setTouched(new Set());

  const thresholdsBad = !(f.aheadPct >= f.normalPct && f.normalPct >= f.lagPct);

  const save = async () => {
    if (thresholdsBad) {
      toast("Пороги должны идти по убыванию: выше плана ≥ по плану ≥ отстаёт", "err");
      return;
    }
    const patch = Object.fromEntries(changed.map((k) => [k, f[k]])) as Partial<Settings>;
    setBusy(true);
    const ok = await saveSettings(patch);
    setBusy(false);
    if (!ok) return; // причину уже показал стор
    setTouched(new Set());
    toast("Настройки сохранены — расчёты обновлены");
  };

  // несохранённые правки: закрытие окна и переход по ссылке — только с подтверждением
  const unsaved = dirty || approveDirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const nav = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented) return;
      if (!window.confirm("В настройках есть несохранённые изменения. Уйти без сохранения?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", nav, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", nav, true);
    };
  }, [unsaved]);

  const tabs: { value: Tab; label: string; show: boolean }[] = [
    { value: "profile", label: "Мой профиль", show: true },
    { value: "system", label: "Система", show: access.can.systemSettings },
    { value: "accounts", label: "Аккаунты", show: access.can.manageAccounts },
    { value: "roles", label: "Роли и доступ", show: access.can.manageAccounts },
    { value: "data", label: "Данные", show: access.can.manageData },
    { value: "audit", label: "Журнал", show: access.can.manageData || access.can.editPayroll },
  ];
  const shown = tabs.filter((t) => t.show);
  const active = shown.some((t) => t.value === tab) ? tab : "profile";
  const systemTab = active === "system";

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <PageHead
        title="Настройки"
        sub={access.can.systemSettings ? "Все параметры расчётов редактируются здесь, без правки кода" : "Личные настройки вашего аккаунта"}
        actions={
          systemTab ? (
            <>
              {dirty && (
                <button className="btn" onClick={reset} disabled={busy}>
                  Отменить
                </button>
              )}
              <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty || busy}>
                <Icon name="check" size={14} /> {busy ? "Сохраняю…" : "Сохранить"}
              </button>
            </>
          ) : undefined
        }
      />

      {shown.length > 1 && (
        <Seg<Tab>
          value={active}
          onChange={(v) => {
            // апрув за месяц — свой черновик, он пропадёт при уходе с вкладки
            if (approveDirty && v !== "system" && !window.confirm("Апрув за месяц не сохранён. Перейти без сохранения?")) return;
            setTab(v);
            window.history.replaceState(null, "", `/settings?tab=${v}`);
          }}
          options={shown.map((t) => ({ value: t.value, label: t.label }))}
        />
      )}

      {active === "audit" && <AuditLog />}
      {active === "profile" && <ProfileTab />}
      {active === "accounts" && <AccountsTab />}
      {active === "roles" && <RolesTab />}
      {active === "data" && (
        <>
          <DataSection />
          <SheetsSection />
          <AboutSection />
        </>
      )}
      {systemTab && (
        <>

      <Section title="Основное">
        <div className="grid3">
          <Field label="Название отдела">
            <input className="inp" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Отчётный месяц" hint={f.reportMonth ? `Приложение открывается на ${fmtMonth(f.reportMonth)}` : "Всегда текущий календарный месяц"}>
            <div className="row">
              {f.reportMonth ? (
                <MonthPicker value={f.reportMonth} onChange={(m) => set("reportMonth", m)} size="md" minWidth={170} />
              ) : (
                <span className="btn" style={{ minWidth: 170, pointerEvents: "none", color: "var(--dim)" }}>
                  {fmtMonth(currentMonth())} · текущий
                </span>
              )}
              <Switch
                size="sm"
                checked={!f.reportMonth}
                onChange={(v) => set("reportMonth", v ? "" : currentMonth())}
                label="всегда текущий"
              />
            </div>
          </Field>
          <Field label="Тема по умолчанию" hint="Для новых аккаунтов; свою тему каждый выбирает в профиле">
            <Seg
              value={f.theme}
              onChange={(v) => set("theme", v)}
              options={[
                { value: "light", label: "Светлая" },
                { value: "dark", label: "Тёмная" },
                { value: "system", label: "Системная" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="Планы и рабочее время" sub="План на дату, Run Rate и нужный темп считаются по рабочим дням месяца">
        <div className="grid4">
          <Field label="Общий план команды, лидов/мес" hint="0 — сумма планов групп и операторов">
            <NumInput value={f.teamPlan} onChange={(v) => set("teamPlan", v ?? 0)} max={10_000_000} />
          </Field>
          <Field label="План оператора по умолчанию" hint="Если в карточке не задан свой; 0 — без плана">
            <NumInput value={f.defaultOperatorPlan} onChange={(v) => set("defaultOperatorPlan", v ?? 0)} max={100_000} />
          </Field>
          <Field label="Норма часов в месяц по умолчанию">
            <NumInput value={f.defaultNormHours} onChange={(v) => set("defaultNormHours", v ?? 0)} max={744} step={0.5} />
          </Field>
          <Field label="Часов в стандартном рабочем дне">
            <NumInput value={f.dayHours} onChange={(v) => set("dayHours", v ?? 8)} min={0.5} max={24} step={0.5} />
          </Field>
        </div>
        <Field label="Рабочие дни недели">
          <div className="row" style={{ gap: 4 }}>
            {WEEKDAYS_SHORT.map((w, i) => {
              const d = i + 1;
              const on = f.workdays.includes(d);
              return (
                <button
                  key={w}
                  type="button"
                  className="btn btn-sm"
                  aria-pressed={on}
                  style={{ width: 40, background: on ? "var(--brand-tint)" : undefined, borderColor: on ? "var(--brand-border)" : undefined, color: on ? "var(--text)" : "var(--dim)", fontWeight: on ? 600 : 400 }}
                  onClick={() => set("workdays", on ? f.workdays.filter((x) => x !== d) : [...f.workdays, d].sort())}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Праздники и нерабочие дни" hint="Не считаются рабочими днями при расчёте плана и темпа">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {[...f.holidays].sort().map((h) => (
              <Chip key={h} hue="amber">
                {fmtDate(h)}
                <button type="button" onClick={() => set("holidays", f.holidays.filter((x) => x !== h))} style={{ border: "none", background: "none", color: "inherit", padding: 0, marginLeft: 2, cursor: "pointer" }} aria-label="Убрать">
                  ×
                </button>
              </Chip>
            ))}
            <DateInput size="sm" width={150} value={holiday} onChange={setHoliday} clearable ariaLabel="Праздничный день" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!holiday || f.holidays.includes(holiday)}
              onClick={() => {
                set("holidays", [...f.holidays, holiday].sort());
                setHoliday("");
              }}
            >
              Добавить
            </button>
          </div>
        </Field>
      </Section>

      <Section
        title="Зарплата по умолчанию"
        sub="Подставляется новым операторам; у каждого можно задать своё"
        action={
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const ok = await confirm({
                title: "Перевести операторов на сетку?",
                text: "Всем операторам (кроме супервайзеров) будет поставлена схема «По сетке за смену»: ставка часа и бонус за лид берутся по числу лидов в смене. Индивидуальные оклады и фиксированные ставки обнулятся.",
                ok: "Перевести",
              });
              if (!ok) return;
              const n = await applyGridPay();
              if (!n) toast("Все операторы уже на сетке", "info");
            }}
          >
            <Icon name="bolt" size={13} /> Перевести всех на сетку
          </button>
        }
      >
        <div className="grid3">
          <Field label="Схема оплаты">
            <Select<PayType>
              value={f.defaultPayType}
              options={(Object.keys(PAY_LABEL) as PayType[]).map((p) => ({ value: p, label: PAY_LABEL[p], hint: PAY_HINT[p] }))}
              onChange={(v) => set("defaultPayType", v)}
              ariaLabel="Схема оплаты"
              minPopWidth={460}
            />
          </Field>
          <Field label="Оклад, ₽/мес">
            <NumInput value={f.defaultSalary} onChange={(v) => set("defaultSalary", v ?? 0)} max={10_000_000} />
          </Field>
          <Field label="Ставка, ₽/час" hint="Для схем с фиксированной ставкой">
            <NumInput value={f.defaultHourlyRate} onChange={(v) => set("defaultHourlyRate", v ?? 0)} step={0.5} max={100_000} />
          </Field>
          <Field label="Бонус за переданный лид, ₽" hint="Для схем с фиксированным бонусом">
            <NumInput value={f.defaultLeadBonus} onChange={(v) => set("defaultLeadBonus", v ?? 0)} max={1_000_000} />
          </Field>
          <Field label="Процент удержания" hint="У самозанятых — 0: налог платят сами. 13% ставим, когда оформлен ТК РФ">
            <NumInput value={f.withholdPct} onChange={(v) => set("withholdPct", v ?? 0)} max={100} step={0.1} />
          </Field>
          <Field label="Цена лида для заказчика, ₽" hint="По договору. Доход для % ФОТ = лиды × цена лида × апрув заказчика за месяц (апрув — в «Зарплате»)">
            <NumInput value={f.leadRevenue} onChange={(v) => set("leadRevenue", v ?? 0)} max={10_000_000} />
          </Field>
          <Field label="Норматив ФОТ, % от дохода" hint="Превышать нельзя; в ведомости подсвечивается по группам">
            <NumInput value={f.payrollCapPct} onChange={(v) => set("payrollCapPct", v ?? 0)} max={100} step={0.5} />
          </Field>
          <Field label="Оклад при неполной норме">
            <Select
              value={f.prorateSalary ? "1" : "0"}
              options={[
                { value: "1", label: "Пропорционально часам", hint: "оклад × часы / норма" },
                { value: "0", label: "Полностью" },
              ]}
              onChange={(v) => set("prorateSalary", v === "1")}
              ariaLabel="Оклад при неполной норме"
              minPopWidth={300}
            />
          </Field>
        </div>
      </Section>

      <RateGridsSection
        grids={f.rateGrids}
        defaultGridId={f.defaultGridId}
        onChange={(grids, def) => {
          set("rateGrids", grids);
          set("defaultGridId", def);
        }}
      />

      <SvBonusSection value={f.svBonus} onChange={(v) => set("svBonus", v)} />

      <Section
        title="Апрув заказчика"
        sub="Доля лидов, которые принял заказчик. От неё зависит бонус супервайзера: по ступеням ниже бонус умножается на коэффициент"
      >
        <ApproveRules value={f.svBonus} onChange={(v) => set("svBonus", v)} />
        <div style={{ borderTop: "1px solid var(--ink-06)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="field-label">Апрув по месяцам и проектам</div>
          <ApproveMonthEditor monthSwitcher onDirty={setApproveDirty} />
        </div>
      </Section>

      <Section title="Оценка выполнения" sub="Темп = факт / план на сегодня. По этим порогам операторы и группы делятся на «выше плана», «по плану», «отстаёт», «сильно отстаёт»">
        <div className="grid4">
          <Field label="Выше плана, от %" error={thresholdsBad ? "Пороги должны убывать" : null}>
            <NumInput value={f.aheadPct} onChange={(v) => set("aheadPct", v ?? 0)} max={1000} />
          </Field>
          <Field label="По плану (норма), от %">
            <NumInput value={f.normalPct} onChange={(v) => set("normalPct", v ?? 0)} max={1000} />
          </Field>
          <Field label="Отстаёт, от %" hint="Ниже — «сильно отстаёт»">
            <NumInput value={f.lagPct} onChange={(v) => set("lagPct", v ?? 0)} max={1000} />
          </Field>
          <Field label="«Не работает» после, раб. дней без лидов" hint="Отпуск и больничный не считаются">
            <NumInput value={f.idleDays} onChange={(v) => set("idleDays", v ?? 3)} min={1} max={60} />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Норма конверсии, %" hint="Лидов на час × 100. Ниже — попадает в «Утро руководителя»">
            <NumInput value={f.convNormPct} onChange={(v) => set("convNormPct", v ?? 0)} max={1000} />
          </Field>
          <Field label="Стажировка: лидов" hint="Столько лидов нужно передать, чтобы закрыть стажировку">
            <NumInput value={f.probationLeads} onChange={(v) => set("probationLeads", v ?? 0)} max={1000} />
          </Field>
          <Field label="Стажировка: часов" hint="За столько отработанных часов">
            <NumInput value={f.probationHours} onChange={(v) => set("probationHours", v ?? 0)} max={1000} />
          </Field>
        </div>
      </Section>

      <Section title="Лиды">
        <div className="grid3">
          <Field label="Доп. поле в лиде">
            <Select
              value={f.directionEnabled ? "1" : "0"}
              options={[
                { value: "1", label: "Используется", icon: dot("green") },
                { value: "0", label: "Не используется", icon: dot("gray") },
              ]}
              onChange={(v) => set("directionEnabled", v === "1")}
              ariaLabel="Доп. поле"
            />
          </Field>
          <Field label="Название поля" hint="Город, дилерский центр, направление…">
            <input className="inp" value={f.directionLabel} onChange={(e) => set("directionLabel", e.target.value)} disabled={!f.directionEnabled} />
          </Field>
          <Field label="Предупреждать о повторном телефоне, дней" hint="0 — не проверять">
            <NumInput value={f.duplicateDays} onChange={(v) => set("duplicateDays", v ?? 0)} max={3650} />
          </Field>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-sub)" }}>
          Справочник проектов — на странице{" "}
          <Link href="/projects" style={{ color: "var(--brand)" }}>
            «Проекты»
          </Link>
          . Источник лидов всегда «Скорозвон».
        </div>
      </Section>

      {/* прилипает к низу окна, пока есть несохранённые правки — видно из любого места вкладки */}
      <SaveBar
        sticky
        dirty={dirty}
        busy={busy}
        error={thresholdsBad ? "Пороги оценки должны идти по убыванию: выше плана ≥ по плану ≥ отстаёт" : null}
        onSave={() => void save()}
        onReset={reset}
      />
        </>
      )}
    </div>
  );
}

function DataSection() {
  const crm = useCrm();
  const { data, exportJson, importJson, backup, restoreBackup, wipeAll, repairData, reload, confirm, toast, remote, uploadLocal } = crm;
  const [backups, setBackups] = useState<db.BackupMeta[] | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [keep, setKeep] = useState<number | null>(data.settings.backupsKeep);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshBackups = async () => setBackups(await db.listBackups());
  useEffect(() => {
    void refreshBackups();
  }, [data]);

  const doExport = () => {
    const stamp = nowStamp().replace(/[:T]/g, "-");
    downloadText(`leadup_backup_${stamp}.json`, exportJson(), "application/json");
  };

  const doImport = async (file: File) => {
    const ok = await confirm({
      title: "Загрузить данные из файла?",
      text: "Текущие данные будут заменены данными из файла. Перед заменой автоматически сохранится резервная копия — к ней можно вернуться ниже.",
      ok: "Заменить данные",
      danger: true,
    });
    if (!ok) return;
    const text = await file.text();
    const w = await importJson(text);
    setNotes(w);
  };

  return (
    <Section
      title="Данные"
      sub={
        remote
          ? "База — в Supabase: все сотрудники работают с одними данными, права проверяет сервер. Резервные копии ниже хранятся в этом браузере; выгрузка в файл — дополнительная страховка."
          : "Все данные хранятся в этом браузере (IndexedDB). Регулярно делайте выгрузку в файл — это ваша страховка."
      }
    >
      {remote && (
        <div className="note-line" style={{ alignItems: "center" }}>
          <Icon name="database" size={15} />
          <span style={{ flex: 1 }}>
            Работали в CRM до подключения базы? Данные того времени остались в этом браузере — перенесите их в Supabase. Ничего в базе не удаляется: записи добавляются
            или обновляются, моки не переносятся.
          </span>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (await confirm({ title: "Перенести данные из браузера?", text: "Операторы, группы, проекты, лиды, смены, планы и начисления из этого браузера попадут в общую базу. Аккаунты — только с почтой.", ok: "Перенести" }))
                await uploadLocal();
            }}
          >
            <Icon name="upload" size={13} /> Перенести в базу
          </button>
        </div>
      )}
      <div className="toolbar">
        <button className="btn" onClick={doExport}>
          <Icon name="download" size={14} /> Выгрузить всё (JSON)
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Загрузить из файла
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void doImport(file);
          }}
        />
        <Link className="btn" href="/leads">
          <Icon name="leads" size={14} /> Лиды в CSV
        </Link>
        <button className="btn" onClick={() => void reload()} title="Перечитать базу и пересчитать все показатели">
          <Icon name="refresh" size={14} /> Обновить расчёты
        </button>
      </div>
      {notes.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-sub)", background: "var(--bg)", border: "1px solid var(--ink-07)", borderRadius: 8, padding: "10px 12px" }}>
          <b>При импорте:</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ background: "var(--bg)" }}>
        <div className="row" style={{ padding: "12px 14px", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Резервные копии</div>
            <div style={{ fontSize: 12, color: "var(--dim)" }}>Делаются автоматически раз в сутки и перед опасными операциями: удалением, импортом, восстановлением, очисткой.</div>
          </div>
          <label className="row" style={{ gap: 6, fontSize: 12.5, color: "var(--text-sub)" }}>
            хранить
            <NumInput value={keep} onChange={setKeep} min={3} max={100} className="inp inp-sm" style={{ width: 56 }} />
            <button className="btn btn-sm" disabled={keep === data.settings.backupsKeep || !keep} onClick={() => keep && void crm.saveSettings({ backupsKeep: keep })}>
              ОК
            </button>
          </label>
          <button
            className="btn btn-sm btn-primary"
            onClick={async () => {
              try {
                await backup("Вручную");
                toast("Резервная копия сохранена");
                await refreshBackups();
              } catch (e) {
                toast(`Не удалось: ${e instanceof Error ? e.message : e}`, "err");
              }
            }}
          >
            <Icon name="database" size={13} /> Сделать копию
          </button>
        </div>
        {backups && backups.length > 0 ? (
          <table className="tbl">
            <thead>
              <tr>
                <th className="c">Когда</th>
                <th>Причина</th>
                <th className="c">Операторов</th>
                <th className="c">Лидов</th>
                <th className="c">Смен</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td className="num c">{fmtStamp(b.createdAt)}</td>
                  <td>{b.reason}</td>
                  <td className="c num">{fmtInt(b.counts.operators ?? 0)}</td>
                  <td className="c num">{fmtInt(b.counts.leads ?? 0)}</td>
                  <td className="c num">{fmtInt(b.counts.shifts ?? 0)}</td>
                  <td className="r">
                    <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          if (await confirm({ title: "Восстановить эту копию?", text: "Текущие данные заменятся данными из копии. Перед этим сохранится ещё одна копия текущего состояния.", ok: "Восстановить", danger: true })) {
                            await restoreBackup(b.id);
                            await refreshBackups();
                          }
                        }}
                      >
                        <Icon name="restore" size={13} /> Восстановить
                      </button>
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        title="Удалить копию"
                        onClick={async () => {
                          if (await confirm({ title: "Удалить резервную копию?", ok: "Удалить", danger: true })) {
                            await db.deleteBackup(b.id);
                            await refreshBackups();
                          }
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "0 14px 14px", fontSize: 12.5, color: "var(--dim)" }}>{backups ? "Копий пока нет." : "Загрузка…"}</div>
        )}
      </div>

      <div className="card" style={{ background: "var(--bg)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Проверка целостности</div>
            <div style={{ fontSize: 12, color: "var(--dim)" }}>Дубли ID, ссылки на несуществующих операторов, группы и проекты, битые даты и часы.</div>
          </div>
          <button className="btn btn-sm" onClick={() => setIssues(checkIntegrity(crm.data))}>
            <Icon name="check" size={13} /> Проверить
          </button>
          {issues && issues.length > 0 && (
            <button
              className="btn btn-sm btn-primary"
              onClick={async () => {
                const n = await repairData();
                setNotes(n);
                setIssues(null);
              }}
            >
              Исправить
            </button>
          )}
        </div>
        {issues &&
          (issues.length === 0 ? (
            <Chip hue="green" dot>
              Проблем не найдено
            </Chip>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-sub)" }}>
              {issues.map((i) => (
                <li key={i.text} style={{ color: i.level === "error" ? "var(--c-red-fg)" : undefined }}>
                  {i.text}
                </li>
              ))}
            </ul>
          ))}
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="spacer" />
        <button
          className="btn btn-danger"
          onClick={async () => {
            if (!(await confirm({ title: "Удалить все данные?", text: "Будут удалены операторы, группы, проекты, лиды, смены, планы и начисления. Настройки останутся. Резервная копия сохранится автоматически.", ok: "Далее", danger: true }))) return;
            if (!(await confirm({ title: "Точно удалить всё?", text: "Это последнее подтверждение. Вернуть данные можно будет только из резервной копии.", ok: "Удалить всё", danger: true }))) return;
            await wipeAll();
          }}
        >
          <Icon name="trash" size={14} /> Очистить все данные
        </button>
      </div>
    </Section>
  );
}

function AboutSection() {
  const { data, persistent } = useCrm();
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void db.storageEstimate().then(setEst);
  }, [data]);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} МБ`;
  const counts = useMemo(
    () => [
      ["Операторы", data.operators.filter((o) => !o.deletedAt).length],
      ["Группы", data.groups.filter((g) => !g.deletedAt).length],
      ["Проекты", data.projects.filter((p) => !p.deletedAt).length],
      ["Лиды", data.leads.length],
      ["Смены", data.shifts.length],
      ["Планы месяцев", data.plans.length],
      ["Начисления", data.adjustments.length],
      ["Аккаунты", data.accounts.filter((a) => !a.deletedAt).length],
    ],
    [data],
  );
  return (
    <Section title="О системе">
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {counts.map(([k, v]) => (
          <Chip key={k as string}>
            {k}: {fmtInt(v as number)}
          </Chip>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-sub)", lineHeight: 1.7 }}>
        Хранилище: {persistent ? "IndexedDB этого браузера" : "только память вкладки (браузер запретил хранилище)"}
        {est && est.quota > 0 && ` · занято ${mb(est.usage)} из ${mb(est.quota)}`}
        <br />
        Зафиксированные месяцы: {data.frozenMonths.length ? data.frozenMonths.map(fmtMonth).join(", ") : "пока нет"} — планы и ставки этих месяцев не меняются при правке карточек.
        <br />
        Авторизация: {AUTH_ENABLED ? "включена" : "выключена — аккаунты переключаются без пароля (lib/appMode.ts → AUTH_ENABLED)"} · Версия{" "}
        {process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
      </div>
    </Section>
  );
}
