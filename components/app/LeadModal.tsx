"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCrm, type LeadPreset } from "@/lib/crm/store";
import type { Lead, LeadStatus } from "@/lib/crm/types";
import { LEAD_SOURCE, LEAD_STATUSES, LEAD_STATUS_HUE, LEAD_STATUS_LABEL, NO_GROUP_LABEL } from "@/lib/crm/types";
import { Avatar, Chip, Modal, RegionTag } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canCreateLeadFor, canEditLead, canReviewLead } from "@/lib/crm/access";
import { Icon, type IconName } from "@/components/ui/icons";
import { findDuplicate } from "@/lib/crm/calc";
import { SKOROZVON_LINK_EXAMPLE, fmtPhone, isSkorozvonLink, normLink, normPhone, shortName, skorozvonLinkPhone } from "@/lib/crm/format";
import { fmtDate, fmtDay, fmtStamp, nowStamp } from "@/lib/crm/dates";
import { hasLeadLinkColumn, hasLeadRegionColumn } from "@/lib/crm/remote";
import { SEGMENT_LABEL, regionSegment } from "@/lib/crm/regions";
import { DialogView, mmss, useLeadDialog } from "./LeadDialog";

/**
 * Лид в новом виде. Одна логика (useLeadDraft) — два места:
 *  • LeadPanel — панель справа на странице «Лиды»: сверху действия СВ (статус, Скорозвон),
 *    ниже данные лида (правятся на месте, «Сохранить» появляется, когда что-то поменяли);
 *  • LeadModal — попап: новый лид (оператор записывает передачу) или лид, открытый с другой страницы.
 * Прежнее окно — LeadModalClassic.tsx.
 */

const LAST_OP = "leadup.lastOperator";
const LAST_PR = "leadup.lastProject";
const LAST_RG = "leadup.lastRegion";

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

const STATUS_META: Record<LeadStatus, { icon: IconName; hint: string }> = {
  work: { icon: "clock", hint: "Менеджер ещё работает. В факте и в оплате, пока не отклонён" },
  done: { icon: "check", hint: "Менеджер подтвердил. В факте и в оплате оператора" },
  failed: { icon: "close", hint: "Сорвался. Уходит из факта и из оплаты, нужна причина" },
};

/** Что изменится для оператора при смене статуса: было → станет. */
const STATUS_EFFECT: Record<LeadStatus, Record<LeadStatus, string>> = {
  work: { work: "", done: "Лид останется в факте и в оплате.", failed: "Лид уйдёт из факта и из оплаты оператора." },
  done: { done: "", work: "Лид останется в факте, но снова ждёт проверки.", failed: "Лид уйдёт из факта и из оплаты оператора." },
  failed: { failed: "", work: "Лид вернётся в факт и в оплату.", done: "Лид вернётся в факт и в оплату." },
};

/* ════════════════════════════════════════════════════════════════════
   Черновик лида: поля, проверки, сохранение, удаление
   ════════════════════════════════════════════════════════════════════ */

function useLeadDraft(lead: Lead | null, preset?: LeadPreset) {
  const { data, full, ix, saveLead, deleteLead, confirm, toast, access, me, remote } = useCrm();
  const s = data.settings;
  const liveOps = useMemo(
    () =>
      data.operators
        .filter((o) => !o.deletedAt && o.status !== "fired" && canCreateLeadFor(access, o.id))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    [data.operators, access],
  );
  const liveProjects = useMemo(() => data.projects.filter((p) => !p.deletedAt && p.active).sort((a, b) => a.sort - b.sort), [data.projects]);
  const regionList = useMemo(() => [...s.regions.main, ...s.regions.regional], [s.regions]);

  const [operatorId, setOperatorId] = useState(() => {
    if (lead) return lead.operatorId;
    if (access.isOp && access.opId) return access.opId;
    if (preset?.operatorId) return preset.operatorId;
    const last = remembered(LAST_OP);
    if (last && liveOps.some((o) => o.id === last)) return last;
    return liveOps.length === 1 ? liveOps[0].id : "";
  });
  const [projectId, setProjectId] = useState(() => {
    if (lead) return lead.projectId ?? "";
    if (preset?.projectId) return preset.projectId;
    const def = me.prefs.defaultProjectId;
    if (def && liveProjects.some((p) => p.id === def)) return def;
    const last = remembered(LAST_PR);
    if (last && liveProjects.some((p) => p.id === last)) return last;
    return liveProjects.length === 1 ? liveProjects[0].id : "";
  });
  const [client, setClient] = useState(lead?.client ?? preset?.client ?? "");
  const [phone, setPhone] = useState(lead ? fmtPhone(lead.phone) : preset?.phone ?? "");
  const [comment, setComment] = useState(lead?.comment ?? "");
  const [link, setLink] = useState(lead?.link ?? preset?.link ?? "");
  const [region, setRegion] = useState(() => {
    if (lead) return lead.region ?? "";
    if (preset?.region) return preset.region;
    const last = remembered(LAST_RG);
    return last && regionList.includes(last) ? last : "";
  });
  const [groupId, setGroupId] = useState<string>(lead ? lead.groupId ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [added, setAdded] = useState(0);
  // номер, который подставили из ссылки: новая ссылка его заменит, вписанный руками — нет
  const autoPhone = useRef("");

  const reset = () => {
    if (!lead) return;
    setOperatorId(lead.operatorId);
    setProjectId(lead.projectId ?? "");
    setClient(lead.client);
    setPhone(fmtPhone(lead.phone));
    setComment(lead.comment);
    setLink(lead.link ?? "");
    setRegion(lead.region ?? "");
    setGroupId(lead.groupId ?? "");
    setTried(false);
  };

  // оператор из списка ушёл (удалён/уволен) — в режиме правки всё равно показываем его
  const opOpts = useMemo<Opt[]>(() => {
    const list = [...liveOps];
    if (lead && !list.some((o) => o.id === lead.operatorId)) {
      const o = ix.opById.get(lead.operatorId);
      if (o) list.push(o);
    }
    return list.map((o) => ({
      value: o.id,
      label: shortName(o.name),
      hint: [o.groupId ? ix.groupById.get(o.groupId)?.name ?? "" : "без группы", o.deletedAt ? "удалён" : o.status === "fired" ? "уволен" : ""].filter(Boolean).join(" · "),
      icon: <Avatar name={o.name} id={o.id} size={20} />,
    }));
  }, [lead, liveOps, ix]);
  const projectOpts = useMemo<Opt[]>(() => {
    const list = [...liveProjects];
    if (lead?.projectId && !list.some((p) => p.id === lead.projectId)) {
      const p = data.projects.find((x) => x.id === lead.projectId);
      if (p) list.push(p);
    }
    return list.map((p) => ({ value: p.id, label: p.name + (p.deletedAt ? " (удалён)" : ""), icon: dot(p.color) }));
  }, [lead, liveProjects, data.projects]);
  const groupOpts = useMemo<Opt[]>(
    () => [
      { value: "", label: NO_GROUP_LABEL, icon: dot("gray") },
      ...data.groups
        .filter((g) => !g.deletedAt || g.id === lead?.groupId)
        .map((g) => ({ value: g.id, label: g.name + (g.deletedAt ? " (удалена)" : ""), icon: dot(g.color) })),
    ],
    [data.groups, lead?.groupId],
  );
  const regionOpts = useMemo<Opt[]>(() => {
    const opts: Opt[] = [
      ...s.regions.main.map((r) => ({ value: r, label: r, group: "Основа", hint: SEGMENT_LABEL.main })),
      ...s.regions.regional.map((r) => ({ value: r, label: r, group: "Регионы", hint: SEGMENT_LABEL.regional })),
    ];
    // у старого лида регион могли убрать из списков — всё равно показываем его
    if (region && !regionList.includes(region)) opts.push({ value: region, label: region, group: "Прочее" });
    return opts;
  }, [s.regions, region, regionList]);

  const phoneNorm = normPhone(phone);
  const at = lead?.at ?? nowStamp();
  const dup = useMemo(
    () => (phoneNorm.length >= 10 ? findDuplicate(data.leads, phoneNorm, at, s.duplicateDays, lead?.id) : null),
    [data.leads, phoneNorm, at, s.duplicateDays, lead?.id],
  );

  // новый лид — только полный: клиент, телефон, ссылка, регион. Старые записи без них правятся как раньше
  const isNew = !lead;
  const linkNorm = normLink(link);
  const linkChanged = isNew || linkNorm !== (lead?.link ?? "");
  const linkPhone = skorozvonLinkPhone(linkNorm);
  const err = {
    op: !operatorId ? "Выберите оператора" : null,
    pr: liveProjects.length > 0 && !projectId ? "Выберите проект" : null,
    client: isNew ? (!client.trim() ? "Укажите имя клиента" : null) : !client.trim() && !phoneNorm ? "Укажите имя клиента или телефон" : null,
    phone: isNew
      ? !phone.trim()
        ? "Укажите телефон"
        : phoneNorm.length < 10
          ? "Номер неполный"
          : null
      : phone.trim() && phoneNorm.length < 6
        ? "Слишком короткий номер"
        : null,
    region: isNew && regionList.length > 0 && !region ? "Выберите регион" : null,
    link:
      link.trim() && !linkNorm
        ? "Не похоже на ссылку — вставьте адрес целиком"
        : isNew && !linkNorm
          ? "Вставьте ссылку на лид из Скорозвона"
          : linkNorm && linkChanged && !isSkorozvonLink(linkNorm)
            ? `Нужна ссылка из Скорозвона: ${SKOROZVON_LINK_EXAMPLE}`
            : linkNorm && linkPhone && phoneNorm.length >= 10 && linkPhone !== phoneNorm && (linkChanged || phoneNorm !== normPhone(lead?.phone ?? ""))
              ? `Ссылка от другого лида: в ней номер ${fmtPhone(linkPhone)}, а в лиде ${fmtPhone(phoneNorm)}`
              : null,
  };
  const invalid = Object.values(err).some(Boolean);
  const missing = isNew ? [!client.trim() && "клиент", phoneNorm.length < 10 && "телефон", !linkNorm && "ссылка", !!err.region && "регион"].filter(Boolean) : [];

  const dirty =
    !!lead &&
    (operatorId !== lead.operatorId ||
      projectId !== (lead.projectId ?? "") ||
      client !== lead.client ||
      phoneNorm !== normPhone(lead.phone) ||
      comment !== lead.comment ||
      linkNorm !== (lead.link ?? "") ||
      region !== (lead.region ?? "") ||
      groupId !== (lead.groupId ?? ""));

  const readOnly = !!lead && !canEditLead(access, lead, full);
  const canDelete = !!lead && canEditLead(access, lead, full, true);

  /** Сохранить поля. Новый лид: more — очистить форму под следующий. Возвращает, получилось ли. */
  const save = async (more = false): Promise<boolean> => {
    setTried(true);
    if (busy || invalid || readOnly) return false;
    setBusy(true);
    const saved = await saveLead({
      id: lead?.id,
      // время не выбирают: новый лид — «сейчас» по Москве (ставит сервер), при правке — прежнее
      at: lead?.at ?? nowStamp(),
      link,
      region,
      client,
      phone,
      projectId: projectId || null,
      operatorId,
      // «Город / ДЦ» больше не заполняют — город задаёт регион; старое значение у лида сохраняется
      direction: lead?.direction ?? "",
      comment,
      ...(lead ? { groupId: groupId || null } : {}),
    });
    setBusy(false);
    if (!saved) return false;
    remember(LAST_OP, operatorId);
    if (projectId) remember(LAST_PR, projectId);
    if (region) remember(LAST_RG, region);
    if (lead) {
      toast("Лид изменён");
      setTried(false);
      return true;
    }
    if (more) {
      setAdded((n) => n + 1);
      toast(`Лид записан: ${shortName(ix.opById.get(operatorId)?.name ?? "")}`);
      setClient("");
      setPhone("");
      setComment("");
      setLink("");
      setTried(false);
      return true;
    }
    toast("Лид записан — показатели обновлены");
    return true;
  };

  const remove = async (): Promise<boolean> => {
    if (!lead) return false;
    const ok = await confirm({ title: "Удалить лид?", text: "Удаляйте только ошибочно внесённые записи. Лид пропадёт из всех показателей.", ok: "Удалить", danger: true });
    if (!ok) return false;
    await deleteLead(lead.id);
    return true;
  };

  return {
    lead,
    isNew,
    s,
    remote,
    noOps: liveOps.length === 0 && !lead,
    noProjects: liveProjects.length === 0,
    f: { operatorId, projectId, client, phone, comment, link, region, groupId },
    set: {
      operatorId: (v: string) => {
        setOperatorId(v);
        // при правке: лид другого оператора — и группа его
        if (lead) setGroupId(ix.opById.get(v)?.groupId ?? "");
      },
      projectId: setProjectId,
      client: setClient,
      phone: setPhone,
      comment: setComment,
      link: (v: string) => {
        setLink(v);
        const p = skorozvonLinkPhone(normLink(v));
        if (p && (!phone.trim() || normPhone(phone) === autoPhone.current)) {
          autoPhone.current = p;
          setPhone(fmtPhone(p));
        }
      },
      region: setRegion,
      groupId: setGroupId,
    },
    opts: { op: opOpts, project: projectOpts, group: groupOpts, region: regionOpts },
    phoneNorm,
    linkNorm,
    linkPhone,
    dup,
    err,
    tried,
    missing,
    dirty,
    readOnly,
    canDelete,
    busy,
    added,
    save,
    remove,
    reset,
  };
}
type Draft = ReturnType<typeof useLeadDraft>;

/* ════════════════════════════════════════════════════════════════════
   Поля лида (общие для панели и попапа)
   ════════════════════════════════════════════════════════════════════ */

function F({ label, req, error, hint, children, wide }: { label: string; req?: boolean; error?: string | null; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`lf-f${wide ? " wide" : ""}`}>
      <span className="lf-l">
        {label}
        {req && <span className="req">*</span>}
      </span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function Sec({ icon, title, right, children }: { icon: IconName; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="lf-sec">
      <div className="l2-sec-t">
        <Icon name={icon} size={14} /> {title}
        {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
      </div>
      {children}
    </section>
  );
}

function LinkInput({ d }: { d: Draft }) {
  return (
    <div className="lead-link">
      <Icon name="link" size={15} />
      <input
        className="inp"
        value={d.f.link}
        onChange={(e) => d.set.link(e.target.value)}
        onBlur={() => d.linkNorm && d.set.link(d.linkNorm)}
        placeholder="https://app.skorozvon.ru/#/leads/…"
        inputMode="url"
        spellCheck={false}
        aria-invalid={d.tried && !!d.err.link}
        readOnly={d.readOnly}
      />
      {d.linkNorm && (
        <a className="btn btn-sm btn-ghost" href={d.linkNorm} target="_blank" rel="noreferrer noopener" title="Открыть в новой вкладке">
          Открыть <Icon name="arrowR" size={12} />
        </a>
      )}
    </div>
  );
}

function regionHint(d: Draft): ReactNode {
  if (d.remote && !hasLeadRegionColumn())
    return <span style={{ color: "var(--c-red-fg)" }}>Регион пока не сохраняется: руководителю нужно выполнить в Supabase файл 20260926000002_lead_region.sql</span>;
  if (!d.f.region) return undefined;
  return regionSegment(d.f.region, d.s) === "regional"
    ? `Регионы: апрув ${d.s.regions.regionalApprovePct}%, ${d.s.regions.regionalLeadRevenue.toLocaleString("ru-RU")} ₽ за лид`
    : "Основа: цена и апрув — как у проекта";
}

function dupHint(d: Draft, opName: (id: string) => string): ReactNode {
  if (!d.dup) return undefined;
  return (
    <span style={{ color: "var(--c-amber-fg)" }}>
      Номер уже передавали {fmtStamp(d.dup.at)} ({shortName(opName(d.dup.operatorId)) || "—"}). Не дубль ли?
    </span>
  );
}

/** Поля для правки: клиент, ссылка, оператор и проект, регион, группа, комментарий. */
function LeadFields({ d, compact }: { d: Draft; compact?: boolean }) {
  const { access, ix } = useCrm();
  const linkNotStored = d.remote && !hasLeadLinkColumn();
  const dh = dupHint(d, (id) => ix.opById.get(id)?.name ?? "");
  const linkSec = (
    <Sec icon="external" title="Лид в Скорозвоне">
      <F
        label="Ссылка на лид"
        req={d.isNew}
        wide
        // не та ссылка (не Скорозвон, чужой номер) — видно сразу после вставки
        error={d.tried || d.linkNorm ? d.err.link : null}
        hint={
          linkNotStored ? (
            <span style={{ color: "var(--c-red-fg)" }}>Ссылка пока не сохраняется: руководителю нужно выполнить в Supabase файл 20260925000001_lead_link_time.sql</span>
          ) : d.isNew ? (
            "Скопируйте адрес лида из Скорозвона — номер подставится сам"
          ) : undefined
        }
      >
        <LinkInput d={d} />
      </F>
    </Sec>
  );
  // новый лид: сначала ссылка из Скорозвона — номер из неё подставится сам
  return (
    <>
      {d.isNew && linkSec}
      <Sec icon="user" title="Клиент">
        <div className="lf-grid">
          <F label="Имя" req={d.isNew} error={d.tried ? d.err.client : null}>
            <input className="inp" value={d.f.client} onChange={(e) => d.set.client(e.target.value)} placeholder="Имя клиента" readOnly={d.readOnly} />
          </F>
          <F label="Телефон" req={d.isNew} error={d.tried ? d.err.phone : null} hint={dh}>
            <input
              className="inp"
              value={d.f.phone}
              onChange={(e) => d.set.phone(e.target.value)}
              onBlur={() => d.phoneNorm.length === 11 && d.set.phone(fmtPhone(d.phoneNorm))}
              placeholder="+7 900 000-00-00"
              inputMode="tel"
              aria-invalid={d.tried && !!d.err.phone}
              readOnly={d.readOnly}
            />
          </F>
        </div>
      </Sec>

      {!d.isNew && linkSec}

      <Sec icon="folder" title="Оператор, проект и регион">
        <div className="lf-grid">
          <F label="Оператор" wide error={d.tried ? d.err.op : null}>
            <Select value={d.f.operatorId} options={d.opts.op} onChange={d.set.operatorId} disabled={access.isOp || d.readOnly} invalid={d.tried && !!d.err.op} ariaLabel="Оператор" minPopWidth={300} />
          </F>
          <F label="Проект" error={d.tried ? d.err.pr : null} hint={d.noProjects ? "Справочник проектов пуст" : undefined}>
            <Select value={d.f.projectId} options={d.opts.project} onChange={d.set.projectId} invalid={d.tried && !!d.err.pr} ariaLabel="Проект" disabled={d.readOnly} />
          </F>
          <F label="Регион" req={d.isNew} error={d.tried ? d.err.region : null} hint={regionHint(d)}>
            <Select value={d.f.region} options={d.opts.region} onChange={d.set.region} invalid={d.tried && !!d.err.region} ariaLabel="Регион" disabled={d.readOnly} placeholder="Регион" minPopWidth={240} />
          </F>
          {d.lead ? (
            <F label="Группа на момент передачи" wide hint={compact ? undefined : "Меняется сама, если сменить оператора"}>
              <Select value={d.f.groupId} options={d.opts.group} onChange={d.set.groupId} ariaLabel="Группа" disabled={d.readOnly || access.isOp} />
            </F>
          ) : (
            <F label="Время передачи, МСК" wide hint="Ставится само в момент записи">
              <div className="lead-time">
                <Icon name="clock" size={14} />
                сейчас {nowStamp().slice(11)}
              </div>
            </F>
          )}
        </div>
      </Sec>

      <Sec icon="doc" title="Комментарий оператора">
        <textarea className="inp lf-ta" value={d.f.comment} onChange={(e) => d.set.comment(e.target.value)} rows={compact ? 2 : 3} placeholder="Что важно знать менеджеру" readOnly={d.readOnly} />
      </Sec>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Статус: быстрые действия СВ
   ════════════════════════════════════════════════════════════════════ */

/** Частые причины «не доведён» — по всем лидам, самые частые сверху. */
function useFailReasons(): string[] {
  const { data } = useCrm();
  return useMemo(() => {
    const cnt = new Map<string, number>();
    for (let i = data.leads.length - 1, seen = 0; i >= 0 && seen < 400; i--) {
      const l = data.leads[i];
      if (l.status !== "failed" || !l.statusReason.trim()) continue;
      seen++;
      const r = l.statusReason.trim();
      cnt.set(r, (cnt.get(r) ?? 0) + 1);
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([r]) => r);
  }, [data.leads]);
}

/**
 * Статус лида тремя кнопками. «В работе» и «Доведён» ставятся сразу, «Не доведён» — после причины.
 * failIntent — открыть сразу с причиной (из меню строки «Не доведён…»).
 */
function StatusActions({ lead, failIntent }: { lead: Lead; failIntent?: boolean }) {
  const { access, setLeadStatus, toast } = useCrm();
  const canReview = canReviewLead(access, lead);
  const reasons = useFailReasons();
  const [asking, setAsking] = useState(!!failIntent && canReview);
  const [reason, setReason] = useState(lead.status === "failed" ? lead.statusReason : "");
  const [busy, setBusy] = useState(false);
  const inpRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (asking) inpRef.current?.focus();
  }, [asking]);

  const apply = async (st: LeadStatus, why = "") => {
    if (busy) return;
    setBusy(true);
    const n = await setLeadStatus([lead.id], st, why);
    setBusy(false);
    if (!n) return;
    toast(`Статус: ${LEAD_STATUS_LABEL[st]}`);
    setAsking(false);
  };
  const pick = (st: LeadStatus) => {
    if (st === "failed") {
      setReason(lead.status === "failed" ? lead.statusReason : "");
      setAsking(true);
      return;
    }
    setAsking(false);
    if (st !== lead.status) void apply(st);
  };

  return (
    <div className="lf-status">
      {canReview ? (
        <div className="lf-st3" role="radiogroup" aria-label="Статус лида">
          {LEAD_STATUSES.map((st) => {
            const on = asking ? st === "failed" : lead.status === st;
            return (
              <button key={st} type="button" role="radio" aria-checked={on} data-hue={LEAD_STATUS_HUE[st]} className={on ? "on" : ""} onClick={() => pick(st)} disabled={busy} title={STATUS_META[st].hint}>
                <Icon name={STATUS_META[st].icon} size={14} stroke={2.4} />
                {LEAD_STATUS_LABEL[st]}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          <Chip hue={LEAD_STATUS_HUE[lead.status]} dot>
            {LEAD_STATUS_LABEL[lead.status]}
          </Chip>
          <span className="o2-muted">Статус ставит супервайзер группы или РОП</span>
        </div>
      )}

      {asking && (
        <div className="lf-why">
          {lead.status !== "failed" && (
            <div className="st-change" data-hue="red">
              <Icon name="arrowR" size={14} />
              <span>
                <b>{LEAD_STATUS_LABEL[lead.status]}</b> → <b>Не доведён</b>. {STATUS_EFFECT[lead.status].failed}
              </span>
            </div>
          )}
          <span className="lf-l">Почему не доведён</span>
          {reasons.length > 0 && (
            <div className="lf-reasons">
              {reasons.map((r) => (
                <button key={r} type="button" className={reason.trim() === r ? "on" : ""} onClick={() => setReason(r)} title={r}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inpRef}
            className="inp"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasons.length ? "Или впишите свою причину" : "Причина — обязательно"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && reason.trim()) void apply("failed", reason.trim());
              if (e.key === "Escape") {
                e.preventDefault();
                setAsking(false);
              }
            }}
          />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="o2-btn lf-danger" disabled={!reason.trim() || busy} onClick={() => void apply("failed", reason.trim())}>
              <Icon name="close" size={13} stroke={2.4} />
              {lead.status === "failed" ? "Сохранить причину" : "Не доведён"}
            </button>
            <button type="button" className="o2-btn ghost" onClick={() => setAsking(false)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {!asking && lead.status === "failed" && lead.statusReason && (
        <div className="lf-reason-now">
          <span className="o2-muted">Причина:</span> {lead.statusReason}
        </div>
      )}
      <div className="st-stamp">
        {lead.statusBy || lead.statusAt ? (
          <>
            «{LEAD_STATUS_LABEL[lead.status]}»{lead.statusBy && <> — поставил(а) <b>{lead.statusBy}</b></>}
            {lead.statusAt && <>, {fmtStamp(lead.statusAt)} МСК</>}
          </>
        ) : (
          "Статус ещё не меняли — «В работе» с момента записи"
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Карточка существующего лида: шапка → статус → вкладки «Разговор / Лид / История».
   Шапка и статус всегда на виду, листается только вкладка — больше не надо прокручивать
   форму, чтобы добраться до разговора, и наоборот.
   ════════════════════════════════════════════════════════════════════ */

type LcTab = "talk" | "info" | "hist";
const LAST_TAB = "leadup.leadTab";

function LeadCard({ lead, failIntent, onClose, variant }: { lead: Lead; failIntent?: boolean; onClose: () => void; variant: "side" | "modal" }) {
  const { data, ix, toast } = useCrm();
  const d = useLeadDraft(lead);
  const dlg = useLeadDialog(lead);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<LcTab>(() => {
    const last = remembered(LAST_TAB) as LcTab;
    if (last === "talk" || !last) return dlg.callId && dlg.available ? "talk" : "info";
    return last === "hist" ? "hist" : "info";
  });
  const pick = (t: LcTab) => {
    setTab(t);
    remember(LAST_TAB, t);
  };

  const op = ix.opById.get(lead.operatorId);
  const g = lead.groupId ? ix.groupById.get(lead.groupId) : null;
  const p = lead.projectId ? ix.projectById.get(lead.projectId) : null;
  const history = useLeadHistory(lead);

  const copyPhone = () => {
    const v = fmtPhone(lead.phone);
    if (!v) return;
    void navigator.clipboard?.writeText(v).then(
      () => toast("Номер скопирован"),
      () => {},
    );
  };
  const stopEdit = () => {
    d.reset();
    setEditing(false);
  };
  const saveEdit = async () => {
    if (await d.save()) setEditing(false);
  };

  const talkBadge =
    dlg.state === "busy" ? <span className="lc-spin sm" aria-label="готовится" /> : dlg.state === "done" && dlg.dlg?.callSec != null ? <span className="lc-tab-n num">{mmss(dlg.dlg.callSec)}</span> : dlg.state === "failed" ? <span className="lc-tab-n err">!</span> : null;

  return (
    <div className={`lc lc-${variant}`} onKeyDown={onCtrlEnter(() => editing && d.dirty && void saveEdit())}>
      {/* шапка: кто клиент и откуда лид */}
      <header className="lc-head">
        <div className="lc-id">
          <div className="lc-name">{lead.client || "Лид без имени"}</div>
          <div className="lc-meta">
            {lead.phone ? (
              <button type="button" className="lc-phone num" onClick={copyPhone} title="Скопировать номер">
                {fmtPhone(lead.phone)}
                <Icon name="copy" size={12} />
              </button>
            ) : (
              <span className="o2-muted">номер не указан</span>
            )}
            {lead.region && <RegionTag region={lead.region} />}
          </div>
        </div>
        {lead.link && (
          <a className="lc-ic" href={lead.link} target="_blank" rel="noreferrer noopener" title="Открыть в Скорозвоне">
            <Icon name="external" size={15} />
          </a>
        )}
        <button type="button" className="lc-ic" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="lc-line">
        <span>
          <Icon name="clock" size={12} /> {fmtDay(lead.at.slice(0, 10), true)}, {lead.at.slice(11, 16)}
        </span>
        <span>
          <Icon name="user" size={12} /> {op ? shortName(op.name) : "—"}
          {g && <span className="o2-muted"> · {g.name}</span>}
        </span>
        {p && <Chip hue={p.color}>{p.name}</Chip>}
      </div>

      {/* статус — главное действие супервайзера */}
      <div className="lc-status">
        <StatusActions key={`${lead.id}:${lead.status}:${lead.statusAt ?? ""}`} lead={lead} failIntent={failIntent} />
      </div>

      <nav className="lc-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "talk"} className={tab === "talk" ? "on" : ""} onClick={() => pick("talk")}>
          <Icon name="chat" size={13} /> Разговор {talkBadge}
        </button>
        <button type="button" role="tab" aria-selected={tab === "info"} className={tab === "info" ? "on" : ""} onClick={() => pick("info")}>
          <Icon name="doc" size={13} /> Лид {d.dirty && <span className="lc-tab-n">•</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "hist"} className={tab === "hist" ? "on" : ""} onClick={() => pick("hist")}>
          <Icon name="list" size={13} /> История <span className="lc-tab-n num">{history.length}</span>
        </button>
      </nav>

      <div className="lc-pane" role="tabpanel">
        {tab === "talk" && <DialogView lead={lead} d={dlg} note={lead.comment} />}

        {tab === "info" &&
          (editing ? (
            <div className="lf-body lc-edit">
              <LeadFields d={d} compact />
              {d.canDelete && (
                <button type="button" className="lc-link danger" onClick={async () => (await d.remove()) && onClose()}>
                  <Icon name="trash" size={12} /> Удалить ошибочную запись
                </button>
              )}
            </div>
          ) : (
            <LeadInfo lead={lead} canEdit={!d.readOnly} onEdit={() => setEditing(true)} dupHintNode={dupHint(d, (id) => ix.opById.get(id)?.name ?? "")} exported={data.leadExports[lead.id]} />
          ))}

        {tab === "hist" && <LeadHistory items={history} />}
      </div>

      {tab === "info" && editing && (
        <div className="lc-foot">
          <button type="button" className="o2-btn" onClick={stopEdit} disabled={d.busy}>
            Отмена
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="o2-btn pri" onClick={() => void saveEdit()} disabled={d.busy || !d.dirty} title="Ctrl+Enter">
            <Icon name="check" size={13} /> Сохранить
          </button>
        </div>
      )}
    </div>
  );
}

/** Вкладка «Лид»: всё о лиде строками, без полей ввода. Править — кнопкой. */
function LeadInfo({ lead, canEdit, onEdit, dupHintNode, exported }: { lead: Lead; canEdit: boolean; onEdit: () => void; dupHintNode: ReactNode; exported?: string }) {
  const { ix, data } = useCrm();
  const op = ix.opById.get(lead.operatorId);
  const g = lead.groupId ? ix.groupById.get(lead.groupId) : null;
  const p = lead.projectId ? ix.projectById.get(lead.projectId) : null;
  const seg = lead.region ? regionSegment(lead.region, data.settings) : null;
  const skId = lead.link.match(/#\/leads\/(\d+)/)?.[1];
  return (
    <div className="lc-info">
      <dl className="lc-dl">
        <dt>Клиент</dt>
        <dd>{lead.client || <span className="o2-muted">без имени</span>}</dd>
        <dt>Телефон</dt>
        <dd className="num">
          {fmtPhone(lead.phone) || <span className="o2-muted">не указан</span>}
          {dupHintNode && <div className="lc-hint">{dupHintNode}</div>}
        </dd>
        <dt>Регион</dt>
        <dd>{lead.region ? <>{lead.region} <span className="o2-muted">· {seg ? SEGMENT_LABEL[seg].toLowerCase() : ""}</span></> : <span className="o2-muted">не указан</span>}</dd>
        <dt>Проект</dt>
        <dd>{p ? <Chip hue={p.color}>{p.name}</Chip> : <span className="o2-muted">без проекта</span>}</dd>
        <dt>Оператор</dt>
        <dd>
          {op ? (
            <span className="lc-op">
              <Avatar name={op.name} id={op.id} size={18} /> {shortName(op.name)}
            </span>
          ) : (
            "—"
          )}
        </dd>
        <dt>Группа</dt>
        <dd>{g ? g.name : <span className="o2-muted">{NO_GROUP_LABEL}</span>}</dd>
        <dt>Передан</dt>
        <dd>
          {fmtDate(lead.at.slice(0, 10))} в {lead.at.slice(11, 16)} МСК
        </dd>
        <dt>Скорозвон</dt>
        <dd>
          {lead.link ? (
            <a className="lc-a" href={lead.link} target="_blank" rel="noreferrer noopener">
              лид {skId ?? ""} <Icon name="external" size={11} />
            </a>
          ) : (
            <span className="o2-muted">ссылки нет</span>
          )}
        </dd>
        {exported && (
          <>
            <dt>Выгружен</dt>
            <dd>{fmtStamp(exported)}</dd>
          </>
        )}
      </dl>

      <div className="lc-cm">
        <span className="lc-cap">Комментарий оператора</span>
        <div className={lead.comment ? "l2-note" : "l2-note o2-muted"}>{lead.comment || "Без комментария"}</div>
      </div>

      {canEdit ? (
        <button type="button" className="o2-btn lc-wide" onClick={onEdit}>
          <Icon name="edit" size={13} /> Изменить данные лида
        </button>
      ) : (
        <div className="o2-muted" style={{ fontSize: 11.5 }}>
          Менять лид нельзя: у вашего аккаунта нет прав или истекло время на исправление.
        </div>
      )}
    </div>
  );
}

type HistItem = { at: string; title: string; by?: string; changes?: { f: string; from: string; to: string }[]; hue?: "green" | "red" | "gray" };

/** События лида: запись, правки и статусы из журнала, выгрузка номера. Новые сверху. */
function useLeadHistory(lead: Lead): HistItem[] {
  const { data, ix } = useCrm();
  return useMemo(() => {
    const items: HistItem[] = [];
    const op = ix.opById.get(lead.operatorId);
    items.push({ at: lead.createdAt, title: "Лид записан", by: op ? shortName(op.name) : undefined, hue: "gray" });
    let statusLogged = false;
    for (const a of data.audit) {
      if (a.entity !== "lead" || !a.entityId.split(",").includes(lead.id)) continue;
      const isStatus = /^Статус/.test(a.summary);
      if (isStatus) statusLogged = true;
      const tail = a.summary.split(": ").slice(1).join(": ");
      items.push({
        at: a.at,
        title: isStatus ? `Статус: ${tail || "изменён"}` : /^Выгружены/.test(a.summary) ? "Номер выгружен" : "Данные изменены",
        by: a.accountName,
        changes: isStatus ? undefined : a.changes,
        hue: isStatus ? (/Не доведён/.test(tail) ? "red" : /Доведён/.test(tail) ? "green" : "gray") : undefined,
      });
    }
    if (!statusLogged && lead.statusAt)
      items.push({ at: lead.statusAt, title: `Статус: ${LEAD_STATUS_LABEL[lead.status]}`, by: lead.statusBy, hue: lead.status === "done" ? "green" : lead.status === "failed" ? "red" : "gray" });
    const exp = data.leadExports[lead.id];
    if (exp && !items.some((i) => i.title === "Номер выгружен")) items.push({ at: exp, title: "Номер выгружен" });
    // новые сверху; в одну минуту — в порядке, как случилось (записан → статус)
    return items
      .map((it, i) => ({ it, i, t: Date.parse(it.at) || 0 }))
      .sort((a, b) => b.t - a.t || b.i - a.i)
      .map((x) => x.it);
  }, [data.audit, data.leadExports, ix, lead]);
}

function LeadHistory({ items }: { items: HistItem[] }) {
  return (
    <ol className="lc-tl">
      {items.map((it, i) => (
        <li key={i} data-hue={it.hue}>
          <span className="lc-tl-dot" />
          <div className="lc-tl-b">
            <div className="lc-tl-h">
              <b>{it.title}</b>
              <span className="o2-muted num">{fmtStamp(it.at)}</span>
            </div>
            {it.by && <div className="o2-muted">{it.by}</div>}
            {it.changes && it.changes.length > 0 && (
              <ul className="lc-tl-ch">
                {it.changes.map((c, j) => (
                  <li key={j}>
                    <span className="o2-muted">{c.f}:</span> <s>{c.from || "—"}</s> → {c.to || "—"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function onCtrlEnter(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      fn();
    }
  };
}

/* ════════════════════════════════════════════════════════════════════
   Панель справа на странице «Лиды» и попап с других страниц — одна карточка
   ════════════════════════════════════════════════════════════════════ */

export function LeadPanel({ lead, onClose, failIntent }: { lead: Lead; onClose: () => void; failIntent?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  // панель липкая, но стоит под шапкой страницы: высота — ровно до низа окна, иначе низ
  // карточки (плеер, «Сохранить») уезжает за экран, пока страницу не прокрутят
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      if (window.innerWidth <= 1180) {
        el.style.height = "";
        return;
      }
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
      const top = Math.max(el.getBoundingClientRect().top, 12);
      el.style.height = `${Math.max(420, (window.innerHeight - top - 12) / scale)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    document.addEventListener("scroll", fit, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", fit);
      document.removeEventListener("scroll", fit, { capture: true });
    };
  }, []);
  return (
    <aside className="card o2-side lc-wrap" ref={ref}>
      <LeadCard lead={lead} failIntent={failIntent} onClose={onClose} variant="side" />
    </aside>
  );
}

export function LeadModal({ lead, preset }: { lead: Lead | null; preset?: LeadPreset }) {
  const { closeModal, data } = useCrm();
  // лид могли поменять, пока окно открыто (статус) — показываем свежий
  const live = lead ? data.leads.find((l) => l.id === lead.id) ?? lead : null;
  return live ? (
    <Modal onClose={closeModal} width={600}>
      <LeadCard lead={live} failIntent={preset?.status === "failed"} onClose={closeModal} variant="modal" />
    </Modal>
  ) : (
    <LeadCreateModal preset={preset} onClose={closeModal} />
  );
}

function LeadCreateModal({ preset, onClose }: { preset?: LeadPreset; onClose: () => void }) {
  const { access, ix } = useCrm();
  const d = useLeadDraft(null, preset);
  const bodyRef = useRef<HTMLDivElement>(null);
  const op = ix.opById.get(d.f.operatorId);

  const submit = async (more: boolean) => {
    const ok = await d.save(more);
    if (!ok) return;
    if (more) bodyRef.current?.querySelector<HTMLInputElement>(".lead-link input")?.focus();
    else onClose();
  };

  // курсор — сразу в ссылку из Скорозвона
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLInputElement>(".lead-link input")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal
      title={
        <span className="lf-mh">
          <span className="lf-mh-ic">
            <Icon name="plus" size={15} stroke={2.4} />
          </span>
          Передан лид
        </span>
      }
      onClose={onClose}
      width={560}
      footer={
        d.noOps ? (
          <button className="o2-btn" onClick={onClose}>
            Закрыть
          </button>
        ) : (
          <div className="lf-bar" style={{ margin: 0, padding: 0, border: 0, position: "static" }}>
            {d.added > 0 && <span className="o2-muted" style={{ fontSize: 12 }}>Записано подряд: {d.added}</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="o2-btn" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="o2-btn" onClick={() => void submit(true)} disabled={d.busy} title="Записать и сразу ввести следующий">
              Записать и ещё
            </button>
            <button type="button" className="o2-btn pri" onClick={() => void submit(false)} disabled={d.busy} title="Ctrl+Enter">
              <Icon name="check" size={13} /> Записать лид
            </button>
          </div>
        )
      }
    >
      {d.noOps ? (
        <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.55 }}>
          {access.isOp
            ? "Ваш аккаунт не привязан к карточке оператора или запись лидов для операторов выключена. Обратитесь к руководителю."
            : "Сначала добавьте хотя бы одного активного оператора (в вашей зоне) — лид всегда привязан к оператору, который его передал."}
        </div>
      ) : (
        <div className="lf-body" ref={bodyRef} onKeyDown={onCtrlEnter(() => void submit(false))}>
          {access.isOp && op && (
            <div className="lf-who">
              <Avatar name={op.name} id={op.id} size={30} />
              <div>
                <b>{op.name}</b>
                <span>Лид запишется на вас · статус «В работе», доведён или нет — отметит супервайзер</span>
              </div>
            </div>
          )}
          <LeadFields d={d} />
          {d.missing.length > 0 && (
            <div className="lead-missing">
              <Icon name="alert" size={13} /> Чтобы записать лид, заполните: {d.missing.join(", ")}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--dim)" }}>Источник: {LEAD_SOURCE}. Время ставится само — по Москве, по часам сервера.</div>
        </div>
      )}
    </Modal>
  );
}
