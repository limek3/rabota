"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCrm } from "@/lib/crm/store";
import { gradeLevel } from "@/lib/crm/telegram";
import { plural } from "@/lib/crm/format";
import { Icon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/kit";
import { RankIcon, rankOf } from "@/components/app/LiveCursors";
import { NameFx } from "./ShopFx";
import { MAX_LEN, chatStore, type ChatChange, type ChatMsg, type Speaker } from "@/lib/canvasChat";

/**
 * Чат «Холста» — в колонке справа, над «Художниками». У автора то же отличие, что в «Сейчас на этой
 * странице»: РОП со звездой, «СВ · Группа» со щитом, грейд дня II–IV. Подряд от одного
 * человека — без повторной шапки; между днями — разделитель. Удалить: своё — всем,
 * чужое — РОПу и СВ.
 */

const QUICK = ["🔥", "👍", "😂", "🎨", "❤️", "👀"];
const GROUP_MS = 3 * 60_000;

function apply(rows: ChatMsg[], c: ChatChange): ChatMsg[] {
  if (c.m.deletedAt) return rows.filter((r) => r.id !== c.m.id);
  const i = rows.findIndex((r) => r.id === c.m.id);
  if (i < 0) return [...rows, c.m];
  const next = rows.slice();
  next[i] = c.m;
  return next;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function CanvasChat() {
  const { me, access, data, today, toast } = useCrm();
  const [rows, setRows] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const canModerate = access.isHead || access.isSup;

  // кто пишет — для локального режима (с Supabase отличие ставит база)
  const grade = useMemo(() => {
    if (!access.opId || me.role !== "operator") return undefined;
    let done = 0;
    for (const l of data.leads) if (l.operatorId === access.opId && l.status === "done" && l.at.slice(0, 10) === today) done++;
    return gradeLevel(done);
  }, [data.leads, access.opId, me.role, today]);
  const team = useMemo(() => {
    if (me.role !== "supervisor") return undefined;
    const names = data.groups.filter((g) => access.ownGroups.has(g.id)).map((g) => g.name);
    return names.length === 1 ? names[0] : names.length > 1 ? `${names.length} ${plural(names.length, ["группа", "группы", "групп"])}` : undefined;
  }, [me.role, data.groups, access.ownGroups]);
  const who: Speaker = { accountId: access.account.id, name: me.name, role: me.role, grade, team, canModerate };

  useEffect(() => {
    let off = false;
    const unsub = chatStore.subscribe((c) => setRows((prev) => apply(prev, c)));
    chatStore.load().then(
      (r) => {
        if (off) return;
        setRows((prev) => {
          const m = new Map(r.map((x) => [x.id, x]));
          for (const x of prev) m.set(x.id, x);
          return Array.from(m.values())
            .filter((x) => !x.deletedAt)
            .sort((a, b) => a.at.localeCompare(b.at) || Number(a.id) - Number(b.id));
        });
        setLoading(false);
      },
      (e) => {
        if (off) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => {
      off = true;
      unsub();
    };
  }, []);

  // новые сообщения — вниз, если человек и так был внизу (читает старое — не дёргаем)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows]);
  // высота сообщений досчитывается и после отрисовки (шрифты, значки, перенос строк) — держим низ
  useEffect(() => {
    const el = listRef.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const t = text.trim();
      if (!t || busy) return;
      setBusy(true);
      try {
        const m = await chatStore.say(t, who);
        stick.current = true;
        setRows((prev) => apply(prev, { type: "put", m }));
        setText("");
      } catch (x) {
        toast(x instanceof Error ? x.message : String(x), "err");
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    // who собирается на каждой отрисовке — его поля уже в зависимостях
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, busy, me.name, me.role, grade, team, canModerate, toast],
  );

  const unsay = async (m: ChatMsg) => {
    try {
      if (await chatStore.unsay(m.id, who)) setRows((prev) => prev.filter((r) => r.id !== m.id));
    } catch (x) {
      toast(x instanceof Error ? x.message : String(x), "err");
    }
  };

  // поле растёт вместе с текстом — до 5 строк
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [text]);

  return (
    <section className="card px-chat">
      <div className="px-chat-h">
        <h3 className="d2-h">
          <Icon name="chat" size={15} className="title-ic" /> Чат холста
        </h3>
        <small>{rows.length ? `${rows.length} ${plural(rows.length, ["сообщение", "сообщения", "сообщений"])}` : ""}</small>
      </div>

      <div className="px-chat-list" ref={listRef} onScroll={onScroll}>
        {loading && <div className="px-chat-empty">Загружаем…</div>}
        {err && <div className="px-chat-empty px-chat-err">Чат не загрузился: {err}</div>}
        {!loading && !err && !rows.length && (
          <div className="px-chat-empty">
            <span>🎨</span>
            Договоритесь, что рисуем: герб отдела, котика или огромное сердце
          </div>
        )}
        <div className="px-chat-inner" ref={innerRef}>
        {rows.map((m, i) => {
          const prev = rows[i - 1];
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          const cont = !newDay && prev.accountId === m.accountId && Date.parse(m.at) - Date.parse(prev.at) < GROUP_MS;
          const mine = m.accountId === access.account.id;
          const r = rankOf({ role: m.role, grade: m.grade, team: m.team });
          return (
            <div key={m.id} className="px-msg-wrap">
              {newDay && <div className="px-chat-day">{dayLabel(m.at)}</div>}
              <div className="px-msg" data-mine={mine ? "" : undefined} data-cont={cont ? "" : undefined}>
                {/* аватарка с фото и рамкой из Лавки */}
                {cont ? <span className="px-msg-gap" /> : <span className="px-msg-ava"><Avatar name={m.name || "Коллега"} id={m.accountId} size={28} /></span>}
                <div className="px-msg-body">
                  {!cont && (
                    <div className="px-msg-h">
                      <b>
                        <NameFx accountId={m.accountId} me={access.account.id}>{m.name || "Коллега"}</NameFx>
                      </b>
                      {r && (
                        <span className={`lv-rank ${r.cls}`}>
                          {r.icon && <RankIcon name={r.icon} />}
                          {r.chip}
                        </span>
                      )}
                      <time>{timeOf(m.at)}</time>
                    </div>
                  )}
                  <div className="px-msg-t">{m.text}</div>
                </div>
                {(mine || canModerate) && (
                  <button type="button" className="px-msg-del" title={mine ? "Удалить своё сообщение" : "Удалить (модерация)"} onClick={() => void unsay(m)}>
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <form className="px-chat-in" onSubmit={send}>
        <div className="px-chat-quick">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setText((t) => (t ? `${t} ${q}` : q));
                inputRef.current?.focus();
              }}
            >
              {q}
            </button>
          ))}
          {text.length > MAX_LEN - 80 && <small className="num">{MAX_LEN - text.length}</small>}
        </div>
        <div className="px-chat-box">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={MAX_LEN}
            placeholder="Написать… Enter — отправить"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" className="px-chat-send" disabled={!text.trim() || busy} aria-label="Отправить">
            <Icon name="arrowR" size={15} />
          </button>
        </div>
      </form>
    </section>
  );
}
