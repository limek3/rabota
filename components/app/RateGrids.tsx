"use client";

import { useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { normalizeTiers } from "@/lib/crm/defaults";
import type { RateGrid, RateTier, SvBonusGrid, SvBonusRow } from "@/lib/crm/types";
import { GRADE_LABEL, TRACK_LABEL } from "@/lib/crm/types";
import { fmtInt, fmtMoney, plural, LEADS } from "@/lib/crm/format";
import { Chip, Field, NumInput } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/** «от 3 лидов за смену», «0–2 лида за смену» — подпись ступени. */
export function tierRange(tiers: RateTier[], i: number): string {
  const from = tiers[i].from;
  const next = tiers[i + 1]?.from;
  if (next == null) return `от ${from} ${plural(from, LEADS)} за смену`;
  if (next - from === 1) return `${from} ${plural(from, LEADS)} за смену`;
  return `${from}–${next - 1} ${plural(next - 1, LEADS)} за смену`;
}

/** Показ сетки: чем больше лидов в смене, тем выше ставка часа и бонус. */
export function TierTable({ tiers, highlight, withHourly = true }: { tiers: RateTier[]; highlight?: number; withHourly?: boolean }) {
  if (!tiers.length) return <div style={{ fontSize: 12.5, color: "var(--dim)" }}>Сетка пуста</div>;
  return (
    <table className="tbl tbl-fit" style={{ background: "transparent" }}>
      <thead>
        <tr>
          <th>Лидов за смену</th>
          {withHourly && <th className="r">Ставка, ₽/ч</th>}
          <th className="r">Бонус за лид, ₽</th>
        </tr>
      </thead>
      <tbody>
        {tiers.map((t, i) => {
          const on = highlight != null && highlight === t.from;
          return (
            <tr key={t.from} style={on ? { background: "var(--brand-tint)" } : undefined}>
              {/* в узкой колонке «0–5 лидов за смену · сейчас» переносится, а не распирает таблицу */}
              <td style={{ fontWeight: on ? 600 : 400, whiteSpace: "normal" }}>
                {tierRange(tiers, i)}
                {on && <span style={{ color: "var(--brand)" }}> · сейчас</span>}
              </td>
              {withHourly && <td className="r num">{fmtInt(t.hourlyRate)}</td>}
              <td className="r num">{fmtInt(t.leadBonus)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Редактор тарифных сеток — раздел системных настроек (только РОП). Правит черновик
 * формы; в базу уходит по общей кнопке «Сохранить» (ступени там же упорядочиваются).
 */
export function RateGridsSection({
  grids,
  defaultGridId,
  onChange,
}: {
  grids: RateGrid[];
  defaultGridId: string;
  onChange: (grids: RateGrid[], defaultGridId: string) => void;
}) {
  const { data, confirm } = useCrm();
  const s = data.settings;
  const [open, setOpen] = useState<string | null>(grids[0]?.id ?? null);

  const write = (next: RateGrid[], def = defaultGridId) => onChange(next, next.some((g) => g.id === def) ? def : next[0]?.id ?? "");

  const patch = (id: string, fn: (g: RateGrid) => RateGrid) => write(grids.map((g) => (g.id === id ? fn(g) : g)));

  const addGrid = () => {
    const id = `grid_${Date.now().toString(36)}`;
    write([...grids, { id, name: `Сетка ${grids.length + 1}`, tiers: [{ from: 0, hourlyRate: s.defaultHourlyRate, leadBonus: s.defaultLeadBonus }] }]);
    setOpen(id);
  };

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="card-title" style={{ fontSize: 15 }}>
            Тарифные сетки
          </h2>
          <p className="card-sub">
            Ставка за час и бонус за лид зависят от того, сколько лидов оператор передал <b>в эту смену</b>. Каждый день считается по своей
            ступени: сделал больше — весь день оплачен дороже.
          </p>
        </div>
        <button className="btn btn-sm" onClick={addGrid}>
          <Icon name="plus" size={13} /> Сетка
        </button>
      </div>

      {grids.map((g) => {
        const isDefault = g.id === defaultGridId;
        const used = data.operators.filter((o) => !o.deletedAt && (o.rateGridId ?? defaultGridId) === g.id).length;
        const expanded = open === g.id;
        return (
          <div key={g.id} className="card" style={{ background: "var(--bg)", padding: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpen(expanded ? null : g.id)} aria-label="Раскрыть">
                <Icon name={expanded ? "chevD" : "chevR"} size={14} />
              </button>
              <input
                className="inp inp-sm"
                style={{ width: 220 }}
                value={g.name}
                onChange={(e) => patch(g.id, (x) => ({ ...x, name: e.target.value }))}
                aria-label="Название сетки"
              />
              {isDefault ? (
                <Chip hue="purple">По умолчанию</Chip>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => write(grids, g.id)}>
                  Сделать основной
                </button>
              )}
              <Chip hue="gray">{used} чел.</Chip>
              <span className="spacer" />
              {grids.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  title="Удалить сетку"
                  onClick={async () => {
                    if (await confirm({ title: `Удалить сетку «${g.name}»?`, text: `${used ? `${used} чел. перейдут на сетку по умолчанию. ` : ""}Изменение вступит в силу после «Сохранить».`, ok: "Удалить", danger: true }))
                      write(grids.filter((x) => x.id !== g.id));
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>

            {expanded && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <table className="tbl tbl-fit" style={{ background: "transparent" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>Лидов за смену, от</th>
                      <th className="r" style={{ width: 150 }}>
                        Ставка, ₽/час
                      </th>
                      <th className="r" style={{ width: 150 }}>
                        Бонус за лид, ₽
                      </th>
                      <th>Условие</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.tiers.map((t, i) => (
                      <tr key={i}>
                        <td>
                          <NumInput
                            className="inp inp-sm num"
                            style={{ width: 90, textAlign: "right" }}
                            value={t.from}
                            min={0}
                            max={100}
                            onChange={(v) => patch(g.id, (x) => ({ ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, from: v ?? 0 } : y)) }))}
                          />
                        </td>
                        <td className="r">
                          <NumInput
                            className="inp inp-sm num"
                            style={{ width: 110, textAlign: "right" }}
                            value={t.hourlyRate}
                            max={100000}
                            onChange={(v) => patch(g.id, (x) => ({ ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, hourlyRate: v ?? 0 } : y)) }))}
                          />
                        </td>
                        <td className="r">
                          <NumInput
                            className="inp inp-sm num"
                            style={{ width: 110, textAlign: "right" }}
                            value={t.leadBonus}
                            max={1000000}
                            onChange={(v) => patch(g.id, (x) => ({ ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, leadBonus: v ?? 0 } : y)) }))}
                          />
                        </td>
                        <td className="muted">{tierRange(g.tiers, i)}</td>
                        <td className="r">
                          {g.tiers.length > 1 && i > 0 && (
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Убрать ступень"
                              onClick={() => patch(g.id, (x) => ({ ...x, tiers: normalizeTiers(x.tiers.filter((_, j) => j !== i)) }))}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      patch(g.id, (x) => {
                        const last = x.tiers[x.tiers.length - 1];
                        return {
                          ...x,
                          tiers: normalizeTiers([...x.tiers, { from: last.from + 2, hourlyRate: Math.round(last.hourlyRate * 1.2), leadBonus: Math.round(last.leadBonus * 1.25) }]),
                        };
                      })
                    }
                  >
                    <Icon name="plus" size={13} /> Ступень
                  </button>
                  <span style={{ fontSize: 12, color: "var(--dim)" }}>
                    Пример: смена 8 ч и 4 лида ⇒ {fmtMoney(8 * tierAt(g.tiers, 4).hourlyRate + 4 * tierAt(g.tiers, 4).leadBonus)} за день
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5 }}>
        Схемы оплаты «По сетке за смену» и «Оклад + бонус по сетке» берут значения отсюда. Сетка назначается в карточке оператора; прошедшие
        месяцы уже зафиксированы и не пересчитываются.
      </div>
    </section>
  );
}

/** Сетка бонуса супервайзера: пороги объёма × грейд × направление. Правит черновик формы настроек. */
export function SvBonusSection({ value: g, onChange }: { value: SvBonusGrid; onChange: (v: SvBonusGrid) => void }) {
  const { confirm } = useCrm();
  const write = (patch: Partial<SvBonusGrid>) => onChange({ ...g, ...patch });
  const setRow = (i: number, fn: (r: SvBonusRow) => SvBonusRow) => write({ rows: g.rows.map((r, j) => (j === i ? fn(r) : r)) });
  const cell = (i: number, track: "re" | "auto", col: 0 | 1 | 2) => (
    <NumInput
      className="inp inp-sm num"
      style={{ width: 86, textAlign: "right" }}
      value={g.rows[i][track][col]}
      max={10_000_000}
      onChange={(v) =>
        setRow(i, (r) => {
          const arr = [...r[track]] as [number, number, number];
          arr[col] = v ?? 0;
          return { ...r, [track]: arr };
        })
      }
    />
  );

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2 className="card-title" style={{ fontSize: 15 }}>
          Мотивация супервайзера
        </h2>
        <p className="card-sub">
          Оклад плюс бонус за объём лидов его групп за месяц. Колонка в сетке — по грейду и направлению; ниже порога бонуса нет. Схема
          назначается оператору как «{"Супервайзер: оклад + бонус за объём группы"}».
        </p>
      </div>

      <div className="grid3">
        <Field label="Оклад супервайзера, ₽">
          <NumInput value={g.salary} onChange={(v) => write({ salary: v ?? 0 })} max={10_000_000} />
        </Field>
        <Field label="Порог бонуса, лидов" hint="Ниже — бонуса нет вообще">
          <NumInput value={g.minLeads} onChange={(v) => write({ minLeads: v ?? 0 })} max={100000} />
        </Field>
        <Field label="Коэффициент без роста" hint="Применяется к Middle и Senior">
          <NumInput value={g.noGrowthK} onChange={(v) => write({ noGrowthK: v ?? 1 })} max={2} step={0.01} />
        </Field>
      </div>

      <div className="tbl-wrap">
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th rowSpan={2}>Лидов за месяц, от</th>
              <th className="c grp" colSpan={3}>
                {TRACK_LABEL.re}
              </th>
              <th className="c grp" colSpan={3}>
                {TRACK_LABEL.auto}
              </th>
              <th rowSpan={2} />
            </tr>
            <tr>
              <th className="c bl">{GRADE_LABEL.jr}</th>
              <th className="c">{GRADE_LABEL.mid}</th>
              <th className="c">{GRADE_LABEL.sr}</th>
              <th className="c bl">{GRADE_LABEL.jr}</th>
              <th className="c">{GRADE_LABEL.mid}</th>
              <th className="c">{GRADE_LABEL.sr}</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r, i) => (
              <tr key={i} className={r.from < g.minLeads ? "dim" : ""}>
                <td>
                  <NumInput
                    className="inp inp-sm num"
                    style={{ width: 90, textAlign: "right" }}
                    value={r.from}
                    max={1_000_000}
                    onChange={(v) => write({ rows: g.rows.map((x, j) => (j === i ? { ...x, from: v ?? 0 } : x)) })}
                  />
                </td>
                <td className="r bl">{cell(i, "re", 0)}</td>
                <td className="r">{cell(i, "re", 1)}</td>
                <td className="r">{cell(i, "re", 2)}</td>
                <td className="r bl">{cell(i, "auto", 0)}</td>
                <td className="r">{cell(i, "auto", 1)}</td>
                <td className="r">{cell(i, "auto", 2)}</td>
                <td className="r">
                  {g.rows.length > 1 && (
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Убрать ступень"
                      onClick={async () => {
                        if (await confirm({ title: `Убрать ступень ${r.from}?`, ok: "Убрать", danger: true })) write({ rows: g.rows.filter((_, j) => j !== i) });
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            const last = g.rows[g.rows.length - 1];
            write({ rows: [...g.rows, { ...last, from: last.from + 250 }] });
          }}
        >
          <Icon name="plus" size={13} /> Ступень
        </button>
        <span style={{ fontSize: 12, color: "var(--dim)" }}>Коэффициенты апрува — в разделе «Апрув заказчика» ниже.</span>
      </div>
    </section>
  );
}

function tierAt(tiers: RateTier[], leads: number): RateTier {
  let cur = tiers[0] ?? { from: 0, hourlyRate: 0, leadBonus: 0 };
  for (const t of tiers) if (leads >= t.from) cur = t;
  return cur;
}

/** Поле выбора сетки в карточке оператора. */
export function GridField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useCrm();
  const s = data.settings;
  const grid = s.rateGrids.find((g) => g.id === (value ?? s.defaultGridId)) ?? s.rateGrids[0];
  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Тарифная сетка" hint="Ставка часа и бонус за лид зависят от числа лидов в смене">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {s.rateGrids.map((g) => (
            <button
              key={g.id}
              type="button"
              className="chip"
              aria-pressed={(value ?? s.defaultGridId) === g.id}
              style={{ ["--chip-fg" as string]: "var(--c-purple-fg)", ["--chip-bg" as string]: "var(--c-purple-bg)", ["--chip-bd" as string]: "var(--c-purple-bd)" }}
              onClick={() => onChange(g.id === s.defaultGridId ? null : g.id)}
            >
              {g.name}
              {g.id === s.defaultGridId ? " · по умолчанию" : ""}
            </button>
          ))}
        </div>
      </Field>
      {grid && (
        <div className="card" style={{ background: "var(--bg)", padding: "4px 10px" }}>
          <TierTable tiers={grid.tiers} />
        </div>
      )}
    </div>
  );
}
