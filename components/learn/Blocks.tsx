"use client";

import { useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { itemCourse, type Block, type LearnItem } from "@/lib/learn";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Рендер материала академии. Блоки и их разбор на шаги — как в исходных
 * материалах: вводный абзац, тело, затем пронумерованные шаги по подзаголовкам.
 * Меняется только оболочка: типографика и цвета наши.
 */

const NOTE: Record<string, { cls: string; icon: IconName }> = {
  tip: { cls: "note-tip", icon: "info" },
  warn: { cls: "note-warn", icon: "alert" },
  err: { cls: "note-err", icon: "alert" },
  ok: { cls: "note-ok", icon: "check" },
};

/** Тело урока: лид-абзац, вводная часть и шаги по подзаголовкам. */
export function Lesson({ item }: { item: LearnItem }) {
  const blocks = item.b ?? [];
  const intro: Block[] = [];
  const steps: { h: string; c: Block[] }[] = [];
  let cur: { h: string; c: Block[] } | null = null;
  for (const b of blocks) {
    if ("h" in b) {
      cur = { h: b.h, c: [] };
      steps.push(cur);
      continue;
    }
    (cur ? cur.c : intro).push(b);
  }
  const lead = intro.find((b) => "p" in b && b.first);
  const rest = intro.filter((b) => b !== lead);

  return (
    <div className="lesson">
      {lead && "p" in lead && <p className="lead">{lead.p}</p>}
      {rest.length > 0 && (
        <div className="prose">
          {rest.map((b, i) => (
            <BlockView key={i} b={b} itemId={item.id} />
          ))}
        </div>
      )}
      {steps.map((st, i) => (
        <div className="step" key={i}>
          <span className="step-n num">{i + 1}</span>
          <div className="step-b">
            <h2>{st.h}</h2>
            <div className="prose">
              {st.c.map((b, k) => (
                <BlockView key={k} b={b} itemId={item.id} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockView({ b, itemId }: { b: Block; itemId: string }) {
  if ("p" in b) return <p>{b.p}</p>;
  if ("h" in b) return <h3>{b.h}</h3>;
  if ("ul" in b)
    return (
      <ul>
        {b.ul.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    );
  if ("ol" in b)
    return (
      <ol>
        {b.ol.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ol>
    );
  if ("n" in b) {
    const kind = b.n.k || "tip";
    const title = b.n.t || "";
    // «Совет» в источнике выглядит иначе — лампочкой и без рамки-заливки
    if (kind === "tip" && /^(совет|подсказка)/i.test(title))
      return (
        <div className="tipline">
          <span className="ti">
            <Icon name="bulb" size={19} />
          </span>
          <div>
            <b>{title}</b>
            <div>{b.n.b}</div>
          </div>
        </div>
      );
    const cfg = NOTE[kind] ?? NOTE.tip;
    return (
      <div className={`callout ${cfg.cls}`}>
        <span className="ci">
          <Icon name={cfg.icon} size={15} stroke={2.2} />
        </span>
        <div>
          <b>{title || "Важно"}</b>
          <div>{b.n.b}</div>
        </div>
      </div>
    );
  }
  if ("tb" in b)
    return (
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              {b.tb.h.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.tb.r.map((row, i) => (
              <tr key={i}>
                {row.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if ("s" in b)
    return (
      <Panel title={b.s.l || "Говорим клиенту"} note={b.s.t} copy={b.s.b}>
        <div className="script-b">{b.s.b}</div>
      </Panel>
    );
  if ("d" in b)
    return (
      <Panel title="Пример диалога" copy={b.d.map((x) => (x[0] === "op" ? "Оператор: " : "Клиент: ") + x[1]).join("\n")}>
        <div className="dlg">
          {b.d.map(([who, text], i) => (
            <div className="dlg-row" key={i}>
              <span className="who">{who === "op" ? "Оператор:" : "Клиент:"}</span>
              <span className="say">«{text}»</span>
            </div>
          ))}
        </div>
      </Panel>
    );
  if ("ck" in b) return <Checklist id={b.ck.id} items={b.ck.items} itemId={itemId} />;
  return null;
}

/** Панель со скриптом или диалогом: шапка, кнопка «Скопировать», тело. */
function Panel({ title, note, copy, children }: { title: string; note?: string; copy: string; children: React.ReactNode }) {
  const { toast } = useCrm();
  const [hit, setHit] = useState(false);
  const doCopy = () => {
    navigator.clipboard
      .writeText(copy)
      .then(() => {
        setHit(true);
        setTimeout(() => setHit(false), 1400);
      })
      .catch(() => toast("Браузер не дал скопировать", "err"));
  };
  return (
    <div className="panel">
      <div className="panel-h">
        <Icon name="chat" size={16} />
        <b>{title}</b>
        {note && <span className="panel-t">{note}</span>}
        <button className="btn btn-sm btn-ghost panel-copy" onClick={doCopy}>
          <Icon name={hit ? "check" : "copy"} size={13} />
          {hit ? "Скопировано" : "Скопировать"}
        </button>
      </div>
      <div className="panel-b">{children}</div>
    </div>
  );
}

/** Чек-лист: отметки хранятся в прогрессе аккаунта, а не в браузере. */
export function Checklist({ id, items, itemId }: { id: string; items: string[]; itemId: string }) {
  const { data, me, saveLearn } = useCrm();
  const rec = data.learn.find((l) => l.id === `${me.id}|${itemId}`);
  const checked = new Set(rec?.checks ?? []);
  const courseId = rec?.courseId ?? "";
  const toggle = (i: number) => {
    const key = `${id}:${i}`;
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void saveLearn(courseId || itemCourse.get(itemId)?.id || "", itemId, { checks: Array.from(next) });
  };
  const done = items.filter((_, i) => checked.has(`${id}:${i}`)).length;
  return (
    <>
      <div className="checklist">
        {items.map((x, i) => {
          const on = checked.has(`${id}:${i}`);
          return (
            <button key={i} className={`chk${on ? " on" : ""}`} onClick={() => toggle(i)}>
              <span className="bx">
                <Icon name="check" size={12} stroke={3} />
              </span>
              <span className="ct2">{x}</span>
            </button>
          );
        })}
      </div>
      <div className="chknote">
        Отмечено {done} из {items.length} · сохраняется в вашем профиле
      </div>
    </>
  );
}
