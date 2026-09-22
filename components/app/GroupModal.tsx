"use client";

import { useState } from "react";
import { useCrm, type GroupInput } from "@/lib/crm/store";
import type { Group } from "@/lib/crm/types";
import { Field, Modal, NumInput, hueFg } from "@/components/ui/kit";
import { Select, type Opt } from "@/components/ui/select";
import { HUES } from "@/lib/crm/defaults";

export function GroupModal({ group }: { group: Group | null }) {
  const { data, closeModal, saveGroup, toast } = useCrm();
  const usedHues = new Set(data.groups.filter((g) => !g.deletedAt).map((g) => g.color));
  const [f, setF] = useState<GroupInput>(() =>
    group
      ? { ...group }
      : {
          name: "",
          supervisorId: null,
          supervisorName: "",
          monthlyPlan: 0,
          active: true,
          color: HUES.find((h) => !usedHues.has(h)) ?? "blue",
        },
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof GroupInput>(k: K, v: GroupInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const people = data.operators.filter((o) => !o.deletedAt && o.status !== "fired").sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const errName = !f.name.trim() ? "Укажите название" : null;

  const submit = async () => {
    setTried(true);
    if (errName || busy) return;
    setBusy(true);
    const saved = await saveGroup({ ...f, id: group?.id });
    setBusy(false);
    if (saved) {
      toast(group ? "Группа сохранена" : "Группа создана");
      closeModal();
    }
  };

  return (
    <Modal
      title={group ? "Группа" : "Новая группа"}
      onClose={closeModal}
      width={520}
      footer={
        <>
          <button className="btn" onClick={closeModal}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {group ? "Сохранить" : "Создать"}
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
        <Field label="Название" error={tried ? errName : null}>
          <input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus aria-invalid={tried && !!errName} />
        </Field>
        <div className="grid2">
          <Field label="Руководитель / супервайзер">
            <Select
              value={f.supervisorId ?? ""}
              options={[{ value: "", label: "— не из сотрудников —" }, ...people.map<Opt>((o) => ({ value: o.id, label: o.name }))]}
              onChange={(v) => setF((x) => ({ ...x, supervisorId: v || null, supervisorName: v ? "" : x.supervisorName }))}
              ariaLabel="Руководитель"
            />
          </Field>
          {!f.supervisorId && (
            <Field label="ФИО руководителя">
              <input className="inp" value={f.supervisorName} onChange={(e) => set("supervisorName", e.target.value)} placeholder="Необязательно" />
            </Field>
          )}
        </div>
        <div className="grid2">
          <Field label="План группы, лидов/мес" hint="0 — сумма личных планов участников">
            <NumInput value={f.monthlyPlan} onChange={(v) => set("monthlyPlan", v ?? 0)} max={1_000_000} />
          </Field>
          <Field label="Активность">
            <Select
              value={f.active ? "1" : "0"}
              options={[{ value: "1", label: "Активна" }, { value: "0", label: "Неактивна" }]}
              onChange={(v) => set("active", v === "1")}
              ariaLabel="Активность"
            />
          </Field>
        </div>
        <Field label="Цвет на графиках">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {HUES.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => set("color", h)}
                aria-label={h}
                aria-pressed={f.color === h}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  border: f.color === h ? "2px solid var(--text)" : "2px solid transparent",
                  background: hueFg(h),
                  boxShadow: "inset 0 0 0 2px var(--bg-modal)",
                }}
              />
            ))}
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
