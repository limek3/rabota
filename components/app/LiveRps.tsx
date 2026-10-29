"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveMsg } from "@/lib/live";
import { shortName } from "@/lib/crm/format";

/**
 * Камень-ножницы-бумага между двумя людьми на странице — по каналу живых курсоров (lib/live.ts).
 *  • Вызвать можно из списка «на странице»: играют те, у кого сегодня Грейд II (6 лидов) и выше, СВ и РОП — всегда.
 *  • Соперник получает карточку «вызывает вас» — принять или «не сейчас»; 20 секунд без ответа — отказ.
 *  • До двух побед; ничья раунд не считает. Руки раскрываются одновременно — после встряски «раз-два-три».
 *  • В момент раскрытия у курсоров игроков всплывают облачка с рукой — их видят все на странице, у победителя — 🏆.
 * Ничего не пишется в базу.
 */
export type Hand = "r" | "p" | "s";
type RpsMsg = Extract<LiveMsg, { t: "rps" }>;

const HANDS: { k: Hand; emoji: string; label: string }[] = [
  { k: "r", emoji: "✊", label: "Камень" },
  { k: "s", emoji: "✌️", label: "Ножницы" },
  { k: "p", emoji: "✋", label: "Бумага" },
];
const EMO: Record<Hand, string> = { r: "✊", s: "✌️", p: "✋" };
const beats = (a: Hand, b: Hand) => (a === "r" && b === "s") || (a === "s" && b === "p") || (a === "p" && b === "r");

const WIN = 2; // до двух побед
const ASK_MS = 20_000; // на ответ на вызов
const PICK_MS = 30_000; // на выбор руки
const SHAKE_MS = 1300; // «раз-два-три» перед раскрытием
const NEXT_MS = 1900; // показать итог раунда перед следующим

type Foe = { sid: string; id: string; name: string };
type Game = {
  gid: string;
  foe: Foe;
  stage: "inviting" | "invited" | "pick" | "reveal" | "over" | "gone";
  round: number;
  mine?: Hand;
  theirs?: Hand;
  /** Раунд раскрыт: руки видны, счёт обновлён. */
  shown?: boolean;
  res?: "win" | "lose" | "draw";
  score: [number, number];
  note?: string;
};

export function useRps({
  send,
  mySid,
  me,
  enabled,
  onCloud,
}: {
  send: (m: LiveMsg) => void;
  mySid: string;
  me: { id: string; name: string };
  /** Мне можно играть (Грейд II+, СВ, РОП). */
  enabled: boolean;
  /** Облачко с рукой у курсора игрока (sid вкладки). */
  onCloud: (sid: string, emoji: string) => void;
}) {
  const [g, setG] = useState<Game | null>(null);
  const gRef = useRef(g);
  gRef.current = g;
  const to = (game: Game, kind: RpsMsg["kind"], extra?: Partial<RpsMsg>) =>
    send({ t: "rps", sid: mySid, to: game.foe.sid, gid: game.gid, kind, id: me.id, name: me.name, ...extra });
  const active = (x: Game | null) => !!x && x.stage !== "over" && x.stage !== "gone";
  const foeName = (x: Game) => shortName(x.foe.name) || "Соперник";

  /** Обе руки на столе — раскрываем. */
  const settle = (x: Game): Game => (x.stage === "pick" && x.mine && x.theirs ? { ...x, stage: "reveal", shown: false } : x);

  const invite = (foe: Foe) => {
    if (!enabled || active(gRef.current)) return;
    const game: Game = { gid: `${mySid}-${Date.now().toString(36)}`, foe, stage: "inviting", round: 1, score: [0, 0] };
    setG(game);
    to(game, "invite");
  };

  const handle = (m: RpsMsg) => {
    if (m.kind === "show") return onCloud(m.sid, m.hand ? EMO[m.hand] : "🏆");
    if (m.to !== mySid) return;
    const cur = gRef.current;
    if (m.kind === "invite") {
      const foe = { sid: m.sid, id: m.id ?? "", name: m.name ?? "" };
      const probe: Game = { gid: m.gid, foe, stage: "invited", round: 1, score: [0, 0] };
      // уже играю или мне ещё нельзя — вежливый отказ
      if (active(cur) || !enabled) return to(probe, "decline", { busy: active(cur) });
      return setG(probe);
    }
    if (!cur || cur.gid !== m.gid) return;
    if (m.kind === "accept" && cur.stage === "inviting") return setG({ ...cur, stage: "pick" });
    if (m.kind === "decline") return setG({ ...cur, stage: "gone", note: m.busy ? `${foeName(cur)} — уже в другой игре` : `Вызов отклонён — ${foeName(cur)} сейчас не может` });
    if (m.kind === "bye" && active(cur)) return setG({ ...cur, stage: "gone", note: `Игра прервана — ${foeName(cur)} вне игры` });
    if (m.kind === "pick" && m.hand && m.round === cur.round) setG(settle({ ...cur, theirs: m.hand }));
  };

  const accept = () => {
    const cur = gRef.current;
    if (!cur || cur.stage !== "invited") return;
    setG({ ...cur, stage: "pick" });
    to(cur, "accept");
  };
  const pick = (h: Hand) => {
    const cur = gRef.current;
    if (!cur || cur.stage !== "pick" || cur.mine) return;
    setG(settle({ ...cur, mine: h }));
    to(cur, "pick", { hand: h, round: cur.round });
  };
  const close = () => {
    const cur = gRef.current;
    if (cur?.stage === "invited") to(cur, "decline");
    else if (active(cur)) to(cur!, "bye");
    setG(null);
  };
  const rematch = () => {
    const cur = gRef.current;
    if (cur) invite(cur.foe);
  };

  // раскрытие: встряска → руки и счёт → следующий раунд или итог
  useEffect(() => {
    if (!g || g.stage !== "reveal") return;
    if (!g.shown) {
      const t = window.setTimeout(() => {
        const cur = gRef.current;
        if (!cur || cur.gid !== g.gid || cur.stage !== "reveal" || !cur.mine || !cur.theirs) return;
        const res = cur.mine === cur.theirs ? "draw" : beats(cur.mine, cur.theirs) ? "win" : "lose";
        const score: [number, number] = [cur.score[0] + (res === "win" ? 1 : 0), cur.score[1] + (res === "lose" ? 1 : 0)];
        setG({ ...cur, shown: true, res, score });
        // облачко с моей рукой — у моего курсора для всех на странице
        send({ t: "rps", sid: mySid, gid: cur.gid, kind: "show", hand: cur.mine });
      }, SHAKE_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => {
      const cur = gRef.current;
      if (!cur || cur.gid !== g.gid || cur.stage !== "reveal") return;
      if (cur.score[0] >= WIN || cur.score[1] >= WIN) {
        setG({ ...cur, stage: "over" });
        if (cur.score[0] >= WIN) send({ t: "rps", sid: mySid, gid: cur.gid, kind: "show" });
      } else setG({ ...cur, stage: "pick", round: cur.round + 1, mine: undefined, theirs: undefined, shown: false, res: undefined });
    }, NEXT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.gid, g?.stage, g?.shown]);

  // никто не отвечает — не держим карточку вечно
  useEffect(() => {
    if (!g || !(g.stage === "inviting" || g.stage === "invited" || g.stage === "pick")) return;
    const t = window.setTimeout(
      () => {
        const cur = gRef.current;
        if (!cur || cur.gid !== g.gid || cur.stage !== g.stage || cur.round !== g.round) return;
        if (cur.stage === "invited") return close();
        if (cur.stage === "pick") to(cur, "bye");
        setG({ ...cur, stage: "gone", note: cur.stage === "inviting" ? `Нет ответа от ${foeName(cur)}` : "Время на ход вышло — игра закрыта" });
      },
      g.stage === "pick" ? PICK_MS : ASK_MS,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.gid, g?.stage, g?.round]);

  // «вышел» — показали и закрыли сами
  useEffect(() => {
    if (g?.stage !== "gone") return;
    const t = window.setTimeout(() => setG((cur) => (cur?.stage === "gone" ? null : cur)), 4000);
    return () => window.clearTimeout(t);
  }, [g?.stage]);

  // ушёл со вкладки — сопернику «вышел»
  useEffect(() => {
    const bye = () => {
      const cur = gRef.current;
      if (active(cur)) to(cur!, "bye");
    };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card: ReactNode = g ? <RpsCard g={g} foe={foeName(g)} accept={accept} pick={pick} close={close} rematch={rematch} /> : null;
  return { handle, invite, busy: active(g), foeSid: active(g) ? g!.foe.sid : null, card };
}

function RpsCard({ g, foe, accept, pick, close, rematch }: { g: Game; foe: string; accept: () => void; pick: (h: Hand) => void; close: () => void; rematch: () => void }) {
  const playing = g.stage === "pick" || g.stage === "reveal" || g.stage === "over";
  const won = g.score[0] >= WIN;
  return (
    <div className={`rps rps-${g.stage}`} role="dialog" aria-label="Камень, ножницы, бумага">
      <div className="rps-h">
        <span className="rps-logo" aria-hidden>
          ✊✌️✋
        </span>
        {/* в игре вместо названия — счёт: на узкой карточке обоим не хватает места */}
        {playing ? (
          <span className="rps-score">
            <em>Вы</em> {g.score[0]} : {g.score[1]} <em>{foe}</em>
          </span>
        ) : (
          <b>Камень, ножницы, бумага</b>
        )}
        <button type="button" className="rps-x" onClick={close} aria-label="Закрыть игру">
          ×
        </button>
      </div>

      {g.stage === "inviting" && (
        <div className="rps-b">
          <p>
            Вызов отправлен — ждём, примет ли <b>{foe}</b>
            <span className="rps-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </p>
          <div className="rps-act">
            <button type="button" className="btn btn-sm" onClick={close}>
              Отменить
            </button>
          </div>
        </div>
      )}

      {g.stage === "invited" && (
        <div className="rps-b">
          <p className="rps-call">
            <b>{g.foe.name || foe}</b> вызывает вас! До двух побед.
          </p>
          <div className="rps-act">
            <button type="button" className="btn btn-sm btn-primary" onClick={accept}>
              Принять вызов
            </button>
            <button type="button" className="btn btn-sm" onClick={close}>
              Не сейчас
            </button>
          </div>
        </div>
      )}

      {g.stage === "pick" && (
        <div className="rps-b">
          <p>
            Раунд {g.round}. {g.mine ? <>Ждём, что выберет {foe}…</> : <>Ваш ход:</>}
          </p>
          <div className="rps-hands">
            {HANDS.map((h) => (
              <button key={h.k} type="button" className={g.mine === h.k ? "on" : undefined} disabled={!!g.mine} onClick={() => pick(h.k)}>
                <span>{h.emoji}</span>
                <small>{h.label}</small>
              </button>
            ))}
          </div>
          <p className="rps-foe">{g.theirs ? `${foe}: выбор сделан ✓` : `${foe} выбирает…`}</p>
        </div>
      )}

      {g.stage === "reveal" && (
        <div className="rps-b">
          <div className={`rps-duel${g.shown ? " shown" : ""}`}>
            <div>
              <span className="rps-hand me">{g.shown && g.mine ? EMO[g.mine] : "✊"}</span>
              <small>Вы</small>
            </div>
            <b>vs</b>
            <div>
              <span className="rps-hand foe">{g.shown && g.theirs ? EMO[g.theirs] : "✊"}</span>
              <small>{foe}</small>
            </div>
          </div>
          <p className={`rps-res ${g.res ?? ""}`}>{!g.shown ? "Раз, два, три…" : g.res === "win" ? "Раунд ваш!" : g.res === "lose" ? `Раунд за ${foe}` : "Ничья — ещё раз"}</p>
        </div>
      )}

      {g.stage === "over" && (
        <div className="rps-b">
          <p className={`rps-final ${won ? "win" : "lose"}`}>
            <span aria-hidden>{won ? "🏆" : "🤝"}</span>
            {won ? `Победа ${g.score[0]}:${g.score[1]}!` : `Победа за ${foe} — ${g.score[1]}:${g.score[0]}`}
          </p>
          <div className="rps-act">
            <button type="button" className="btn btn-sm btn-primary" onClick={rematch}>
              Реванш
            </button>
            <button type="button" className="btn btn-sm" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {g.stage === "gone" && (
        <div className="rps-b">
          <p>{g.note}</p>
        </div>
      )}
    </div>
  );
}
