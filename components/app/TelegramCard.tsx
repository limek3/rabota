"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { createTgCode, deepLink, fetchTgStatus, gradeTag, linkCommand, unlinkTg, watchTgLink, type TgChatStatus, type TgCode, type TgStatus } from "@/lib/crm/telegram";
import { Chip, Modal } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/** Пока окно подключения открыто — перечитываем статус (подстраховка к realtime). */
const POLL_MS = 3000;

/** Пояснение под привязанным Telegram, если тег в чате поставить нельзя. */
const CHAT_NOTE: Partial<Record<TgChatStatus, { hue: string; text: string; sub?: string }>> = {
  not_member: { hue: "amber", text: "Вы пока не найдены в рабочем чате", sub: "Вступите в чат — Vexi поставит тег автоматически" },
  admin: { hue: "gray", text: "Вы администратор рабочего чата", sub: "Telegram не ставит теги администраторам" },
  no_rights: { hue: "amber", text: "Vexi пока не может менять теги", sub: "Боту нужно право «Управление тегами» в рабочем чате" },
  no_chat: { hue: "gray", text: "Рабочий чат Vexi ещё не подключен", sub: "Тег появится сразу после подключения" },
  error: { hue: "amber", text: "Тег сейчас не поставился", sub: "Vexi повторит попытку сам" },
  unknown: { hue: "gray", text: "Vexi проверяет рабочий чат…" },
};

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function displayName(st: TgStatus): string {
  if (st.username) return `@${st.username}`;
  return [st.firstName, st.lastName].filter(Boolean).join(" ") || "Telegram";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // старый WebView / нет разрешения — через временное поле
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Блок «Telegram» (Настройки → Мой профиль и «Мой кабинет»): привязка аккаунта к Vexi,
 * чтобы бот ставил дневной грейд тегом в рабочем чате. Грейд ведётся по карточке
 * оператора — аккаунту без карточки (обычно РОП) привязывать нечего.
 * compact — одной строкой, для верха «Моего кабинета».
 */
export function TelegramCard({ compact = false }: { compact?: boolean }) {
  const { toast, confirm, data, access, today } = useCrm();
  // доведённые лиды за сегодня — подсказка, какой тег положен, пока Vexi его не подтвердил
  const doneToday = useMemo(
    () => data.leads.filter((l) => l.operatorId === access.opId && l.status === "done" && l.at.slice(0, 10) === today).length,
    [data.leads, access.opId, today],
  );
  const [st, setSt] = useState<TgStatus | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"code" | "unlink" | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<TgCode | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // момент привязки на открытии окна: переподключение ловим по его смене
  const linkedAtBefore = useRef<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchTgStatus();
      if (!alive.current) return null;
      setSt(s);
      setLoadErr(null);
      return s;
    } catch (e) {
      if (alive.current) setLoadErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  // realtime своей строки привязки: бот поставил тег, человек вышел из чата, отвязка с другого устройства
  const opId = st?.operatorId ?? null;
  useEffect(() => {
    if (!opId) return;
    return watchTgLink(opId, () => void refresh());
  }, [opId, refresh]);

  const expired = code ? now >= new Date(code.expiresAt).getTime() : false;

  // окно открыто и код жив — тикаем таймер и опрашиваем статус; окно закрыто — ничего не крутится
  useEffect(() => {
    if (!open || !code || expired) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [open, code, expired, refresh]);

  // привязка прошла — окно закрывается само
  useEffect(() => {
    if (!open || !st?.linked || st.linkedAt === linkedAtBefore.current) return;
    setOpen(false);
    setCode(null);
    toast(`Telegram подключен${st.username ? `: @${st.username}` : ""}`);
  }, [open, st, toast]);

  const newCode = async () => {
    setBusy("code");
    setCodeErr(null);
    try {
      const c = await createTgCode();
      setCode(c);
      setNow(Date.now());
    } catch (e) {
      setCode(null);
      setCodeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startLink = async () => {
    linkedAtBefore.current = st?.linked ? st.linkedAt : null;
    setOpen(true);
    await newCode();
  };

  const unlink = async () => {
    const ok = await confirm({
      title: "Отключить Telegram?",
      text: "Vexi больше не сможет автоматически менять ваш грейд в рабочем чате.",
      ok: "Отключить",
      danger: true,
    });
    if (!ok) return;
    setBusy("unlink");
    try {
      await unlinkTg();
      await refresh();
      toast("Telegram отключен");
    } catch (e) {
      toast(`Не удалось отключить: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? "Команда скопирована" : "Не удалось скопировать — выделите команду вручную", ok ? "ok" : "err");
  };

  const expected = gradeTag(doneToday);
  const shownTag = st?.linked && st.chatStatus === "member" && st.tag ? st.tag : null;
  const note = st?.linked && st.chatStatus !== "member" ? CHAT_NOTE[st.chatStatus] : null;

  const modal = open && (
    <Modal
      title="Подключение Telegram"
      width={460}
      onClose={() => {
        setOpen(false);
        setCode(null);
        setCodeErr(null);
      }}
    >
      <LinkBody
        code={code}
        error={codeErr}
        generating={busy === "code"}
        expired={expired}
        leftMs={code ? new Date(code.expiresAt).getTime() - now : 0}
        onNew={() => void newCode()}
        onCopy={(t) => void copy(t)}
      />
    </Modal>
  );

  if (compact) {
    // аккаунт без карточки оператора — в кабинете блок не нужен (сам кабинет у такого аккаунта не открывается)
    if (st && !st.operatorId) return null;
    return (
      <div className="card tg-strip">
        <span className="tg-strip-icon" aria-hidden>
          <Icon name="chat" size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Telegram</span>
            {st && (st.linked ? <Chip hue="green" dot>Подключен</Chip> : <Chip hue="gray" dot>Не подключен</Chip>)}
            {st?.linked && <span style={{ fontSize: 13, fontWeight: 500, overflowWrap: "anywhere" }}>{displayName(st)}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: note?.hue === "amber" ? "var(--c-amber-fg)" : "var(--text-sub)", marginTop: 3, lineHeight: 1.45 }}>
            {!st && !loadErr && "Проверяем подключение…"}
            {!st && loadErr && <span style={{ color: "var(--c-red-fg)" }}>{loadErr}</span>}
            {st && !st.linked && (
              <>
                Vexi будет ставить ваш грейд дня тегом в рабочем чате — сейчас это <b style={{ color: "var(--text)" }}>{expected}</b>
              </>
            )}
            {st?.linked &&
              (note ? (
                <>
                  {note.hue === "amber" && "⚠️ "}
                  {note.text}
                  {note.sub && <span style={{ color: "var(--dim)" }}> · {note.sub}</span>}
                </>
              ) : (
                <>
                  Текущий тег: <b style={{ color: "var(--text)" }}>{shownTag ?? expected}</b>
                  {!shownTag && <span style={{ color: "var(--dim)" }}> · ещё не назначен</span>}
                </>
              ))}
          </div>
        </div>
        <div className="row tg-strip-actions" style={{ gap: 8 }}>
          {!st && loadErr && (
            <button className="btn btn-sm" onClick={() => void refresh()}>
              <Icon name="refresh" size={13} /> Повторить
            </button>
          )}
          {st && !st.linked && (
            <button className="btn btn-primary btn-sm" onClick={() => void startLink()} disabled={busy !== null}>
              <Icon name="link" size={13} /> Подключить Telegram
            </button>
          )}
          {st?.linked && (
            <>
              <button className="btn btn-sm" onClick={() => void startLink()} disabled={busy !== null}>
                <Icon name="refresh" size={13} /> Переподключить
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => void unlink()} disabled={busy !== null}>
                {busy === "unlink" ? "Отключаем…" : "Отключить"}
              </button>
            </>
          )}
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title">Telegram</h3>
          <p className="card-sub">Vexi ставит ваш грейд дня тегом в рабочем чате</p>
        </div>
        {st?.operatorId && (st.linked ? <Chip hue="green" dot>Подключен</Chip> : <Chip hue="gray" dot>Не подключен</Chip>)}
      </div>

      {!st && !loadErr && <div style={{ fontSize: 13, color: "var(--dim)" }}>Проверяем подключение…</div>}

      {!st && loadErr && (
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--c-red-fg)", lineHeight: 1.5 }}>{loadErr}</div>
          <div>
            <button className="btn btn-sm" onClick={() => void refresh()}>
              <Icon name="refresh" size={13} /> Повторить
            </button>
          </div>
        </div>
      )}

      {st && !st.operatorId && (
        <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.55 }}>
          Грейд-теги ведутся для операторов: Vexi считает доведённые лиды по карточке сотрудника. Ваш аккаунт не связан с карточкой оператора, поэтому привязывать
          Telegram не нужно. Операторы подключают его сами — здесь же, в «Моём профиле», или в «Моём кабинете».
        </div>
      )}

      {st?.operatorId && !st.linked && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.55 }}>
            Подключите Telegram — и рядом с вашим именем в рабочем чате появится тег <b style={{ color: "var(--text)" }}>{expected}</b>. Он меняется в течение дня по числу доведённых
            лидов и каждое утро начинается с «Грейд I».
          </div>
          <div>
            <button className="btn btn-primary" onClick={() => void startLink()} disabled={busy !== null}>
              <Icon name="link" size={14} /> Подключить Telegram
            </button>
          </div>
        </div>
      )}

      {st?.linked && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>{displayName(st)}</span>
            <span style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
              Текущий тег: <b style={{ color: "var(--text)" }}>{shownTag ?? expected}</b>
              {!shownTag && <span style={{ color: "var(--dim)" }}> · ещё не назначен</span>}
            </span>
          </div>
          {note && (
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-sub)" }}>
              <div style={{ color: note.hue === "amber" ? "var(--c-amber-fg)" : "var(--text)", fontWeight: 500 }}>
                {note.hue === "amber" && "⚠️ "}
                {note.text}
              </div>
              {note.sub && <div style={{ color: "var(--dim)" }}>{note.sub}</div>}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={() => void startLink()} disabled={busy !== null}>
              <Icon name="refresh" size={13} /> Переподключить
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void unlink()} disabled={busy !== null}>
              {busy === "unlink" ? "Отключаем…" : "Отключить Telegram"}
            </button>
          </div>
        </div>
      )}

      {modal}
    </div>
  );
}

function LinkBody({
  code,
  error,
  generating,
  expired,
  leftMs,
  onNew,
  onCopy,
}: {
  code: TgCode | null;
  error: string | null;
  generating: boolean;
  expired: boolean;
  leftMs: number;
  onNew: () => void;
  onCopy: (text: string) => void;
}) {
  if (generating && !code) return <div style={{ fontSize: 13, color: "var(--dim)", padding: "12px 0" }}>Создаём одноразовый код…</div>;

  if (error)
    return (
      <div className="stack" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--c-red-fg)", lineHeight: 1.5 }}>{error}</div>
        <div>
          <button className="btn btn-primary" onClick={onNew} disabled={generating}>
            Попробовать ещё раз
          </button>
        </div>
      </div>
    );

  if (!code) return null;

  if (expired)
    return (
      <div className="stack" style={{ gap: 12, alignItems: "flex-start" }}>
        <Chip hue="amber" dot>
          Код истек
        </Chip>
        <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5 }}>Код действует 15 минут. Создайте новый — старый уже не сработает.</div>
        <button className="btn btn-primary" onClick={onNew} disabled={generating}>
          {generating ? "Создаём…" : "Создать новый код"}
        </button>
      </div>
    );

  const cmd = linkCommand(code.code);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "var(--text-sub)" }}>
        <li>Откройте Vexi в Telegram</li>
        <li>Отправьте команду:</li>
      </ol>
      <div
        className="row"
        style={{ gap: 10, padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--ink-06)", justifyContent: "space-between", flexWrap: "wrap" }}
      >
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: ".04em", color: "var(--text)", userSelect: "all" }}>{cmd}</code>
        <button className="btn btn-sm" onClick={() => onCopy(cmd)}>
          <Icon name="copy" size={13} /> Скопировать команду
        </button>
      </div>

      {code.botUsername ? (
        <>
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>Или нажмите кнопку — Vexi откроется и привяжет аккаунт сам, ничего вводить не нужно:</div>
          <a className="btn btn-primary btn-lg" href={deepLink(code.botUsername, code.code)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <Icon name="arrowR" size={15} /> Открыть Vexi
          </a>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--c-amber-fg)", lineHeight: 1.5 }}>
          Vexi ещё не сообщил своё имя в Telegram — кнопка появится после его запуска. Пока отправьте команду боту вручную.
        </div>
      )}

      <div className="row" style={{ gap: 8, fontSize: 12.5, color: "var(--text-sub)", flexWrap: "wrap" }}>
        <span className="tg-wait-dot" aria-hidden />
        <span style={{ flex: 1, minWidth: 160 }}>Ждём подтверждения от Vexi…</span>
        <span className="num" style={{ color: "var(--dim)" }}>Код действует ещё {mmss(leftMs)}</span>
      </div>
    </div>
  );
}
