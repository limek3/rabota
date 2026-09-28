"use client";

import { useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { buildReport, reportRange, type ReportKind } from "@/lib/crm/report";
import { buildRopReport, groupTrack, ropText } from "@/lib/crm/rop";
import { NO_GROUP, NO_GROUP_LABEL, type RopSettings, type Track } from "@/lib/crm/types";
import { addDays, fmtDate } from "@/lib/crm/dates";
import { Collapse, Field, NumInput, PageHead, SaveBar, Seg, useDraft } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { ReportCanvas, type ReportCanvasHandle } from "@/components/app/ReportCanvas";
import { RopCanvas } from "@/components/app/RopCanvas";

/**
 * Готовые отчёты за день и неделю — картинкой (скопировать PNG в буфер или скачать).
 *
 * Какие отчёты — решает доступ:
 *   РОП         — оба: по операторам (как у супервайзера) и отчёт РОП — деньги, сегменты,
 *                 себестоимость лида, табель, найм, KPI; отчёт РОП ещё и текстом для чата.
 *   супервайзер — только по операторам своей группы (в пределах прав аккаунта).
 */

type View = "ops" | "rop";
export default function ReportsPage() {
  const { data, ix, today, toast, access } = useCrm();
  const [view, setView] = useState<View>("rop");
  const rop = access.isHead && view === "rop";
  const [kind, setKind] = useState<ReportKind>("day");
  const [anchor, setAnchor] = useState(today);
  const [groupId, setGroupId] = useState("");
  const [params, setParams] = useState(false);
  const [busy, setBusy] = useState(false);
  const pic = useRef<ReportCanvasHandle>(null);

  const report = useMemo(() => (rop ? null : buildReport(data, ix, kind, anchor, groupId, today)), [rop, data, ix, kind, anchor, groupId, today]);
  const ropReport = useMemo(() => (rop ? buildRopReport(data, ix, kind, anchor, today) : null), [rop, data, ix, kind, anchor, today]);
  const { from, to } = reportRange(kind, anchor);
  const step = kind === "day" ? 1 : 7;
  const groups = data.groups.filter((g) => !g.deletedAt);
  const hasNoGroup = data.operators.some((o) => !o.deletedAt && !o.groupId);
  const company = data.settings.companyName || "LEADUP CRM";

  const scope = report && groupId ? `_${report.scope.replace(/\s+/g, "-")}` : "";
  const fileName = `otchet${rop ? "_rop" : ""}_${kind === "day" ? from : `${from}_${to}`}${scope}.png`;

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
      <PageHead
        title="Отчёты"
        sub={access.isHead ? "Отчёт РОП и отчёт по операторам за день и неделю — картинкой или текстом, чтобы отправить в чат" : "Готовые отчёты за день и неделю — картинкой, чтобы отправить в чат"}
        actions={
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
      />

      <div className="toolbar">
        {access.isHead && (
          <Seg<View>
            value={view}
            onChange={setView}
            options={[
              { value: "rop", label: "Отчёт РОП" },
              { value: "ops", label: "По операторам" },
            ]}
          />
        )}
        <Seg<ReportKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "day", label: "За день" },
            { value: "week", label: "За неделю" },
          ]}
        />
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-icon" onClick={() => setAnchor(addDays(anchor, -step))} title={kind === "day" ? "Предыдущий день" : "Предыдущая неделя"}>
            <Icon name="chevL" size={14} />
          </button>
          <DateInput value={anchor} onChange={(v) => v && setAnchor(v)} max={today} width={150} ariaLabel="Дата отчёта" />
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
        {!rop && (
          <Select
            width={200}
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
        <span className="spacer" />
        {rop ? (
          <button className="btn btn-sm" onClick={() => setParams((v) => !v)} aria-expanded={params}>
            <Icon name="settings" size={13} /> Параметры отчёта
          </button>
        ) : (
          <span style={{ fontSize: 12.5, color: "var(--dim)" }}>
            {kind === "day" ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`} · {report?.rows.length ?? 0} опер.
          </span>
        )}
      </div>

      {rop && (
        <Collapse open={params}>
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
