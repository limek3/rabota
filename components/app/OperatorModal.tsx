"use client";

import { useState } from "react";
import { useCrm, type OperatorInput } from "@/lib/crm/store";
import type { Grade, Operator, OperatorRole, OperatorStatus, PayType, Track } from "@/lib/crm/types";
import { GRADE_LABEL, PAY_HINT, PAY_LABEL, ROLE_LABEL, STATUS_LABEL, TRACK_LABEL } from "@/lib/crm/types";
import { Field, Modal, NumInput } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { hasBonus, isSalary, isSvVolume, isTiered } from "@/lib/crm/payroll";
import { GridField } from "./RateGrids";
import { todayKey } from "@/lib/crm/dates";

export function OperatorModal({ op, preset }: { op: Operator | null; preset?: Partial<OperatorInput> }) {
  const { data, closeModal, saveOperator, toast, access } = useCrm();
  const s = data.settings;
  // супервайзер ставит людей только в свои группы
  const groups = data.groups.filter((g) => !g.deletedAt && (access.isHead || access.ownGroups.has(g.id)));
  const groupOpts: Opt[] = [
    ...(access.isHead ? [{ value: "", label: "Без группы", icon: dot("gray") }] : []),
    ...groups.map((g) => ({ value: g.id, label: g.name, icon: dot(g.color) })),
  ];
  const statusHue: Record<OperatorStatus, string> = { active: "green", pause: "indigo", fired: "gray" };

  const [f, setF] = useState<OperatorInput>(() =>
    op
      ? { ...op }
      : {
          name: "",
          groupId: preset?.groupId ?? (access.isHead ? null : groups[0]?.id ?? null),
          role: "operator",
          status: "active",
          hireDate: todayKey(),
          fireDate: "",
          monthlyPlan: null,
          normHours: null,
          payType: s.defaultPayType,
          salary: s.defaultSalary,
          hourlyRate: s.defaultHourlyRate,
          leadBonus: null,
          rateGridId: null,
          grade: "mid",
          track: "re",
          contact: "",
          comment: "",
          ...preset,
        },
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof OperatorInput>(k: K, v: OperatorInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const errName = !f.name.trim() ? "Укажите ФИО" : null;
  const errDates = f.fireDate && f.hireDate && f.fireDate < f.hireDate ? "Дата увольнения раньше даты приёма" : null;

  const submit = async () => {
    setTried(true);
    if (errName || errDates || busy) return;
    setBusy(true);
    const saved = await saveOperator({ ...f, id: op?.id });
    setBusy(false);
    if (saved) {
      toast(op ? "Оператор сохранён" : "Оператор добавлен");
      closeModal();
    }
  };

  return (
    <Modal
      title={op ? "Карточка оператора" : "Новый оператор"}
      onClose={closeModal}
      width={640}
      footer={
        <>
          <button className="btn" onClick={closeModal}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {op ? "Сохранить" : "Добавить"}
          </button>
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
        <Field label="ФИО" error={tried ? errName : null}>
          <input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus placeholder="Фамилия Имя Отчество" aria-invalid={tried && !!errName} />
        </Field>
        <div className="grid3">
          <Field label="Группа">
            <Select value={f.groupId ?? ""} options={groupOpts} onChange={(v) => set("groupId", v || null)} ariaLabel="Группа" />
          </Field>
          <Field label="Роль">
            <Select<OperatorRole>
              value={f.role}
              options={(Object.keys(ROLE_LABEL) as OperatorRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              onChange={(v) => set("role", v)}
              ariaLabel="Роль"
            />
          </Field>
          <Field label="Статус">
            <Select<OperatorStatus>
              value={f.status}
              options={(Object.keys(STATUS_LABEL) as OperatorStatus[]).map((r) => ({ value: r, label: STATUS_LABEL[r], icon: dot(statusHue[r]) }))}
              onChange={(st) => setF((x) => ({ ...x, status: st, fireDate: st === "fired" ? x.fireDate || todayKey() : x.fireDate }))}
              ariaLabel="Статус"
            />
          </Field>
        </div>
        <div className="grid3">
          <Field label="Дата приёма">
            <DateInput value={f.hireDate} onChange={(d) => set("hireDate", d)} clearable ariaLabel="Дата приёма" />
          </Field>
          <Field label="Дата увольнения" error={errDates} hint={f.status !== "fired" && !f.fireDate ? "Заполняется при увольнении" : undefined}>
            <DateInput value={f.fireDate} onChange={(d) => set("fireDate", d)} clearable min={f.hireDate || undefined} ariaLabel="Дата увольнения" invalid={!!errDates} />
          </Field>
          <Field label="Контакт">
            <input className="inp" value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="Телефон, Telegram" />
          </Field>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginTop: 4 }}>План и нормы на месяц</div>
        <div className="grid2">
          <Field label="Личный план, лидов/мес" hint={`Пусто — ${s.defaultOperatorPlan > 0 ? `по умолчанию (${s.defaultOperatorPlan})` : "без плана"}. Для отдельного месяца — страница «Планы».`}>
            <NumInput value={f.monthlyPlan} onChange={(v) => set("monthlyPlan", v)} allowEmpty placeholder={s.defaultOperatorPlan > 0 ? String(s.defaultOperatorPlan) : "—"} max={100000} />
          </Field>
          <Field label="Норма часов в месяц" hint={`Пусто — по умолчанию (${s.defaultNormHours} ч)`}>
            <NumInput value={f.normHours} onChange={(v) => set("normHours", v)} allowEmpty placeholder={String(s.defaultNormHours)} max={744} step={0.5} />
          </Field>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)", marginTop: 4 }}>Оплата</div>
        {!access.can.editPayroll ? (
          <div style={{ fontSize: 12.5, color: "var(--dim)" }}>Условия оплаты задаёт РОП.</div>
        ) : (
        <div className="grid2">
          <Field label="Схема оплаты">
            <Select<PayType>
              value={f.payType}
              options={(Object.keys(PAY_LABEL) as PayType[]).map((p) => ({ value: p, label: PAY_LABEL[p], hint: PAY_HINT[p] }))}
              onChange={(v) => set("payType", v)}
              ariaLabel="Схема оплаты"
              minPopWidth={460}
            />
          </Field>
          {isSalary(f.payType) && (
            <Field
              label="Оклад, ₽/мес"
              hint={isSvVolume(f.payType) ? `0 — оклад из сетки супервайзера (${s.svBonus.salary} ₽)` : s.prorateSalary ? "Пропорционально часам, если норма не выполнена" : undefined}
            >
              <NumInput value={f.salary} onChange={(v) => set("salary", v ?? 0)} max={10_000_000} placeholder={isSvVolume(f.payType) ? String(s.svBonus.salary) : undefined} />
            </Field>
          )}
          {!isSalary(f.payType) && !isTiered(f.payType) && (
            <Field label="Ставка, ₽/час">
              <NumInput value={f.hourlyRate} onChange={(v) => set("hourlyRate", v ?? 0)} max={100_000} step={0.5} />
            </Field>
          )}
          {hasBonus(f.payType) && !isTiered(f.payType) && (
            <Field label="Бонус за переданный лид, ₽" hint={`Пусто — по умолчанию (${s.defaultLeadBonus} ₽)`}>
              <NumInput value={f.leadBonus} onChange={(v) => set("leadBonus", v)} allowEmpty placeholder={String(s.defaultLeadBonus)} max={1_000_000} />
            </Field>
          )}
          {isTiered(f.payType) && <GridField value={f.rateGridId} onChange={(v) => set("rateGridId", v)} />}
          {isSvVolume(f.payType) && (
            <>
              <Field label="Грейд" hint="Колонка в сетке бонуса: стаж и размер группы">
                <Select<Grade>
                  value={f.grade}
                  options={(Object.keys(GRADE_LABEL) as Grade[]).map((g) => ({ value: g, label: GRADE_LABEL[g] }))}
                  onChange={(v) => set("grade", v)}
                  ariaLabel="Грейд"
                />
              </Field>
              <Field label="Направление" hint="У недвижимости и авто разные суммы бонуса">
                <Select<Track>
                  value={f.track}
                  options={(Object.keys(TRACK_LABEL) as Track[]).map((t) => ({ value: t, label: TRACK_LABEL[t] }))}
                  onChange={(v) => set("track", v)}
                  ariaLabel="Направление"
                />
              </Field>
              <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--dim)", lineHeight: 1.5 }}>
                Бонус считается от лидов групп, где этот сотрудник указан руководителем (карточка группы → «Руководитель»). До{" "}
                {s.svBonus.minLeads} лидов за месяц бонуса нет. Апрув заказчика и рост к прошлому месяцу задаются в ведомости, в условиях месяца.
              </div>
            </>
          )}
        </div>
        )}
        <Field label="Комментарий">
          <textarea className="inp" rows={2} value={f.comment} onChange={(e) => set("comment", e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
