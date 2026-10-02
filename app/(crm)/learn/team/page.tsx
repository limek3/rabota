"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import * as db from "@/lib/crm/db";
import * as remote from "@/lib/crm/remote";
import { ACAD_COURSE, FLAT, MODULES, PRACTICE_TITLE, SIM_CHAPTERS, SIM_CHAPTER_TITLES, TESTS, acadProgress } from "@/lib/academy/course";
import type { Account, LearnProgress, Operator } from "@/lib/crm/types";
import { canTouchOp } from "@/lib/crm/access";
import { Avatar, Progress } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { RoleChip } from "@/components/app/AccountMenu";

/**
 * «Обучение команды» — руководитель видит, на каком этапе каждый стажёр и оператор:
 * теория и тесты → аттестация → практика в Скорозвоне → «Готов к линии». Тесты (лучший
 * и последний результат, попытки), главы тренажёра и когда человек последний раз занимался.
 * Стажёра, прошедшего всё, можно одной кнопкой перевести в операторы.
 *
 * Данные — записи learn из CRM; они приходят по подписке Supabase, поэтому страница
 * обновляется сама, пока человек учится. Супервайзер видит свои группы, наставник — свою.
 */

const LIVE_MIN = 10;

function ago(iso: string | null, now: number): string {
  if (!iso) return "ещё не начинал";
  const m = Math.floor((now - Date.parse(iso)) / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  if (d < 7) return `${d} дн. назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

interface Row {
  op: Operator;
  acc: Account | null;
  accountId: string | null;
  trainee: boolean;
  group: string;
  recs: Map<string, LearnProgress>;
  prog: ReturnType<typeof acadProgress> | null;
  last: string | null;
  testsBestAvg: number | null;
  tries: number;
}

export default function TeamLearningPage() {
  const { data, full, access, saveOperator, saveAccount, confirm, toast } = useCrm();
  const router = useRouter();
  const allowed = !access.isOp || access.isMentor;
  useEffect(() => {
    if (!allowed) router.replace("/learn");
  }, [allowed, router]);

  // относительное время («5 мин назад») пересчитываем раз в 30 секунд
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [data.learn]);

  const [scope, setScope] = useState<"trainee" | "all">("trainee");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const groups = new Map(data.groups.map((g) => [g.id, g.name]));
    return data.operators
      .filter((o) => !o.deletedAt && o.status !== "fired" && o.role !== "supervisor")
      .map((op) => {
        const acc = full.accounts.find((a) => a.operatorId === op.id && !a.deletedAt) ?? null;
        const mine = acc ? data.learn.filter((l) => l.accountId === acc.id && l.courseId === ACAD_COURSE) : [];
        const recs = new Map(mine.map((l) => [l.itemId, l]));
        const prog = acc ? acadProgress(data.learn, acc.id) : null;
        const last = mine.reduce<string | null>((m, l) => (!m || (l.updatedAt ?? "") > m ? l.updatedAt ?? m : m), null);
        const bests = TESTS.map((t) => recs.get(t.id)?.best).filter((x): x is number => typeof x === "number");
        return {
          op,
          acc,
          accountId: acc?.id ?? null,
          trainee: op.role === "trainee",
          group: op.groupId ? groups.get(op.groupId) ?? "—" : "без группы",
          recs,
          prog,
          last,
          testsBestAvg: bests.length ? Math.round(bests.reduce((a, b) => a + b, 0) / bests.length) : null,
          tries: TESTS.reduce((s, t) => s + (recs.get(t.id)?.tries ?? 0), 0),
        };
      })
      .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.op.name.localeCompare(b.op.name, "ru"));
  }, [data.operators, data.groups, data.learn, full.accounts]);

  const trainees = rows.filter((r) => r.trainee);
  const shown = (scope === "trainee" ? trainees : rows).filter((r) => !q.trim() || r.op.name.toLowerCase().includes(q.trim().toLowerCase()));
  const base = scope === "trainee" ? trainees : rows;
  const live = base.filter((r) => r.last && now - Date.parse(r.last) < LIVE_MIN * 60000).length;
  const finished = base.filter((r) => r.prog && r.prog.next === null).length;
  const avg = base.length ? base.reduce((s, r) => s + (r.prog?.pct ?? 0), 0) / base.length : 0;
  const finalTest = FLAT.find((i) => i.final);
  const certified = finalTest ? base.filter((r) => r.recs.get(finalTest.id)?.pass).length : 0;
  const ready = trainees.filter((r) => r.prog?.stage === "done").length;

  const canPromote = (r: Row) => r.trainee && access.can.manageOperators && canTouchOp(access, r.op.id);
  /** Стажёр прошёл всё — роль «стажёр» в карточке меняется на «оператор», открываются рабочие разделы. */
  const promote = async (r: Row) => {
    const ok = await confirm({
      title: `Перевести ${r.op.name} в операторы?`,
      text: "Теория, аттестация и практика в Скорозвоне пройдены. В карточке роль «стажёр» сменится на «оператор» — откроются лиды, план, график и заработок. Обучение останется доступным.",
      ok: "Перевести",
    });
    if (!ok) return;
    const saved = await saveOperator({ ...r.op, role: "operator" });
    if (!saved) return;
    // стартовая страница стажёра — обучение; оператору — личный кабинет
    // РОП меняет аккаунт сам; супервайзер — через функцию базы, только стартовую своего человека
    if (r.acc && r.acc.prefs?.homePage === "/learn") {
      if (access.can.manageAccounts) await saveAccount({ ...r.acc, prefs: { ...r.acc.prefs, homePage: "/me" } });
      else if (db.REMOTE) await remote.traineeHome(r.op.id);
    }
    toast(`${r.op.name} — теперь оператор`);
  };

  if (!allowed) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Обучение команды</h1>
          <p className="page-sub">
            Где сейчас каждый стажёр и оператор по курсу «Авто»: этап, тесты и попытки, тренажёр Скорозвона. Обновляется само, пока человек учится.
          </p>
        </div>
        <div className="toolbar">
          <div className="seg">
            <button aria-pressed={scope === "trainee"} onClick={() => setScope("trainee")}>
              Стажёры · {trainees.length}
            </button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              Все операторы · {rows.length}
            </button>
          </div>
          <input className="inp" style={{ width: 220 }} placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi icon="users" label={scope === "trainee" ? "Стажёров" : "Операторов"} value={String(base.length)} sub={scope === "trainee" ? "роль «стажёр» в карточке" : "без уволенных"} />
        <Kpi icon="play" label="Учатся сейчас" value={String(live)} sub={`активность за ${LIVE_MIN} мин`} tone={live ? "good" : undefined} />
        <Kpi icon="target" label="Средний прогресс" value={`${Math.round(avg * 100)}%`} sub={`курса «Авто», ${FLAT.length} материалов`} />
        <Kpi icon="star" label="Сдали аттестацию" value={`${certified} из ${base.length}`} sub={`и практику в Скорозвоне: ${finished}`} />
        {scope === "trainee" && <Kpi icon="check" label="Готовы к линии" value={String(ready)} sub={ready ? "можно переводить в операторы" : "пока никто не прошёл всё"} tone={ready ? "good" : undefined} />}
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Этап</th>
              <th style={{ width: 170 }}>Курс</th>
              <th className="c">Тесты</th>
              <th className="c">Скорозвон</th>
              <th>Активность</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const isOpen = open === r.op.id;
              const p = r.prog;
              const isLive = !!r.last && now - Date.parse(r.last) < LIVE_MIN * 60000;
              const nextMod = p?.next ? MODULES.findIndex((m) => m.items.some((i) => i.id === p.next!.id)) : -1;
              return (
                <Fragment key={r.op.id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : r.op.id)}>
                    <td>
                      <span className="row" style={{ gap: 9 }}>
                        <Avatar name={r.op.name} id={r.op.id} size={26} />
                        <span style={{ minWidth: 0 }}>
                          <span className="row" style={{ gap: 6 }}>
                            <b style={{ fontWeight: 600 }}>{r.op.name}</b>
                            {r.trainee && <RoleChip role="operator" trainee />}
                          </span>
                          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>{r.group}</span>
                        </span>
                      </span>
                    </td>
                    <td className="wrap">
                      {!r.accountId ? (
                        <span className="muted">нет аккаунта — заведите в Настройках</span>
                      ) : !p?.next ? (
                        <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span style={{ color: "var(--c-green-fg)", fontWeight: 600 }}>✓ {r.trainee ? "Готов к линии" : "Курс пройден"}</span>
                          {canPromote(r) && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                void promote(r);
                              }}
                            >
                              Перевести в операторы
                            </button>
                          )}
                        </span>
                      ) : p.stage === "practice" ? (
                        <span>
                          <span style={{ fontSize: 11.5, color: "var(--c-green-fg)", display: "block" }}>✓ Аттестация сдана · {PRACTICE_TITLE.toLowerCase()}</span>
                          Глава {SIM_CHAPTERS.indexOf(p.next.id.slice(4)) + 1} из {SIM_CHAPTERS.length}: {p.next.t}
                        </span>
                      ) : (
                        <span>
                          <span style={{ fontSize: 11.5, color: "var(--dim)", display: "block" }}>
                            Модуль {nextMod + 1} · {MODULES[nextMod]?.t}
                          </span>
                          {p.next.t}
                        </span>
                      )}
                    </td>
                    <td>
                      {p ? (
                        <span style={{ display: "block" }}>
                          <span className="row" style={{ justifyContent: "space-between", fontSize: 11.5, color: "var(--text-sub)", marginBottom: 5 }}>
                            <span className="num">
                              {p.done} / {p.total}
                            </span>
                            <b className="num">{Math.round(p.pct * 100)}%</b>
                          </span>
                          <Progress value={p.pct} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="c">
                      {p ? (
                        <span className="num">
                          {p.testsDone} / {p.tests}
                          {r.testsBestAvg != null && <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>ср. {r.testsBestAvg}% · попыток {r.tries}</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="c num">{p ? `${p.sim} / ${SIM_CHAPTERS.length}` : "—"}</td>
                    <td>
                      <span className="row" style={{ gap: 7 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: isLive ? "var(--c-green-fg)" : "var(--ink-15)" }} />
                        <span style={{ color: isLive ? "var(--c-green-fg)" : "var(--text-sub)", fontWeight: isLive ? 600 : 400 }}>{isLive ? "учится сейчас" : ago(r.last, now)}</span>
                      </span>
                    </td>
                    <td className="r">
                      <Icon name="chevD" size={14} style={{ color: "var(--dim)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} style={{ background: "var(--bg-strip)", whiteSpace: "normal", padding: 16 }}>
                        <Detail r={r} now={now} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <div className="empty-title">{scope === "trainee" ? "Стажёров нет" : "Никого не нашлось"}</div>
                    <div className="empty-text">
                      {scope === "trainee"
                        ? "Стажёр — это аккаунт с ролью «Стажёр» (Настройки → Аккаунты) или оператор с ролью «стажёр» в карточке. Ему открыто только обучение."
                        : "Попробуйте изменить поиск."}
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; value: string; sub: string; tone?: "good" }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        <Icon name={icon} size={13} className="kpi-ic" />
        {label}
      </div>
      <div className="kpi-value" style={tone === "good" ? { color: "var(--c-green-fg)" } : undefined}>
        {value}
      </div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

/** Раскрытая строка: модули, тесты с попытками, главы тренажёра. */
function Detail({ r, now }: { r: Row; now: number }) {
  if (!r.accountId || !r.prog) return <span className="muted">У сотрудника нет аккаунта — прогресс появится, когда он войдёт и начнёт обучение.</span>;
  const p = r.prog;
  const simKeys = r.recs.get("sim")?.checks ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 12 }}>
      <div className="card card-pad">
        <h3 className="card-title">По модулям</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {MODULES.map((m, mi) => {
            const d = m.items.filter((i) => p.isDone(i.id)).length;
            return (
              <div key={m.t}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12.5, marginBottom: 5 }}>
                  <span>
                    {mi + 1}. {m.t}
                  </span>
                  <span className="num" style={{ color: d === m.items.length ? "var(--c-green-fg)" : "var(--dim)" }}>
                    {d} / {m.items.length}
                  </span>
                </div>
                <Progress value={d / m.items.length} />
              </div>
            );
          })}
        </div>
        <h3 className="card-title" style={{ marginTop: 16 }}>
          {PRACTICE_TITLE}
          <span className="card-sub" style={{ margin: "0 0 0 8px", fontWeight: 400 }}>
            {p.certified ? "после аттестации · засчитывается «Пройти самому»" : "откроется после аттестации · смотреть можно уже сейчас"}
          </span>
        </h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {SIM_CHAPTERS.map((c, i) => {
            const tried = simKeys.includes(`auto:${c}:try`);
            const watched = simKeys.includes(`auto:${c}:watch`);
            return (
              <span key={c} className="chip" style={tried ? { color: "var(--c-green-fg)" } : watched ? { color: "var(--text-sub)" } : { color: "var(--dim)" }} title={tried ? "прошёл сам" : watched ? "только смотрел" : "не начинал"}>
                {tried ? "✓" : watched ? "◐" : "○"} {i + 1}. {SIM_CHAPTER_TITLES[c]}
              </span>
            );
          })}
        </div>
      </div>
      <div className="card" style={{ overflow: "auto" }}>
        <div className="card-pad" style={{ paddingBottom: 6 }}>
          <h3 className="card-title">Тесты и попытки</h3>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Тест</th>
              <th className="r">Лучший</th>
              <th className="r">Последний</th>
              <th className="r">Попыток</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>
            {TESTS.map((t) => {
              const x = r.recs.get(t.id);
              return (
                <tr key={t.id}>
                  <td className="wrap">
                    {t.t}
                    {t.final ? <span className="chip" style={{ marginLeft: 6 }}>итоговая</span> : null}
                  </td>
                  <td className="r num" style={{ color: x?.best == null ? "var(--dim)" : x.pass ? "var(--c-green-fg)" : "var(--c-red-fg)", fontWeight: 600 }}>
                    {x?.best != null ? `${x.best}%` : "—"}
                  </td>
                  <td className="r num">{x?.last != null ? `${x.last}%${x.right != null && x.total ? ` · ${x.right}/${x.total}` : ""}` : "—"}</td>
                  <td className="r num">{x?.tries ?? 0}</td>
                  <td className="muted">{x?.at ? ago(x.at, now) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="card-pad" style={{ paddingTop: 8, fontSize: 12, color: "var(--dim)" }}>
          Тест засчитывается от 80%. Заметок к материалам: {Array.from(r.recs.values()).filter((l) => l.note && l.note.trim()).length}.
        </div>
      </div>
    </div>
  );
}
