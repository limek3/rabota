"use client";

import { useState } from "react";
import { useCrm } from "@/lib/crm/store";
import type { Block, LearnItem } from "@/lib/learn";
import { Icon, type IconName } from "@/components/ui/icons";
import { Collapse, Seg } from "@/components/ui/kit";
import { useLib } from "@/components/learn/kit";

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

type Step = { h: string; c: Block[] };

/** Вводная часть и шаги по подзаголовкам. */
function splitSteps(item: LearnItem): { intro: Block[]; steps: Step[] } {
  const intro: Block[] = [];
  const steps: Step[] = [];
  let cur: Step | null = null;
  for (const b of item.b ?? []) {
    if ("h" in b) {
      cur = { h: b.h, c: [] };
      steps.push(cur);
      continue;
    }
    (cur ? cur.c : intro).push(b);
  }
  return { intro, steps };
}

/** «1. Приветствие» → «Приветствие»: номер шага и так стоит в кружке. */
const stepTitle = (t: string) => String(t || "").replace(/^\s*\d+[.)]\s*/, "");

const isSay = (b: Block) => "s" in b || "d" in b;
const isLead = (b: Block) => "p" in b && !!b.first;

/** Скрипт — материал, где говорить клиенту нужно хотя бы дважды. */
const isScript = (item: LearnItem) => !item.quiz && !item.w && (item.b ?? []).filter(isSay).length >= 2;

/**
 * Тело урока. У скриптов — если в исходнике роли есть такой режим — переключатель
 * «Только реплики / Весь урок»: реплики идут одной колонкой, пояснения свёрнуты.
 */
export function Lesson({ item, runMode, onRunMode }: { item: LearnItem; runMode: boolean; onRunMode: (v: boolean) => void }) {
  const { features } = useLib();
  const { toast } = useCrm();
  if (!features.runMode || !isScript(item)) return <FullLesson item={item} />;
  return (
    <>
      <div className="modebar">
        <Seg<"run" | "full">
          value={runMode ? "run" : "full"}
          onChange={(v) => {
            onRunMode(v === "run");
            toast(v === "run" ? "Показываем только реплики" : "Показываем весь урок", "info");
          }}
          options={[
            {
              value: "run",
              label: (
                <>
                  <Icon name="chat" size={14} /> Только реплики
                </>
              ),
            },
            {
              value: "full",
              label: (
                <>
                  <Icon name="doc" size={14} /> Весь урок
                </>
              ),
            },
          ]}
        />
        <span className="mbhint">
          {runMode
            ? "Всё, что нужно говорить, идёт одной колонкой. Пояснения свёрнуты внутри шагов."
            : "Полный разбор: пояснения, таблицы и примеры на своих местах."}
        </span>
      </div>
      {runMode ? <RunSheet item={item} /> : <FullLesson item={item} />}
    </>
  );
}

/** Урок целиком: лид-абзац, вводная часть и шаги по подзаголовкам. */
function FullLesson({ item }: { item: LearnItem }) {
  const { intro, steps } = splitSteps(item);
  const lead = intro.find(isLead);
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
            <h2>{stepTitle(st.h)}</h2>
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

/* ── режим «Только реплики» ────────────────────────────────────── */

function RunSheet({ item }: { item: LearnItem }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { intro, steps } = splitSteps(item);
  const lead = intro.find(isLead);
  const rest = intro.filter((b) => b !== lead);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const jump = (n: number) => {
    const el = document.getElementById(`rs${n}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 900);
  };

  return (
    <div className="runsheet">
      {lead && "p" in lead && <p className="rslead">{lead.p}</p>}
      {steps.length >= 3 && (
        <div className="rsnav">
          <b>Шаги</b>
          {steps.map((st, i) => (
            <button key={i} className="num" title={st.h} onClick={() => jump(i + 1)}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
      {rest.some(isSay) ? (
        <RunCard title={item.t} num={0} blocks={rest} itemId={item.id} open={!!open[`${item.id}:0`]} onToggle={() => toggle(`${item.id}:0`)} />
      ) : (
        rest.length > 0 && (
          <div className="prose" style={{ marginBottom: 18 }}>
            {rest.map((b, i) => (
              <BlockView key={i} b={b} itemId={item.id} />
            ))}
          </div>
        )
      )}
      {steps.map((st, i) => {
        const k = `${item.id}:${i + 1}`;
        return <RunCard key={k} title={st.h} num={i + 1} blocks={st.c} itemId={item.id} open={!!open[k]} onToggle={() => toggle(k)} />;
      })}
    </div>
  );
}

/** Шаг скрипта: реплики крупно, пометки точками, остальное — под кнопкой «Пояснения». */
function RunCard({
  title,
  num,
  blocks,
  itemId,
  open,
  onToggle,
}: {
  title: string;
  num: number;
  blocks: Block[];
  itemId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const say = blocks.filter(isSay);
  const flags = blocks.filter((b) => "n" in b);
  const rest = blocks.filter((b) => !isSay(b) && !("n" in b) && !isLead(b));
  if (!say.length && !flags.length && !rest.length) return null;
  return (
    <div className="runstep" id={num ? `rs${num}` : undefined}>
      <div className="rsh">
        {num > 0 && <span className="n num">{num}</span>}
        <h2>{num ? stepTitle(title) : title}</h2>
      </div>
      {say.length > 0 && (
        <div className="rslines">
          {say.map((b, i) =>
            "s" in b ? (
              <div className="rsline" key={i}>
                <div className="rsl">
                  <span>{b.s.l || "Говорим клиенту"}</span>
                  {b.s.t && <span className="tm">{b.s.t}</span>}
                </div>
                <p className="rst">{b.s.b}</p>
              </div>
            ) : "d" in b ? (
              <div className="rsline" key={i}>
                <div className="rsl">
                  <span>Пример диалога</span>
                </div>
                <Dialog d={b.d} />
              </div>
            ) : null,
          )}
        </div>
      )}
      {flags.length > 0 && (
        <div className="rsflags">
          {flags.map((b, i) =>
            "n" in b ? (
              <div className={`rsflag ${b.n.k === "warn" ? "warn" : b.n.k === "err" ? "err" : ""}`} key={i}>
                <span className="fd" />
                <div>
                  {b.n.t && <b>{b.n.t}. </b>}
                  {b.n.b}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
      {rest.length > 0 && (
        <>
          <button className={`rsmore${open ? " open" : ""}`} onClick={onToggle}>
            <Icon name="chevD" size={15} stroke={2.2} />
            {open ? "Скрыть пояснения" : `Пояснения и таблицы — ${rest.length}`}
          </button>
          <Collapse open={open}>
            <div className="rsdet prose">
              {rest.map((b, i) => (
                <BlockView key={i} b={b} itemId={itemId} />
              ))}
            </div>
          </Collapse>
        </>
      )}
    </div>
  );
}

function Dialog({ d }: { d: [string, string][] }) {
  return (
    <div className="dlg">
      {d.map(([who, text], i) => (
        <div className="dlg-row" key={i}>
          <span className="who">{who === "op" ? "Оператор:" : "Клиент:"}</span>
          <span className="say">«{text}»</span>
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
        <Dialog d={b.d} />
      </Panel>
    );
  if ("ck" in b) return <Checklist id={b.ck.id} items={b.ck.items} itemId={itemId} />;
  return null;
}

/** Панель со скриптом или диалогом: шапка, кнопка «Скопировать» (если она есть в исходнике роли), тело. */
function Panel({ title, note, copy, children }: { title: string; note?: string; copy: string; children: React.ReactNode }) {
  const { toast } = useCrm();
  const { features } = useLib();
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
        {features.copy && (
          <button className="btn btn-sm btn-ghost panel-copy" onClick={doCopy}>
            <Icon name={hit ? "check" : "copy"} size={13} />
            {hit ? "Скопировано" : "Скопировать"}
          </button>
        )}
      </div>
      <div className="panel-b">{children}</div>
    </div>
  );
}

/** Чек-лист: отметки хранятся в прогрессе аккаунта, а не в браузере. */
export function Checklist({ id, items, itemId }: { id: string; items: string[]; itemId: string }) {
  const { data, me, saveLearn } = useCrm();
  const { itemCourse } = useLib();
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
