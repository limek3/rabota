"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lead } from "@/lib/crm/types";
import { Icon, type IconName } from "@/components/ui/icons";
import { shortName } from "@/lib/crm/format";
import { Layer, usePopover } from "@/components/ui/select";
import { getVexaBridge } from "@/lib/electron";
import { player, usePlayer } from "@/lib/player";
import { downloadBlob } from "@/lib/xlsx";
import { DIALOG_BUSY, cachedDialog, dialogAvailable, dialogCallId, readDialog, sameDialogCall, syncDialog, type LeadDialog as Dialog } from "@/lib/crm/dialog";

/**
 * Разговор лида для проверки: запись из Скорозвона и плеер.
 * useLeadDialog — состояние и опрос (запись Скорозвон готовит не сразу: пока карточка открыта и записи
 * нет, она сама дёргает функцию lead-dialog); CallReview — плеер в карточке.
 * Готовый разговор берётся из кэша сразу, база только освежает — без «загрузки заново».
 */

/** Пауза между шагами: Скорозвон готовит запись — спрашиваем реже. */
const PAUSE: Record<string, number> = { pending: 2000, waiting: 20000, processing: 2000 };
/** Карточку могут держать открытой долго — дальше не опрашиваем, догонит следующее открытие. */
const MAX_STEPS = 40;

export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Нужно ли ещё что-то просить у функции: записи пока нет. */
const pending = (d: Dialog | null, callId: string) => !d || !sameDialogCall(d.callId, callId) || DIALOG_BUSY.includes(d.status);

/** Упал во времена Memo AI (минуты, 409 и т. п.) — функция теперь берёт запись из Скорозвона, достаточно позвать. */
const stuck = (d: Dialog | null) => !!d && d.status === "failed" && /memo|409|idempotency/i.test(d.error);

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
          if (d && i > 0) await sleep(PAUSE[d.status] ?? 6000);
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

  const act = async (action: "retry" | "swap") => {
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

  const fresh = dlg && sameDialogCall(dlg.callId, callId) ? dlg : null;
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
  // реплик нет (запись без расшифровки) — ровная условная волна одного цвета
  if (!segs.length)
    return Array.from({ length: n }, (_, k) => ({ at: ((k + 0.5) / n) * total, who: "rec", h: 30 + 50 * (0.5 + 0.3 * Math.sin(k * 0.9) + 0.2 * Math.sin(k * 2.3)) }));
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

const BUSY_TEXT: Record<string, string> = {
  pending: "Берём запись разговора из Скорозвона…",
  waiting: "Скорозвон ещё готовит запись — проверим снова через 20 секунд",
  processing: "Берём запись разговора из Скорозвона…",
};

/** Заглушка: что происходит и место под плеер. */
function ReviewSkeleton({ caption }: { caption?: ReactNode }) {
  return (
    <>
      {caption && (
        <div className="rv-cap busy">
          <span className="lc-spin sm" aria-hidden /> {caption}
        </div>
      )}
      <div className="sk" style={{ height: 92, borderRadius: 12 }} aria-hidden />
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

/** Имя файла записи: «Разговор Светлана +79375634685 17.10.2026 16-11.mp3». */
function recordName(lead: Lead, url: string): string {
  const ext = url.split("?")[0].match(/\.(mp3|wav|ogg|m4a)$/i)?.[1]?.toLowerCase() ?? "mp3";
  const when = `${lead.at.slice(8, 10)}.${lead.at.slice(5, 7)}.${lead.at.slice(0, 4)} ${lead.at.slice(11, 16).replace(":", "-")}`;
  return `${["Разговор", lead.client, lead.phone ? `+${lead.phone}` : "", when].filter(Boolean).join(" ")}.${ext}`;
}

/**
 * Скачать запись. Хранилище Скорозвона без CORS: в десктопе качает сам Electron (окно «Сохранить как»),
 * в браузере — пробуем файлом, не пускает — открываем запись во вкладке, там её можно сохранить.
 */
async function downloadRecord(url: string, name: string) {
  const br = getVexaBridge();
  if (br?.download) return br.download(url, name);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    downloadBlob(name, await r.blob());
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

/**
 * Запись разговора из Скорозвона: плеер, скачать, громкость, скорость.
 * Звук — в общем плеере (lib/player.ts): ушли на другую страницу — запись играет дальше в мини-плеере.
 */
export function CallReview({ lead, d }: { lead: Lead; d: DialogState }) {
  const pl = usePlayer();
  const src = d.dlg?.recordUrl ?? "";
  // эта карточка показывает свою запись — мини-плеер для неё не нужен
  // layout-эффект: при закрытии карточки плеер ещё на экране — запоминаем, где он стоял (мини-плеер прилетит оттуда)
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => (src ? player.view(src, () => box.current?.getBoundingClientRect() ?? null) : undefined), [src]);
  const on = !!src && pl.src === src;
  const playing = on && pl.playing;
  const t = on ? pl.t : 0;
  const dur = on ? pl.dur : 0;
  const speed = pl.speed;
  // громкость — общая для всех записей, запоминается
  const vol = pl.vol;
  const setVol = (f: (v: number) => number) => player.setVol(f(pl.vol));
  const [volOpen, setVolOpen] = useState(false);
  const volBtn = useRef<HTMLButtonElement>(null);
  const volPop = useRef<HTMLDivElement>(null);
  const { style: volStyle } = usePopover(volOpen, volBtn, volPop, () => setVolOpen(false));
  const dlg = d.dlg;
  const total = dur || dlg?.callSec || 0;
  const bars = useMemo(() => (dlg ? waveBars(dlg.segments, total, dlg.operatorSpeaker) : []), [dlg, total]);

  if (d.state === "none") {
    if (!d.callId)
      return (
        <Notice icon="link" title="Записи нет: ссылка не из Скорозвона">
          Запись разговора появляется, когда в лиде ссылка на лид или звонок в Скорозвоне — app.skorozvon.ru/#/leads/…
        </Notice>
      );
    return <Notice icon="database" title="Запись работает только с базой">CRM сейчас без Supabase — запись взять неоткуда.</Notice>;
  }
  if (d.state === "loading") return <ReviewSkeleton />;
  if (d.state === "busy") return <ReviewSkeleton caption={BUSY_TEXT[dlg?.status ?? "pending"]} />;
  if (d.state === "failed")
    return (
      <Notice
        icon="alert"
        title="Не получилось взять запись"
        danger
        action={
          dlg && (
            <button type="button" className="o2-btn" onClick={() => void d.act("retry")} disabled={d.busy}>
              <Icon name="refresh" size={13} /> Взять запись заново
            </button>
          )
        }
      >
        {dlg?.error || d.err || "Неизвестная ошибка"}
      </Notice>
    );
  if (!dlg) return null;

  const opName = dlg.callUser ? shortName(dlg.callUser) : "Оператор";
  const clName = lead.client || "Клиент";
  // для мини-плеера: кто на записи и когда
  const meta = { leadId: lead.id, title: clName, sub: `${opName} · ${lead.at.slice(8, 10)}.${lead.at.slice(5, 7)} ${lead.at.slice(11, 16)}` };
  const seek = (sec: number) => player.seek(dlg.recordUrl, meta, sec);
  const toggle = () => (on ? player.toggle() : player.play(dlg.recordUrl, meta));
  const nextSpeed = () => player.setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);

  return (
    <>
      {/* запись: «волна» (у старых разговоров с расшифровкой — цветом кто говорит, провалы — паузы); клик — перемотка */}
      {dlg.recordUrl && (
        <div className="lw" ref={box}>
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
            {dlg.segments.length ? (
              <span className="lw-legend">
                <span className="lc-dot op" /> {opName}
                <span className="lc-dot cl" style={{ marginLeft: 10 }} /> {clName}
              </span>
            ) : (
              <span className="lw-legend">{opName}</span>
            )}
            <button type="button" className="lw-ib" onClick={() => void downloadRecord(dlg.recordUrl, recordName(lead, dlg.recordUrl))} title="Скачать запись разговора" aria-label="Скачать запись">
              <Icon name="download" size={14} />
            </button>
            <button
              ref={volBtn}
              type="button"
              className={`lw-ib${volOpen ? " on" : ""}`}
              onClick={() => setVolOpen((v) => !v)}
              onWheel={(e) => setVol((v) => Math.max(0, Math.min(1, Math.round((v + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10)))}
              title={`Громкость ${Math.round(vol * 100)}%`}
              aria-label="Громкость"
              aria-expanded={volOpen}
            >
              <VolumeIcon v={vol} />
            </button>
            <button type="button" className="lc-speed num" onClick={nextSpeed} title="Скорость">
              {speed}×
            </button>
          </div>
          {volOpen && (
            <Layer>
              <div ref={volPop} className="sel-pop lw-vol" style={volStyle} role="dialog" aria-label="Громкость">
                <button type="button" className="lw-ib" onClick={() => setVol((v) => (v > 0 ? 0 : 1))} title={vol > 0 ? "Выключить звук" : "Включить звук"}>
                  <VolumeIcon v={vol} />
                </button>
                <input type="range" min={0} max={100} step={5} value={Math.round(vol * 100)} onChange={(e) => player.setVol(Number(e.target.value) / 100)} aria-label="Громкость" />
                <span className="num">{Math.round(vol * 100)}%</span>
              </div>
            </Layer>
          )}
        </div>
      )}

      {d.err && <div className="lc-sub err">{d.err}</div>}
    </>
  );
}

/** Динамик: волны по громкости, перечёркнут — без звука. */
function VolumeIcon({ v }: { v: number }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" stroke="none" />
      {v <= 0 ? (
        <path d="M10.5 6l3.5 4M14 6l-3.5 4" />
      ) : (
        <>
          <path d="M10.4 6.2a2.6 2.6 0 0 1 0 3.6" />
          {v > 0.5 && <path d="M12.2 4.4a5.2 5.2 0 0 1 0 7.2" />}
        </>
      )}
    </svg>
  );
}
