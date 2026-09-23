"use client";

import { useMemo, useState } from "react";
import { useCrm, type CandidateInput } from "@/lib/crm/store";
import type { Candidate, CandidateStage } from "@/lib/crm/types";
import { CANDIDATE_STAGE_HUE, CANDIDATE_STAGE_LABEL } from "@/lib/crm/types";
import { canTouchCandidate } from "@/lib/crm/access";
import { fmtDate } from "@/lib/crm/dates";
import { Chip, Field, Modal, Seg, Swatch } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";

/** Этапы, которые выбираются вручную. «Принят» — только кнопкой «Принять»: она заводит карточку. */
const MANUAL: CandidateStage[] = ["new", "interview", "training", "rejected", "declined"];

export function CandidateModal({ cand, onClose }: { cand: Candidate | null; onClose: () => void }) {
  const { data, today, access, saveCandidate, deleteCandidate, hireCandidate, openOperator, toast, confirm } = useCrm();
  // супервайзер ведёт кандидатов своих групп и общий поток без группы
  const groups = data.groups.filter((g) => !g.deletedAt && (access.isHead || access.ownGroups.has(g.id)));
  const groupOpts: Opt[] = [{ value: "", label: "Пока не решили", icon: dot("gray") }, ...groups.map((g) => ({ value: g.id, label: g.name, icon: dot(g.color) }))];

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
  const [hire, setHire] = useState<{ date: string; groupId: string } | null>(null);

  const hired = cand?.stage === "hired";
  const op = cand?.operatorId ? data.operators.find((o) => o.id === cand.operatorId) ?? null : null;
  const closing = f.stage === "rejected" || f.stage === "declined";
  const canEdit = !cand || canTouchCandidate(access, cand);

  // подсказки из уже введённого: источники и причины повторяются
  const sources = useMemo(() => uniq(data.candidates.map((c) => c.source)), [data.candidates]);
  const reasons = useMemo(() => uniq(data.candidates.map((c) => c.reason)), [data.candidates]);

  const errName = !f.name.trim() ? "Укажите ФИО" : null;
  const errDates =
    (f.interviewAt && f.interviewAt < f.appliedAt) || (f.trainingAt && f.trainingAt < f.appliedAt) || (f.closedAt && closing && f.closedAt < f.appliedAt)
      ? "Дата этапа раньше отклика"
      : null;

  const submit = async () => {
    setTried(true);
    if (errName || errDates || busy) return;
    setBusy(true);
    const saved = await saveCandidate({ ...f, id: cand?.id });
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
    const made = saved ? await hireCandidate(cand.id, hire.date, hire.groupId || null, saved) : null;
    setBusy(false);
    if (!made) return;
    onClose();
    toast(`${made.name} принят(а) с ${fmtDate(hire.date)}. Проверьте план и оплату в карточке`, "ok", { label: "Карточка", run: () => openOperator(made) });
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
          <Field label="Группа">
            <Select value={f.groupId ?? ""} options={groupOpts} onChange={(v) => set("groupId", v || null)} ariaLabel="Группа" disabled={hired} />
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

        {cand && !hired && canEdit && (
          <div className="hire-box">
            {hire ? (
              <>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Принять в штат</div>
                <div style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
                  Заведётся карточка оператора с датой приёма — с неё считаются стажировка, план и стаж. Схема оплаты — по умолчанию из настроек.
                </div>
                <div className="grid2" style={{ marginTop: 4 }}>
                  <Field label="Дата приёма">
                    <DateInput value={hire.date} onChange={(v) => setHire({ ...hire, date: v })} ariaLabel="Дата приёма" />
                  </Field>
                  <Field label="Группа">
                    <Select
                      value={hire.groupId}
                      options={access.isHead ? [{ value: "", label: "Без группы", icon: dot("gray") }, ...groupOpts.slice(1)] : groupOpts.slice(1)}
                      onChange={(v) => setHire({ ...hire, groupId: v })}
                      ariaLabel="Группа"
                    />
                  </Field>
                </div>
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
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-sub)" }}>Прошёл отбор и обучение? Примите в штат — появится карточка оператора.</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setHire({ date: today, groupId: f.groupId ?? (access.isHead ? "" : groups[0]?.id ?? "") })}>
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
