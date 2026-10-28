"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { Icon } from "@/components/ui/icons";
import { detectCars } from "@/lib/cars/catalog";
import { photoSrc } from "@/lib/cars/photo";
import { VERDICT_LABEL, mentionVerdict, rulesFor, type VerdictKind } from "@/lib/cars/rules";

/**
 * Машина в комментарии лида: оператор пишет «хочет продать свой прадик 2012» — под полем сразу
 * плашка «Toyota Land Cruiser Prado — для 100 up не передаём» с причиной. Проект и город — из лида
 * (у Авто.ру город решает, берём ли некитайскую марку). Ошиблись с машиной — «Не та машина» прячет плашку.
 * Машину показываем всегда: у проекта нет правил или по одной марке не решить — плашка без вердикта.
 * Только подсказка: сохранить лид она не мешает.
 */
export function CarHint({ text, projectId, city }: { text: string; projectId: string; city: string }) {
  const { data } = useCrm();
  const [hidden, setHidden] = useState<string[]>([]);
  // печатают быстро — распознаём, когда рука остановилась
  const [calm, setCalm] = useState(text);
  useEffect(() => {
    const t = window.setTimeout(() => setCalm(text), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  const project = data.projects.find((p) => p.id === projectId) ?? null;
  const rules = rulesFor(project);
  const items = useMemo(() => {
    if (!calm.trim()) return [];
    return detectCars(calm).map((m) => ({ m, key: m.model?.id ?? m.brand.id, vs: rules ? mentionVerdict(rules, m, city) ?? [] : null }));
  }, [calm, rules, city]);

  const shown = items.filter((x) => !hidden.includes(x.key));
  if (!shown.length) return null;

  return (
    <div className="ch-list" aria-live="polite">
      {shown.map(({ m, key, vs }) => {
        const src = m.model ? photoSrc(m.model.id) : null;
        const name = m.model ? m.model.full : m.brand.name;
        // «Toyota Camry — в списке…» → «в списке…»: название и так в заголовке
        const short = (r: string) => r.replace(`${name} — `, "");
        let kind: VerdictKind | null = null;
        let reasons: string[] = [];
        if (vs && vs.length) {
          kind = vs.every((v) => v.kind === "ok") ? "ok" : vs.some((v) => v.kind === "no") && vs.every((v) => v.kind !== "ok") ? "no" : "ask";
          reasons = vs.flatMap((v) => (vs.length > 1 && v.zone ? [`${v.zone} — ${VERDICT_LABEL[v.kind].toLowerCase()}${v.reasons.length ? `: ${v.reasons.map(short).join("; ")}` : ""}`] : v.reasons.map(short)));
        } else if (vs) {
          // правила есть, но по одной марке не решить
          kind = "ask";
          reasons = ["назовите модель — по одной марке не решить"];
        }
        return (
          <div key={key} className="ch" data-kind={kind ?? undefined}>
            {src ? <img className="ch-img" src={src} alt="" /> : <span className="ch-img ph"><Icon name="car" size={18} /></span>}
            <div className="ch-main">
              <b>
                {name}
                {kind && ` — ${VERDICT_LABEL[kind].toLowerCase()}`}
              </b>
              <span>
                «{m.said}»{project && ` · ${project.name}`}
                {reasons.length > 0 && ` · ${reasons.join(" · ")}`}
                {!vs && project && " · правил по машинам у проекта нет"}
              </span>
            </div>
            <button type="button" className="ch-x" onClick={() => setHidden((h) => [...h, key])} title="Не та машина — спрятать">
              Не та
            </button>
          </div>
        );
      })}
    </div>
  );
}
