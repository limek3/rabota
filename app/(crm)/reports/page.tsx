"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { buildReport, reportRange, type ReportKind } from "@/lib/crm/report";
import { buildRopReport, groupTrack, ropText } from "@/lib/crm/rop";
import { NO_GROUP, NO_GROUP_LABEL, type RopSettings, type Track } from "@/lib/crm/types";
import { addDays, fmtDate, isDayKey, isMonthKey, monthOf, monthStart, rangeDays } from "@/lib/crm/dates";
import { Collapse, Field, MonthSwitcher, NumInput, SaveBar, Seg, useDraft } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { ReportCanvas, type ReportCanvasHandle } from "@/components/app/ReportCanvas";
import { RopCanvas } from "@/components/app/RopCanvas";
import { StickyHead } from "@/components/app/StickyHead";
import { PageHero } from "@/components/app/PageHero";
import { OpsReportHero, RopReportHero, dayCols } from "@/components/app/HeroParts";

/**
 * Готовые отчёты за день, неделю и месяц — картинкой (скопировать PNG в буфер или скачать).
 * Месяц — только по операторам: группы, прогноз, лучшие. Со сводки сюда ведёт кнопка
 * «Отчёт за месяц»: /reports?kind=month&month=YYYY-MM&group=<id>.
 *
 * Какие отчёты — решает доступ:
 *   РОП         — оба: по операторам (как у супервайзера) и отчёт РОП — деньги, сегменты,
 *                 себестоимость лида, табель, найм, KPI; отчёт РОП ещё и текстом для чата.
 *   супервайзер — только по операторам своей группы (в пределах прав аккаунта).
 */

type View = "ops" | "rop";
export default function ReportsPage() {
  const { data, ix, today, toast, access, lens } = useCrm();
  // отчёт РОПа считает ФОТ и доход — ему нужны все лиды, фильтр «Проект» его не трогает
  const ropData = lens?.base.data ?? data;
  const ropIx = lens?.base.ix ?? ix;
  const [view, setView] = useState<View>("rop");
  const [kind, setKind] = useState<ReportKind>("day");
  // отчёт РОП — за день и неделю; месяц — по операторам
  const rop = access.isHead && view === "rop" && kind !== "month";
  const [anchor, setAnchor] = useState(today);
  const [groupId, setGroupId] = useState("");
  const [params, setParams] = useState(false);
  const [busy, setBusy] = useState(false);
  const pic = useRef<ReportCanvasHandle>(null);

  // пришли со сводки: сразу нужный отчёт (месяц, группа)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const k = q.get("kind");
    if (k === "day" || k === "week" || k === "month") {
      setKind(k);
      if (k !== "day" && access.isHead) setView("ops");
    }
    const m = q.get("month");
    const d = q.get("day");
    if (isDayKey(d) && d <= today) setAnchor(d);
    else if (isMonthKey(m)) setAnchor(monthOf(today) === m ? today : monthStart(m) <= today ? monthStart(m) : today);
    const g = q.get("group");
    if (g) setGroupId(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickKind = (k: ReportKind) => {
    setKind(k);
    if (k === "month" && access.isHead) setView("ops");
  };
  const pickView = (v: View) => {
    setView(v);
    if (v === "rop" && kind === "month") setKind("day");
  };

  const report = useMemo(() => (rop ? null : buildReport(data, ix, kind, anchor, groupId, today)), [rop, data, ix, kind, anchor, groupId, today]);
  const ropReport = useMemo(() => (rop ? buildRopReport(ropData, ropIx, kind, anchor, today) : null), [rop, ropData, ropIx, kind, anchor, today]);
  const { from, to } = reportRange(kind, anchor);
  const step = kind === "day" ? 1 : 7;
  // хиро: дни вокруг отчёта — месяц целиком или три недели до конца отрезка
  const heroDays = useMemo(() => (kind === "month" ? rangeDays(monthStart(monthOf(from)), to) : rangeDays(addDays(to, -20), to > today ? to : addDays(to, Math.min(6, Math.max(0, rangeDays(to, today).length - 1))))), [kind, from, to, today]);
  const heroLeads = useMemo(() => {
    const a = heroDays[0];
    const z = heroDays[heroDays.length - 1];
    return data.leads.filter((l) => {
      const d = l.at.slice(0, 10);
      return d >= a && d <= z && (!groupId || (l.groupId || NO_GROUP) === groupId);
    });
  }, [data.leads, heroDays, groupId]);
  const heroCols = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const l of heroLeads) cnt.set(l.at.slice(0, 10), (cnt.get(l.at.slice(0, 10)) ?? 0) + 1);
    const plan = new Map((report?.byDay ?? []).map((b) => [b.day, b.plan]));
    return dayCols(
      heroDays,
      (d) => cnt.get(d) ?? 0,
      today,
      (d) => d >= from && d <= to,
      (d) => {
        setAnchor(d);
        pickKind("day");
      },
      report ? (d) => plan.get(d) ?? 0 : undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroLeads, heroDays, today, from, to, report]);
  const groups = data.groups.filter((g) => !g.deletedAt);
  const hasNoGroup = data.operators.some((o) => !o.deletedAt && !o.groupId);
  const company = data.settings.companyName || "LEADUP CRM";

  const scope = report && groupId ? `_${report.scope.replace(/\s+/g, "-")}` : "";
  const fileName = `otchet${rop ? "_rop" : ""}_${kind === "day" ? from : kind === "month" ? monthOf(from) : `${from}_${to}`}${scope}.png`;

  const copy = async () => {
    setBusy(true);
    try {
      const blob = await pic.current?.toBlob();
      if (!blob) throw new Error("картинка не готова");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Картинка скопирована — вставьте в чат (Ctrl+V)");
    } catch (e) {
      toast(`Не удалось скопировать: ${e instanceof Error ? e.message : String(e)}. Скачайте файл`, "err");
    } finally {
      setBusy(false);
    }
  };
  const copyText = async () => {
    if (!ropReport) return;
    try {
      await navigator.clipboard.writeText(ropText(ropReport, company));
      toast("Текст отчёта скопирован — вставьте в чат (Ctrl+V)");
    } catch (e) {
      toast(`Не удалось скопировать: ${e instanceof Error ? e.message : String(e)}`, "err");
    }
  };
  const download = () => {
    const url = pic.current?.toDataURL();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  return (
    <div className="stack">
      <StickyHead title="Отчёты" />
      <PageHero
        accent="slate"
        style={{ ["--ph-cols" as string]: "minmax(200px, 0.85fr) minmax(400px, 1.55fr) minmax(220px, 1fr)", ["--ph-cols-md" as string]: "minmax(190px, 0.8fr) minmax(0, 1.6fr)" }}
        title="Отчёты"
        sub={access.isHead ? "Отчёт РОП за день и неделю, по операторам — ещё и за месяц: картинкой или текстом для чата" : "Готовые отчёты за день, неделю и месяц — картинкой, чтобы отправить в чат"}
        tools={
          <>
            <button className="btn" onClick={download}>
              <Icon name="download" size={14} /> Скачать PNG
            </button>
            {rop && (
              <button className="btn" onClick={() => void copyText()}>
                <Icon name="doc" size={14} /> Скопировать текстом
              </button>
            )}
            <button className="btn btn-primary" onClick={() => void copy()} disabled={busy}>
              <Icon name="copy" size={14} /> Скопировать картинку
            </button>
          </>
        }
        bar={
          <>
        {access.isHead && (
          <Seg<View>
            value={rop ? "rop" : "ops"}
            onChange={pickView}
            options={[
              { value: "rop", label: "Отчёт РОП" },
              { value: "ops", label: "По операторам" },
            ]}
          />
        )}
        <Seg<ReportKind>
          value={kind}
          onChange={pickKind}
          options={[
            { value: "day", label: "За день" },
            { value: "week", label: "За неделю" },
            { value: "month", label: "За месяц" },
          ]}
        />
        {/* дата — забирает остаток строки (вместе с выбором группы), чтобы панель не обрывалась пустым местом */}
        {kind === "month" ? (
          <div className="row rep-date" style={{ gap: 4 }}>
            <MonthSwitcher
              value={monthOf(anchor)}
              // будущий месяц пуст — дальше текущего не листаем
              onChange={(m) => setAnchor(m >= monthOf(today) ? today : monthStart(m))}
            />
          </div>
        ) : (
        <div className="row rep-date" style={{ gap: 4 }}>
          <button className="btn btn-icon" onClick={() => setAnchor(addDays(anchor, -step))} title={kind === "day" ? "Предыдущий день" : "Предыдущая неделя"}>
            <Icon name="chevL" size={14} />
          </button>
          <DateInput value={anchor} onChange={(v) => v && setAnchor(v)} max={today} width="auto" ariaLabel="Дата отчёта" />
          <button
            className="btn btn-icon"
            onClick={() => setAnchor(addDays(anchor, step) > today ? today : addDays(anchor, step))}
            disabled={kind === "day" ? anchor >= today : to >= today}
            title={kind === "day" ? "Следующий день" : "Следующая неделя"}
          >
            <Icon name="chevR" size={14} />
          </button>
          {anchor !== today && (
            <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(today)}>
              {kind === "day" ? "Сегодня" : "Эта неделя"}
            </button>
          )}
        </div>
        )}
        {!rop && (
          <Select
            width={200}
            style={{ flex: "1 1 180px", width: "auto" }}
            value={groupId}
            options={[
              { value: "", label: "Все группы" },
              ...groups.map<Opt>((g) => ({ value: g.id, label: g.name, icon: dot(g.color) })),
              ...(hasNoGroup ? [{ value: NO_GROUP, label: NO_GROUP_LABEL, icon: dot("gray") }] : []),
            ]}
            onChange={setGroupId}
            ariaLabel="Группа"
          />
        )}
        {rop && (
          <button className={`btn${params ? " btn-primary" : ""}`} onClick={() => setParams((v) => !v)} aria-expanded={params} title="Расходы, лимиты себестоимости лида, направления групп и план найма">
            <Icon name="settings" size={14} /> Параметры
          </button>
        )}
          </>
        }
      >
        {ropReport ? (
          <RopReportHero r={ropReport} cols={heroCols} onParams={() => setParams(true)} />
        ) : (
          report && <OpsReportHero r={report} cols={heroCols} />
        )}
      </PageHero>


      {rop && (
        <Collapse open={params} className="rep-w">
          <RopParams />
        </Collapse>
      )}

      {ropReport ? <RopCanvas ref={pic} report={ropReport} company={company} /> : report && <ReportCanvas ref={pic} report={report} company={company} />}
    </div>
  );
}

/**
 * Параметры отчёта РОП: примерные расходы в месяц, лимиты себестоимости лида,
 * направление каждой группы и план выхода новых операторов.
 */
function RopParams() {
  const { data, ix, saveSettings } = useCrm();
  const { draft, setDraft, dirty, reset } = useDraft<RopSettings>(data.settings.rop);
  const [busy, setBusy] = useState(false);
  const groups = data.groups.filter((g) => !g.deletedAt && g.active);
  const set = <K extends keyof RopSettings>(k: K, v: RopSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    await saveSettings({ rop: draft });
    setBusy(false);
  };
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid4">
        <Field label="Связь в месяц, ₽" hint="Телефония, сим-карты — примерно">
          <NumInput className="inp num" value={draft.telecomMonth} onChange={(v) => set("telecomMonth", v ?? 0)} max={100_000_000} />
        </Field>
        <Field label="Общие расходы в месяц, ₽" hint="Аренда, софт, прочее — примерно">
          <NumInput className="inp num" value={draft.overheadMonth} onChange={(v) => set("overheadMonth", v ?? 0)} max={100_000_000} />
        </Field>
        <Field label="Лимит сс лида · авто, ₽">
          <NumInput className="inp num" value={draft.capAuto} onChange={(v) => set("capAuto", v ?? 0)} max={1_000_000} />
        </Field>
        <Field label="Лимит сс лида · недвижимость, ₽">
          <NumInput className="inp num" value={draft.capRe} onChange={(v) => set("capRe", v ?? 0)} max={1_000_000} />
        </Field>
      </div>
      {groups.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Группа</th>
                <th style={{ width: 210 }}>Направление</th>
                <th className="r" style={{ width: 210 }} title="Сколько новых операторов должно выйти в группу за месяц">
                  План найма в месяц, чел.
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>
                    <Select
                      width={180}
                      value={draft.groupTrack[g.id] ?? groupTrack(data, ix, g.id)}
                      options={[
                        { value: "re", label: "Недвижимость" },
                        { value: "auto", label: "Авто" },
                      ]}
                      onChange={(v) => set("groupTrack", { ...draft.groupTrack, [g.id]: v as Track })}
                      ariaLabel={`Направление: ${g.name}`}
                    />
                  </td>
                  <td className="r">
                    <NumInput className="inp r num" value={draft.hirePlan[g.id] ?? 0} onChange={(v) => set("hirePlan", { ...draft.hirePlan, [g.id]: v ?? 0 })} max={1000} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SaveBar dirty={dirty} onSave={() => void save()} onReset={reset} busy={busy} />
    </section>
  );
}
