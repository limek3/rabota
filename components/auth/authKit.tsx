"use client";

/**
 * Auth kit — общий «вау»-слой для страниц входа (/login, /reset).
 *
 * Раньше обе страницы были плоскими формами с кнопкой Telegram. Тут собран
 * единый набор: живой фон-аврора, маскот Vexi (реагирует настроением на ввод и
 * на ошибку) и поля с иконкой + свечением на фокусе. Всё темизируется через
 * CSS-переменные, так что работает и в светлой, и в тёмной теме.
 */

import { useState } from "react";
import { VexiFace } from "@/components/Vexi";

const display = "var(--font-sans)";

export type Mood = "idle" | "peek" | "happy" | "sad";

/* ─────────────────────────────────────────────────────────────────────────
   Фон — аврора из трёх дрейфующих пятен + мягкая сетка + искры.
   Кейфреймы и классы (.auth-*) живут в globals.css: инлайновый <style> с
   дочерним CSS-текстом ломал гидрацию (сервер эскейпит `>` и кавычки иначе,
   чем клиент), поэтому статичные правила вынесены в настоящую таблицу стилей.
   ───────────────────────────────────────────────────────────────────────── */
export function AuthBackdrop() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* сетка точек */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(var(--ink-06) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
          WebkitMaskImage: "radial-gradient(1000px 700px at 50% 40%, #000, transparent 78%)",
          maskImage: "radial-gradient(1000px 700px at 50% 40%, #000, transparent 78%)",
          opacity: 0.7,
        }}
      />
      {/* аврора */}
      <span
        className="auth-blob"
        style={{ position: "absolute", top: "-14%", left: "8%", width: 460, height: 460, borderRadius: "50%", filter: "blur(70px)", background: "radial-gradient(circle, var(--brand-glow), transparent 68%)", animation: "authBlobA 16s ease-in-out infinite" }}
      />
      <span
        className="auth-blob"
        style={{ position: "absolute", bottom: "-18%", right: "6%", width: 520, height: 520, borderRadius: "50%", filter: "blur(80px)", background: "radial-gradient(circle, rgba(139, 104, 250,.18), transparent 66%)", animation: "authBlobB 19s ease-in-out infinite" }}
      />
      <span
        className="auth-blob"
        style={{ position: "absolute", top: "34%", right: "26%", width: 340, height: 340, borderRadius: "50%", filter: "blur(70px)", background: "radial-gradient(circle, var(--brand-tint), transparent 70%)", animation: "authBlobC 22s ease-in-out infinite" }}
      />
      {/* искры */}
      {[
        { top: "22%", left: "20%", s: 5, d: "0s" },
        { top: "30%", left: "78%", s: 4, d: "1.1s" },
        { top: "66%", left: "16%", s: 6, d: "2.2s" },
        { top: "74%", left: "82%", s: 4, d: "0.6s" },
        { top: "14%", left: "56%", s: 3, d: "1.7s" },
      ].map((t, i) => (
        <span
          key={i}
          className="auth-twinkle"
          style={{ position: "absolute", top: t.top, left: t.left, width: t.s, height: t.s, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 8px var(--brand)", animation: `authTwinkle 3.4s ease-in-out ${t.d} infinite` }}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Маскот — Vexi.
   Раньше здесь жила пара «живых» глаз, следящих за курсором. Глаза были
   симпатичные, но ничьи: на логотипе, в трее и на пустых экранах человек видит
   лису, а на входе — что-то другое. Настроение осталось прежним, поменялся
   носитель: покой/подглядывание/радость — фиолетовая мордочка, ошибка —
   красная, та же самая, что потом объяснит, что именно не вышло.
   ───────────────────────────────────────────────────────────────────────── */
export function Mascot({ mood = "idle", size = 104 }: { mood?: Mood; size?: number }) {
  // Мордочка стоит неподвижно: ни парения, ни прыжка на успехе, ни тряски на
  // ошибке, ни наклона на вводе пароля. Настроение теперь только меняет лицо
  // (спокойное/красное), но экран при этом не «дышит».
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* мягкое свечение под мордочкой */}
      <span style={{ position: "absolute", width: size * 1.05, height: size * 0.8, borderRadius: "50%", background: "radial-gradient(circle, var(--brand-glow), transparent 70%)", filter: "blur(8px)" }} />
      <div style={{ position: "relative" }}>
        <VexiFace
          mood={mood === "sad" ? "error" : "calm"}
          size={size}
          style={{
            filter: "drop-shadow(0 10px 24px var(--brand-glow))",
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Поля.
   ───────────────────────────────────────────────────────────────────────── */
type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ReactNode };

export function Field({ icon, ...rest }: FieldProps) {
  return (
    <label className="auth-field">
      {icon}
      <input {...rest} />
    </label>
  );
}

export function PasswordField({ icon, ...rest }: FieldProps) {
  const [show, setShow] = useState(false);
  return (
    <label className="auth-field">
      {icon}
      <input {...rest} type={show ? "text" : "password"} style={{ paddingRight: 42 }} />
      <button type="button" className="auth-eye-btn" onClick={() => setShow((s) => !s)} aria-label={show ? "Скрыть пароль" : "Показать пароль"} tabIndex={-1}>
        {show ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </label>
  );
}

/* иконки полей */
export const MailIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3" /><path d="m22 7-10 6L2 7" /></svg>
);
export const LockIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
export const WsIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);

export const authDisplay = display;
