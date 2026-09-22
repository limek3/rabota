"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { academyRole, lib, nextUp, progMap, programItems, progressAll, progLabel } from "@/lib/learn";
import type { AccountRole, LearnProgress } from "@/lib/crm/types";
import { fmtPct } from "@/lib/crm/format";
import { Chip, Progress } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/** Сводка по программе обучения аккаунта: сколько пройдено и что открыть дальше. */
export function learnSummary(accountId: string, role: AccountRole, learn: LearnProgress[]) {
  const p = progMap(learn, accountId);
  const r = academyRole(role);
  const pr = progressAll(p, r);
  const next = nextUp(p, r);
  const tests = programItems(r).filter((i) => i.quiz);
  const passed = tests.filter((i) => p.get(i.id)?.pass).length;
  return {
    total: pr.n,
    passed: pr.d,
    pct: pr.n ? pr.d / pr.n : 0,
    tests: tests.length,
    testsPassed: passed,
    label: progLabel(r),
    next: next ? { itemId: next.id, title: next.t, course: lib(r).itemCourse.get(next.id)?.title ?? "" } : null,
  };
}

/** Карточка «Обучение» для личного кабинета. */
export function LearnCard() {
  const { data, me } = useCrm();
  const s = useMemo(() => learnSummary(me.id, me.role, data.learn), [me.id, me.role, data.learn]);
  if (!s.total) return null;
  return (
    <div className="card card-pad">
      <div className="card-head">
        <div>
          <h3 className="card-title">Обучение</h3>
          <p className="card-sub">Академия обзвона · программа «{s.label}»</p>
        </div>
        {s.pct === 1 ? <Chip hue="green" dot>Всё пройдено</Chip> : <Chip hue="amber">{fmtPct(s.pct)}</Chip>}
      </div>
      <Progress value={s.pct} />
      <div className="row" style={{ justifyContent: "space-between", fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>
        <span>
          Пройдено {s.passed} из {s.total}
        </span>
        <span>
          Тестов сдано {s.testsPassed} из {s.tests}
        </span>
      </div>
      {s.next ? (
        <Link className="btn btn-sm" style={{ marginTop: 12 }} href={`/learn/?item=${s.next.itemId}`}>
          <Icon name="book" size={13} /> Продолжить: {s.next.title}
        </Link>
      ) : (
        <Link className="btn btn-sm btn-ghost" style={{ marginTop: 12 }} href="/learn">
          Открыть академию <Icon name="chevR" size={13} />
        </Link>
      )}
    </div>
  );
}
