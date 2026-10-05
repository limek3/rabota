import type { CSSProperties, ReactNode } from "react";

/**
 * Заглушки на время загрузки — той же формы, что страница: шапка, главный блок, показатели,
 * таблицы, графики, правая панель. Когда приходят данные, контент встаёт на их место без прыжков.
 * Новая страница или новая раскладка — поправить её заглушку здесь (BY_ROUTE).
 */

function B({ w = "100%", h = 12, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: r, flex: "none", ...style }} />;
}

function Card({ children, h, pad = 16, style }: { children?: ReactNode; h?: number; pad?: number; style?: CSSProperties }) {
  return (
    <div className="card sk-card" style={{ padding: pad, minHeight: h, ...style }}>
      {children}
    </div>
  );
}

/** Шапка страницы: название и подпись слева, кнопки справа. */
function Head({ controls = 3, sub = true }: { controls?: number; sub?: boolean }) {
  return (
    <div className="page-head">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <B w={170} h={26} r={7} />
        {sub && <B w={260} h={12} />}
      </div>
      {controls > 0 && (
        <div className="toolbar">
          {Array.from({ length: controls }, (_, i) => (
            <B key={i} w={i === controls - 1 ? 180 : 120} h={34} r={8} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Полоса показателей: подпись, число, пояснение — по центру колонок с разделителями. */
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

/** Плитки показателей отдельными карточками (kpi-grid). */
function Tiles({ n = 6 }: { n?: number }) {
  return (
    <div className="sk-tiles" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {Array.from({ length: n }, (_, i) => (
        <Card key={i} pad={14}>
          <B w="55%" h={10} />
          <B w="45%" h={22} r={5} style={{ marginTop: 10 }} />
          <B w="70%" h={9} style={{ marginTop: 8 }} />
        </Card>
      ))}
    </div>
  );
}

function Table({ rows = 10, cols = 7, head = true, group = false }: { rows?: number; cols?: number; head?: boolean; group?: boolean }) {
  const tpl = `2fr repeat(${cols - 1}, 1fr)`;
  return (
    <div className="sk-table">
      {head && (
        <div className="sk-tr sk-th" style={{ gridTemplateColumns: tpl }}>
          {Array.from({ length: cols }, (_, i) => (
            <B key={i} w={i ? "60%" : "45%"} h={10} />
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, r) =>
        group && r % 5 === 0 ? (
          <div key={r} className="sk-tr sk-grp" style={{ gridTemplateColumns: tpl }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <B w={10} h={10} r={3} />
              <B w="40%" h={12} />
            </div>
            {Array.from({ length: cols - 1 }, (_, i) => (
              <B key={i} w="35%" h={11} />
            ))}
          </div>
        ) : (
          <div key={r} className="sk-tr" style={{ gridTemplateColumns: tpl }}>
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
        ),
      )}
    </div>
  );
}

/** Карточка с графиком: заголовок, полоса показателей, столбцы. */
function Chart({ h = 300, strip = 4, bars = 14 }: { h?: number; strip?: number; bars?: number }) {
  return (
    <Card h={h}>
      <B w={220} h={14} />
      {strip > 0 && (
        <div style={{ marginTop: 14 }}>
          <Strip n={strip} />
        </div>
      )}
      <div className="sk-bars">
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} className="sk" style={{ height: `${25 + ((i * 37) % 70)}%` }} />
        ))}
      </div>
    </Card>
  );
}

/** Строка «человек»: аватар, имя с подписью, число справа. */
function Person({ i }: { i: number }) {
  return (
    <div className="sk-person">
      <B w={26} h={26} r={13} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        <B w={`${55 + ((i * 17) % 30)}%`} h={11} />
        <B w="40%" h={9} />
      </div>
      <B w={28} h={16} r={4} />
    </div>
  );
}

/** Сетка тепловой карты: имена слева, клетки дней. */
function Heat({ rows = 8, days = 31 }: { rows?: number; days?: number }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <B w={260} h={14} />
        <div style={{ display: "flex", gap: 18 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <B key={i} w={60} h={28} r={6} />
          ))}
        </div>
      </div>
      <div className="sk-heat" style={{ gridTemplateColumns: `120px repeat(${days}, minmax(14px, 1fr))` }}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} style={{ display: "contents" }}>
            <B w={`${60 + ((r * 13) % 30)}%`} h={10} style={{ alignSelf: "center" }} />
            {Array.from({ length: days }, (_, d) => (
              <div key={d} className="sk" style={{ height: 16, borderRadius: 3, opacity: (r * 3 + d) % 4 ? 0.55 : 1 }} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── страницы ─────────────────────────────────────────────────────── */

function Dashboard() {
  return (
    <>
      <Head controls={4} />
      {/* главный блок: факт | сегодня | вывод, показатели, шкала */}
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
      {/* люди периода: лучшие | отстают | вклад, факты */}
      <Card>
        <B w={200} h={14} />
        <div className="sk-cols3">
          {Array.from({ length: 3 }, (_, c) => (
            <div key={c}>
              <B w={90} h={10} />
              {Array.from({ length: 3 }, (_, i) => (
                <Person key={i} i={i + c} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <B key={i} w={190} h={28} r={14} />
          ))}
        </div>
      </Card>
      <div className="sk-grid2">
        <Chart />
        <Chart bars={7} />
      </div>
      <Card pad={0}>
        <div style={{ padding: 16 }}>
          <B w={200} h={14} />
        </div>
        <Table rows={9} cols={10} group />
      </Card>
      <Heat />
    </>
  );
}

/** «Лиды», «Операторы», «Зарплата»: шапка, плитки в одной карточке, фильтры, таблица и правая панель. */
function SidePage({ cols = 9, rows = 13, group = false }: { cols?: number; rows?: number; group?: boolean }) {
  return (
    <>
      <div className="o2-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <B w={150} h={26} r={7} />
          <B w={240} h={12} />
        </div>
        <div className="o2-tools">
          <B w={200} h={34} r={8} />
          <B w={240} h={34} r={9} />
          <B w={110} h={34} r={8} />
        </div>
      </div>
      <div className="o2-body has-side">
        <div className="o2-main">
          <Card pad={0}>
            <div className="sk-kpis6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i}>
                  <B w={34} h={34} r={9} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <B w="60%" h={10} />
                    <B w="45%" h={20} r={5} />
                    <B w="70%" h={9} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card pad={0} style={{ marginTop: 14 }}>
            <div className="sk-toolbar">
              <B w={260} h={32} r={8} />
              <B w={140} h={32} r={8} />
              <B w={140} h={32} r={8} />
            </div>
            <Table rows={rows} cols={cols} group={group} />
          </Card>
        </div>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <B w={40} h={40} r={20} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <B w="60%" h={13} />
              <B w="40%" h={10} />
            </div>
          </div>
          <B h={90} r={10} />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
              <B w={`${35 + ((i * 11) % 25)}%`} h={11} />
              <B w={60} h={11} />
            </div>
          ))}
        </Card>
      </div>
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

function Groups() {
  return (
    <>
      <Head controls={3} />
      <div className="sk-grid3">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} h={220}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <B w="45%" h={15} />
              <B w={60} h={20} r={10} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <B w="30%" h={30} r={6} />
              <B w="30%" h={30} r={6} />
              <B w="30%" h={30} r={6} />
            </div>
            <B h={8} r={4} style={{ marginTop: 18 }} />
            <B w="55%" h={10} style={{ marginTop: 16 }} />
          </Card>
        ))}
      </div>
    </>
  );
}

function Plans() {
  return (
    <>
      <Head controls={1} />
      <Tiles n={6} />
      {Array.from({ length: 2 }, (_, i) => (
        <Card key={i} pad={0}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: 16 }}>
            <B w={180} h={15} />
            <B w={150} h={30} r={8} />
          </div>
          <Table rows={5} cols={7} />
        </Card>
      ))}
    </>
  );
}

function Dynamics() {
  return (
    <>
      <Head controls={1} />
      <Tiles n={6} />
      <div className="sk-grid2">
        <Chart strip={0} />
        <Chart strip={0} bars={5} />
      </div>
      <Card pad={0}>
        <Table rows={8} cols={8} />
      </Card>
    </>
  );
}

function Hiring() {
  return (
    <>
      <Head controls={2} />
      <B w={360} h={34} r={9} />
      <Tiles n={6} />
      <Card>
        <B w={200} h={14} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
          {[100, 78, 55, 38, 26].map((w, i) => (
            <B key={i} w={`${w}%`} h={30} r={6} />
          ))}
        </div>
      </Card>
    </>
  );
}

function Projects() {
  return (
    <>
      <Head controls={0} />
      <div className="sk-aside" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card h={70}>
            <B w="50%" h={32} r={8} />
          </Card>
          <Card pad={0}>
            <Table rows={8} cols={6} />
          </Card>
        </div>
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <B w="50%" h={14} />
          {Array.from({ length: 6 }, (_, i) => (
            <B key={i} h={34} r={8} />
          ))}
        </Card>
      </div>
    </>
  );
}

function Reports() {
  return (
    <>
      <Head controls={2} />
      <B w={420} h={34} r={9} />
      <div className="sk-grid2">
        <Card h={520}>
          <B w="40%" h={14} />
          <B h={440} r={10} style={{ marginTop: 14 }} />
        </Card>
        <Card h={520}>
          <B w="40%" h={14} />
          <B h={440} r={10} style={{ marginTop: 14 }} />
        </Card>
      </div>
    </>
  );
}

function Settings() {
  return (
    <div style={{ maxWidth: 1100, display: "flex", flexDirection: "column", gap: 16 }}>
      <Head controls={0} />
      <B w={520} h={34} r={9} />
      {Array.from({ length: 3 }, (_, s) => (
        <Card key={s}>
          <B w={200} h={15} />
          <B w={340} h={10} style={{ marginTop: 8 }} />
          <div className="sk-grid3" style={{ marginTop: 16 }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <B w="50%" h={10} />
                <B h={34} r={8} />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** «Мой кабинет»: заработок, сегодня (смена и ступень), строка месяца, лиды и правая колонка. */
function Cabinet() {
  return (
    <>
      <Head controls={2} />
      <Card pad={0}>
        <div className="sk-hero" style={{ gridTemplateColumns: "1.2fr 1fr 1fr" }}>
          <div>
            <B w={200} h={11} />
            <B w={190} h={50} r={8} style={{ marginTop: 10 }} />
            <B w={160} h={9} style={{ marginTop: 8 }} />
          </div>
          <div>
            <B w={80} h={11} />
            <B w={110} h={30} r={7} style={{ marginTop: 10 }} />
            <B w={150} h={9} style={{ marginTop: 8 }} />
          </div>
          <div>
            <B w={150} h={11} />
            <B w={130} h={30} r={7} style={{ marginTop: 10 }} />
            <B h={6} r={3} style={{ marginTop: 10 }} />
          </div>
        </div>
        <Strip n={4} />
      </Card>
      <Card>
        <B w={110} h={14} />
        <B w={140} h={42} r={8} style={{ marginTop: 14 }} />
        <B h={6} r={3} style={{ marginTop: 12 }} />
        <div className="sk-aside" style={{ gridTemplateColumns: "1.5fr 1fr", marginTop: 16 }}>
          <B h={70} r={10} />
          <B h={150} r={10} />
        </div>
      </Card>
      <Card pad={0}>
        <Strip n={5} />
      </Card>
      <div className="sk-aside" style={{ gridTemplateColumns: "minmax(0, 1fr) 380px" }}>
        <Card pad={0}>
          <div style={{ padding: 16 }}>
            <B w={180} h={14} />
          </div>
          <Table rows={5} cols={6} head={false} />
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card h={120}>
            <B w="45%" h={14} />
            <B h={6} r={3} style={{ marginTop: 18 }} />
          </Card>
          <Card h={110}>
            <B w="40%" h={14} />
            <B w="70%" h={10} style={{ marginTop: 14 }} />
          </Card>
        </div>
      </div>
    </>
  );
}

/** «Мои показатели»: план с переключателем периода, показатели, графики, смены по дням, выработка. */
function Personal() {
  return (
    <>
      <Head controls={2} />
      <Card pad={0}>
        <div className="sk-hero" style={{ gridTemplateColumns: "290px minmax(0, 1fr)" }}>
          <div>
            <B w={70} h={11} />
            <B w={130} h={46} r={8} style={{ marginTop: 10 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <B w={290} h={34} r={9} />
            <B w={290} h={34} r={8} />
          </div>
        </div>
        <Strip n={7} />
        <div style={{ padding: "18px 26px 22px" }}>
          <B h={9} r={5} />
        </div>
      </Card>
      <Card pad={0}>
        <Strip n={6} />
      </Card>
      <div className="sk-grid2">
        <Chart />
        <Chart bars={7} />
      </div>
      <Heat rows={2} />
    </>
  );
}

/** «Обучение»: оглавление слева, содержание справа. */
function Learn() {
  return (
    <div className="sk-aside" style={{ gridTemplateColumns: "260px minmax(0, 1fr)" }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <B w="60%" h={14} />
        <B h={6} r={3} />
        {Array.from({ length: 9 }, (_, i) => (
          <B key={i} w={`${60 + ((i * 13) % 35)}%`} h={12} style={{ marginTop: i % 3 === 0 ? 10 : 0 }} />
        ))}
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card>
          <B w="35%" h={22} r={7} />
          <B w="70%" h={11} style={{ marginTop: 12 }} />
          <B w="60%" h={11} style={{ marginTop: 8 }} />
        </Card>
        <div className="sk-grid3">
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} h={150}>
              <B w="50%" h={13} />
              <B w="85%" h={10} style={{ marginTop: 12 }} />
              <B w="70%" h={10} style={{ marginTop: 8 }} />
              <B h={6} r={3} style={{ marginTop: 26 }} />
            </Card>
          ))}
        </div>
      </div>
    </div>
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
  "/leads": () => <SidePage cols={9} rows={14} />,
  "/operators": () => <SidePage cols={11} rows={12} group />,
  "/payroll": () => <SidePage cols={8} rows={12} group />,
  "/schedule": Schedule,
  "/groups": Groups,
  "/plans": Plans,
  "/dynamics": Dynamics,
  "/hiring": Hiring,
  "/projects": Projects,
  "/reports": Reports,
  "/settings": Settings,
  "/me": Cabinet,
  "/stats": Personal,
  "/learn": Learn,
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
        <div style={{ flex: 1 }} />
        <B h={92} r={10} />
        <B h={36} r={9} style={{ marginTop: 10 }} />
      </div>
      <main style={{ flex: 1, minWidth: 0, overflow: "hidden", background: "var(--bg)", border: "1px solid var(--ink-07)", borderRadius: 10, margin: 8, marginLeft: 0 }}>
        <div className="app-content" style={{ padding: "24px 30px 48px", maxWidth: 1680, margin: "0 auto" }}>
          <PageSkeleton route={route} />
        </div>
      </main>
    </div>
  );
}
