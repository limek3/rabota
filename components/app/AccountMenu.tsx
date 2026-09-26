"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { AUTH_ENABLED } from "@/lib/appMode";
import { ACCOUNT_ROLE_LABEL, type Account, type AccountRole } from "@/lib/crm/types";
import { Avatar } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { Layer, usePopover } from "@/components/ui/select";
import { signOut } from "@/lib/auth";

/** Логин под именем: почту показываем как есть, короткий логин — с «@». */
const loginOf = (a: { login: string }): string => (!a.login ? "" : a.login.includes("@") ? a.login : `@${a.login}`);

export const ROLE_HUE: Record<AccountRole, string> = { head: "blue", supervisor: "teal", operator: "gray" };

export function RoleChip({ role }: { role: AccountRole }) {
  return (
    <span
      className="chip"
      style={{
        ["--chip-fg" as string]: `var(--c-${ROLE_HUE[role]}-fg)`,
        ["--chip-bg" as string]: `var(--c-${ROLE_HUE[role]}-bg)`,
        ["--chip-bd" as string]: `var(--c-${ROLE_HUE[role]}-bd)`,
        height: 19,
        fontSize: 10.5,
        padding: "0 6px",
      }}
    >
      {ACCOUNT_ROLE_LABEL[role]}
    </span>
  );
}

/**
 * Аккаунт внизу боковой панели: кто сейчас работает в системе, его роль и зона.
 * Пока вход выключен — здесь же переключение между аккаунтами (для проверки,
 * как систему видят РОП, супервайзер и оператор).
 */
export function AccountMenu() {
  const { me, access, full, switchAccount, saveMyProfile } = useCrm();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { style } = usePopover(open, btnRef, popRef, close);

  const others = useMemo(() => {
    const t = q.trim().toLowerCase();
    const order: Record<AccountRole, number> = { head: 0, supervisor: 1, operator: 2 };
    return full.accounts
      .filter((a) => !a.deletedAt && a.active && a.id !== me.id)
      .filter((a) => !t || a.name.toLowerCase().includes(t) || a.login.toLowerCase().includes(t))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "ru"));
  }, [full.accounts, me.id, q]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const dark = me.prefs.theme === "dark";

  return (
    <>
      <button
        ref={btnRef}
        className="btn btn-ghost acc-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${me.name} · ${ACCOUNT_ROLE_LABEL[me.role]}`}
      >
        <Avatar name={me.name} id={me.id} size={28} />
        <span className="rail-text acc-btn-t">
          <span className="acc-btn-n">{me.name}</span>
          <RoleChip role={me.role} />
        </span>
        <Icon name="chevD" size={13} className="rail-text" style={{ color: "var(--dim)", transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <Layer>
          <div
            ref={popRef}
            className="sel-pop acc-pop"
            style={style}
            role="menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          >
            <div className="acc-card">
              <Avatar name={me.name} id={me.id} size={40} />
              <div className="acc-card-t">
                <div className="acc-card-n">{me.name}</div>
                <div className="acc-card-s">{loginOf(me) || ACCOUNT_ROLE_LABEL[me.role]}</div>
              </div>
              <RoleChip role={me.role} />
            </div>
            <div className="acc-scope" title="Что видит этот аккаунт">
              <Icon name="target" size={13} />
              <span>{access.scopeLabel}</span>
            </div>

            <div className="acc-sep" />

            <MenuItem icon="user" label="Мой профиль и настройки" hint="Имя, тема, стартовая страница" onClick={() => go("/settings?tab=profile")} />
            {access.can.manageAccounts && (
              <MenuItem icon="users" label="Аккаунты и доступ" hint="Сотрудники, роли и права" onClick={() => go("/settings?tab=accounts")} />
            )}
            <MenuItem
              icon={dark ? "sun" : "moon"}
              label={dark ? "Светлая тема" : "Тёмная тема"}
              hint={dark ? "Сейчас тёмная" : "Сейчас светлая"}
              onClick={() => void saveMyProfile({ theme: dark ? "light" : "dark" })}
            />

            {AUTH_ENABLED && (
              <>
                <div className="acc-sep" />
                <MenuItem
                  icon="arrowR"
                  label="Выйти"
                  hint={me.login}
                  onClick={async () => {
                    setOpen(false);
                    await signOut();
                    router.replace("/login");
                  }}
                />
              </>
            )}

            {!AUTH_ENABLED && (
              <>
                <div className="acc-sep" />
                <div className="acc-gh">
                  <span>Войти как</span>
                  <span className="acc-gh-n">вход выключен · без пароля</span>
                </div>
                {full.accounts.filter((a) => !a.deletedAt && a.active).length > 6 && (
                  <div className="acc-search">
                    <Icon name="search" size={14} style={{ color: "var(--dim)" }} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или логин" autoFocus />
                  </div>
                )}
                <div className="acc-list">
                  {others.map((a) => (
                    <AccountRow
                      key={a.id}
                      a={a}
                      onClick={() => {
                        setOpen(false);
                        switchAccount(a.id);
                      }}
                    />
                  ))}
                  {others.length === 0 && <div className="sel-empty">Никого не нашлось</div>}
                </div>
              </>
            )}
          </div>
        </Layer>
      )}
    </>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button role="menuitem" className="acc-item" onClick={onClick}>
      <span className="acc-item-i">
        <Icon name={icon} size={15} />
      </span>
      <span className="acc-item-t">
        <span className="acc-item-l">{label}</span>
        {hint && <span className="acc-item-h">{hint}</span>}
      </span>
      <Icon name="chevR" size={13} className="acc-item-c" />
    </button>
  );
}

function AccountRow({ a, onClick }: { a: Account; onClick: () => void }) {
  return (
    <button role="menuitem" className="acc-row" onClick={onClick}>
      <Avatar name={a.name} id={a.id} size={24} />
      <span className="acc-row-t">
        <span className="acc-row-n">{a.name}</span>
        {loginOf(a) && <span className="acc-row-l">{loginOf(a)}</span>}
      </span>
      <RoleChip role={a.role} />
    </button>
  );
}
