"use client";

import { useMemo, useState } from "react";
import { useCrm, type CandidateInput } from "@/lib/crm/store";
import type { Candidate, CandidateStage } from "@/lib/crm/types";
import { CANDIDATE_STAGE_HUE, CANDIDATE_STAGE_LABEL } from "@/lib/crm/types";
import { canTouchCandidate } from "@/lib/crm/access";
import { fmtDate } from "@/lib/crm/dates";
import { sameNameOps } from "@/lib/crm/dupes";
import { setLogin } from "@/lib/crm/remote";
import { AUTH_ENABLED } from "@/lib/appMode";
import { LoginFields } from "./LoginFields";
import { Chip, Field, Modal, Seg, Swatch } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";

/**
 * Этапы, которые выбираются вручную. «Принят» — только кнопкой «Принять».
 *
 * Путь стажёра — одна карточка от начала до конца: «Выдать доступ» на обучении заводит карточку
 * «стажёр» и аккаунт (график, курс), «Принять в штат» переводит эту же карточку в операторы.
 */
const MANUAL: CandidateStage[] = ["new", "interview", "training", "rejected", "declined"];

export function CandidateModal({ cand, onClose }: { cand: Candidate | null; onClose: () => void }) {
  const { data, full, today, access, saveCandidate, deleteCandidate, hireCandidate, startTraining, saveAccount, setOperatorStatus, openOperator, toast, confirm } = useCrm();
  // супервайзер ведёт только кандидатов своих групп; «без группы» — только у РОПа
  const groups = data.groups.filter((g) => !g.deletedAt && (access.isHead || access.ownGroups.has(g.id)));
  const own: Opt[] = groups.map((g) => ({ value: g.id, label: g.name, icon: dot(g.color) }));
  const groupOpts: Opt[] = access.isHead ? [{ value: "", label: "Пока не решили", icon: dot("gray") }, ...own] : own;

  const [f, setF] = useState<CandidateInput>(() =>
    cand
      ? { ...cand }
      : {
          name: "",
          contact: "",
          source: "",
          groupId: access.isHead ? null : groups[0]?.id ?? null,
          stage: "new",
          appliedAt: today,
          interviewAt: "",
          trainingAt: "",
          closedAt: "",
          reason: "",
          comment: "",
        },
  );
  const set = <K extends keyof CandidateInput>(k: K, v: CandidateInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hire, setHire] = useState<{ date: string; groupId: string; linkTo: string } | null>(null);
  const [grant, setGrant] = useState<{ login: string; password: string; groupId: string; date: string } | null>(null);

  const hired = cand?.stage === "hired";
  const op = cand?.operatorId ? data.operators.find((o) => o.id === cand.operatorId && !o.deletedAt) ?? null : null;
  const opAcc = op ? full.accounts.find((a) => a.operatorId === op.id && !a.deletedAt) ?? null : null;
  // тёзки среди карточек — чтобы при приёме не завести второго такого же человека
  const namesakes = !op && cand ? sameNameOps(data.operators, f.name) : [];
  const canGrant = access.can.manageAccounts;
  const closing = f.stage === "rejected" || f.stage === "declined";
  const canEdit = !cand || canTouchCandidate(access, cand);

  // подсказки из уже введённого: источники и причины повторяются
  const sources = useMemo(() => uniq(data.candidates.map((c) => c.source)), [data.candidates]);
  const reasons = useMemo(() => uniq(data.candidates.map((c) => c.reason)), [data.candidates]);

  const errName = !f.name.trim() ? "Укажите ФИО" : null;
  const errGroup = !access.isHead && !f.groupId ? "Выберите группу" : null;
  const errDates =
    (f.interviewAt && f.interviewAt < f.appliedAt) || (f.trainingAt && f.trainingAt < f.appliedAt) || (f.closedAt && closing && f.closedAt < f.appliedAt)
      ? "Дата этапа раньше отклика"
      : null;

  const submit = async () => {
    setTried(true);
    if (errName || errDates || errGroup || busy) return;
    // отказ после обучения: карточку стажёра — в уволенные, аккаунт выключится сам
    const closeTrainee =
      closing && op && op.role === "trainee" && op.status !== "fired"
        ? await confirm({
            title: `Закрыть доступ ${op.name}?`,
            text: "Карточка стажёра уйдёт в уволенные с даты отказа, аккаунт выключится. История обучения и смены останутся.",
            ok: "Закрыть доступ",
          })
        : false;
    setBusy(true);
    const saved = await saveCandidate({ ...f, id: cand?.id });
    if (saved && closeTrainee && op) await setOperatorStatus(op.id, "fired", f.closedAt || today);
    setBusy(false);
    if (saved) {
      toast(cand ? "Кандидат сохранён" : "Кандидат добавлен");
      onClose();
    }
  };

  const doHire = async () => {
    if (!cand || !hire || busy) return;
    if (!hire.date) return toast("Укажите дату приёма", "err");
    if (!access.isHead && !hire.groupId) return toast("Выберите группу — супервайзер принимает только в свои группы", "err");
    setBusy(true);
    // несохранённые правки карточки кандидата — сначала сохраняем
    const saved = await saveCandidate({ ...f, id: cand.id, stage: f.stage === "rejected" || f.stage === "declined" ? "training" : f.stage });
    const made = saved ? await hireCandidate(cand.id, hire.date, hire.groupId || null, saved, hire.linkTo || null) : null;
    setBusy(false);
    if (!made) return;
    onClose();
    toast(`${made.name} принят(а) с ${fmtDate(hire.date)}. Проверьте план и оплату в карточке`, "ok", { label: "Карточка", run: () => openOperator(made) });
  };

  /** Выдать доступ: карточка «стажёр» (или найденная существующая) + аккаунт + вход. */
  const doGrant = async () => {
    if (!cand || !grant || busy) return;
    const login = grant.login.trim().toLowerCase();
    const needAcc = canGrant && !opAcc;
    if (needAcc) {
      if (AUTH_ENABLED && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) return toast("Укажите почту — с ней человек войдёт в CRM", "err");
      if (AUTH_ENABLED && grant.password.length < 8) return toast("Пароль — минимум 8 символов", "err");
      if (login && full.accounts.some((a) => !a.deletedAt && a.login.trim().toLowerCase() === login)) return toast("Такая почта уже занята другим аккаунтом", "err");
    }
    if (!op && !access.isHead && !grant.groupId) return toast("Выберите группу", "err");
    // тёзка уже есть — привязываем его карточку, а не заводим вторую
    let linkTo: string | null = null;
    if (!op && namesakes.length) {
      const t = namesakes[0];
      const g = t.groupId ? data.groups.find((x) => x.id === t.groupId)?.name : "без группы";
      const yes = await confirm({
        title: `«${t.name}» уже есть в сотрудниках`,
        text: `Карточка: ${t.role === "trainee" ? "стажёр" : "оператор"}, ${g}. Это тот же человек? Привяжем к ней, чтобы не было дубля в графике. Если это другой человек — отмените и уточните ФИО.`,
        ok: "Да, привязать",
      });
      if (!yes) return;
      linkTo = t.id;
    }
    setBusy(true);
    const stage = f.stage === "new" || f.stage === "interview" ? "training" : f.stage;
    const saved = await saveCandidate({ ...f, id: cand.id, stage });
    const card = saved ? op ?? (await startTraining(cand.id, { groupId: grant.groupId || null, date: grant.date || today, linkTo }, saved)) : null;
    if (!card) return setBusy(false);
    const hasAcc = full.accounts.some((a) => a.operatorId === card.id && !a.deletedAt);
    if (needAcc && !hasAcc) {
      const acc = await saveAccount({
        name: card.name,
        login,
        role: "operator",
        operatorId: card.id,
        groupIds: [],
        active: true,
        prefs: { theme: full.settings.theme, homePage: card.role === "trainee" ? "/learn" : "/me", defaultProjectId: null, compact: false },
      });
      if (!acc) return setBusy(false);
      if (AUTH_ENABLED && grant.password) {
        try {
          await setLogin(acc.login, grant.password, acc.name);
          const text = [`Вход в CRM: ${window.location.origin}`, `Почта: ${acc.login}`, `Пароль: ${grant.password}`].join("\n");
          const copied = await navigator.clipboard.writeText(text).then(
            () => true,
            () => false,
          );
          toast(`Доступ выдан: ${acc.login}${copied ? " — почта и пароль скопированы" : ""}`);
        } catch (e) {
          toast(`Аккаунт создан, но вход не создан: ${e instanceof Error ? e.message : String(e)}`, "err");
        }
      } else toast(`Доступ выдан: ${card.name}`);
    } else toast(canGrant ? `Карточка привязана: ${card.name}` : "Карточка стажёра заведена — аккаунт для входа выдаёт РОП");
    setBusy(false);
    onClose();
  };

  const remove = async () => {
    if (!cand) return;
    if (await confirm({ title: "Удалить кандидата?", text: hired ? "Карточка оператора останется — удалится только запись в воронке." : cand.name, ok: "Удалить", danger: true })) {
      await deleteCandidate(cand.id);
      onClose();
    }
  };

  return (
    <Modal
      title={cand ? "Кандидат" : "Новый кандидат"}
      onClose={onClose}
      width={620}
      footer={
        <>
          {cand && canEdit && (
            <button className="btn btn-ghost" onClick={() => void remove()} style={{ marginRight: "auto", color: "var(--c-red-fg)" }}>
              <Icon name="trash" size={14} /> Удалить
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {cand ? "Сохранить" : "Добавить"}
            </button>
          )}
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div className="grid2">
          <Field label="ФИО" error={tried ? errName : null}>
            <input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus={!cand} aria-invalid={tried && !!errName} />
          </Field>
          <Field label="Контакт">
            <input className="inp" value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Телефон или Telegram" />
          </Field>
        </div>
        <div className="grid2">
          <Field label="Источник" hint="Откуда пришёл: hh.ru, Авито, рекомендация…">
            <input className="inp" value={f.source} onChange={(e) => set("source", e.target.value)} list="cand-sources" placeholder="Необязательно" />
            <datalist id="cand-sources">
              {sources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Группа" error={tried ? errGroup : null}>
            <Select value={f.groupId ?? ""} options={groupOpts} onChange={(v) => set("groupId", v || null)} ariaLabel="Группа" disabled={hired} invalid={tried && !!errGroup} />
          </Field>
        </div>

        <Field label="Этап">
          {hired ? (
            <div className="row" style={{ gap: 8, minHeight: 34 }}>
              <Chip hue="green" dot>
                Принят {cand?.closedAt ? `с ${fmtDate(cand.closedAt)}` : ""}
              </Chip>
              {op && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    onClose();
                    openOperator(op);
                  }}
                >
                  Карточка оператора <Icon name="chevR" size={13} />
                </button>
              )}
            </div>
          ) : (
            <Seg<CandidateStage>
              value={f.stage}
              onChange={(v) => set("stage", v)}
              style={{ flexWrap: "wrap" }}
              options={MANUAL.map((st) => ({
                value: st,
                label: (
                  <>
                    <Swatch hue={CANDIDATE_STAGE_HUE[st]} size={7} /> {CANDIDATE_STAGE_LABEL[st]}
                  </>
                ),
              }))}
            />
          )}
        </Field>

        <div className="grid3">
          <Field label="Отклик">
            <DateInput value={f.appliedAt} onChange={(v) => set("appliedAt", v || today)} max={today} ariaLabel="Дата отклика" />
          </Field>
          <Field label="Собеседование" error={tried ? errDates : null}>
            <DateInput value={f.interviewAt} onChange={(v) => set("interviewAt", v)} clearable ariaLabel="Дата собеседования" placeholder={f.stage === "interview" ? "сегодня" : "—"} />
          </Field>
          <Field label="Обучение">
            <DateInput value={f.trainingAt} onChange={(v) => set("trainingAt", v)} clearable ariaLabel="Дата начала обучения" placeholder={f.stage === "training" ? "сегодня" : "—"} />
          </Field>
        </div>

        {closing && (
          <div className="grid2">
            <Field label={f.stage === "rejected" ? "Почему отказали" : "Почему отказался"}>
              <input className="inp" value={f.reason} onChange={(e) => set("reason", e.target.value)} list="cand-reasons" placeholder="Например: не прошёл обучение" />
              <datalist id="cand-reasons">
                {reasons.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Дата">
              <DateInput value={f.closedAt} onChange={(v) => set("closedAt", v)} clearable ariaLabel="Дата отказа" placeholder="сегодня" />
            </Field>
          </div>
        )}

        <Field label="Комментарий">
          <textarea className="inp" value={f.comment} onChange={(e) => set("comment", e.target.value)} rows={2} placeholder="Впечатление, договорённости, когда перезвонить" />
        </Field>

        {cand && !hired && !closing && canEdit && (
          <div className="hire-box">
            {op && (opAcc || !canGrant) ? (
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1, fontSize: 12.5 }}>
                  <span style={{ color: "var(--c-green-fg)", fontWeight: 600 }}>✓ </span>
                  {opAcc ? (
                    <>
                      Доступ выдан: <b style={{ fontWeight: 600 }}>{opAcc.login || opAcc.name}</b>
                    </>
                  ) : (
                    "Карточка стажёра заведена — аккаунт для входа выдаёт РОП"
                  )}
                  <span style={{ color: "var(--text-sub)" }}>
                    {" "}
                    · {op.role === "trainee" ? "стажёр" : "оператор"}
                    {op.hireDate ? ` в графике с ${fmtDate(op.hireDate)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    onClose();
                    openOperator(op);
                  }}
                >
                  Карточка <Icon name="chevR" size={13} />
                </button>
              </div>
            ) : grant ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Выдать доступ на обучение</div>
                <div style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
                  {op
                    ? "Карточка уже есть — создадим аккаунт и вход."
                    : `Заведётся карточка «стажёр» (в графике и операторах)${canGrant ? " и аккаунт: человек видит только обучение" : " — аккаунт для входа потом выдаст РОП"}. «Принять в штат» переведёт эту же карточку в операторы.`}
                </div>
                {canGrant && (
                  <LoginFields login={grant.login} onLogin={(v) => setGrant({ ...grant, login: v })} password={grant.password} onPassword={(v) => setGrant({ ...grant, password: v })} autoFocus />
                )}
                {!op && (
                  <div className="grid2">
                    <Field label="Группа">
                      <Select
                        value={grant.groupId}
                        options={access.isHead ? [{ value: "", label: "Без группы", icon: dot("gray") }, ...own] : own}
                        onChange={(v) => setGrant({ ...grant, groupId: v })}
                        ariaLabel="Группа"
                      />
                    </Field>
                    <Field label="Начало обучения" hint="С этого дня — в графике">
                      <DateInput value={grant.date} onChange={(v) => setGrant({ ...grant, date: v || today })} ariaLabel="Начало обучения" />
                    </Field>
                  </div>
                )}
                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-sm" onClick={() => setGrant(null)}>
                    Отмена
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void doGrant()} disabled={busy}>
                    <Icon name="check" size={13} /> {canGrant ? "Выдать доступ" : "Завести карточку стажёра"}
                  </button>
                </div>
              </>
            ) : (
              <div className="row" style={{ gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-sub)" }}>
                  {op ? "Карточка стажёра есть, аккаунта нет." : "Идёт на обучение? Выдайте доступ — карточка стажёра и вход заведутся одним шагом."}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setGrant({
                      login: f.contact.includes("@") ? f.contact.trim() : "",
                      password: "",
                      groupId: f.groupId ?? (access.isHead ? "" : groups[0]?.id ?? ""),
                      date: f.trainingAt || today,
                    })
                  }
                >
                  <Icon name="userPlus" size={13} /> Выдать доступ
                </button>
              </div>
            )}
          </div>
        )}

        {cand && !hired && canEdit && (
          <div className="hire-box">
            {hire ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Принять в штат</div>
                <div style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
                  {op
                    ? `Карточка «${op.name}» станет оператором — новая не заводится, смены и обучение остаются. С даты приёма считаются стажировка, план и стаж; смены раньше неё в часы и зарплату не попадут.`
                    : hire.linkTo
                      ? "Кандидат привяжется к существующей карточке — она станет оператором."
                      : "Заведётся карточка оператора с датой приёма — с неё считаются стажировка, план и стаж. Схема оплаты — по умолчанию из настроек."}
                </div>
                <div className="grid2" style={{ marginTop: 4 }}>
                  <Field label="Дата приёма">
                    <DateInput value={hire.date} onChange={(v) => setHire({ ...hire, date: v })} ariaLabel="Дата приёма" />
                  </Field>
                  <Field label="Группа">
                    <Select
                      value={hire.groupId}
                      options={access.isHead ? [{ value: "", label: "Без группы", icon: dot("gray") }, ...own] : own}
                      onChange={(v) => setHire({ ...hire, groupId: v })}
                      ariaLabel="Группа"
                    />
                  </Field>
                </div>
                {!op && namesakes.length > 0 && (
                  <Field label="Карточка" hint="Такое ФИО уже есть в сотрудниках — если это он(а), привяжите, чтобы не было дубля">
                    <Select
                      value={hire.linkTo}
                      options={[
                        ...namesakes.map((o) => ({
                          value: o.id,
                          label: `${o.name} — существующая`,
                          hint: `${o.role === "trainee" ? "стажёр" : "оператор"}, ${o.groupId ? data.groups.find((g) => g.id === o.groupId)?.name ?? "" : "без группы"}`,
                        })),
                        { value: "", label: "Новая карточка", hint: "это другой человек" },
                      ]}
                      onChange={(v) => setHire({ ...hire, linkTo: v })}
                      ariaLabel="Карточка"
                    />
                  </Field>
                )}
                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-sm" onClick={() => setHire(null)}>
                    Отмена
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void doHire()} disabled={busy}>
                    <Icon name="check" size={13} /> Принять
                  </button>
                </div>
              </>
            ) : (
              <div className="row" style={{ gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-sub)" }}>
                  {op ? "Прошёл обучение? Примите в штат — карточка стажёра станет оператором." : "Прошёл отбор и обучение? Примите в штат — появится карточка оператора."}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() =>
                    setHire({
                      date: op?.hireDate || today,
                      groupId: op?.groupId ?? f.groupId ?? (access.isHead ? "" : groups[0]?.id ?? ""),
                      linkTo: namesakes[0]?.id ?? "",
                    })
                  }
                >
                  <Icon name="userPlus" size={13} /> Принять в штат
                </button>
              </div>
            )}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function uniq(list: string[]): string[] {
  const seen = new Map<string, string>();
  for (const s of list) {
    const t = s.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "ru"));
}
