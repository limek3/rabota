"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import {
  SEARCH_INDEX,
  itemCourse,
  itemModule,
  neighbours,
  norm,
  realItems,
  type LearnItem,
} from "@/lib/learn";
import { Icon } from "@/components/ui/icons";

/**
 * Тест и итоговая аттестация — по правилам исходной академии:
 * отвечаем на все вопросы, жмём «Проверить ответы», получаем разбор каждой
 * ошибки, проходной результат 80%, учитывается лучший результат и число попыток.
 */

const LETTERS = "АБВГД";
const PASS = 80;

const idx = new Map(SEARCH_INDEX.map((x) => [x.id, x.txt]));

/** Материалы, которые стоит перечитать перед пересдачей. */
function lessonsForWrong(item: LearnItem, wrong: number[]): LearnItem[] {
  const mod = itemModule.get(item.id);
  const course = itemCourse.get(item.id);
  let cands = (mod?.items ?? []).filter((i) => !i.quiz && !i.from);
  if (cands.length < 2 && course) cands = realItems(course).filter((i) => !i.quiz);
  const out: LearnItem[] = [];
  for (const qi of wrong) {
    const q = item.quiz?.[qi];
    if (!q) continue;
    const terms = norm(`${q.q} ${q.w ?? ""} ${q.o[q.a] ?? ""}`)
      .split(/[^a-zа-яё0-9]+/)
      .filter((w) => w.length > 4);
    let best: LearnItem | null = null;
    let bs = 0;
    for (const c of cands) {
      const txt = idx.get(c.id) ?? "";
      let sc = 0;
      for (const t of terms) if (txt.includes(t)) sc++;
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    if (best && bs > 0 && !out.includes(best)) out.push(best);
  }
  return out.slice(0, 4);
}

export function Quiz({
  item,
  onOpen,
  onCert,
}: {
  item: LearnItem;
  onOpen: (id: string) => void;
  onCert: (id: string) => void;
}) {
  const { data, me, saveLearn } = useCrm();
  const qs = item.quiz ?? [];
  const rec = data.learn.find((l) => l.id === `${me.id}|${item.id}`);
  const courseId = itemCourse.get(item.id)?.id ?? "";

  const [ans, setAns] = useState<Record<number, number>>({});
  const [shown, setShown] = useState(false);

  const answered = Object.keys(ans).length;
  const correct = useMemo(() => qs.filter((x, i) => ans[i] === x.a).length, [ans, qs]);
  const pct = qs.length ? Math.round((correct / qs.length) * 100) : 0;
  const pass = pct >= PASS;
  const open2 = pass || !!rec?.pass;
  const wrong = qs.map((x, i) => (ans[i] === x.a ? -1 : i)).filter((i) => i >= 0);
  const next = neighbours(item).next;

  const check = () => {
    setShown(true);
    const best = Math.max(pct, rec?.best ?? 0);
    const now = new Date().toISOString();
    void saveLearn(courseId, item.id, {
      done: best >= PASS,
      right: correct,
      total: qs.length,
      last: pct,
      best,
      tries: (rec?.tries ?? 0) + 1,
      pass: best >= PASS,
      at: now,
      // сертификат — только за итоговую аттестацию и только при сдаче
      cert: item.final && pass ? rec?.cert ?? { at: now, pct: best, name: me.name } : rec?.cert,
    });
  };

  const retry = () => {
    setAns({});
    setShown(false);
  };

  return (
    <div className="quiz">
      <p className="lead">
        {item.final ? "Итоговая аттестация" : "Проверка знаний"} · {qs.length} вопросов · проходной результат 80%.
        Ответьте на все вопросы и нажмите «Проверить ответы» — после проверки увидите разбор каждой ошибки.
      </p>

      {shown && (
        <div className={`quiz-res ${pass ? "pass" : "fail"}`}>
          <div className="eyebrow">Результат</div>
          <div className="row" style={{ alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            <span className="big num">{pct}%</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {correct} из {qs.length} верно
            </span>
            {/* запись уже сохранена, поэтому tries — номер текущей попытки */}
            {rec && (rec.tries ?? 1) > 1 && (
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dim)" }}>
                лучший результат {rec.best ?? pct}% · попытка {rec.tries}
              </span>
            )}
          </div>
          <p className="quiz-msg">
            {pass
              ? item.final
                ? "Аттестация пройдена. Материал освоен — держите справочники под рукой во время смены."
                : "Тест пройден. Разберите ошибки ниже и двигайтесь дальше."
              : open2
                ? `Эта попытка ниже проходного результата. Материал остаётся зачтённым по лучшему результату ${rec?.best ?? pct}%, но разберите ошибки ниже.`
                : "Проходной результат — 80%. Разберите ошибки ниже и пройдите тест ещё раз."}
          </p>
          <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn" onClick={retry}>
              Пройти заново
            </button>
            {open2 && item.final && (
              <button className="btn btn-primary" onClick={() => onCert(item.id)}>
                <Icon name="star" size={15} /> Сертификат
              </button>
            )}
            {open2 && next && (
              <button className={`btn ${item.final ? "" : "btn-primary"}`} onClick={() => onOpen(next.id)}>
                Дальше <Icon name="arrowR" size={15} />
              </button>
            )}
          </div>
        </div>
      )}

      {shown && wrong.length > 0 && <Redo item={item} wrong={wrong} onOpen={onOpen} onRetry={retry} />}

      {qs.map((x, i) => {
        const picked = ans[i];
        return (
          <div className="qc" key={i}>
            <div className="qn">
              Вопрос {i + 1} из {qs.length}
            </div>
            <div className="qt">{x.q}</div>
            <div className="opts">
              {x.o.map((o, j) => {
                let cls = "opt";
                if (shown) {
                  if (j === x.a) cls += " right";
                  else if (picked === j) cls += " wrong";
                } else if (picked === j) cls += " pick";
                return (
                  <button key={j} className={cls} disabled={shown} onClick={() => setAns((a) => ({ ...a, [i]: j }))}>
                    <span className="k">{LETTERS[j]}</span>
                    <span>{o}</span>
                  </button>
                );
              })}
            </div>
            {shown && (
              <div className="why">
                <b>{picked === x.a ? "Верно." : `Правильный ответ — ${LETTERS[x.a]}.`}</b> {x.w}
              </div>
            )}
          </div>
        );
      })}

      {!shown && (
        <div className="quizbar">
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dim)", marginBottom: 6 }}>
              Отвечено {answered} из {qs.length}
            </div>
            <div className="lprog-bar">
              <i style={{ width: `${qs.length ? Math.round((answered / qs.length) * 100) : 0}%` }} />
            </div>
          </div>
          <button className="btn btn-primary" disabled={answered < qs.length} onClick={check}>
            Проверить ответы
          </button>
        </div>
      )}
    </div>
  );
}

function Redo({
  item,
  wrong,
  onOpen,
  onRetry,
}: {
  item: LearnItem;
  wrong: number[];
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  const les = useMemo(() => lessonsForWrong(item, wrong), [item, wrong]);
  if (!les.length) return null;
  const word = wrong.length === 1 ? "ошибка" : wrong.length < 5 ? "ошибки" : "ошибок";
  return (
    <div className="redo">
      <div className="redo-h">
        <Icon name="book" size={16} />
        <b>Повторить перед пересдачей</b>
        <span>
          {wrong.length} {word} · материалы по темам, где были ошибки
        </span>
      </div>
      <div className="lrn-list">
        {les.map((l) => (
          <button className="lrn-row" key={l.id} onClick={() => onOpen(l.id)}>
            <span className="ri">
              <Icon name="doc" size={16} />
            </span>
            <span className="rt">
              <b>{l.t}</b>
              <span>
                {itemModule.get(l.id)?.t} · {l.k}, {l.m}
              </span>
            </span>
            <span className="rc">
              <Icon name="chevR" size={14} />
            </span>
          </button>
        ))}
      </div>
      <div className="redo-f">
        <button className="btn btn-primary" onClick={() => onOpen(les[0].id)}>
          Начать повтор <Icon name="arrowR" size={14} />
        </button>
        <button className="btn" onClick={onRetry}>
          Сразу пересдать
        </button>
      </div>
    </div>
  );
}
