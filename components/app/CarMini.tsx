"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Icon } from "@/components/ui/icons";
import { BODY_LABEL, POWER_LABEL, searchCars, type Model } from "@/lib/cars/catalog";
import { photoSrc } from "@/lib/cars/photo";
import { VERDICT_LABEL, rulesFor, type VerdictKind, type ZoneVerdict } from "@/lib/cars/rules";
import { getVexaBridge } from "@/lib/electron";
import type { Project } from "@/lib/crm/types";

/**
 * Мини-окно «Марок авто» поверх всех окон — держать рядом со Скорозвоном во время звонка:
 * поле, фото и крупно «передаём / не передаём». Enter — строка для комментария в буфер.
 *
 * Где живёт:
 *  - приложение (Electron) — своё маленькое окно «поверх всех», Ctrl+Shift+A показывает и прячет
 *    (electron/main.mjs, страница /mini/cars);
 *  - Chrome и Edge — окно «картинка в картинке» (Document Picture-in-Picture): тоже поверх всех окон;
 *  - другой браузер — обычное маленькое окно (поверх не держится).
 * Компонент не берёт данные из хранилища CRM: в окне «картинка в картинке» своё дерево React,
 * проекты ему передают при открытии.
 */

const PROJECT_KEY = "leadup.carsMini.project";

function overall(vs: ZoneVerdict[]): VerdictKind {
  if (vs.every((v) => v.kind === "ok")) return "ok";
  if (vs.every((v) => v.kind === "no")) return "no";
  return "ask";
}

export function CarMini({ projects, base = "" }: { projects: Project[]; base?: string }) {
  const ruled = projects.filter((p) => !p.deletedAt && p.active && rulesFor(p));
  // выбранный проект — из памяти окна; проекты могут прийти позже (страница /mini/cars грузит их сама),
  // поэтому нет такого — берём первый с правилами, а не «ничего»
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  const project = ruled.find((p) => p.id === projectId) ?? ruled[0] ?? null;
  const rules = rulesFor(project);
  const hits = useMemo(() => searchCars(q, 4), [q]);
  const car: Model | null = hits[Math.min(active, hits.length - 1)]?.model ?? null;
  const vs = car && rules ? rules.check(car) : [];
  const kind = vs.length ? overall(vs) : null;

  const pick = (id: string) => {
    setProjectId(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* без хранилища — просто не запомним */
    }
    inp.current?.focus();
  };

  // окно снова в фокусе (горячая клавиша, клик) — курсор в поле, текст выделен: можно сразу печатать
  useEffect(() => {
    const win = inp.current?.ownerDocument.defaultView;
    if (!win) return;
    const onFocus = () => {
      inp.current?.focus();
      inp.current?.select();
    };
    win.addEventListener("focus", onFocus);
    return () => win.removeEventListener("focus", onFocus);
  }, []);

  const copy = async () => {
    if (!car || !project) return;
    const line = `${car.full} (${car.bodies.map((b) => BODY_LABEL[b]).join(", ")}; ${car.power.map((p) => POWER_LABEL[p]).join(", ")}) — ${project.name}: ${vs
      .map((v) => `${v.zone ? `${v.zone} — ` : ""}${VERDICT_LABEL[v.kind].toLowerCase()}`)
      .join(", ")}`;
    // буфер обмена того окна, где сейчас фокус: из окна «картинка в картинке» — его собственный
    const nav = inp.current?.ownerDocument.defaultView?.navigator ?? navigator;
    try {
      await nav.clipboard.writeText(line);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* не дали — ничего страшного */
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void copy();
    } else if (e.key === "Escape") {
      setQ("");
      setActive(0);
    }
  };

  const src = car ? photoSrc(car.id, base) : null;

  return (
    <div className="mw">
      {ruled.length > 1 && (
        <div className="mw-tabs" role="tablist" aria-label="Проект">
          {ruled.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === project?.id} className={p.id === project?.id ? "on" : ""} onClick={() => pick(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inp}
        className="mw-inp"
        value={q}
        autoFocus
        placeholder="Машина клиента — «камри», «крузак»…"
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        aria-label="Машина клиента"
      />
      {car ? (
        <div className="mw-res" data-kind={kind ?? undefined}>
          {src ? <img className="mw-img" src={src} alt="" /> : <span className="mw-img ph"><Icon name="car" size={22} /></span>}
          <div className="mw-main">
            <span className="mw-kind">{kind ? (vs.length > 1 && kind === "ask" ? "По городу" : VERDICT_LABEL[kind]) : "Правил нет"}</span>
            <b>{car.full}</b>
            <span className="mw-sub">
              {car.bodies.map((b) => BODY_LABEL[b]).join(", ")} · {car.power.map((p) => POWER_LABEL[p]).join(", ")}
            </span>
          </div>
        </div>
      ) : (
        <div className="mw-tip">{q ? "Не нашли — попробуйте иначе" : project ? `Проект: ${project.name}` : "Нет проектов с правилами"}</div>
      )}
      {car && vs.some((v) => v.reasons.length || v.zone) && (
        <div className="mw-why">
          {vs.map((v, i) => (
            <span key={i}>
              {v.zone ? `${v.zone} — ${VERDICT_LABEL[v.kind].toLowerCase()}` : v.reasons.join("; ")}
              {v.zone && v.reasons.length > 0 ? ` (${v.reasons.join("; ")})` : ""}
            </span>
          ))}
        </div>
      )}
      {hits.length > 1 && (
        <div className="mw-alts">
          {hits.map((h, i) => (
            <button key={h.model.id} type="button" className={i === active ? "on" : ""} onClick={() => setActive(i)}>
              {h.model.full}
            </button>
          ))}
        </div>
      )}
      <div className="mw-foot">{copied ? "Скопировано — вставьте в комментарий" : "Enter — скопировать · ↑↓ — другая модель · Esc — очистить"}</div>
    </div>
  );
}

/**
 * Открыть мини-окно. Приложение — своё окно Electron; Chrome/Edge — «картинка в картинке»
 * (стили CRM копируются в его документ); иначе — обычное маленькое окно со страницей /mini/cars.
 */
export async function openCarMini(projects: Project[]): Promise<void> {
  const br = getVexaBridge();
  if (br?.carsMini) return br.carsMini();
  const dpip = (window as unknown as { documentPictureInPicture?: { window: Window | null; requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
  const popup = () => void window.open("/mini/cars/", "leadup-cars-mini", "popup,width=400,height=420");
  if (!dpip) return popup();
  if (dpip.window) {
    dpip.window.focus();
    return;
  }
  let pip: Window;
  try {
    pip = await dpip.requestWindow({ width: 380, height: 400 });
  } catch {
    // браузер не дал окно «картинка в картинке» (встроенный просмотр, запрет) — обычное маленькое окно
    return popup();
  }
  const doc = pip.document;
  doc.title = "Марки авто";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = doc.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      doc.head.appendChild(style);
    } catch {
      // чужой домен (шрифты) — подключаем ссылкой
      if (sheet.href) {
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        doc.head.appendChild(link);
      }
    }
  }
  // тема и шрифт — как у CRM
  doc.documentElement.className = document.documentElement.className;
  for (const a of Array.from(document.documentElement.attributes)) if (a.name.startsWith("data-")) doc.documentElement.setAttribute(a.name, a.value);
  doc.body.className = document.body.className;
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const root = createRoot(host);
  root.render(<CarMini projects={projects} base={window.location.origin} />);
  pip.addEventListener("pagehide", () => root.unmount());
}
