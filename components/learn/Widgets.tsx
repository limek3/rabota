"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { DATA_AS_OF, DATA_SRC, GGRP, REFS, norm, type WidgetId } from "@/lib/learn";
import { svBonus, tierFor } from "@/lib/crm/payroll";
import { LEADS, fmtInt, fmtMoney, fmtNum, plural } from "@/lib/crm/format";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/select";

/**
 * Справочники, тренажёры и калькуляторы академии.
 *
 * Состав, тексты и логика — как в исходных материалах. Отличие одно и
 * намеренное: калькуляторы берут ставки из настроек платформы, а не из
 * зашитых чисел, иначе обучение и ведомость со временем разошлись бы.
 */

/* ── общие части ───────────────────────────────────────────────── */

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="searchfield">
      <Icon name="search" size={16} style={{ color: "var(--dim)" }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button className="btn btn-sm btn-ghost" onClick={() => onChange("")} title="Очистить">
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

function Filters({ list, value, onChange }: { list: { v: string; t: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="filters">
      {list.map((f) => (
        <button key={f.v} className={`filt${value === f.v ? " on" : ""}`} onClick={() => onChange(f.v)}>
          {f.t}
        </button>
      ))}
    </div>
  );
}

/** Подсветка совпадения — как в источнике. */
function Mark({ t, q }: { t: string; q: string }) {
  if (!q) return <>{t}</>;
  const p = norm(t).indexOf(norm(q));
  if (p < 0) return <>{t}</>;
  return (
    <>
      {t.slice(0, p)}
      <span className="hl">{t.slice(p, p + q.length)}</span>
      {t.slice(p + q.length)}
    </>
  );
}

function DataNote({ k }: { k: string }) {
  return (
    <div className="datanote">
      <Icon name="clock" size={15} stroke={2.2} />
      <span>
        <b>Данные загружены: {DATA_AS_OF}.</b> Источник — {DATA_SRC[k] ?? "материалы проекта"}. Цены и наличие меняются: если
        клиент спорит с цифрой или её нет в таблице, не спорьте в ответ — уточните у супервайзера.
      </span>
    </div>
  );
}

const Foot = ({ children }: { children: React.ReactNode }) => <div className="chknote">{children}</div>;

/* ── статусы ───────────────────────────────────────────────────── */

const ST_HUE: Record<string, string> = { Успешные: "ok", Промежуточные: "warn", Недозвон: "g", Неуспешные: "err" };

export function StatusTable({ kind }: { kind: "re" | "auto" }) {
  const src = kind === "auto" ? REFS.statusesAuto : REFS.statusesRealty;
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const rows = src.filter((r) => (f === "all" || r.g === f) && (!q || norm(r.n).includes(norm(q)) || norm(r.d).includes(norm(q))));
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Статус или ситуация: дубль, тишина, ПВ…" />
      <Filters
        value={f}
        onChange={setF}
        list={[
          { v: "all", t: "Все статусы" },
          { v: "Успешные", t: "Успешные" },
          { v: "Промежуточные", t: "Промежуточные" },
          { v: "Недозвон", t: "Недозвон" },
          { v: "Неуспешные", t: "Неуспешные" },
        ]}
      />
      <div className="lrn-list">
        {rows.map((r) => (
          <div className="strow" key={r.n}>
            <span className="sn">
              <Mark t={r.n} q={q} />
              <div style={{ marginTop: 6 }}>
                <span className={`lpill ${ST_HUE[r.g] ?? "g"}`}>{r.g}</span>
              </div>
            </span>
            <span className="sd">
              <Mark t={r.d} q={q} />
            </span>
          </div>
        ))}
        {!rows.length && <div className="lrn-empty">Ничего не нашлось. Попробуйте: «дубль», «перезвонить», «бот».</div>}
      </div>
      <Foot>
        {rows.length} из {src.length} статусов. Статус ставим по факту разговора: от него зависят перезаливы базы и ваша
        конверсия.
      </Foot>
      <DataNote k="status" />
    </>
  );
}

/* ── цены новостроек ───────────────────────────────────────────── */

export function PriceTable() {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const rows = REFS.prices.filter((r) => (f === "all" || r.zone === f) && (!q || norm(r.city).includes(norm(q))));
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Город: Казань, Тула, Сочи…" />
      <Filters
        value={f}
        onChange={setF}
        list={[
          { v: "all", t: "Все города" },
          { v: "МСК / СПБ", t: "МСК / СПБ" },
          { v: "Т1", t: "Регионы Т1" },
          { v: "Т2", t: "Регионы Т2" },
        ]}
      />
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Город</th>
              <th>Студия</th>
              <th>1-комн.</th>
              <th>2-комн.</th>
              <th>3-комн.</th>
              <th>Перевод</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.city}>
                <td>
                  <Mark t={r.city} q={q} />
                </td>
                <td className="num">{r.s}</td>
                <td className="num">{r.k1}</td>
                <td className="num">{r.k2}</td>
                <td className="num">{r.k3}</td>
                <td>{r.transfer}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="lrn-empty">
                  Города нет в списке — значит, мы с ним не работаем. Ставьте «Интерес. Регион».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Foot>
        {rows.length} из {REFS.prices.length} городов. Цены — нижняя граница вилки; озвучиваем только при прямом вопросе
        клиента и после проверки на уникальность.
      </Foot>
      <DataNote k="prices" />
    </>
  );
}

/* ── возражения ────────────────────────────────────────────────── */

export function ObjList({ track }: { track?: "realty" | "auto" }) {
  const [q, setQ] = useState("");
  const rows = REFS.objections.filter(
    (o) => (!track || o.t === track) && (!q || norm(o.q).includes(norm(q)) || norm(o.a).includes(norm(q))),
  );
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Возражение: дорого, откуда номер, подумаю…" />
      <div className="qa">
        {rows.map((o) => (
          <div className="qacard" key={o.q}>
            <div className="q">
              <Mark t={o.q} q={q} />
            </div>
            <div className="a">
              <b>Отвечаем</b>
              <Mark t={o.a} q={q} />
            </div>
          </div>
        ))}
        {!rows.length && <div className="lrn-empty">Ничего не нашлось.</div>}
      </div>
      <Foot>Каждый ответ заканчиваем вопросом по скрипту — иначе после паузы клиент кладёт трубку.</Foot>
    </>
  );
}

/* ── глоссарий ─────────────────────────────────────────────────── */

export function GlossList() {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const rows = REFS.glossary.filter(
    (g) => (f === "all" || g.g === f) && (!q || norm(g.t).includes(norm(q)) || norm(g.d).includes(norm(q))),
  );
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Термин: ПВ, кроссовер, апрув, FTE…" />
      <Filters value={f} onChange={setF} list={[{ v: "all", t: "Все термины" }, ...GGRP.map((g) => ({ v: g.v, t: g.t }))]} />
      {!rows.length && <div className="lrn-empty">Ничего не нашлось.</div>}
      {GGRP.map((grp) => {
        const list = rows.filter((g) => g.g === grp.v);
        if (!list.length) return null;
        return (
          <div key={grp.v}>
            <h2 className="lsec">
              {grp.t} <span className="cnt num">{list.length}</span>
            </h2>
            <p className="subline">{grp.s}</p>
            <div className="lgrid">
              {list.map((g) => (
                <div className="lcard plain" key={g.t}>
                  <span className="ct" style={{ fontSize: 15 }}>
                    <Mark t={g.t} q={q} />
                  </span>
                  <span className="cd">
                    <Mark t={g.d} q={q} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ── авто: цены и города ───────────────────────────────────────── */

export function AutoPriceTable() {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const rows = REFS.autoPrices
    .filter((r) => (f === "all" || r.segment === f) && (!q || norm(r.name).includes(norm(q)) || norm(r.aliases || "").includes(norm(q))))
    .sort((a, b) => (a.price || 1e12) - (b.price || 1e12));
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Марка: Хавейл, Чери, Лада, BMW…" />
      <Filters
        value={f}
        onChange={setF}
        list={[
          { v: "all", t: "Все марки" },
          { v: "budget", t: "Доступные" },
          { v: "middle", t: "Средний сегмент" },
          { v: "premium", t: "Премиум" },
          { v: "unavailable", t: "Нет в наличии" },
        ]}
      />
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Марка</th>
              <th>Латиницей</th>
              <th>Стартовая цена</th>
              <th>Страна</th>
              <th>Особенности</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <Mark t={r.name} q={q} />
                </td>
                <td style={{ color: "var(--dim)" }}>{r.aliases || "—"}</td>
                <td className="num">
                  {r.segment === "unavailable" ? <span className="lpill err">нет в наличии</span> : fmtMoney(r.price)}
                </td>
                <td>{r.country || "—"}</td>
                <td>{r.power || "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="lrn-empty">
                  Марка не найдена. Уточните у клиента готовность рассмотреть другие марки.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Foot>
        {rows.length} из {REFS.autoPrices.length} марок. Это стартовые цены по марке, а не стоимость конкретной модели:
        комплектацию, наличие и итоговое предложение подтверждает менеджер.
      </Foot>
      <DataNote k="auto" />
    </>
  );
}

export function CitiesTable() {
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const rows = REFS.autoCities
    .filter((r) => (f === "all" || r.hub === f) && (!q || norm(r.city).includes(norm(q))))
    .sort((a, b) => a.km - b.km);
  return (
    <>
      <SearchField value={q} onChange={setQ} placeholder="Город клиента: Тверь, Казань, Псков…" />
      <Filters
        value={f}
        onChange={setF}
        list={[
          { v: "all", t: "Все города" },
          { v: "Москва", t: "До Москвы" },
          { v: "Санкт-Петербург", t: "До Санкт-Петербурга" },
        ]}
      />
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Город</th>
              <th>Ближайший ДЦ</th>
              <th>Расстояние</th>
              <th>Примерно в пути</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.city}>
                <td>
                  <Mark t={r.city} q={q} />
                </td>
                <td>{r.hub}</td>
                <td className="num">{r.km} км</td>
                <td className="num" style={{ color: "var(--dim)" }}>
                  ≈ {fmtNum(Math.round((r.km / 80) * 10) / 10, 1)} ч
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="lrn-empty">
                  Города нет в таблице — уточните готовность приехать в ДЦ и согласуйте с руководителем.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Foot>
        {rows.length} из {REFS.autoCities.length} городов. Время в пути — грубая оценка по 80 км/ч, не расчёт маршрута. В
        скрипте важно другое: готов ли клиент приехать в ДЦ в ближайшие 1–2 недели.
      </Foot>
      <DataNote k="cities" />
    </>
  );
}

/* ── тренажёры ─────────────────────────────────────────────────── */

const shuffle = <T,>(a: T[]): T[] => {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};

/** Тренажёр возражений: вспоминаем ответ, сверяем с эталоном. */
function ObjTrainer({ track }: { track?: "realty" | "auto" }) {
  const pool = useMemo(() => REFS.objections.filter((o) => !track || o.t === track), [track]);
  const [queue, setQueue] = useState<number[]>(() => shuffle(pool.map((_, i) => i)));
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [ok, setOk] = useState(0);
  const [no, setNo] = useState(0);
  const cur = pool[queue[i % queue.length]];
  const step = (good: boolean | null) => {
    if (good === true) setOk((x) => x + 1);
    if (good === false) setNo((x) => x + 1);
    setFlip(false);
    setI((x) => {
      const n = x + 1;
      if (n % queue.length === 0) setQueue(shuffle(pool.map((_, k) => k)));
      return n;
    });
  };
  if (!cur) return <div className="lrn-empty">Возражений нет.</div>;
  return (
    <div className="trainer">
      <div className="flip">
        <div className="who2">Клиент говорит{track ? "" : cur.t === "auto" ? " · автотема" : " · недвижимость"}</div>
        <div className="said">«{cur.q}»</div>
        {flip ? (
          <div className="ans">
            <b>Отвечаем:</b> {cur.a}
          </div>
        ) : (
          <div className="ans dim">Проговорите ответ вслух, затем откройте эталон и сравните формулировку.</div>
        )}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {flip ? (
          <>
            <button className="btn" onClick={() => step(false)}>
              Ответил неточно
            </button>
            <button className="btn btn-primary" onClick={() => step(true)}>
              Ответил верно <Icon name="arrowR" size={15} />
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => setFlip(true)}>
              Показать эталон
            </button>
            <button className="btn" onClick={() => step(null)}>
              Пропустить
            </button>
          </>
        )}
      </div>
      <div className="tstat">
        <span>
          Карточка {(i % pool.length) + 1} из {pool.length}
        </span>
        <span style={{ color: "var(--green)" }}>верно: {ok}</span>
        <span style={{ color: "var(--amber)" }}>неточно: {no}</span>
      </div>
    </div>
  );
}

/** Тренажёр статусов: ситуация из звонка — выбираем статус. */
function StatusTrainer() {
  const pool = useMemo(
    () => [...REFS.statusesRealty.map((x) => ({ ...x, auto: false })), ...REFS.statusesAuto.map((x) => ({ ...x, auto: true }))],
    [],
  );
  const [queue, setQueue] = useState<number[]>(() => shuffle(pool.map((_, i) => i)));
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [ok, setOk] = useState(0);
  const [no, setNo] = useState(0);
  const cur = pool[queue[i % queue.length]];
  const opts = useMemo(() => {
    if (!cur) return [];
    const same = pool.filter((x) => x.auto === cur.auto && x.n !== cur.n);
    const sameGroup = shuffle(same.filter((x) => x.g === cur.g));
    return shuffle([cur, ...[...sameGroup, ...shuffle(same)].slice(0, 3)]);
    // новый набор вариантов — на каждую карточку
  }, [cur, pool]);
  if (!cur) return <div className="lrn-empty">Статусов нет.</div>;
  const done = pick !== null;
  return (
    <div className="trainer">
      <div className="flip">
        <div className="who2">Ситуация в звонке · {cur.auto ? "автотема" : "недвижимость"}</div>
        <div className="said">{cur.d}</div>
      </div>
      <div className="opts" style={{ marginTop: 14 }}>
        {opts.map((o, j) => {
          let cls = "opt";
          if (done) {
            if (o.n === cur.n) cls += " right";
            else if (pick === j) cls += " wrong";
          }
          return (
            <button
              key={j}
              className={cls}
              disabled={done}
              onClick={() => {
                setPick(j);
                if (o.n === cur.n) setOk((x) => x + 1);
                else setNo((x) => x + 1);
              }}
            >
              <span className="k">{"АБВГ"[j]}</span>
              <span>{o.n}</span>
            </button>
          );
        })}
      </div>
      {done && (
        <>
          <div className="why" style={{ marginTop: 14 }}>
            <b>{opts[pick!].n === cur.n ? "Верно." : `Правильный ответ — «${cur.n}».`}</b> {cur.d}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                setPick(null);
                setI((x) => {
                  const n = x + 1;
                  if (n % queue.length === 0) setQueue(shuffle(pool.map((_, k) => k)));
                  return n;
                });
              }}
            >
              Следующая ситуация <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      )}
      <div className="tstat">
        <span>Ситуация {i + 1}</span>
        <span style={{ color: "var(--green)" }}>верно: {ok}</span>
        <span style={{ color: "var(--red)" }}>ошибок: {no}</span>
      </div>
    </div>
  );
}

/* ── калькуляторы ──────────────────────────────────────────────── */

const Out = ({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: string }) => (
  <div className={`ob${big ? " big" : ""}`}>
    <div className="l">{label}</div>
    <div className="v num" style={tone ? { color: tone } : undefined}>
      {value}
    </div>
  </div>
);

const RANGE = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Калькулятор смены оператора. Ставки — из настроек платформы. */
export function CalcOp() {
  const { data, access } = useCrm();
  const s = data.settings;
  const myOp = access.opId ? data.operators.find((o) => o.id === access.opId) : null;
  const grid = s.rateGrids.find((g) => g.id === (myOp?.rateGridId ?? s.defaultGridId)) ?? s.rateGrids[0];
  const tiers = grid?.tiers ?? [];
  const [h, setH] = useState(8);
  const [l, setL] = useState(6);

  const cur = tierFor(tiers, l);
  const sum = cur.hourlyRate * h + cur.leadBonus * l;
  const eff = h ? Math.round((l / h) * 100) : 0;
  const next = tiers.find((t) => t.from > l) ?? null;
  const hint = next
    ? `Ещё ${next.from - l} ${plural(next.from - l, LEADS)} — и смена стоит ${fmtMoney(next.hourlyRate * h + next.leadBonus * next.from)} вместо ${fmtMoney(sum)}.`
    : `Вы в верхней ступени сетки: ${fmtInt(cur.hourlyRate)} ₽ за час и ${fmtInt(cur.leadBonus)} ₽ за лид.`;

  return (
    <>
      <div className="calc">
        <label className="calc-f">
          <span>Часов в смене</span>
          <Select
            value={String(h)}
            onChange={(v) => setH(Number(v))}
            options={RANGE(2, 12).map((v) => ({ value: String(v), label: `${v} ${v === 1 ? "час" : v < 5 ? "часа" : "часов"}` }))}
          />
        </label>
        <label className="calc-f">
          <span>Лидов за смену</span>
          <Select
            value={String(l)}
            onChange={(v) => setL(Number(v))}
            options={RANGE(0, 20).map((v) => ({ value: String(v), label: `${v} ${plural(v, LEADS)}` }))}
          />
        </label>
      </div>
      <div className="calcout">
        <Out label="Заработок за смену" value={fmtMoney(sum)} big />
        <Out label="Ставка в час" value={`${fmtInt(cur.hourlyRate)} ₽`} />
        <Out label="За каждый лид" value={`${fmtInt(cur.leadBonus)} ₽`} />
        <Out
          label="Эффективность"
          value={`${eff}%`}
          tone={eff >= 60 ? "var(--green)" : eff >= 40 ? "var(--amber)" : "var(--red)"}
        />
      </div>
      <div className={`callout ${eff >= 60 ? "note-ok" : "note-tip"}`} style={{ marginTop: 20 }}>
        <span className="ci">
          <Icon name={eff >= 60 ? "check" : "info"} size={15} stroke={2.2} />
        </span>
        <div>
          <b>{eff >= 60 ? "Норма выполнена" : "Как заработать больше"}</b>
          <div>{hint} Стажировка закрывается по 10 переданным лидам за 15 отработанных часов.</div>
        </div>
      </div>
    </>
  );
}

/** Калькулятор бонуса супервайзера. Сетка — из настроек платформы. */
export function CalcSv() {
  const { data } = useCrm();
  const grid = data.settings.svBonus;
  const [leads, setLeads] = useState(1000);
  const [grade, setGrade] = useState<"jr" | "mid" | "sr">("mid");
  const [track, setTrack] = useState<"re" | "auto">("re");
  const [apr, setApr] = useState(30);
  const [growth, setGrowth] = useState(true);

  const sv = svBonus(grid, leads, 0, { grade, track, approvePct: apr, growth });
  const total = grid.salary + sv.bonus;
  const steps = Array.from(new Set([...grid.rows.map((r) => r.from), 400, 600, 800, 900, 1100, 1300, 1400, 1600, 2250, 2500, leads])).sort(
    (a, b) => a - b,
  );

  return (
    <>
      <div className="calc">
        <label className="calc-f">
          <span>Лидов группы за месяц</span>
          <Select
            value={String(leads)}
            onChange={(v) => setLeads(Number(v))}
            options={steps.map((v) => ({ value: String(v), label: `${v.toLocaleString("ru-RU")} лидов` }))}
          />
        </label>
        <label className="calc-f">
          <span>Грейд</span>
          <Select
            value={grade}
            onChange={(v) => setGrade(v as "jr" | "mid" | "sr")}
            options={[
              { value: "jr", label: "Junior" },
              { value: "mid", label: "Middle" },
              { value: "sr", label: "Senior" },
            ]}
          />
        </label>
        <label className="calc-f">
          <span>Направление</span>
          <Select
            value={track}
            onChange={(v) => setTrack(v as "re" | "auto")}
            options={[
              { value: "re", label: "Недвижимость" },
              { value: "auto", label: "Авто" },
            ]}
          />
        </label>
        <label className="calc-f">
          <span>Апрув заказчика</span>
          <Select
            value={String(apr)}
            onChange={(v) => setApr(Number(v))}
            options={[15, 18, 20, 22, 25, 28, 30, 35, 40, 50].map((v) => ({ value: String(v), label: `${v}%` }))}
          />
        </label>
        <label className="calc-f">
          <span>Рост к прошлым месяцам</span>
          <Select
            value={growth ? "1" : "0"}
            onChange={(v) => setGrowth(v === "1")}
            options={[
              { value: "1", label: "Есть" },
              { value: "0", label: "Нет" },
            ]}
          />
        </label>
      </div>
      <div className="calcout">
        <Out label="Итого за месяц" value={fmtMoney(total)} big />
        <Out label="Оклад" value={fmtMoney(grid.salary)} />
        <Out label="Бонус по сетке" value={fmtMoney(sv.base)} />
        <Out label="Бонус к выплате" value={fmtMoney(sv.bonus)} tone={sv.bonus ? "var(--brand)" : "var(--red)"} />
      </div>
      <div className={`callout ${sv.kApprove === 0 ? "note-err" : sv.kGrowth < 1 ? "note-warn" : "note-tip"}`} style={{ marginTop: 20 }}>
        <span className="ci">
          <Icon name="alert" size={15} stroke={2.2} />
        </span>
        <div>
          <b>{sv.kApprove === 0 ? "Бонус обнулён" : sv.kGrowth < 1 ? "Понижающий коэффициент" : "Как считается"}</b>
          <div>
            {sv.kApprove === 0
              ? "Апрув ниже 20% обнуляет бонус за лиды целиком, независимо от объёма."
              : `Ступень сетки — ${sv.step} лидов. Коэффициент апрува ${String(sv.kApprove).replace(".", ",")}${
                  sv.kGrowth < 1 ? ", коэффициент за отсутствие динамики 0,85 (Middle и Senior)" : ""
                }.`}
          </div>
        </div>
      </div>
      <Foot>
        Расчёт предварительный: он считает бонус по сетке, но не проверяет ФОТ. Норматив «ФОТ группы не выше 24% от дохода»
        контролируется отдельно — по фактическим выплатам операторам и доходу группы за месяц. Итоговую сумму подтверждает
        руководитель направления.
      </Foot>
    </>
  );
}

/* ── точка входа ───────────────────────────────────────────────── */

export function Widget({ id }: { id: WidgetId }) {
  switch (id) {
    case "st-re":
      return <StatusTable kind="re" />;
    case "st-auto":
      return <StatusTable kind="auto" />;
    case "prices":
      return <PriceTable />;
    case "obj-re":
      return <ObjList track="realty" />;
    case "obj-auto":
      return <ObjList track="auto" />;
    case "gloss":
      return <GlossList />;
    case "auto-prices":
      return <AutoPriceTable />;
    case "auto-cities":
      return <CitiesTable />;
    case "tr-re":
      return <ObjTrainer track="realty" />;
    case "tr-auto":
      return <ObjTrainer track="auto" />;
    case "tr-all":
      return <ObjTrainer />;
    case "tr-st":
      return <StatusTrainer />;
    case "calc-op":
      return <CalcOp />;
    case "calc-sv":
      return <CalcSv />;
    default:
      return <div className="lrn-empty">Материал готовится.</div>;
  }
}
