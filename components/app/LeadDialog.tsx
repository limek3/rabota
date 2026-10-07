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

/** Споткнулся о параллельную загрузку (409): файл у Memo есть — функция доведёт сама, достаточно позвать. */
const stuck = (d: Dialog | null) => !!d && d.status === "failed" && /409|idempotency/i.test(d.error);

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
        for (let i = 0; i < MAX_STEPS && alive && (pending(d, callId) || (i === 0 && stuck(d))); i++) {
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

type Seg = { s: number; e: number; who: string; t: string };

/**
 * «Волна» плеера по расшифровке: где говорит оператор, где клиент, где тишина.
 * Настоящую громкость не взять — mp3 лежит в хранилище Скорозвона без CORS, браузер его не прочитает.
 * Высота условная, но плавная: соседние столбики меняются постепенно и сходят на нет к краям реплики,
 * как у звуковой волны. Паузы и ожидание на линии — короткие штрихи.
 */
function waveBars(segs: Seg[], total: number, op: string | null, n = 64) {
  if (!total) return [];
  return Array.from({ length: n }, (_, k) => {
    const at = ((k + 0.5) / n) * total;
    const i = segs.findIndex((s, j) => at >= s.s && at < Math.max(s.e, segs[j + 1]?.s ?? s.e));
    const speech = i >= 0 && at <= segs[i].e + 1.5;
    let h = 14;
    if (speech) {
      const seg = segs[i];
      // огибающая реплики: тише в начале и в конце
      const edge = Math.min(1, (at - seg.s) / 1.5, (seg.e + 1.5 - at) / 1.5);
      // плавный «голос»: сумма двух синусов, у каждой реплики свой рисунок
      const voice = 0.5 + 0.3 * Math.sin(k * 0.9 + i * 1.7) + 0.2 * Math.sin(k * 2.3 + i * 0.6);
      h = 22 + 74 * Math.max(0.15, edge) * voice;
    }
    return { at, who: speech ? (segs[i].who === op ? "op" : "cl") : "gap", h };
  });
}

/** Пары «вопрос → ответ»: реплики оператора подряд — вопрос, следующие за ними реплики клиента — ответ. */
function qaGroups(segs: Seg[], op: string | null) {
  const out: { q: number[]; a: number[] }[] = [];
  let cur: { q: number[]; a: number[] } | null = null;
  segs.forEach((s, i) => {
    const mine = s.who === op;
    if (!cur || (mine && cur.a.length)) {
      cur = { q: [], a: [] };
      out.push(cur);
    }
    (mine ? cur.q : cur.a).push(i);
  });
  return out;
}

/** Вопрос квалификации в реплике оператора — помечаем, чтобы супервайзер видел, что спросили. */
const QA_TAGS: [RegExp, string][] = [
  [/обращаться|как вас зовут|ваше имя/i, "имя"],
  [/модел|марк|какой автомобиль|какую машину/i, "модель"],
  [/бюджет|сумм|стоимост|сколько готовы/i, "бюджет"],
  [/когда планир|срок|в течение какого/i, "срок"],
  [/кредит|наличн|рассрочк|способ оплат|как.*оплачива/i, "оплата"],
  [/удобно.*(звон|связ)|перезвон|менеджер свяж/i, "звонок"],
];
const qaTag = (text: string) => (text.includes("?") ? QA_TAGS.find(([re]) => re.test(text))?.[1] : undefined);
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
        {player && <div className="sk" style={{ height: 92, borderRadius: 12 }} aria-hidden />}
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
      {player && <div className="sk" style={{ height: 92, borderRadius: 12 }} aria-hidden />}
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
  const bars = useMemo(() => (dlg ? waveBars(dlg.segments, total, dlg.operatorSpeaker) : []), [dlg, total]);
  const groups = useMemo(() => (dlg ? qaGroups(dlg.segments, dlg.operatorSpeaker) : []), [dlg]);

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

      {/* запись: «волна» по расшифровке — цветом кто говорит, провалы — паузы; клик — перемотка */}
      {dlg.recordUrl && (
        <div className="lw">
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
          <div className="lw-row">
            <button type="button" className="lw-play" onClick={toggle} aria-label={playing ? "Пауза" : "Слушать"}>
              {/* залитые фигуры 12×12 по центру круга. Треугольник стоит так, что середина между центром его
                  рамки (x 6.6) и центром тяжести (x 5.3) приходится ровно на центр — x 6: так он на глаз ровный */}
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <rect x="2.25" y="1.5" width="2.75" height="9" rx="0.8" fill="currentColor" />
                  <rect x="7" y="1.5" width="2.75" height="9" rx="0.8" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M2.6 1.6 10.6 6 2.6 10.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div
              className="lw-bars"
              role="slider"
              tabIndex={0}
              aria-label="Перемотка"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(t)}
              aria-valuetext={`${mmss(t)} из ${mmss(total)}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                if (total) seek(Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)));
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  seek(Math.max(0, Math.min(total, t + (e.key === "ArrowRight" ? 5 : -5))));
                } else if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggle();
                }
              }}
            >
              {bars.map((b, k) => (
                <i key={k} className={`${b.who}${b.at <= t ? " done" : ""}`} style={{ height: `${b.h}%` }} />
              ))}
            </div>
          </div>
          <div className="lw-foot">
            <span className="lc-time num">
              {mmss(t)} / {mmss(total)}
            </span>
            <span className="lw-legend">
              <span className="lc-dot op" /> {opName}
              <span className="lc-dot cl" style={{ marginLeft: 10 }} /> {clName}
            </span>
            <button type="button" className="lc-speed num" onClick={nextSpeed} title="Скорость">
              {speed}×
            </button>
          </div>
        </div>
      )}

      {/* расшифровка целиком — по клику: пары «вопрос оператора → ответ клиента» */}
      <details className="rv-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <Icon name="chat" size={13} /> Расшифровка целиком
          <span className="o2-muted num">{dlg.segments.length} реплик</span>
          <Icon name="chevD" size={13} className="rv-chev" />
        </summary>
        <div className="qa-list" ref={chat}>
          {groups.map((g, gi) => (
            <div key={gi} className="qa-card">
              {g.q.map((i) => {
                const s = dlg.segments[i];
                const tag = qaTag(s.t);
                return (
                  <button key={i} type="button" data-i={i} className={`qa-q${i === active ? " now" : ""}`} onClick={() => seek(s.s)} title={`${opName} · слушать с ${mmss(s.s)}`}>
                    <span className="qa-ts num">{mmss(s.s)}</span>
                    <span>
                      {s.t}
                      {tag && <span className="qa-tag">{tag}</span>}
                    </span>
                  </button>
                );
              })}
              {g.a.map((i) => {
                const s = dlg.segments[i];
                return (
                  <button key={i} type="button" data-i={i} className={`qa-a${i === active ? " now" : ""}`} onClick={() => seek(s.s)} title={`${clName} · слушать с ${mmss(s.s)}`}>
                    <span className="qa-ts num">{mmss(s.s)}</span>
                    <span>{s.t}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="lc-talk-f">
          <span>
            <span className="qa-key q" /> вопрос — {opName}
            <span className="qa-key a" style={{ marginLeft: 10 }} /> ответ — {clName}
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
