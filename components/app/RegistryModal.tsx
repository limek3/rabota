"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { isGone } from "@/lib/crm/calc";
import { TAX_PCT, withTax } from "@/lib/crm/payroll";
import { REMOTE } from "@/lib/crm/db";
import type { PeriodState } from "@/components/app/PeriodPayroll";
import { KIND_LABEL, PROJECT_LABEL, registryLine, registryPayload, registryTab, type RegistryKind, type RegistryProject, type RegistryReply } from "@/lib/crm/registry";
import { pushRegistry } from "@/lib/crm/registrySync";
import type { DayKey, ID, Operator } from "@/lib/crm/types";
import { fmtDate } from "@/lib/crm/dates";
import { fmtInt, fmtMoney } from "@/lib/crm/format";
import { EmploymentTag, Modal, NumInput, Seg } from "@/components/ui/kit";
import { DateInput } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";

/**
 * «Реестр YouDo»: суммы периода → листы «План/Факт ОКЦ (дд.мм-дд.мм)» в таблицах бухгалтера
 * (lib/crm/registry.ts). Суммы — остаток к выплате на руки, их можно поправить: план
 * в начале периода — ориентир, который вводит РОП. В YouDo уходит на руки ÷ 0,94.
 */

interface Draft {
  on: boolean;
  project: RegistryProject;
  net: number;
}

const PROJECTS: RegistryProject[] = ["okc", "sv"];

export function RegistryModal({ pp, isSv, onClose }: { pp: PeriodState; isSv: (op: Operator) => boolean; onClose: () => void }) {
  const { data, today, confirm, toast } = useCrm();
  const { period, prAll } = pp;
  const cfg = data.settings.sheets.registry;
  const ready = REMOTE && !!cfg.url && !!cfg.token;

  const [kind, setKind] = useState<RegistryKind>(today <= period.to ? "plan" : "fact");
  // даты задания: в YouDo задание не начать раньше сегодняшнего дня — для плана с сегодня
  const [from, setFrom] = useState<DayKey>(today > period.from && today <= period.to ? today : period.from);
  const [to, setTo] = useState<DayKey>(period.to);

  // кто в реестре: все с начислением за период + самозанятые в штате (план в начале периода)
  const people = useMemo(() => {
    const byId = new Map<ID, { op: Operator; toPay: number }>();
    for (const r of prAll.rows) byId.set(r.op.id, { op: r.op, toPay: r.toPay });
    for (const op of data.operators) if (!isGone(op) && op.employment === "smz" && !byId.has(op.id)) byId.set(op.id, { op, toPay: 0 });
    return Array.from(byId.values()).sort((a, b) => Number(isSv(b.op)) - Number(isSv(a.op)) || a.op.name.localeCompare(b.op.name, "ru"));
  }, [prAll.rows, data.operators, isSv]);

  const [draft, setDraft] = useState<Record<ID, Draft>>(() =>
    Object.fromEntries(people.map((p) => [p.op.id, { on: p.toPay > 0.5, project: isSv(p.op) ? "sv" : "okc", net: Math.max(0, Math.round(p.toPay)) }])),
  );
  const blank: Draft = { on: false, project: "okc", net: 0 };
  const get = (id: ID): Draft => draft[id] ?? blank;
  const patch = (id: ID, p: Partial<Draft>) => setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? blank), ...p } }));

  const lines = (proj: RegistryProject) =>
    people.filter((p) => get(p.op.id).on && get(p.op.id).project === proj && get(p.op.id).net > 0).map((p) => registryLine(p.op.id, p.op.name, get(p.op.id).net));
  const sums = Object.fromEntries(PROJECTS.map((pr) => [pr, lines(pr)])) as Record<RegistryProject, ReturnType<typeof lines>>;
  const notSmz = people.filter((p) => get(p.op.id).on && get(p.op.id).net > 0 && p.op.employment !== "smz");
  const toSend = PROJECTS.filter((pr) => sums[pr].length);

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ project: RegistryProject; reply?: RegistryReply; error?: string }[]>([]);

  const send = async () => {
    setBusy(true);
    setResults([]);
    const out: typeof results = [];
    for (const project of toSend) {
      const payload = registryPayload(kind, project, prAll.start, period.to, from, to, sums[project]);
      try {
        let reply = await pushRegistry(payload);
        if (reply.exists) {
          const same = !reply.tab || reply.tab === payload.tab;
          const ok = await confirm({
            title: `Лист «${reply.tab ?? payload.tab}» уже есть`,
            text: same
              ? "Перезаписать его суммами из CRM? Статусы YouDo внизу листа сохранятся, остальные листы не тронутся."
              : `Его сделали руками. Создать рядом отдельный лист «${payload.tab}» из CRM? Лист «${reply.tab}» не изменится.`,
            ok: same ? "Перезаписать" : "Создать отдельный",
          });
          if (!ok) {
            out.push({ project, error: "Не отправлено — лист уже есть" });
            continue;
          }
          reply = await pushRegistry({ ...payload, replace: true });
        }
        out.push({ project, reply });
      } catch (e) {
        out.push({ project, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setResults(out);
    setBusy(false);
    const failed = out.filter((r) => r.error).length;
    toast(failed ? "Реестр отправлен не полностью" : "Реестр в таблице бухгалтера", failed ? "err" : "ok");
  };

  const startLabel = fmtDate(prAll.start).slice(0, 5);
  return (
    <Modal
      title={`Реестр YouDo · ${startLabel} – ${fmtDate(period.to).slice(0, 5)}`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 12.5, color: "var(--dim)" }}>
            {toSend.length ? toSend.map((pr) => `«${registryTab(kind, pr, prAll.start, period.to)}»`).join(" и ") : "Отметьте, кого включить"}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy || !toSend.length} onClick={() => void send()}>
            <Icon name="upload" size={14} /> {busy ? "Отправляю…" : "В таблицы бухгалтера"}
          </button>
        </>
      }
    >
      {/* суммы меняются при вводе — без анимации чисел (NumberTween) */}
      <div data-no-tween style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {!ready && (
          <div className="note-line warn">
            <Icon name="info" size={14} />
            <span>
              {!REMOTE ? "Реестры отправляет сервер — нужна Supabase." : "Скрипт реестров не подключён. "}
              {REMOTE && (
                <Link href="/settings?tab=data#registry-sheet" onClick={onClose}>
                  <b>Настройки → Данные → «Реестры выплат YouDo»</b>
                </Link>
              )}
            </span>
          </div>
        )}

        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Seg<RegistryKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "plan", label: "План — до конца периода" },
              { value: "fact", label: "Факт — к выплате" },
            ]}
          />
          <span className="row" style={{ gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--dim)" }}>
            Задание в YouDo
            <DateInput size="sm" width={130} value={from} onChange={(d) => d && setFrom(d)} ariaLabel="Начало задания" />–
            <DateInput size="sm" width={130} value={to} onChange={(d) => d && setTo(d)} ariaLabel="Конец задания" />
          </span>
        </div>
        <p className="card-sub" style={{ margin: 0 }}>
          {kind === "plan"
            ? "Суммы на руки — остаток за период на сегодня; поправьте, если нужен другой ориентир. В YouDo уходит сумма с налогом."
            : "Факт сверяется с листом плана этого периода: даты задания берутся оттуда, изменённые суммы подсвечиваются, кого не было в плане — отмечается."}{" "}
          ФИО и ИНН скрипт подставит из реестра исполнителей.
        </p>

        <div className="tbl-wrap" style={{ maxHeight: 420 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Сотрудник</th>
                <th>Реестр</th>
                <th className="r">На руки, ₽</th>
                <th className="r" title={`На руки ÷ 0,94 — налог самозанятого ${TAX_PCT}%`}>
                  В YouDo
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map(({ op, toPay }) => {
                const d = get(op.id);
                return (
                  <tr key={op.id} style={d.on ? undefined : { opacity: 0.55 }}>
                    <td>
                      <input type="checkbox" className="o2-cb" checked={d.on} onChange={(e) => patch(op.id, { on: e.target.checked })} aria-label={`Включить ${op.name}`} />
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6, alignItems: "center" }}>
                        {op.name}
                        {op.employment !== "smz" && <EmploymentTag op={op} />}
                      </span>
                    </td>
                    <td>
                      <Seg<RegistryProject> value={d.project} onChange={(v) => patch(op.id, { project: v })} options={PROJECTS.map((p) => ({ value: p, label: PROJECT_LABEL[p] }))} />
                    </td>
                    <td className="r">
                      <NumInput
                        value={d.net}
                        onChange={(v) => patch(op.id, (v ?? 0) > 0 ? { net: v ?? 0, on: true } : { net: 0 })}
                        style={{ width: 110, textAlign: "right" }}
                        placeholder={toPay > 0.5 ? String(Math.round(toPay)) : "0"}
                      />
                    </td>
                    <td className="r" style={{ fontWeight: 600 }}>
                      {d.net > 0 ? fmtMoney(withTax(d.net)) : <span className="o2-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!people.length && (
                <tr>
                  <td colSpan={5} className="o2-muted" style={{ textAlign: "center", padding: 18 }}>
                    За период начислений нет и самозанятых в штате нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          {PROJECTS.map((pr) => {
            const l = sums[pr];
            return (
              <span key={pr}>
                <b>{PROJECT_LABEL[pr]}</b>: {fmtInt(l.length)} чел. · на руки {fmtMoney(l.reduce((a, x) => a + x.net, 0))} · в YouDo <b>{fmtMoney(l.reduce((a, x) => a + x.sum, 0))}</b>
              </span>
            );
          })}
        </div>

        {notSmz.length > 0 && (
          <div className="note-line warn">
            <Icon name="info" size={14} />
            <span>
              Не самозанятые в карточке: <b>{notSmz.map((p) => p.op.name).join(", ")}</b> — YouDo не примет задание, пока человек не оформлен.
            </span>
          </div>
        )}

        {results.map(({ project, reply, error }) => (
          <RegistryResult key={project} project={project} kind={kind} reply={reply} error={error} />
        ))}
      </div>
    </Modal>
  );
}

function RegistryResult({ project, kind, reply, error }: { project: RegistryProject; kind: RegistryKind; reply?: RegistryReply; error?: string }) {
  if (error || !reply)
    return (
      <div className="note-line warn">
        <Icon name="info" size={14} />
        <span>
          <b>{PROJECT_LABEL[project]}:</b> {error ?? "нет ответа"}
        </span>
      </div>
    );
  if (reply.unconfirmed)
    return (
      <div className="note-line">
        <Icon name="info" size={14} />
        <span>
          <b>{PROJECT_LABEL[project]}:</b> отправлено, но Google не прислал ответ — откройте таблицу и проверьте лист.
        </span>
      </div>
    );
  const missing = reply.missing ?? [];
  return (
    <div className={`note-line${missing.length ? " warn" : " ok"}`} style={{ alignItems: "flex-start" }}>
      <Icon name={missing.length ? "info" : "check"} size={14} />
      <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span>
          <b>
            «{reply.tab}» {reply.created ? "создан" : "перезаписан"}
          </b>{" "}
          · {fmtInt(reply.rows ?? 0)} строк · {fmtMoney(reply.total ?? 0)} с налогом
          {reply.url && (
            <>
              {" · "}
              <a href={reply.url} target="_blank" rel="noreferrer">
                открыть лист
              </a>
            </>
          )}
        </span>
        {kind === "fact" && (
          <span>
            {reply.plan ? `Сверено с «${reply.plan}»` : "Листа плана за этот период нет — даты задания из CRM"}
            {reply.changed?.length ? ` · изменилась сумма: ${reply.changed.map((c) => `${c.name} ${fmtMoney(c.from)} → ${fmtMoney(c.to)}`).join(", ")}` : ""}
            {reply.added?.length ? ` · нет в плане: ${reply.added.join(", ")}` : ""}
            {reply.zeroed?.length ? ` · в плане были, в факте 0: ${reply.zeroed.join(", ")}` : ""}
          </span>
        )}
        {missing.length > 0 && <span>ИНН не найден: {missing.map((m) => `${m.name} (${m.why})`).join(", ")} — добавьте в «Реестр исполнителей» и отправьте снова.</span>}
      </span>
    </div>
  );
}
