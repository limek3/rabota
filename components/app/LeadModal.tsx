"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useCrm, type LeadPreset } from "@/lib/crm/store";
import type { Lead, LeadStatus } from "@/lib/crm/types";
import { LEAD_SOURCE, LEAD_STATUSES, LEAD_STATUS_HUE, LEAD_STATUS_LABEL, NO_GROUP_LABEL } from "@/lib/crm/types";
import { Avatar, Field, LeadStatusChip, Modal } from "@/components/ui/kit";
import { DateTimeInput, Select, dot, type Opt } from "@/components/ui/select";
import { canCreateLeadFor, canEditLead, canReviewLead } from "@/lib/crm/access";
import { Icon, type IconName } from "@/components/ui/icons";
import { findDuplicate } from "@/lib/crm/calc";
import { fmtPhone, normLink, normPhone } from "@/lib/crm/format";
import { fmtStamp, nowStamp } from "@/lib/crm/dates";
import { hasLeadLinkColumn } from "@/lib/crm/remote";

const LAST_OP = "leadup.lastOperator";
const LAST_PR = "leadup.lastProject";

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export function LeadModal({ lead, preset }: { lead: Lead | null; preset?: LeadPreset }) {
  const { data, full, ix, closeModal, saveLead, setLeadStatus, deleteLead, confirm, toast, access, me, remote } = useCrm();
  // в Supabase ещё нет колонки для ссылки (не выполнен SQL) — предупреждаем у самого поля
  const linkNotStored = remote && !hasLeadLinkColumn();
  const s = data.settings;
  // в списке — только те, за кого этот аккаунт может записывать лиды
  const liveOps = useMemo(
    () =>
      data.operators
        .filter((o) => !o.deletedAt && o.status !== "fired" && canCreateLeadFor(access, o.id))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [data.operators, access],
  );
  const liveProjects = useMemo(() => data.projects.filter((p) => !p.deletedAt && p.active).sort((a, b) => a.sort - b.sort), [data.projects]);

  const initOp = () => {
    if (lead) return lead.operatorId;
    if (access.isOp && access.opId) return access.opId;
    if (preset?.operatorId) return preset.operatorId;
    const last = remembered(LAST_OP);
    if (last && liveOps.some((o) => o.id === last)) return last;
    return liveOps.length === 1 ? liveOps[0].id : "";
  };
  const initPr = () => {
    if (lead) return lead.projectId ?? "";
    if (preset?.projectId) return preset.projectId;
    const def = me.prefs.defaultProjectId;
    if (def && liveProjects.some((p) => p.id === def)) return def;
    const last = remembered(LAST_PR);
    if (last && liveProjects.some((p) => p.id === last)) return last;
    return liveProjects.length === 1 ? liveProjects[0].id : "";
  };

  const [operatorId, setOperatorId] = useState(initOp);
  const [projectId, setProjectId] = useState(initPr);
  const [client, setClient] = useState(lead?.client ?? preset?.client ?? "");
  const [phone, setPhone] = useState(lead ? fmtPhone(lead.phone) : preset?.phone ?? "");
  const [direction, setDirection] = useState(lead?.direction ?? preset?.direction ?? "");
  const [comment, setComment] = useState(lead?.comment ?? "");
  const [link, setLink] = useState(lead?.link ?? preset?.link ?? "");
  const [at, setAt] = useState(lead?.at ?? preset?.at ?? nowStamp());
  // время нового лида, которое не трогали руками, берётся в момент записи, а не открытия окна
  const [atTouched, setAtTouched] = useState(!!lead || !!preset?.at);
  // оператор время не выбирает: его ставит система по серверу (МСК)
  const timeLocked = access.isOp;
  const [groupId, setGroupId] = useState<string>(lead ? lead.groupId ?? "" : "");
  const [status, setStatus] = useState<LeadStatus>(preset?.status ?? lead?.status ?? "work");
  const [reason, setReason] = useState(lead?.statusReason ?? "");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);

  // оператор из списка ушёл (удалён/уволен) — в режиме правки всё равно показываем его
  const opOptions = useMemo(() => {
    if (lead && !liveOps.some((o) => o.id === lead.operatorId)) {
      const o = ix.opById.get(lead.operatorId);
      if (o) return [...liveOps, o];
    }
    return liveOps;
  }, [lead, liveOps, ix]);
  const projectOptions = useMemo(() => {
    if (lead?.projectId && !liveProjects.some((p) => p.id === lead.projectId)) {
      const p = data.projects.find((x) => x.id === lead.projectId);
      if (p) return [...liveProjects, p];
    }
    return liveProjects;
  }, [lead, liveProjects, data.projects]);

  const opOpts = useMemo<Opt[]>(
    () =>
      opOptions.map((o) => ({
        value: o.id,
        label: o.name,
        hint: [o.groupId ? ix.groupById.get(o.groupId)?.name ?? "" : "без группы", o.deletedAt ? "удалён" : o.status === "fired" ? "уволен" : ""].filter(Boolean).join(" · "),
        icon: <Avatar name={o.name} id={o.id} size={20} />,
      })),
    [opOptions, ix],
  );
  const projectOpts = useMemo<Opt[]>(
    () => projectOptions.map((p) => ({ value: p.id, label: p.name + (p.deletedAt ? " (удалён)" : ""), icon: dot(p.color) })),
    [projectOptions],
  );
  const groupOpts = useMemo<Opt[]>(
    () => [
      { value: "", label: NO_GROUP_LABEL, icon: dot("gray") },
      ...data.groups
        .filter((g) => !g.deletedAt || g.id === lead?.groupId)
        .map((g) => ({ value: g.id, label: g.name + (g.deletedAt ? " (удалена)" : ""), icon: dot(g.color) })),
    ],
    [data.groups, lead?.groupId],
  );

  const directions = useMemo(() => {
    if (!s.directionEnabled) return [];
    const seen = new Map<string, number>();
    for (let i = data.leads.length - 1; i >= 0 && seen.size < 60; i--) {
      const d = data.leads[i].direction;
      if (d && !seen.has(d)) seen.set(d, i);
    }
    return Array.from(seen.keys());
  }, [data.leads, s.directionEnabled]);

  // причины, которые уже писали, — подсказки, чтобы формулировки не расходились
  const reasons = useMemo(() => {
    const seen = new Set<string>();
    for (let i = data.leads.length - 1; i >= 0 && seen.size < 40; i--) {
      const l = data.leads[i];
      if (l.status === "failed" && l.statusReason) seen.add(l.statusReason);
    }
    return Array.from(seen);
  }, [data.leads]);

  const phoneNorm = normPhone(phone);
  const dup = useMemo(
    () => (phoneNorm.length >= 10 ? findDuplicate(data.leads, phoneNorm, at, s.duplicateDays, lead?.id) : null),
    [data.leads, phoneNorm, at, s.duplicateDays, lead?.id],
  );

  const errOp = !operatorId ? "Выберите оператора" : null;
  const errPr = liveProjects.length > 0 && !projectId ? "Выберите проект" : null;
  // новый лид — только полный: клиент, телефон, ссылка. Старые записи без них правятся как раньше
  const isNew = !lead;
  const linkNorm = normLink(link);
  const errContact = isNew ? (!client.trim() ? "Укажите имя клиента" : null) : !client.trim() && !phoneNorm ? "Укажите имя клиента или телефон" : null;
  const errPhone = isNew
    ? !phone.trim()
      ? "Укажите телефон"
      : phoneNorm.length < 10
        ? "Номер неполный"
        : null
    : phone.trim() && phoneNorm.length < 6
      ? "Слишком короткий номер"
      : null;
  const errLink = link.trim() && !linkNorm ? "Не похоже на ссылку — вставьте адрес целиком" : isNew && !linkNorm ? "Вставьте ссылку на лид" : null;
  const errAt = timeLocked
    ? null
    : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)
      ? "Укажите дату и время"
      : atTouched && at > nowStamp()
        ? "Время позже текущего (МСК)"
        : null;
  const missing = isNew ? [!client.trim() && "клиент", phoneNorm.length < 10 && "телефон", !linkNorm && "ссылка"].filter(Boolean) : [];
  const canReview = !!lead && canReviewLead(access, lead);
  const errReason = canReview && status === "failed" && !reason.trim() ? "Укажите причину" : null;
  const statusChanged = !!lead && (status !== lead.status || (status === "failed" && reason.trim() !== lead.statusReason));
  const invalid = !!(errOp || errPr || errContact || errPhone || errLink || errAt || errReason);

  const submit = async (more: boolean) => {
    setTried(true);
    if (busy) return;
    // проверяющий без прав на правку полей — сохраняем только статус
    if (lead && readOnly) {
      if (errReason) return;
      if (statusChanged) {
        setBusy(true);
        const n = await setLeadStatus([lead.id], status, reason);
        setBusy(false);
        if (!n) return;
        toast(`Статус: ${LEAD_STATUS_LABEL[status]}`);
      }
      closeModal();
      return;
    }
    if (invalid) return;
    setBusy(true);
    const saved = await saveLead({
      id: lead?.id,
      at: atTouched ? at : nowStamp(),
      link,
      client,
      phone,
      projectId: projectId || null,
      operatorId,
      direction: s.directionEnabled ? direction : lead?.direction ?? "",
      comment,
      ...(lead ? { groupId: groupId || null } : {}),
    });
    if (saved && lead && canReview && statusChanged) await setLeadStatus([lead.id], status, reason);
    setBusy(false);
    if (!saved) return;
    remember(LAST_OP, operatorId);
    if (projectId) remember(LAST_PR, projectId);
    if (more && !lead) {
      setAdded((n) => n + 1);
      toast(`Лид записан: ${ix.opById.get(operatorId)?.name ?? ""}`);
      setClient("");
      setPhone("");
      setComment("");
      setDirection("");
      setLink("");
      setAt(nowStamp());
      setAtTouched(false);
      setTried(false);
      clientRef.current?.focus();
      return;
    }
    toast(lead ? "Лид изменён" : "Лид записан — показатели обновлены");
    closeModal();
  };

  const canDelete = !!lead && canEditLead(access, lead, full, true);
  const readOnly = !!lead && !canEditLead(access, lead, full);

  const onDelete = async () => {
    if (!lead) return;
    const ok = await confirm({ title: "Удалить лид?", text: "Удаляйте только ошибочно внесённые записи. Лид пропадёт из всех показателей.", ok: "Удалить", danger: true });
    if (!ok) return;
    await deleteLead(lead.id);
    closeModal();
  };

  const noOps = liveOps.length === 0 && !lead;

  return (
    <Modal
      title={lead ? "Лид" : "Передан лид"}
      onClose={closeModal}
      width={560}
      footer={
        noOps ? (
          <button className="btn" onClick={closeModal}>
            Закрыть
          </button>
        ) : (
          <>
            {canDelete && (
              <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: "auto" }}>
                <Icon name="trash" size={14} /> Удалить
              </button>
            )}
            {!lead && added > 0 && <span style={{ marginRight: "auto", fontSize: 12, color: "var(--dim)" }}>Записано в этой серии: {added}</span>}
            <button className="btn" onClick={closeModal}>
              Отмена
            </button>
            {!lead && (
              <button className="btn" onClick={() => void submit(true)} disabled={busy} title="Сохранить и сразу ввести следующий">
                Сохранить и ещё
              </button>
            )}
            {(!readOnly || canReview) && (
              <button className="btn btn-primary" onClick={() => void submit(false)} disabled={busy} title="Ctrl+Enter">
                {!lead ? "Записать лид" : statusChanged ? `Сохранить · «${LEAD_STATUS_LABEL[status]}»` : "Сохранить"}
              </button>
            )}
          </>
        )
      }
    >
      {noOps ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.55 }}>
          {access.isOp
            ? "Ваш аккаунт не привязан к карточке оператора или запись лидов для операторов выключена. Обратитесь к руководителю."
            : "Сначала добавьте хотя бы одного активного оператора (в вашей зоне) — лид всегда привязан к оператору, который его передал."}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit(false);
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {lead &&
            (canReview ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 10, background: "var(--bg-strip)", border: "1px solid var(--ink-07)" }}>
                <Field label="Статус лида">
                  <StatusPicker value={status} current={lead.status} onChange={setStatus} />
                </Field>
                {statusChanged && status !== lead.status && (
                  <div className="st-change" data-hue={LEAD_STATUS_HUE[status]}>
                    <Icon name="arrowR" size={14} />
                    <span>
                      <b>{LEAD_STATUS_LABEL[lead.status]}</b> → <b>{LEAD_STATUS_LABEL[status]}</b>. {STATUS_EFFECT[lead.status][status]} Применится после «Сохранить».
                    </span>
                  </div>
                )}
                {status === "failed" && (
                  <Field label="Причина — почему не доведён" error={tried ? errReason : null}>
                    <input
                      className="inp"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      list="lead-fail-reasons"
                      placeholder="Обязательно"
                      autoFocus={preset?.status === "failed"}
                      aria-invalid={tried && !!errReason}
                    />
                    <datalist id="lead-fail-reasons">
                      {reasons.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </Field>
                )}
                <StatusStamp lead={lead} />
              </div>
            ) : (
              <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                <LeadStatusChip lead={lead} />
                {lead.status === "failed" && lead.statusReason && <span>Причина: {lead.statusReason}</span>}
                {lead.statusBy && <span style={{ color: "var(--dim)" }}>· {lead.statusBy}{lead.statusAt ? `, ${fmtStamp(lead.statusAt)} МСК` : ""}</span>}
              </div>
            ))}
          <div className="grid2">
            <Field label="Оператор" error={tried ? errOp : null}>
              <Select
                value={operatorId}
                options={opOpts}
                onChange={(v) => {
                  setOperatorId(v);
                  // при правке: лид другого оператора — и группа его
                  if (lead) setGroupId(ix.opById.get(v)?.groupId ?? "");
                }}
                disabled={access.isOp || readOnly}
                autoFocus={!operatorId}
                invalid={tried && !!errOp}
                ariaLabel="Оператор"
                minPopWidth={320}
              />
            </Field>
            <Field label="Проект" error={tried ? errPr : null} hint={liveProjects.length === 0 ? "Справочник проектов пуст — заполните в «Проектах»" : undefined}>
              <Select value={projectId} options={projectOpts} onChange={setProjectId} invalid={tried && !!errPr} ariaLabel="Проект" disabled={readOnly} />
            </Field>
          </div>
          <div className="grid2">
            <Field label={isNew ? <Req>Клиент</Req> : "Клиент"} error={tried ? errContact : null}>
              <input ref={clientRef} className="inp" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Имя клиента" autoFocus={!!operatorId && preset?.status !== "failed"} />
            </Field>
            <Field
              label={isNew ? <Req>Телефон</Req> : "Телефон"}
              error={tried ? errPhone : null}
              hint={
                dup ? (
                  <span style={{ color: "var(--c-amber-fg)" }}>
                    Этот номер уже передавали {fmtStamp(dup.at)} ({ix.opById.get(dup.operatorId)?.name ?? "—"}). Проверьте, не дубль ли.
                  </span>
                ) : undefined
              }
            >
              <input
                className="inp"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => phoneNorm.length === 11 && setPhone(fmtPhone(phoneNorm))}
                placeholder="+7 900 000-00-00"
                inputMode="tel"
                aria-invalid={tried && !!errPhone}
              />
            </Field>
          </div>
          <Field
            label={isNew ? <Req>Ссылка на лид</Req> : "Ссылка на лид"}
            error={tried ? errLink : null}
            hint={
              linkNotStored ? (
                <span style={{ color: "var(--c-red-fg)" }}>Ссылка пока не сохраняется: руководителю нужно выполнить в Supabase файл 20260925000001_lead_link_time.sql</span>
              ) : !tried || !errLink ? (
                "Карточка лида в CRM заказчика или запись звонка — чтобы супервайзер проверил в один клик"
              ) : undefined
            }
          >
            <div className="lead-link">
              <Icon name="link" size={15} />
              <input
                className="inp"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onBlur={() => linkNorm && setLink(linkNorm)}
                placeholder="https://…"
                inputMode="url"
                spellCheck={false}
                aria-invalid={tried && !!errLink}
                readOnly={readOnly}
              />
              {linkNorm && (
                <a className="btn btn-sm btn-ghost" href={linkNorm} target="_blank" rel="noreferrer noopener" title="Открыть в новой вкладке">
                  Открыть <Icon name="arrowR" size={12} />
                </a>
              )}
            </div>
          </Field>
          <div className="grid2">
            {s.directionEnabled && (
              <Field label={s.directionLabel || "Направление"}>
                <input className="inp" value={direction} onChange={(e) => setDirection(e.target.value)} list="lead-directions" placeholder="Необязательно" />
                <datalist id="lead-directions">
                  {directions.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
            )}
            {timeLocked ? (
              <Field label="Время передачи, МСК" hint={lead ? "Время записи менять нельзя" : "Ставится само в момент записи — по серверу, не по часам компьютера"}>
                <div className="lead-time">
                  <Icon name="clock" size={14} />
                  {lead ? fmtStamp(lead.at) : `сейчас ${nowStamp().slice(11)}`}
                </div>
              </Field>
            ) : (
              <Field label="Дата и время передачи, МСК" error={tried ? errAt : null} hint={!lead && !atTouched ? "Не меняли — запишется время сохранения" : undefined}>
                <DateTimeInput
                  value={at}
                  onChange={(v) => {
                    setAt(v);
                    setAtTouched(true);
                  }}
                  max={nowStamp().slice(0, 10)}
                />
              </Field>
            )}
            {lead && (
              <Field label="Группа на момент передачи" hint="Меняется сама, если сменить оператора">
                <Select value={groupId} options={groupOpts} onChange={setGroupId} ariaLabel="Группа" disabled={readOnly || access.isOp} />
              </Field>
            )}
          </div>
          <Field label="Комментарий оператора">
            <textarea className="inp" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Что важно знать менеджеру" />
          </Field>
          {missing.length > 0 && (
            <div className="lead-missing">
              <Icon name="alert" size={13} /> Чтобы записать лид, заполните: {missing.join(", ")}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--dim)" }}>
            Источник: {LEAD_SOURCE}. {lead ? "" : "Новый лид попадает в статус «в работе» — доведён он или нет, отмечает супервайзер."}
            {readOnly && (canReview ? " Поля лида менять нельзя — только статус." : " Изменить эту запись нельзя: у вашего аккаунта нет прав или истекло время на исправление.")}
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

/* ── статус лида: выбор карточками, что он значит и кто его поставил ── */

const STATUS_META: Record<LeadStatus, { icon: IconName; hint: string }> = {
  work: { icon: "clock", hint: "Передан, менеджер ещё работает. В факте и в оплате, пока не отклонён" },
  done: { icon: "check", hint: "Менеджер подтвердил. В факте и в оплате оператора" },
  failed: { icon: "close", hint: "Сорвался. Уходит из факта и из оплаты, нужна причина" },
};

/** Что изменится для оператора при смене статуса: было → станет. */
const STATUS_EFFECT: Record<LeadStatus, Record<LeadStatus, string>> = {
  work: { work: "", done: "Лид останется в факте и в оплате.", failed: "Лид уйдёт из факта и из оплаты оператора." },
  done: { done: "", work: "Лид останется в факте, но снова ждёт проверки.", failed: "Лид уйдёт из факта и из оплаты оператора." },
  failed: { failed: "", work: "Лид вернётся в факт и в оплату.", done: "Лид вернётся в факт и в оплату." },
};

function StatusPicker({ value, current, onChange }: { value: LeadStatus; current: LeadStatus; onChange: (s: LeadStatus) => void }) {
  return (
    <div className="st-pick" role="radiogroup" aria-label="Статус лида">
      {LEAD_STATUSES.map((st) => (
        <button
          key={st}
          type="button"
          role="radio"
          aria-checked={value === st}
          className="st-opt"
          data-hue={LEAD_STATUS_HUE[st]}
          onClick={() => onChange(st)}
        >
          <span className="st-opt-ico">
            <Icon name={STATUS_META[st].icon} size={15} stroke={2.2} />
          </span>
          <span className="st-opt-title">
            {LEAD_STATUS_LABEL[st]}
            {st === current && <em>сейчас</em>}
          </span>
          <span className="st-opt-hint">{STATUS_META[st].hint}</span>
        </button>
      ))}
    </div>
  );
}

/** «Доведён — поставил Оленчук Борис, 24.09.2026 14:05 МСК». */
function StatusStamp({ lead }: { lead: Lead }) {
  if (!lead.statusBy && !lead.statusAt) return <div className="st-stamp">Статус ещё не меняли — лид «В работе» с момента записи</div>;
  return (
    <div className="st-stamp">
      Сейчас <b>«{LEAD_STATUS_LABEL[lead.status]}»</b>
      {lead.statusBy && (
        <>
          {" "}— поставил(а) <b>{lead.statusBy}</b>
        </>
      )}
      {lead.statusAt && <>, {fmtStamp(lead.statusAt)} МСК</>}
    </div>
  );
}

/** Подпись обязательного поля. */
function Req({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="req" aria-hidden>
        *
      </span>
    </>
  );
}
