"use client";

import { useEffect, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { Modal } from "@/components/ui/kit";
import { DateInput } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { fmtDay } from "@/lib/crm/dates";
import { fmtNum, shortName } from "@/lib/crm/format";
import { pullShiftHours, type ShiftHoursResult } from "@/lib/crm/shiftHours";
import type { DayKey } from "@/lib/crm/types";

/**
 * «Часы из Скорозвона»: за выбранный день считает часы по статусам Скорозвона тем, у кого
 * в графике смена, и показывает было → станет. «Записать» ставит их в график. Каждый вечер
 * в 21:01 то же самое делает расписание — здесь можно проверить или дозаписать прошедший день.
 */

const PARTS: [string, string][] = [
  ["speaking", "разговор"],
  ["wrapup", "карточка"],
  ["ringing", "гудки"],
  ["normal", "доступен"],
];
const hhmm = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

export function SkorozvonHours({ onClose }: { onClose: () => void }) {
  const { today, toast, reload } = useCrm();
  const [date, setDate] = useState<DayKey>(today);
  const [res, setRes] = useState<ShiftHoursResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // предпросмотр — сразу и при смене дня
  useEffect(() => {
    let alive = true;
    setRes(null);
    setErr("");
    setSaved(false);
    setBusy(true);
    pullShiftHours(date, true)
      .then((r) => alive && setRes(r))
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [date]);

  const apply = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await pullShiftHours(date, false);
      setRes(r);
      setSaved(true);
      await reload();
      toast(`Часы из Скорозвона записаны: ${r.updated.length} смен`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changed = res?.updated.filter((u) => Math.abs(u.to - u.from) >= 0.01).length ?? 0;

  return (
    <Modal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="clock" size={16} /> Часы из Скорозвона
        </span>
      }
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className="o2-muted" style={{ fontSize: 12, marginRight: "auto" }}>
            Каждый день в 21:01 записывается само
          </span>
          <button className="btn" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy || saved || !res?.updated.length}>
            <Icon name="check" size={14} /> {saved ? "Записано" : "Записать в график"}
          </button>
        </>
      }
    >
      <div className="skh-top">
        <DateInput value={date} onChange={(v) => v && setDate(v)} max={today} width={170} ariaLabel="День" />
        <span className="o2-muted">Часы = разговор + заполняет карточку + гудки + доступен. Перерывы и «не беспокоить» не считаются.</span>
      </div>

      {err && <div className="skh-err">{err}</div>}

      {busy && !res ? (
        <div className="skh-list" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skh-row">
              <span className="sk" style={{ height: 11, width: "60%", borderRadius: 5 }} />
              <span className="sk" style={{ height: 11, width: 70, borderRadius: 5 }} />
              <span className="sk" style={{ height: 11, width: "90%", borderRadius: 5 }} />
            </div>
          ))}
        </div>
      ) : res ? (
        <>
          {res.note && <div className="o2-muted">{res.note}</div>}
          {res.updated.length > 0 && (
            <>
              <div className="skh-cap">
                {fmtDay(date, true)} · {res.updated.length} смен{changed ? ` · поменяется ${changed}` : ""}
              </div>
              <div className="skh-list">
                {res.updated
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "ru"))
                  .map((u) => (
                    <div key={u.name} className="skh-row">
                      <b>{shortName(u.name)}</b>
                      <span className="num skh-h">
                        <s>{fmtNum(u.from)}</s> → <b>{fmtNum(u.to)} ч</b>
                      </span>
                      <span className="o2-muted num skh-parts">{PARTS.map(([k, l]) => `${l} ${hhmm(u.parts[k] ?? 0)}`).join(" · ")}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
          {res.skipped.length > 0 && (
            <div className="skh-skip">
              <b>Не сопоставлены — их смены не трогаем ({res.skipped.length})</b>
              {res.skipped.map((s) => (
                <span key={s.name}>
                  {s.name} <span className="o2-muted">— {s.why}</span>
                </span>
              ))}
              <span className="o2-muted">Сопоставляем по фамилии (и имени, если фамилия повторяется): проверьте, что ФИО в CRM и в Скорозвоне совпадают.</span>
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}
