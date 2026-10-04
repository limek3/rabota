import type { CSSProperties, ReactNode } from "react";

/**
 * Заглушки на время загрузки — той же формы, что страница: шапка, полосы показателей, таблицы,
 * графики. Когда приходят данные, контент встаёт на их место без прыжков.
 */

function B({ w = "100%", h = 12, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

function Card({ children, h, pad = 16, style }: { children?: ReactNode; h?: number; pad?: number; style?: CSSProperties }) {
  return (
    <div className="card sk-card" style={{ padding: pad, minHeight: h, ...style }}>
      {children}
    </div>
  );
}

function Head({ controls = 3 }: { controls?: number }) {
  return (
    <div className="page-head">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <B w={170} h={26} r={7} />
        <B w={260} h={12} />
      </div>
      <div className="toolbar">
        {Array.from({ length: controls }, (_, i) => (
          <B key={i} w={i === controls - 1 ? 180 : 120} h={34} r={8} />
        ))}
      </div>
    </div>
  );
}

/** Полоса показателей: подпись, число, пояснение — по центру колонок. */
function Strip({ n = 6 }: { n?: number }) {
  return (
    <div className="sk-strip" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <B w="55%" h={10} />
          <B w="40%" h={20} r={5} />
          <B w="65%" h={9} />
        </div>
      ))}
    </div>
  );
}

function Table({ rows = 10, cols = 7, head = true }: { rows?: number; cols?: number; head?: boolean }) {
  return (
    <div className="sk-table">
      {head && (
        <div className="sk-tr sk-th" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
          {Array.from({ length: cols }, (_, i) => (
            <B key={i} w={i ? "60%" : "45%"} h={10} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-tr" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
          {Array.from({ length: cols }, (_, i) =>
            i === 0 ? (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <B w={22} h={22} r={11} />
                <B w={`${50 + ((r * 13) % 30)}%`} h={11} />
              </div>
            ) : (
              <B key={i} w={`${35 + ((r * 7 + i * 11) % 40)}%`} h={11} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function Chart({ h = 300 }: { h?: number }) {
  return (
    <Card h={h}>
      <B w={220} h={14} />
      <div style={{ marginTop: 14 }}>
        <Strip n={4} />
      </div>
      <div className="sk-bars">
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="sk" style={{ height: `${25 + ((i * 37) % 70)}%` }} />
        ))}
      </div>
    </Card>
  );
}

function Dashboard() {
  return (
    <>
      <Head controls={4} />
      <Card pad={0}>
        <div className="sk-hero">
          <div>
            <B w={70} h={11} />
            <B w={130} h={46} r={8} style={{ marginTop: 10 }} />
          </div>
          <div>
            <B w={110} h={11} />
            <B w={90} h={38} r={8} style={{ marginTop: 10 }} />
            <B w={150} h={9} style={{ marginTop: 8 }} />
          </div>
          <B h={58} r={8} />
        </div>
        <Strip n={7} />
        <div style={{ padding: "18px 26px 22px" }}>
          <B h={9} r={5} />
        </div>
      </Card>
      <Card>
        <B w={180} h={14} />
        <div className="sk-grid4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="sk-tile">
              <B w="70%" h={12} />
              <B w="90%" h={10} />
              <B w="50%" h={10} />
            </div>
          ))}
        </div>
      </Card>
      <div className="sk-grid2">
        <Chart />
        <Chart />
      </div>
      <Card pad={0}>
        <div style={{ padding: 16 }}>
          <B w={200} h={14} />
        </div>
        <Table rows={8} cols={10} />
      </Card>
    </>
  );
}

function TablePage({ strip = 6, cols = 8, rows = 12 }: { strip?: number; cols?: number; rows?: number }) {
  return (
    <>
      <Head />
      {strip > 0 && (
        <Card pad={0}>
          <Strip n={strip} />
        </Card>
      )}
      <Card pad={0}>
        <div className="sk-toolbar">
          <B w={260} h={32} r={8} />
          <B w={140} h={32} r={8} />
          <B w={140} h={32} r={8} />
        </div>
        <Table rows={rows} cols={cols} />
      </Card>
    </>
  );
}

function Schedule() {
  return (
    <>
      <Head controls={4} />
      <Card h={52} pad={12}>
        <B w="60%" h={26} r={7} />
      </Card>
      <Card pad={0}>
        <div className="sk-sched">
          {Array.from({ length: 12 }, (_, r) => (
            <div key={r} className="sk-sched-row">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <B w={22} h={22} r={11} />
                <B w={110} h={11} />
              </div>
              {Array.from({ length: 21 }, (_, i) => (
                <div key={i} className="sk" style={{ height: 30, borderRadius: 6, opacity: (r + i) % 3 ? 0.55 : 1 }} />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Cards({ n = 6 }: { n?: number }) {
  return (
    <>
      <Head controls={2} />
      <div className="sk-grid3">
        {Array.from({ length: n }, (_, i) => (
          <Card key={i} h={190}>
            <B w="50%" h={14} />
            <B w="80%" h={10} style={{ marginTop: 14 }} />
            <B w="65%" h={10} style={{ marginTop: 8 }} />
            <B w="100%" h={8} style={{ marginTop: 26 }} />
          </Card>
        ))}
      </div>
    </>
  );
}

function Generic() {
  return (
    <>
      <Head />
      <Card pad={0}>
        <Strip n={5} />
      </Card>
      <Chart h={320} />
      <Card pad={0}>
        <Table rows={6} cols={6} />
      </Card>
    </>
  );
}

const BY_ROUTE: Record<string, () => ReactNode> = {
  "/dashboard": Dashboard,
  "/leads": () => <TablePage strip={6} cols={9} rows={14} />,
  "/operators": () => <TablePage strip={6} cols={10} />,
  "/payroll": () => <TablePage strip={5} cols={9} />,
  "/plans": () => <TablePage strip={4} cols={7} />,
  "/projects": () => <TablePage strip={0} cols={6} rows={8} />,
  "/hiring": () => <TablePage strip={5} cols={7} />,
  "/schedule": Schedule,
  "/groups": () => <Cards n={6} />,
  "/learn": () => <Cards n={6} />,
};

/** Заглушка страницы по разделу: /dashboard, /leads… Неизвестный раздел — общая. */
export function PageSkeleton({ route }: { route: string }) {
  const View = BY_ROUTE[route] ?? Generic;
  return (
    <div className="stack sk-page" aria-busy aria-label="Загрузка">
      <View />
    </div>
  );
}

/** Пока проверяется вход: меню слева и заглушка страницы — вместо пустого экрана. */
export function ShellSkeleton({ route }: { route: string }) {
  return (
    <div style={{ display: "flex", height: "calc(100vh / var(--ui-scale, 1) - var(--titlebar-h, 0px))", overflow: "clip", background: "var(--bg-sidebar)" }}>
      <div className="sk-rail">
        <B h={36} r={9} />
        {Array.from({ length: 12 }, (_, i) => (
          <B key={i} w={`${55 + ((i * 17) % 35)}%`} h={12} style={{ marginTop: i % 4 === 0 ? 22 : 12 }} />
        ))}
      </div>
      <main style={{ flex: 1, minWidth: 0, overflow: "hidden", background: "var(--bg)", border: "1px solid var(--ink-07)", borderRadius: 10, margin: 8, marginLeft: 0 }}>
        <div className="app-content" style={{ padding: "24px 30px 48px", maxWidth: 1680, margin: "0 auto" }}>
          <PageSkeleton route={route} />
        </div>
      </main>
    </div>
  );
}
