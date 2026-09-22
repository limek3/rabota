"use client";

import { useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { buildReport, reportRange, type ReportKind } from "@/lib/crm/report";
import { NO_GROUP, NO_GROUP_LABEL } from "@/lib/crm/types";
import { addDays, fmtDate } from "@/lib/crm/dates";
import { PageHead, Seg } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { ReportCanvas, type ReportCanvasHandle } from "@/components/app/ReportCanvas";

/**
 * Готовые отчёты за день и неделю. Супервайзер выбирает период и группу —
 * и отправляет картинку в чат: «Скопировать» кладёт PNG в буфер обмена,
 * «Скачать» сохраняет файл. Данные — в пределах прав аккаунта.
 */
export default function ReportsPage() {
  const { data, ix, today, toast } = useCrm();
  const [kind, setKind] = useState<ReportKind>("day");
  const [anchor, setAnchor] = useState(today);
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const pic = useRef<ReportCanvasHandle>(null);

  const report = useMemo(() => buildReport(data, ix, kind, anchor, groupId, today), [data, ix, kind, anchor, groupId, today]);
  const { from, to } = reportRange(kind, anchor);
  const step = kind === "day" ? 1 : 7;
  const groups = data.groups.filter((g) => !g.deletedAt);
  const hasNoGroup = data.operators.some((o) => !o.deletedAt && !o.groupId);

  const fileName = `otchet_${kind === "day" ? from : `${from}_${to}`}${groupId ? `_${report.scope.replace(/\s+/g, "-")}` : ""}.png`;

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
        sub="Готовые отчёты за день и неделю — картинкой, чтобы отправить в чат"
        actions={
          <>
            <button className="btn" onClick={download}>
              <Icon name="download" size={14} /> Скачать PNG
            </button>
            <button className="btn btn-primary" onClick={() => void copy()} disabled={busy}>
              <Icon name="copy" size={14} /> Скопировать картинку
            </button>
          </>
        }
      />

      <div className="toolbar">
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
        <span className="spacer" />
        <span style={{ fontSize: 12.5, color: "var(--dim)" }}>
          {kind === "day" ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`} · {report.rows.length} опер.
        </span>
      </div>

      <ReportCanvas ref={pic} report={report} company={data.settings.companyName || "LEADUP CRM"} />
    </div>
  );
}
