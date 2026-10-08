"use client";

import { useState } from "react";
import { Field } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { AUTH_ENABLED } from "@/lib/appMode";

/** Случайный пароль без похожих символов (l/1, O/0). */
export function genPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => abc[b % abc.length]).join("");
}

/**
 * Почта и пароль для входа: «Сгенерировать» и «Копировать» (ссылка, почта и пароль одним текстом —
 * сразу переслать человеку). Общие для аккаунта в Настройках и «Выдать доступ» в Найме.
 */
export function LoginFields({
  login,
  onLogin,
  password,
  onPassword,
  existing = false,
  autoFocus = false,
}: {
  login: string;
  onLogin: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  /** Аккаунт уже есть — пароль можно не менять. */
  existing?: boolean;
  autoFocus?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Field label={AUTH_ENABLED ? "Почта для входа" : "Логин"} hint={AUTH_ENABLED ? "С ней человек входит в CRM" : "Почта или телефон — для будущего входа"}>
        <input className="inp" type={AUTH_ENABLED ? "email" : "text"} value={login} onChange={(e) => onLogin(e.target.value)} placeholder="ivanova@mail.ru" autoFocus={autoFocus} />
      </Field>
      {AUTH_ENABLED && (
        <Field
          label={existing ? "Новый пароль" : "Пароль для входа"}
          hint={existing ? "Оставьте пустым, чтобы не менять. Минимум 8 символов" : "Минимум 8 символов. Передайте человеку вместе с почтой — регистрации нет"}
        >
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" value={password} onChange={(e) => onPassword(e.target.value)} placeholder={existing ? "не менять" : "придумайте пароль"} autoComplete="new-password" spellCheck={false} style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => onPassword(genPassword())}>
              Сгенерировать
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!password}
              title={login.trim() ? "Скопировать почту и пароль — чтобы отправить человеку" : "Скопировать пароль"}
              onClick={() => {
                const text = login.trim() ? [`Вход в CRM: ${window.location.origin}`, `Почта: ${login.trim()}`, `Пароль: ${password}`].join("\n") : password;
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
        </Field>
      )}
    </>
  );
}
