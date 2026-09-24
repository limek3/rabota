"use client";

// Electron title bar — "lead terminal" style. Renders ONLY inside Electron
// (when the preload script exposed window.vexaElectron); in a normal browser
// it renders nothing and the app is unaffected.
//
// Anatomy: draggable frameless strip with the app brand at the left and the
// custom window controls at the right, plus a thin bottom border in the rail's
// tone. Nothing in between — the old centre label and clock only duplicated the
// brand and the OS clock, so they were dropped.

import { useEffect, useState } from "react";
import { getVexaBridge, type VexaBridge } from "@/lib/electron";

const mono = "var(--font-mono)";
const BAR_H = 38;

export function TitleBar() {
  const [bridge, setBridge] = useState<VexaBridge | null>(null);
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    const b = getVexaBridge();
    if (!b) return;
    setBridge(b);
    // let the rest of the app make room for the bar
    document.documentElement.dataset.electron = "1";
    document.documentElement.style.setProperty("--titlebar-h", `${BAR_H}px`);
    const off = b.onMaximized(setIsMax);
    return () => {
      off();
      delete document.documentElement.dataset.electron;
      document.documentElement.style.removeProperty("--titlebar-h");
    };
  }, []);

  if (!bridge) return null;

  /* На маке окном управляет системный «светофор» (main.mjs: hiddenInset).
     Свои три кнопки там были бы вторым комплектом органов управления, поэтому
     справа их не рисуем, а слева освобождаем место под сам светофор. */
  const isMac = bridge.platform === "darwin";

  return (
    <div
      onDoubleClick={() => bridge.toggleMaximize()}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: BAR_H,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: 12,
        /* Слева — место под системный «светофор» macOS. Делим на масштаб
           интерфейса: кнопки рисует система, они не зумятся вместе со
           страницей, и при увеличенном масштабе отступ уезжал бы от них. */
        padding: isMac ? "0 14px 0 calc(84px / var(--ui-scale, 1))" : "0 0 0 12px",
        background: "var(--bg-sidebar)",
        WebkitAppRegion: "drag",
        userSelect: "none",
      } as React.CSSProperties}
    >
      <style>{`
        .vexa-tb-btn {
          -webkit-app-region: no-drag;
          width: 40px;
          height: ${BAR_H}px;
          border: none;
          background: transparent;
          color: var(--dim);
          font-family: ${mono};
          font-size: 11px;
          cursor: pointer;
          transition: background .12s ease, color .12s ease, box-shadow .12s ease;
        }
        .vexa-tb-btn:hover { background: var(--ink-06); color: var(--text) }
        .vexa-tb-btn.vexa-tb-close:hover {
          background: rgba(229, 72, 77, .85);
          color: #fff;
          box-shadow: 0 0 18px rgba(229, 72, 77, .4);
        }
      `}</style>

      {/* ── brand ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: "linear-gradient(150deg, var(--brand-soft), var(--brand-strong))", color: "#fff", fontSize: 8.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
          LU
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
          LEADUP CRM
        </span>
      </div>

      {/* Центр раньше держал слово «ПАРСЕР», справа тикали часы. Первое
          дублировало бренд слева, вторые — системные часы ОС в трёх сантиметрах
          выше. Обоих больше нет: в шапке только бренд и управление окном. */}
      <span style={{ flex: 1 }} />

      {/* ── window controls (нет на маке: там системный светофор) ── */}
      {!isMac && (
        <div style={{ display: "flex", flex: "none" }}>
          <button className="vexa-tb-btn" title="Свернуть" onClick={() => bridge.minimize()}>
            ─
          </button>
          <button className="vexa-tb-btn" title={isMax ? "Восстановить" : "Развернуть"} onClick={() => bridge.toggleMaximize()}>
            {isMax ? "❐" : "▢"}
          </button>
          <button className="vexa-tb-btn vexa-tb-close" title="Закрыть" onClick={() => bridge.close()}>
            ✕
          </button>
        </div>
      )}

      {/* ── нижняя граница ──
          Была переливающаяся сине-фиолетовая полоса: единственный движущийся
          элемент на неподвижном экране, он тянул взгляд к шапке, где ничего не
          происходит. Обычная граница того же тона, что у рельсы, — шапка и
          боковое меню читаются как одна поверхность. */}
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          background: "var(--ink-07)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
