"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lead } from "@/lib/crm/types";
import { Icon, type IconName } from "@/components/ui/icons";
import { shortName } from "@/lib/crm/format";
import { DIALOG_BUSY, cachedDialog, dialogAvailable, dialogCallId, parseReport, readDialog, syncDialog, type LeadDialog as Dialog } from "@/lib/crm/dialog";

/**
 * Разговор лида для проверки: разбор от Memo AI (сводка, чек-лист), запись и расшифровка.
 * useLeadDialog — состояние и опрос (у Memo нет вебхуков: пока карточка открыта и что-то
 * не готово, она сама дёргает функцию lead-dialog); CallReview — блоки карточки.
 * Готовый разговор берётся из кэша сразу, база только освежает — без «загрузки заново».
 */

/** Пауза между шагами: запись в Скорозвоне готовится дольше, чем Memo расшифровывает. */
/**
 * Разбор от Memo AI (сводка и чек-лист) — пока выключен: шаблон «Проверка лида» в Memo не заведён.
 * Включить — true здесь и секрет MEMO_REPORT у функции (supabase/README.md, пункт 12).
 */
export const SHOW_REPORT = false;

const PAUSE: Record<string, number> = { pending: 2000, waiting: 20000, processing: 6000, report: 8000 };
/** Карточку могут держать открытой долго — дальше не опрашиваем, догонит следующее открытие. */
const MAX_STEPS = 40;

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Нужно ли ещё что-то просить у функции: расшифровка не готова или разбор в пути. */
const pending = (d: Dialog | null, callId: string) =>
  !d || d.callId !== callId || DIALOG_BUSY.includes(d.status) || (SHOW_REPORT && d.status === "done" && (d.reportStatus === "processing" || d.reportStatus === "none"));

export function useLeadDialog(lead: Lead) {
  const callId = dialogCallId(lead.link);
  const available = dialogAvailable(lead.link);
  const [dlg, setDlg] = useState<Dialog | null>(() => (available ? cachedDialog(lead.id) : null));
  const [loading, setLoading] = useState(() => available && !cachedDialog(lead.id));
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
        setLoading(false);
        for (let i = 0; i < MAX_STEPS && alive && pending(d, callId); i++) {
          if (d && i > 0) await sleep(d.status === "done" ? PAUSE.report : PAUSE[d.status] ?? 6000);
          if (!alive) return;
          d = await syncDialog(lead.id);
          if (alive) setDlg(d);
        }
      } catch (e) {
        if (alive) {
          setErr((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [lead.id, available, callId, run]);

  const act = async (action: "retry" | "swap" | "report") => {
    setBusy(true);
    setErr("");
    try {
      const d = await syncDialog(lead.id, action);
      setDlg(d);
      if (action !== "swap") setRun((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fresh = dlg && dlg.callId === callId ? dlg : null;
  const state: "none" | "loading" | "busy" | "failed" | "done" =
    !callId || !available
      ? "none"
      : fresh?.status === "done"
        ? "done"
        : fresh?.status === "failed" || (err && !fresh && !loading)
          ? "failed"
          : loading && !fresh
            ? "loading"
            : "busy";
  return { callId, available, dlg: fresh, err, busy, act, state };
}
export type DialogState = ReturnType<typeof useLeadDialog>;

const SPEEDS = [1, 1.25, 1.5, 2];
const BUSY_TEXT: Record<string, string> = {
  pending: "Берём запись разговора из Скорозвона…",
  waiting: "Скорозвон ещё готовит запись — проверим снова через 20 секунд",
  processing: "Memo AI расшифровывает разговор — обычно 1–3 минуты",
};

/** Заглушка разбора: сводка, чек-лист, плеер — той же формы, что готовый блок. */
function ReviewSkeleton({ caption, player = true }: { caption?: ReactNode; player?: boolean }) {
  // без разбора: что происходит, плеер и строка «Расшифровка целиком»
  if (!SHOW_REPORT)
    return (
      <>
        {caption && (
          <div className="rv-cap busy">
            <span className="lc-spin sm" aria-hidden /> {caption}
          </div>
        )}
        {player && <div className="sk" style={{ height: 46, borderRadius: 999 }} aria-hidden />}
        <div className="sk" style={{ height: 39, borderRadius: 10 }} aria-hidden />
      </>
    );
  return (
    <>
      <section className="rv-sum" aria-busy>
        <div className={caption ? "rv-cap busy" : "rv-cap"}>
          {caption ? (
            <>
              <span className="lc-spin sm" aria-hidden /> {caption}
            </>
          ) : (
            <>
              <Icon name="bulb" size={12} /> Кратко о разговоре
            </>
          )}
        </div>
        <div className="sk" style={{ height: 11, width: "96%", borderRadius: 5 }} />
        <div className="sk" style={{ height: 11, width: "88%", borderRadius: 5 }} />
        <div className="sk" style={{ height: 11, width: "62%", borderRadius: 5 }} />
      </section>
      <div className="rv-checks" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rv-chk">
            <span className="sk" style={{ width: 16, height: 16, borderRadius: 8, flex: "none" }} />
            <span style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <span className="sk" style={{ height: 10, width: "55%", borderRadius: 5 }} />
              <span className="sk" style={{ height: 10, width: "80%", borderRadius: 5 }} />
            </span>
          </div>
        ))}
      </div>
      {player && <div className="sk" style={{ height: 46, borderRadius: 999 }} aria-hidden />}
    </>
  );
}

function Notice({ icon, title, danger, children, action }: { icon: IconName; title: string; danger?: boolean; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rv-notice${danger ? " err" : ""}`}>
      <span className="rv-notice-ic">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {action}
      </div>
    </section>
  );
}

/** Блоки проверки: разбор, чек-лист, запись, расшифровка. Плеер общий — чек-лист и реплики в него «прыгают». */
export function CallReview({ lead, d }: { lead: Lead; d: DialogState }) {
  const audio = useRef<HTMLAudioElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [open, setOpen] = useState(false);
  const dlg = d.dlg;
  const total = dur || dlg?.callSec || 0;
  const report = useMemo(() => (dlg?.reportStatus === "done" ? parseReport(dlg.report, dlg.segments) : null), [dlg?.reportStatus, dlg?.report, dlg?.segments]);

  // реплика, которая звучит сейчас
  const active = playing || t > 0 ? (dlg?.segments.findIndex((s, i, a) => t >= s.s && (i === a.length - 1 || t < a[i + 1].s)) ?? -1) : -1;
  useEffect(() => {
    if (!playing || active < 0 || !open) return;
    chat.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, playing, open]);

  if (d.state === "none") {
    if (!d.callId)
      return (
        <Notice icon="link" title="Разбора нет: в ссылке нет звонка">
          Разбор и запись появляются, когда ссылка скопирована из звонка в Скорозвоне — с …/answer/&lt;номер звонка&gt;/…
        </Notice>
      );
    return <Notice icon="database" title="Разбор работает только с базой">CRM сейчас без Supabase — запись и расшифровку взять неоткуда.</Notice>;
  }
  if (d.state === "loading") return <ReviewSkeleton />;
  if (d.state === "busy") return <ReviewSkeleton caption={BUSY_TEXT[dlg?.status ?? "pending"]} />;
  if (d.state === "failed")
    return (
      <Notice
        icon="alert"
        title="Не получилось взять разговор"
        danger
        action={
          dlg && (
            <button type="button" className="o2-btn" onClick={() => void d.act("retry")} disabled={d.busy}>
              <Icon name="refresh" size={13} /> Расшифровать заново
            </button>
          )
        }
      >
        {dlg?.error || d.err || "Неизвестная ошибка"}
      </Notice>
    );
  if (!dlg) return null;

  const seek = (sec: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = sec;
    setT(sec);
    void a.play().catch(() => {});
  };
  const jump = (sec: number) => {
    setOpen(true);
    seek(sec);
  };
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };
  const nextSpeed = () => {
    const v = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(v);
    if (audio.current) audio.current.playbackRate = v;
  };
  const opName = dlg.callUser ? shortName(dlg.callUser) : "Оператор";
  const clName = lead.client || "Клиент";
  const rs = dlg.reportStatus;

  return (
    <>
      {/* разбор от Memo AI */}
      {!SHOW_REPORT ? null : rs === "processing" || rs === "none" ? (
        <ReviewSkeleton caption="Memo AI готовит разбор разговора…" player={false} />
      ) : rs === "missing" ? (
        <Notice
          icon="bulb"
          title="Разбора нет"
          action={
            <button type="button" className="o2-btn" onClick={() => void d.act("report")} disabled={d.busy}>
              <Icon name="refresh" size={13} /> Запросить разбор
            </button>
          }
        >
          В Memo AI не найден шаблон отчёта «Проверка лида» (или в базе нет колонок для него). Как настроить — supabase/README.md, пункт 12.
        </Notice>
      ) : rs === "failed" ? (
        <Notice
          icon="alert"
          title="Memo AI не смог сделать разбор"
          danger
          action={
            <button type="button" className="o2-btn" onClick={() => void d.act("report")} disabled={d.busy}>
              <Icon name="refresh" size={13} /> Попробовать ещё раз
            </button>
          }
        />
      ) : report ? (
        <>
          <section className="rv-sum">
            <div className="rv-cap">
              <Icon name="bulb" size={12} /> Кратко о разговоре
            </div>
            {report.summary && <p>{report.summary}</p>}
            {report.verdict && (
              <div className="rv-verdict" data-kind={report.verdict.kind}>
                <b>{report.verdict.kind === "done" ? "Похоже на лид" : report.verdict.kind === "failed" ? "Похоже, не лид" : "Под вопросом"}</b>
                {report.verdict.text && <span>{report.verdict.text}</span>}
              </div>
            )}
          </section>
          {report.checks.length > 0 && (
            <div className="rv-checks">
              {report.checks.map((c, i) => (
                <div key={i} className="rv-chk">
                  <span className={`rv-m ${c.ok ? "ok" : "no"}`} aria-label={c.ok ? "выяснили" : "не выяснили"}>
                    {c.ok ? "✓" : "?"}
                  </span>
                  <div>
                    <b>{c.label}</b>
                    <span>{c.value}</span>
                    {c.at != null && dlg.recordUrl && (
                      <button type="button" className="rv-jump num" onClick={() => jump(c.at!)} title="Слушать это место">
                        {mmss(c.at)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* запись */}
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

      {/* расшифровка целиком — по клику */}
      <details className="rv-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <Icon name="chat" size={13} /> Расшифровка целиком
          <span className="o2-muted num">{dlg.segments.length} реплик</span>
          <Icon name="chevD" size={13} className="rv-chev" />
        </summary>
        <div className="lc-chat rv-chat" ref={chat}>
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
      </details>
      {d.err && <div className="lc-sub err">{d.err}</div>}
    </>
  );
}
