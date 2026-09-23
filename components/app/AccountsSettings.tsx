"use client";

import { useMemo, useState } from "react";
import { useCrm, type AccountInput } from "@/lib/crm/store";
import { NAV } from "@/lib/crm/nav";
import { computeAccess, supervisorGroups } from "@/lib/crm/access";
import {
  ACCOUNT_ROLE_HINT,
  ACCOUNT_ROLE_LABEL,
  type Account,
  type AccountRole,
  type OperatorAccess,
  type SupervisorAccess,
} from "@/lib/crm/types";
import { fmtDate } from "@/lib/crm/dates";
import { Avatar, Chip, Empty, Field, Modal, NumInput, Switch, useDraft } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { RoleChip } from "./AccountMenu";
import { AUTH_ENABLED } from "@/lib/appMode";
import { TelegramCard } from "./TelegramCard";
import { setLogin } from "@/lib/crm/remote";

function Section({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>
            {title}
          </h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {action && <div style={{ flex: "none" }}>{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Переключатель права с пояснением — из него собраны настройки ролей. */
function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  // своей строкой: иначе короткий переключатель без пояснения встаёт в строку со следующим
  return (
    <div style={{ padding: "8px 0" }}>
      <Switch checked={on} onChange={onChange} label={label} hint={hint} disabled={disabled} />
    </div>
  );
}

/** Часы на исправление лида: число сохраняется целиком (Enter / уход из поля / кнопка), а не на каждую цифру. */
function EditHoursField({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const { draft, setDraft, dirty, reset } = useDraft(value);
  return (
    <Field label="Сколько часов оператор может исправлять свой лид" hint="0 — исправления запрещены; по истечении срока правит супервайзер или РОП" style={{ maxWidth: 420 }}>
      <div className="row" style={{ gap: 6 }}>
        <div onBlur={() => dirty && onSave(draft)} style={{ width: 120 }}>
          <NumInput value={draft} onChange={(v) => setDraft(v ?? 0)} min={0} max={744} onEnter={() => dirty && onSave(draft)} />
        </div>
        {dirty && (
          <>
            <button type="button" className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => onSave(draft)}>
              Сохранить
            </button>
            <button type="button" className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={reset}>
              Отменить
            </button>
          </>
        )}
      </div>
    </Field>
  );
}

/* ── мой профиль ─────────────────────────────────────────────────── */

export function ProfileTab() {
  const { me, access, data, saveMyProfile, toast, remote } = useCrm();
  const [name, setName] = useState(me.name);
  const [login, setLogin] = useState(me.login);
  const op = access.opId ? data.operators.find((o) => o.id === access.opId) : null;
  const pages = NAV.filter((n) => access.routes.has(n.href));
  const projects = data.projects.filter((p) => !p.deletedAt && p.active).sort((a, b) => a.sort - b.sort);
  const dirty = name !== me.name || login !== me.login;

  return (
    <div className="stack">
      <Section title="Мой профиль" sub="Как вас видят в системе. Смена пароля появится вместе с включённым входом.">
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={me.name} id={me.id} size={52} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <RoleChip role={me.role} />
            <Chip hue="gray">{access.scopeLabel}</Chip>
            {op && <Chip hue="blue">Карточка сотрудника: {op.name}</Chip>}
          </div>
        </div>
        <div className="grid2">
          <Field label="Имя">
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {AUTH_ENABLED ? (
            <Field label="Почта для входа" hint="К ней привязан аккаунт. Сменить может руководитель в «Аккаунтах»">
              <input className="inp" value={me.login} readOnly disabled />
            </Field>
          ) : (
            <Field label="Логин (почта или телефон)" hint="Понадобится, когда включим вход по паролю">
              <input className="inp" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ivanova@leadup.ru" />
            </Field>
          )}
        </div>
        {dirty && (
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await saveMyProfile({ name, login });
                toast("Профиль сохранён");
              }}
            >
              <Icon name="check" size={14} /> Сохранить
            </button>
            <button
              className="btn"
              onClick={() => {
                setName(me.name);
                setLogin(me.login);
              }}
            >
              Отменить
            </button>
          </div>
        )}
      </Section>

      {/* привязка к Vexi живёт в базе — без Supabase её нет */}
      {remote && <TelegramCard />}

      <Section title="Внешний вид и удобство" sub="Настройки только для вашего аккаунта — другим они не мешают">
        <div className="grid2">
          <Field label="Тема">
            <Select
              value={me.prefs.theme}
              options={[
                { value: "light", label: "Светлая", icon: <Icon name="sun" size={14} /> },
                { value: "dark", label: "Тёмная", icon: <Icon name="moon" size={14} /> },
                { value: "system", label: "Как в системе" },
              ]}
              onChange={(v) => void saveMyProfile({ theme: v as "light" | "dark" | "system" })}
              ariaLabel="Тема"
            />
          </Field>
          <Field label="Стартовая страница" hint="Куда попадаете сразу после входа">
            <Select
              value={pages.some((p) => p.href === me.prefs.homePage) ? me.prefs.homePage : pages[0]?.href ?? "/dashboard"}
              options={pages.map<Opt>((p) => ({ value: p.href, label: p.label, hint: p.hint }))}
              onChange={(v) => void saveMyProfile({ homePage: v })}
              ariaLabel="Стартовая страница"
              minPopWidth={320}
            />
          </Field>
          {access.can.createLeads && (
            <Field label="Проект по умолчанию" hint="Подставляется в форме лида">
              <Select
                value={me.prefs.defaultProjectId ?? ""}
                options={[{ value: "", label: "Не выбирать" }, ...projects.map<Opt>((p) => ({ value: p.id, label: p.name, icon: dot(p.color) }))]}
                onChange={(v) => void saveMyProfile({ defaultProjectId: v || null })}
                ariaLabel="Проект по умолчанию"
              />
            </Field>
          )}
          <Field label="Плотность таблиц">
            <Select
              value={me.prefs.compact ? "1" : "0"}
              options={[
                { value: "0", label: "Обычная" },
                { value: "1", label: "Плотная", hint: "больше строк на экране" },
              ]}
              onChange={(v) => void saveMyProfile({ compact: v === "1" })}
              ariaLabel="Плотность таблиц"
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

/* ── аккаунты ────────────────────────────────────────────────────── */

export function AccountsTab() {
  const { full, data, me, switchAccount, deleteAccount, createOperatorAccounts, confirm } = useCrm();
  const [edit, setEdit] = useState<Account | null | "new">(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const list = useMemo(() => {
    const order: Record<AccountRole, number> = { head: 0, supervisor: 1, operator: 2 };
    return full.accounts
      .filter((a) => showDeleted || !a.deletedAt)
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "ru"));
  }, [full.accounts, showDeleted]);

  const withoutAccount = full.operators.filter((o) => !o.deletedAt && o.status !== "fired" && !full.accounts.some((a) => !a.deletedAt && a.operatorId === o.id)).length;

  return (
    <div className="stack">
      <Section
        title="Аккаунты"
        sub={
          AUTH_ENABLED
            ? "Кто заходит в систему и что видит. Вход — по почте и паролю: задайте пароль в карточке аккаунта и передайте его человеку."
            : "Кто заходит в систему и что видит. Пока вход выключен, аккаунты переключаются из меню внизу слева — так удобно проверять, как систему видят РОП, супервайзер и оператор."
        }
        action={
          <div className="row" style={{ gap: 8 }}>
            {withoutAccount > 0 && (
              <button className="btn btn-sm" onClick={() => void createOperatorAccounts()} title="Создать аккаунты всем операторам без аккаунта">
                <Icon name="users" size={13} /> Создать операторам ({withoutAccount})
              </button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => setEdit("new")}>
              <Icon name="plus" size={13} /> Аккаунт
            </button>
          </div>
        }
      >
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Аккаунт</th>
                <th className="c">Роль</th>
                <th>Зона видимости</th>
                <th>Логин</th>
                <th className="c">Заходил</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const acc = computeAccess(a, full);
                const op = a.operatorId ? full.operators.find((o) => o.id === a.operatorId) : null;
                return (
                  <tr key={a.id} className={a.deletedAt || !a.active ? "dim" : ""}>
                    <td>
                      <span className="row" style={{ gap: 9 }}>
                        <Avatar name={a.name} id={a.id} size={26} />
                        <span>
                          <span style={{ display: "block" }}>
                            {a.name}
                            {a.id === me.id && <span style={{ color: "var(--brand)" }}> · вы</span>}
                          </span>
                          <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                            {op ? op.name : "без карточки сотрудника"}
                            {a.deletedAt ? " · удалён" : !a.active ? " · выключен" : ""}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <RoleChip role={a.role} />
                    </td>
                    <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {acc.scopeLabel}
                    </td>
                    <td className="muted">{a.login || "—"}</td>
                    <td className="muted num c">{a.lastSeenAt ? fmtDate(a.lastSeenAt.slice(0, 10)) : "—"}</td>
                    <td className="r">
                      <span className="row-actions">
                        {a.active && !a.deletedAt && a.id !== me.id && (
                          <button className="btn btn-ghost btn-sm btn-icon" title="Войти как этот пользователь" onClick={() => switchAccount(a.id)}>
                            <Icon name="play" size={13} />
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm btn-icon" title="Изменить" onClick={() => setEdit(a)}>
                          <Icon name="edit" size={13} />
                        </button>
                        {!a.deletedAt && a.id !== me.id && (
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Удалить аккаунт"
                            onClick={async () => {
                              if (await confirm({ title: `Удалить аккаунт «${a.name}»?`, text: "Человек больше не сможет войти. Его лиды, смены и начисления останутся в системе.", ok: "Удалить", danger: true }))
                                void deleteAccount(a.id);
                            }}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Switch size="sm" checked={showDeleted} onChange={setShowDeleted} label="показывать удалённые" />
        {data.operators.length === 0 && <Empty icon="users" title="Сначала заведите операторов" text="Аккаунт оператора привязывается к карточке сотрудника." />}
      </Section>

      {edit && <AccountModal account={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AccountModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { full, saveAccount, toast } = useCrm();
  const [password, setPassword] = useState("");
  const groups = full.groups.filter((g) => !g.deletedAt);
  const taken = new Set(full.accounts.filter((a) => !a.deletedAt && a.id !== account?.id && a.operatorId).map((a) => a.operatorId));
  const [f, setF] = useState<AccountInput>(() =>
    account
      ? { ...account }
      : {
          name: "",
          login: "",
          role: "operator",
          operatorId: null,
          groupIds: [],
          active: true,
          prefs: { theme: full.settings.theme, homePage: "/me", defaultProjectId: null, compact: false },
        },
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const opOpts: Opt[] = [
    { value: "", label: "— без карточки сотрудника —" },
    ...full.operators
      .filter((o) => !o.deletedAt && (!taken.has(o.id) || o.id === f.operatorId))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((o) => ({
        value: o.id,
        label: o.name,
        hint: o.groupId ? full.groups.find((g) => g.id === o.groupId)?.name ?? "" : "без группы",
        icon: <Avatar name={o.name} id={o.id} size={20} />,
      })),
  ];
  const autoGroups = account ? supervisorGroups({ ...account, ...f } as Account, full) : new Set<string>();

  return (
    <Modal
      title={account ? "Аккаунт" : "Новый аккаунт"}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              if (AUTH_ENABLED && password && password.length < 8) {
                toast("Пароль — минимум 8 символов", "err");
                return;
              }
              setBusy(true);
              const ok = await saveAccount({ ...f, id: account?.id });
              if (ok && AUTH_ENABLED && password) {
                try {
                  const r = await setLogin(ok.login, password, ok.name);
                  toast(r === "created" ? `Вход создан: ${ok.login}` : `Пароль для ${ok.login} изменён`);
                } catch (e) {
                  toast(`Аккаунт сохранён, но вход не создан: ${e instanceof Error ? e.message : String(e)}`, "err");
                }
              }
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {account ? "Сохранить" : "Создать"}
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Имя">
          <input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus placeholder="Фамилия Имя" />
        </Field>
        <Field
          label={AUTH_ENABLED ? "Почта для входа" : "Логин"}
          hint={AUTH_ENABLED ? "С ней человек входит в CRM" : "Почта или телефон — для будущего входа"}
        >
          <input className="inp" type={AUTH_ENABLED ? "email" : "text"} value={f.login} onChange={(e) => set("login", e.target.value)} placeholder="ivanova@mail.ru" />
        </Field>
      </div>
      {AUTH_ENABLED && (
        <Field
          label={account ? "Новый пароль" : "Пароль для входа"}
          hint={account ? "Оставьте пустым, чтобы не менять. Минимум 8 символов" : "Минимум 8 символов. Передайте человеку вместе с почтой — регистрации нет"}
        >
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={account ? "не менять" : "придумайте пароль"} autoComplete="new-password" spellCheck={false} style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                const buf = new Uint8Array(10);
                crypto.getRandomValues(buf);
                setPassword(Array.from(buf, (b) => abc[b % abc.length]).join(""));
              }}
            >
              Сгенерировать
            </button>
          </div>
        </Field>
      )}
      <Field label="Роль" hint={ACCOUNT_ROLE_HINT[f.role]}>
        <Select<AccountRole>
          value={f.role}
          options={(Object.keys(ACCOUNT_ROLE_LABEL) as AccountRole[]).map((r) => ({ value: r, label: ACCOUNT_ROLE_LABEL[r], hint: ACCOUNT_ROLE_HINT[r] }))}
          onChange={(r) =>
            setF((x) => ({ ...x, role: r, prefs: { ...x.prefs, homePage: r === "operator" ? "/me" : "/dashboard" } }))
          }
          ariaLabel="Роль"
          minPopWidth={420}
        />
      </Field>
      <Field
        label="Карточка сотрудника"
        hint={f.role === "operator" ? "Обязательно: из неё берутся план, часы и заработок" : "Нужна, если этот человек тоже передаёт лиды"}
      >
        <Select
          value={f.operatorId ?? ""}
          options={opOpts}
          onChange={(v) => {
            const op = full.operators.find((o) => o.id === v);
            setF((x) => ({ ...x, operatorId: v || null, name: x.name.trim() ? x.name : op?.name ?? "" }));
          }}
          ariaLabel="Карточка сотрудника"
          minPopWidth={340}
        />
      </Field>
      {f.role === "supervisor" && (
        <Field label="Группы под управлением" hint="Плюс те, где он указан руководителем в карточке группы — они отмечены">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {groups.map((g) => {
              const on = f.groupIds.includes(g.id);
              const auto = autoGroups.has(g.id) && !on;
              return (
                <button
                  key={g.id}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  style={{
                    ["--chip-fg" as string]: `var(--c-${g.color}-fg)`,
                    ["--chip-bg" as string]: `var(--c-${g.color}-bg)`,
                    ["--chip-bd" as string]: `var(--c-${g.color}-bd)`,
                    opacity: on || auto ? 1 : 0.5,
                  }}
                  onClick={() => set("groupIds", on ? f.groupIds.filter((x) => x !== g.id) : [...f.groupIds, g.id])}
                >
                  {g.name}
                  {auto ? " · авто" : ""}
                </button>
              );
            })}
            {groups.length === 0 && <span style={{ fontSize: 12.5, color: "var(--dim)" }}>Групп пока нет</span>}
          </div>
        </Field>
      )}
      <Field label="Доступ">
        <Select
          value={f.active ? "1" : "0"}
          options={[
            { value: "1", label: "Включён", icon: dot("green") },
            { value: "0", label: "Выключен", hint: "не сможет войти", icon: dot("gray") },
          ]}
          onChange={(v) => set("active", v === "1")}
          ariaLabel="Доступ"
        />
      </Field>
    </Modal>
  );
}

/* ── роли и доступ ───────────────────────────────────────────────── */

export function RolesTab() {
  const { data, saveSettings, toast } = useCrm();
  const A = data.settings.access;
  const setSup = (patch: Partial<SupervisorAccess>) => void saveSettings({ access: { ...A, supervisor: { ...A.supervisor, ...patch } } });
  const setOp = (patch: Partial<OperatorAccess>) => void saveSettings({ access: { ...A, operator: { ...A.operator, ...patch } } });

  return (
    <div className="stack">
      <div className="card card-pad" style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.6 }}>
        РОП всегда видит и может всё. Ниже — что разрешено супервайзерам и операторам. Изменения применяются сразу: у людей пропадают или
        появляются кнопки и разделы.
      </div>

      <Section title="Супервайзер" sub="Видит и ведёт свои группы: те, что назначены в аккаунте, плюс где он указан руководителем группы">
        <div className="grid2" style={{ gap: 0, columnGap: 24 }}>
          <div>
            <Toggle on={A.supervisor.seeAllGroups} onChange={(v) => setSup({ seeAllGroups: v })} label="Видит показатели всех групп" hint="Править по-прежнему может только свои" />
            <Toggle on={A.supervisor.createLeads} onChange={(v) => setSup({ createLeads: v })} label="Вносит лиды за своих операторов" />
            <Toggle on={A.supervisor.editLeads} onChange={(v) => setSup({ editLeads: v })} label="Правит и удаляет лиды своей группы" />
            <Toggle on={A.supervisor.manageOperators} onChange={(v) => setSup({ manageOperators: v })} label="Заводит и редактирует операторов" hint="Только в своих группах" />
          </div>
          <div>
            <Toggle on={A.supervisor.editShifts} onChange={(v) => setSup({ editShifts: v })} label="Ведёт график смен своей группы" />
            <Toggle on={A.supervisor.editPlans} onChange={(v) => setSup({ editPlans: v })} label="Ставит планы на месяц" hint="Своей группе и её операторам" />
            <Toggle on={A.supervisor.viewPayroll} onChange={(v) => setSup({ viewPayroll: v, editPayroll: v && A.supervisor.editPayroll })} label="Видит зарплату своей группы" />
            <Toggle
              on={A.supervisor.editPayroll}
              disabled={!A.supervisor.viewPayroll}
              onChange={(v) => setSup({ editPayroll: v })}
              label="Меняет начисления и ставки"
              hint="Премии, удержания, авансы, условия месяца"
            />
            <Toggle on={A.supervisor.manageProjects} onChange={(v) => setSup({ manageProjects: v })} label="Правит справочник проектов" />
          </div>
        </div>
      </Section>

      <Section title="Оператор" sub="Личный кабинет: только свои данные">
        <div className="grid2" style={{ gap: 0, columnGap: 24 }}>
          <div>
            <Toggle on={A.operator.createOwnLeads} onChange={(v) => setOp({ createOwnLeads: v })} label="Вносит свои лиды" hint="Главный сценарий: передал менеджеру — записал" />
            <Toggle on={A.operator.deleteOwnLeads} onChange={(v) => setOp({ deleteOwnLeads: v })} label="Может удалить свой лид" hint="Только в пределах времени на исправление" />
            <Toggle on={A.operator.editOwnShifts} onChange={(v) => setOp({ editOwnShifts: v })} label="Отмечает свои часы в графике" />
          </div>
          <div>
            <Toggle on={A.operator.viewOwnPay} onChange={(v) => setOp({ viewOwnPay: v })} label="Видит свой заработок" hint="Оклад/часы, бонус за лиды, остаток к выплате" />
            <Toggle on={A.operator.viewGroupProgress} onChange={(v) => setOp({ viewGroupProgress: v })} label="Видит результат своей группы" hint="Только итог группы, без чужих лидов и зарплат" />
            <Toggle on={A.operator.viewTeamProgress} onChange={(v) => setOp({ viewTeamProgress: v })} label="Видит результат всего отдела" />
          </div>
        </div>
        <EditHoursField value={A.operator.editOwnLeadsHours} onSave={(v) => setOp({ editOwnLeadsHours: v })} />
      </Section>
    </div>
  );
}
