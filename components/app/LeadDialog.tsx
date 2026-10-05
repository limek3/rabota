"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead } from "@/lib/crm/types";
import { Icon } from "@/components/ui/icons";
import { shortName } from "@/lib/crm/format";
import { DIALOG_BUSY, dialogAvailable, dialogCallId, readDialog, syncDialog, type LeadDialog as Dialog } from "@/lib/crm/dialog";

/**
 * Разговор лида: запись звонка из Скорозвона, расшифрованная Memo AI.
 * useLeadDialog — состояние и опрос (живёт в карточке, пока она открыта: у Memo нет вебхуков);
 * DialogView — вкладка «Разговор»: плеер и реплики.
 */

/** Пауза между шагами: запись в Скорозвоне готовится дольше, чем Memo расшифровывает. */
const PAUSE: Record<string, number> = { pending: 2000, waiting: 20000, processing: 6000 };
/** Карточку могут держать открытой долго — дальше не опрашиваем, догонит следующее открытие. */
const MAX_STEPS = 40;

const BUSY_TEXT: Record<string, string> = {
  pending: "Берём запись разговора из Скорозвона…",
  waiting: "Скорозвон ещё готовит запись разговора — проверим снова через 20 секунд",
  processing: "Memo AI расшифровывает разговор — обычно 1–3 минуты",
};

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function useLeadDialog(lead: Lead) {
  const callId = dialogCallId(lead.link);
  const available = dialogAvailable(lead.link);
  const [dlg, setDlg] = useState<Dialog | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0); // смена — перезапуск опроса

  useEffect(() => {
    if (!available) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = (ms: number) => new Promise<void>((r) => (timer = setTimeout(r, ms)));
    setErr("");
    (async () => {
      try {
        let d = await readDialog(lead.id);
        if (!alive) return;
        setDlg(d);
        for (let i = 0; i < MAX_STEPS && alive; i++) {
          if (d && d.callId === callId && !DIALOG_BUSY.includes(d.status)) return;
          if (d && i > 0) await sleep(PAUSE[d.status] ?? 6000);
          if (!alive) return;
          d = await syncDialog(lead.id);
          if (alive) setDlg(d);
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [lead.id, available, callId, run]);

  const act = async (action: "retry" | "swap") => {
    setBusy(true);
    setErr("");
    try {
      const d = await syncDialog(lead.id, action);
      setDlg(d);
      if (action === "retry") setRun((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fresh = dlg && dlg.callId === callId ? dlg : null;
  const state: "none" | "busy" | "failed" | "done" =
    !callId || !available ? "none" : !fresh || DIALOG_BUSY.includes(fresh.status) ? (err && !fresh ? "failed" : "busy") : fresh.status === "failed" ? "failed" : "done";
  return { callId, available, dlg: fresh, err, busy, act, state };
}
export type DialogState = ReturnType<typeof useLeadDialog>;

const SPEEDS = [1, 1.25, 1.5, 2];

export function DialogView({ lead, d, note }: { lead: Lead; d: DialogState; note?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const dlg = d.dlg;
  const total = dur || dlg?.callSec || 0;

  // реплика, которая звучит сейчас
  const active = playing || t > 0 ? (dlg?.segments.findIndex((s) => t >= s.s && t < Math.max(s.e, s.s + 0.5)) ?? -1) : -1;
  useEffect(() => {
    if (!playing || active < 0) return;
    chat.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, playing]);

  if (!d.callId) {
    return (
      <Empty icon="link" title="Нет звонка в ссылке">
        Расшифровка появляется, когда ссылка скопирована из звонка в Скорозвоне: …/answer/&lt;звонок&gt;/…
      </Empty>
    );
  }
  if (!d.available) return <Empty icon="database" title="Только с базой">Расшифровка работает, когда CRM подключена к Supabase.</Empty>;
  if (d.state === "busy") {
    return (
      <Empty spin title="Готовим разговор">
        {BUSY_TEXT[dlg?.status ?? "pending"]}
        {dlg?.error && <span className="lc-sub">Последняя попытка: {dlg.error}</span>}
      </Empty>
    );
  }
  if (d.state === "failed") {
    return (
      <Empty icon="alert" title="Не получилось" danger>
        {dlg?.error || d.err || "Не удалось расшифровать разговор"}
        {dlg && (
          <button type="button" className="o2-btn" onClick={() => void d.act("retry")} disabled={d.busy} style={{ marginTop: 6 }}>
            <Icon name="refresh" size={13} /> Расшифровать заново
          </button>
        )}
      </Empty>
    );
  }
  if (!dlg) return null;

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };
  const seek = (sec: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = sec;
    setT(sec);
    void a.play().catch(() => {});
  };
  const nextSpeed = () => {
    const v = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(v);
    if (audio.current) audio.current.playbackRate = v;
  };
  const opName = dlg.callUser ? shortName(dlg.callUser) : "Оператор";
  const clName = lead.client || "Клиент";

  return (
    <div className="lc-talk">
      {dlg.recordUrl && (
        <div className="lc-player">
          <audio
            ref={audio}
            src={dlg.recordUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              if (Number.isFinite(e.currentTarget.duration)) setDur(e.currentTarget.duration);
              e.currentTarget.playbackRate = speed;
            }}
          />
          <button type="button" className="lc-play" onClick={toggle} aria-label={playing ? "Пауза" : "Слушать"}>
            <Icon name={playing ? "pause" : "play"} size={14} stroke={2.4} />
          </button>
          <input
            type="range"
            className="lc-seek"
            min={0}
            max={total || 1}
            step={0.1}
            value={Math.min(t, total || 1)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Перемотка"
            style={{ ["--p" as string]: `${total ? (t / total) * 100 : 0}%` }}
          />
          <span className="lc-time num">
            {mmss(t)} / {mmss(total)}
          </span>
          <button type="button" className="lc-speed num" onClick={nextSpeed} title="Скорость">
            {speed}×
          </button>
        </div>
      )}

      {note && (
        <div className="lc-pin">
          <Icon name="doc" size={13} />
          <span>{note}</span>
        </div>
      )}

      <div className="lc-chat" ref={chat}>
        {dlg.segments.map((s, i) => {
          const mine = s.who === dlg.operatorSpeaker;
          const prevSame = i > 0 && dlg.segments[i - 1].who === s.who;
          return (
            <div key={i} data-i={i} className={`lc-msg ${mine ? "op" : "cl"}${prevSame ? " cont" : ""}${i === active ? " now" : ""}`}>
              {!prevSame && <span className="lc-who">{mine ? opName : clName}</span>}
              <button type="button" className="lc-bub" onClick={() => seek(s.s)} title={`Слушать с ${mmss(s.s)}`}>
                {s.t}
                <span className="lc-ts num">{mmss(s.s)}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="lc-talk-f">
        <span>
          <span className="lc-dot op" /> {opName}
          <span className="lc-dot cl" style={{ marginLeft: 10 }} /> {clName}
        </span>
        <button type="button" className="lc-link" onClick={() => void d.act("swap")} disabled={d.busy} title="Если реплики оператора и клиента перепутаны">
          <Icon name="move" size={12} /> Поменять стороны
        </button>
      </div>
      {d.err && <div className="lc-sub err">{d.err}</div>}
    </div>
  );
}

function Empty({ icon, spin, title, danger, children }: { icon?: Parameters<typeof Icon>[0]["name"]; spin?: boolean; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className={`lc-empty${danger ? " err" : ""}`}>
      <span className="lc-empty-ic">{spin ? <span className="lc-spin" aria-hidden /> : icon && <Icon name={icon} size={18} />}</span>
      <b>{title}</b>
      <span className="lc-empty-t">{children}</span>
    </div>
  );
}
