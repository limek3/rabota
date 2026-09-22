"use client";

/**
 * Vexi (Векси) — лиса-маскот и единственный «голос» интерфейса.
 *
 * Одна мордочка вместо зоопарка иконок: у неё четыре настроения, и по цвету
 * видно, что происходит, ещё до чтения текста.
 *
 *   фиолетовая — обычное состояние: подсказка, пустой экран, приветствие;
 *   серая      — «никого нет»: аватарка не загружена / человек только завёлся;
 *   жёлтая     — предупреждение: сделать можно, но будут последствия;
 *   красная    — ошибка: не получилось, вот что именно.
 *
 * Картинки — PNG в /public/vexi (собираются scripts/vexi_from_assets.py). Не SVG:
 * мордочка одна и та же на веб-странице, в трее Electron и в иконке сборки, и
 * держать её в одном растровом источнике дешевле, чем поддерживать два.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { useVexiHints } from "@/lib/vexiHints";

export type VexiMood = "calm" | "blank" | "warn" | "error";

const FILE: Record<VexiMood, string> = {
  calm: "purple",
  blank: "gray",
  warn: "amber",
  error: "red",
};

/** Цвета плашки под настроение. calm намеренно нейтрален: обычная подсказка не
    должна кричать так же громко, как ошибка. */
const SKIN: Record<VexiMood, { fg: string; bg: string; bd: string }> = {
  calm: { fg: "var(--text-sub)", bg: "var(--ink-03)", bd: "var(--ink-06)" },
  blank: { fg: "var(--text-sub)", bg: "var(--ink-03)", bd: "var(--ink-06)" },
  warn: { fg: "var(--c-amber-fg)", bg: "var(--c-amber-bg)", bd: "var(--c-amber-bd)" },
  error: { fg: "var(--c-red-fg)", bg: "var(--c-red-bg)", bd: "var(--c-red-bd)" },
};

/** Мордочка сама по себе. */
export function VexiFace({
  mood = "calm",
  size = 28,
  title,
  style,
}: {
  mood?: VexiMood;
  size?: number;
  title?: string;
  style?: CSSProperties;
}) {
  // до 64px хватает версии @128 — незачем тянуть 512-й файл ради аватарки 24px
  const src = `/vexi/vexi-${FILE[mood]}${size <= 64 ? "@128" : ""}.png`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Vexi"
      title={title}
      width={size}
      height={size}
      style={{ display: "block", flex: "none", width: size, height: size, ...style }}
    />
  );
}

/**
 * Аватар пользователя с серой Векси вместо заглушки.
 *
 * Инициалы в кружке — честный вариант для списка коллег, где важно различать
 * людей. Но у того, кто только зарегистрировался, и имени-то может не быть:
 * пустой круг с одной буквой выглядит как поломка. Серая мордочка читается как
 * «фотографии пока нет» и заодно намекает, что её можно поставить.
 */
export function VexiAvatar({
  src,
  name,
  size = 32,
  style,
}: {
  src?: string | null;
  name?: string;
  size?: number;
  style?: CSSProperties;
}) {
  const [broken, setBroken] = useState(false);
  const shared: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    display: "block",
    objectFit: "cover",
    ...style,
  };

  if (src && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name ?? ""} title={name} onError={() => setBroken(true)} style={shared} />
    );
  }
  return (
    <span
      title={name}
      style={{
        ...shared,
        background: "var(--ink-06)",
        border: "1px solid var(--ink-08)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* мордочка чуть меньше круга — иначе уши упираются в границу */}
      <VexiFace mood="blank" size={Math.round(size * 0.74)} />
    </span>
  );
}

/**
 * Подсказка, которую можно закрыть навсегда.
 *
 * `id` — ключ в localStorage, поэтому он обязан быть стабильным: меняете id —
 * подсказка возвращается ко всем, кто её уже закрыл. Текст менять можно, id —
 * только вместе с решением «показать заново».
 */
export function VexiHint({
  id,
  text,
  mood = "calm",
  action,
  style,
}: {
  id: string;
  text: ReactNode;
  mood?: VexiMood;
  action?: ReactNode;
  style?: CSSProperties;
}) {
  const { dismissed, dismiss, ready } = useVexiHints();
  // до чтения localStorage не рисуем ничего: иначе закрытая подсказка мигает
  // на первом кадре каждого перехода
  if (!ready || dismissed.includes(id)) return null;
  const s = SKIN[mood];

  return (
    <div
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 8px 7px 9px",
        borderRadius: 10,
        background: s.bg,
        border: `1px solid ${s.bd}`,
        ...style,
      }}
    >
      <VexiFace mood={mood} size={26} />
      {/* Подпись — акцентным цветом, а не серым: это имя, а не сноска. На
          жёлтой и красной плашке фиолетовый спорил бы с фоном, поэтому там
          подпись берёт цвет самой плашки. */}
      <span style={{ fontSize: 12, lineHeight: 1.45, color: s.fg, minWidth: 0, flex: 1 }}>
        «{text}»&nbsp;&nbsp;
        <span style={{ color: mood === "warn" || mood === "error" ? s.fg : "var(--brand)", fontWeight: 600 }}>
          — Vexi
        </span>
      </span>
      {action}
      <button
        onClick={() => dismiss(id)}
        aria-label="Скрыть подсказку"
        title="Больше не показывать"
        style={{
          flex: "none",
          border: "none",
          background: "transparent",
          color: "var(--dim)",
          fontSize: 12,
          lineHeight: 1,
          padding: "4px 5px",
          cursor: "pointer",
          borderRadius: 4,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Блок состояния: предупреждение или ошибка.
 *
 * В отличие от VexiHint это не закрывается навсегда — блок описывает то, что
 * происходит прямо сейчас, и должен исчезать вместе с причиной. `onClose`
 * появляется только там, где закрыть уместно (например, ошибка отправки, после
 * которой человек решил не повторять).
 */
export function VexiNote({
  mood = "warn",
  title,
  text,
  action,
  onClose,
  style,
}: {
  mood?: VexiMood;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  style?: CSSProperties;
}) {
  const s = SKIN[mood];
  return (
    <div
      role={mood === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "11px 12px",
        borderRadius: 10,
        background: s.bg,
        border: `1px solid ${s.bd}`,
        ...style,
      }}
    >
      <VexiFace mood={mood} size={30} style={{ marginTop: 1 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: s.fg, lineHeight: 1.35 }}>{title}</span>
        {text && (
          <span style={{ fontSize: 12, color: "var(--text-sub)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {text}
          </span>
        )}
        {action && <span style={{ marginTop: 5 }}>{action}</span>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Скрыть"
          style={{
            flex: "none",
            border: "none",
            background: "transparent",
            color: "var(--dim)",
            fontSize: 12,
            lineHeight: 1,
            padding: "3px 4px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
