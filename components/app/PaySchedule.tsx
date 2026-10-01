"use client";

import { useCrm } from "@/lib/crm/store";
import type { PaySlot, Settings } from "@/lib/crm/types";
import { normalizeSchedule } from "@/lib/crm/defaults";
import { periodAt, periodIndexOf, type PayPeriod } from "@/lib/crm/payperiod";
import { WEEKDAYS_SHORT, fmtDate, isoWeekday } from "@/lib/crm/dates";
import { Chip, Field, NumInput } from "@/components/ui/kit";
import { DateInput } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";

/**
 * График выплат в настройках. Пока таблица пуста — периоды идут по правилу (начало, длина,
 * через сколько дней выплата). «Задать вручную» копирует правило в таблицу: дальше любую
 * строку можно поправить — периоды всегда подряд, следующий начинается после предыдущего.
 * После последней строки периоды снова идут по правилу.
 */

const wd = (d: string) => WEEKDAYS_SHORT[isoWeekday(d) - 1];
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const slot = (p: PayPeriod): PaySlot => ({ from: p.from, to: p.to, pay: p.pay });

export function PayScheduleSection({ value: f, set, bare }: { value: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void; /** Без карточки и заголовка — для окна в зарплате. */ bare?: boolean }) {
  const { today } = useCrm();
  const list = f.paySchedule;
  const manual = list.length > 0;
  const cur = periodIndexOf(f, today);
  const save = (rows: PaySlot[]) => set("paySchedule", normalizeSchedule(rows));
  const upd = (i: number, patch: Partial<PaySlot>) => save(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fill = () => save(Array.from({ length: cur + 3 }, (_, i) => slot(periodAt(f, i))));
  const add = () => save([...list, slot(periodAt(f, list.length))]);
  // продолжение по правилу: после таблицы — 3 периода, без таблицы — вокруг текущего
  const auto = manual ? [0, 1, 2].map((i) => periodAt(f, list.length + i)) : [cur - 1, cur, cur + 1, cur + 2].filter((i) => i >= 0).map((i) => periodAt(f, i));

  return (
    <section className={bare ? undefined : "card card-pad"} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!bare && (
            <h2 className="card-title" style={{ fontSize: 15 }}>
              <Icon name="calendar" size={16} className="title-ic" />
              График выплат
            </h2>
          )}
          <p className="card-sub">
            {manual
              ? "Периоды из таблицы: поменяйте «по» или день выплаты — следующий период сдвинется сам. После последней строки — по правилу ниже."
              : "Сейчас — по правилу: период заданной длины, выплата через N дней после конца. Если график меняется от месяца к месяцу — задайте его таблицей."}
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {manual ? (
            <>
              <button type="button" className="btn btn-sm" onClick={add}>
                <Icon name="plus" size={13} /> Период
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => save([])} title="Удалить таблицу и считать периоды по правилу">
                <Icon name="restore" size={13} /> По правилу
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={fill} title="Скопировать периоды по правилу в таблицу, чтобы поправить вручную">
              <Icon name="edit" size={13} /> Задать вручную
            </button>
          )}
        </div>
      </div>

      <div className="grid3">
        {!manual && (
          <Field label="Начало первого периода" hint="Первая выплата — за всё с первого рабочего дня до конца этого периода">
            <DateInput value={f.payPeriodStart} onChange={(v) => v && set("payPeriodStart", v)} ariaLabel="Начало первого периода выплат" />
          </Field>
        )}
        <Field label={manual ? "Дальше: длина периода, дней" : "Длина периода, дней"} hint="14 — выплата раз в две недели">
          <NumInput value={f.payPeriodDays} onChange={(v) => set("payPeriodDays", Math.max(7, Math.min(31, Math.round(v ?? 14))))} max={31} />
        </Field>
        <Field label={manual ? "Дальше: выплата через, дней" : "Выплата через, дней"} hint="После конца периода: 05.10 → 09.10 — это 4 дня">
          <NumInput value={f.payDelayDays} onChange={(v) => set("payDelayDays", Math.max(0, Math.min(30, Math.round(v ?? 4))))} max={30} />
        </Field>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th style={{ width: 36 }}>№</th>
              <th>Период с</th>
              <th>по</th>
              <th className="r">Дней</th>
              <th>Выплата</th>
              <th className="r" title="Сколько дней между концом периода и выплатой">После периода</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i}>
                <td className="muted num">{i + 1}</td>
                <td>
                  {i === 0 ? (
                    <DateInput size="sm" width={140} value={r.from} onChange={(v) => v && upd(0, { from: v })} ariaLabel="Начало периода" />
                  ) : (
                    <span className="num">{fmtDate(r.from)}</span>
                  )}
                </td>
                <td>
                  <DateInput size="sm" width={140} value={r.to} min={r.from} onChange={(v) => v && upd(i, { to: v })} ariaLabel="Конец периода" />
                </td>
                <td className="r num">{span(r.from, r.to) + 1}</td>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <DateInput size="sm" width={140} value={r.pay} min={r.to} onChange={(v) => v && upd(i, { pay: v })} ariaLabel="День выплаты" />
                    <span className="muted">{wd(r.pay)}</span>
                    {i === cur && <Chip hue="blue">идёт</Chip>}
                  </span>
                </td>
                <td className="r num">{span(r.to, r.pay)} дн.</td>
                <td className="r">
                  <button type="button" className="btn btn-ghost btn-sm" title="Удалить строку — соседний период займёт её дни" onClick={() => save(list.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {auto.map((p) => (
              <tr key={`a${p.idx}`} style={{ color: "var(--dim)" }}>
                <td className="num">{p.idx + 1}</td>
                <td className="num">{fmtDate(p.from)}</td>
                <td className="num">{fmtDate(p.to)}</td>
                <td className="r num">{span(p.from, p.to) + 1}</td>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="num">{fmtDate(p.pay)}</span>
                    <span>{wd(p.pay)}</span>
                    {p.idx === cur && <Chip hue="blue">идёт</Chip>}
                  </span>
                </td>
                <td className="r num">{span(p.to, p.pay)} дн.</td>
                <td className="r" style={{ fontSize: 11.5 }}>по правилу</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
