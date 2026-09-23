"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import {
  ASIDE,
  DATA_AS_OF,
  PROGRAMS,
  ROLES,
  academyRole,
  blockerOf,
  certNo,
  courseById,
  courseProg,
  isDone,
  lib,
  naturalSection,
  neighbours,
  nextUp,
  progIds,
  progLabel,
  progMap,
  programItems,
  progressAll,
  realItems,
  roleCourses,
  sectionItems,
  sectionName,
  sectionsFor,
  type AcademyRole,
  type Course,
  type LearnItem,
  type Lib,
  type SectionId,
  type WidgetId,
} from "@/lib/learn";
import { REFS } from "@/lib/learn";
import { firstName } from "@/lib/crm/format";
import { Icon, type IconName } from "@/components/ui/icons";
import { Avatar, Collapse } from "@/components/ui/kit";
import { Lesson } from "@/components/learn/Blocks";
import { Quiz } from "@/components/learn/Quiz";
import { Widget } from "@/components/learn/Widgets";
import { AcademyRoleProvider, Bar, Cards, LSec, PageHead, Rows, Subline, Tiles, type CardDef } from "@/components/learn/kit";
import { SectionPage, type Ctx } from "@/components/learn/Sections";

/**
 * «Академия обзвона» внутри платформы.
 *
 * Разделы, программы, дерево курсов, тесты, справочники, тренажёры, заметки и
 * сертификаты — как в исходных материалах. Наше здесь только оболочка:
 * типографика CRM, прогресс на аккаунт и раздел «Обучение команды».
 */

interface Local {
  progName: string;
  track: string;
  ctx: string;
  seen: string[];
  open: Record<string, boolean>;
  /** Скрипты в режиме «Только реплики» (если он есть в академии роли). */
  runMode: boolean;
}

const EMPTY_LOCAL: Local = { progName: "both", track: "all", ctx: "", seen: [], open: {}, runMode: true };

const DRAWERS: Record<string, { t: string; s: string; go: SectionId; w: WidgetId }> = {
  "st-re": { t: "Статусы — Недвижимость", s: "Что ставить после разговора", go: "statuses", w: "st-re" },
  "st-auto": { t: "Статусы — Авто", s: "Коды автотемы", go: "statuses", w: "st-auto" },
  "obj-re": { t: "Возражения — Недвижимость", s: "Готовые ответы клиенту", go: "objections", w: "obj-re" },
  "obj-auto": { t: "Возражения — Авто", s: "Готовые ответы клиенту", go: "objections", w: "obj-auto" },
  prices: { t: "Вилки цен по городам", s: "Нижняя граница по комнатности", go: "realty", w: "prices" },
  "auto-prices": { t: "Цены по маркам", s: "Стартовые цены — ориентир для разговора", go: "autoprices", w: "auto-prices" },
  "auto-cities": { t: "Города и расстояния", s: "До дилерских центров Москвы и СПб", go: "cities", w: "auto-cities" },
  gloss: { t: "Глоссарий", s: "Недвижимость, авто и внутренние слова", go: "gloss", w: "gloss" },
};

export function Academy() {
  const { data, me, saveLearn, toast } = useCrm();
  const role = academyRole(me.role);
  const L = lib(role);
  const prog = useMemo(() => progMap(data.learn, me.id), [data.learn, me.id]);

  const [sec, setSec] = useState<SectionId>("home");
  const [itemId, setItemId] = useState<string | null>(null);
  const [certId, setCertId] = useState<string | null>(null);
  const [filter, setFilter] = useState("realty");
  const [drawer, setDrawer] = useState<string | null>(null);
  const [local, setLocal] = useState<Local>(EMPTY_LOCAL);

  const key = `leadup.learn.${me.id}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setLocal(raw ? { ...EMPTY_LOCAL, ...(JSON.parse(raw) as Local) } : EMPTY_LOCAL);
    } catch {
      setLocal(EMPTY_LOCAL);
    }
  }, [key]);

  const patchLocal = useCallback(
    (p: Partial<Local>) =>
      setLocal((s) => {
        const next = { ...s, ...p };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* приватный режим — просто не сохраняем */
        }
        return next;
      }),
    [key],
  );

  /* ссылка вида /learn/?sec=pay&item=r51 — из кабинета, палитры и «Ссылка» */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("sec") as SectionId | null;
    const i = q.get("item");
    const c = q.get("course");
    if (s) setSec(s);
    if (i && lib(role).byId.has(i)) {
      setItemId(i);
      if (!s) setSec(naturalSection(role, i));
    } else if (c && courseById(role, c)) {
      const first = realItems(courseById(role, c)!)[0];
      setSec("courses");
      if (first) setItemId(first.id);
    }
  }, [role]);

  /* сменили аккаунт — материал чужой роли больше не наш: возвращаемся на главную */
  const accRef = useRef(me.id);
  useEffect(() => {
    if (accRef.current === me.id) return;
    accRef.current = me.id;
    setSec("home");
    setItemId(null);
    setCertId(null);
    setDrawer(null);
  }, [me.id]);

  /* адрес держим в актуальном виде, чтобы ссылкой можно было поделиться */
  useEffect(() => {
    const q = new URLSearchParams();
    if (sec !== "home") q.set("sec", sec);
    if (itemId) q.set("item", itemId);
    if (certId) q.set("cert", certId);
    const s = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, [sec, itemId, certId]);

  const go = useCallback((next: SectionId) => {
    setSec(next);
    setItemId(null);
    setCertId(null);
    setDrawer(null);
    window.scrollTo({ top: 0 });
  }, []);

  const openItem = useCallback(
    (id: string, target?: SectionId) => {
      let next = id;
      let s = target ?? naturalSection(role, id);
      const it = L.byId.get(next);
      const gated = s === "courses" || !!it?.quiz;
      const bl = gated ? blockerOf(prog, role, next) : null;
      if (bl) {
        toast(`Сначала пройдите: ${bl.t}`, "info");
        next = bl.id;
        s = naturalSection(role, next);
      }
      const c = L.itemCourse.get(next);
      if (c && (c.track === "auto" || c.track === "realty")) patchLocal({ ctx: c.track });
      if (s === "courses" && c) {
        const m = L.itemModule.get(next);
        patchLocal({
          track: local.track !== "all" && local.track !== c.id ? c.id : local.track,
          open: m ? { ...local.open, [m.t]: true } : local.open,
        });
      }
      patchLocal({ seen: [next, ...local.seen.filter((x) => x !== next)].slice(0, 10) });
      setSec(s);
      setCertId(null);
      setDrawer(null);
      setItemId(next);
      window.scrollTo({ top: 0 });
    },
    [L, local.open, local.seen, local.track, patchLocal, prog, role, toast],
  );

  const openCourse = useCallback(
    (id: string) => {
      const c = courseById(role, id);
      if (!c) return;
      const inRole = PROGRAMS[role].includes(id);
      const items = realItems(c);
      const first = items.find((i) => !isDone(prog, i.id)) ?? items[0];
      if (!first) return;
      if (inRole) {
        patchLocal({ track: id, open: { [L.itemModule.get(first.id)?.t ?? ""]: true } });
        openItem(first.id, "courses");
      } else openItem(first.id, role === "supervisor" ? "opmat" : "courses");
    },
    [L, openItem, patchLocal, prog, role],
  );

  const openCert = useCallback((id: string) => {
    setCertId(id);
    setItemId(null);
    window.scrollTo({ top: 0 });
  }, []);

  /** «Начать новую смену» — снимаем отметки чек-листов роли. */
  const newShift = useCallback(async () => {
    const items = sectionItems(role, "checklists");
    for (const i of items) {
      const rec = prog.get(i.id);
      if (rec?.checks?.length) await saveLearn(L.itemCourse.get(i.id)?.id ?? "", i.id, { checks: [] });
    }
    toast("Чек-листы очищены — можно начинать смену", "info");
  }, [L, prog, role, saveLearn, toast]);

  const ctx: Ctx = {
    role,
    prog,
    progName: local.progName,
    setProgName: (p) => patchLocal({ progName: p }),
    sec,
    open: (id) => openItem(id),
    go,
    openCourse,
    openCert,
    filter,
    setFilter,
    newShift,
    runMode: local.runMode,
    setRunMode: (v) => patchLocal({ runMode: v }),
  };

  const item = itemId ? L.byId.get(itemId) ?? null : null;
  const showAside = sec !== "courses" && sec !== "tests" && sec !== "team" && !item?.quiz && !certId;
  const track = role === "supervisor" ? "sv" : local.ctx === "auto" || local.ctx === "realty" ? local.ctx : itemTrack(L, item) ?? "realty";

  return (
    <AcademyRoleProvider value={role}>
      <div className="lrn-shell">
        <LearnNav sec={sec} role={me.role} go={go} />

        {sec === "courses" && (
          <CourseTree
            role={role}
            prog={prog}
            activeId={itemId}
            track={local.track}
            open={local.open}
            setTrack={(t) => patchLocal({ track: t })}
            toggle={(t) => patchLocal({ open: { ...local.open, [t]: !(local.open[t] ?? false) } })}
            onOpen={(id) => openItem(id, "courses")}
            onLock={(t) => toast(`Сначала пройдите: ${t}`, "info")}
          />
        )}

        <main className={`lrn-main${item && sec !== "courses" ? " reader" : ""}`}>
          {certId ? (
            <CertPage role={role} id={certId} onBack={() => go("progress")} />
          ) : item ? (
            <ItemView item={item} ctx={ctx} onOpen={openItem} onCert={openCert} />
          ) : sec === "home" ? (
            <Home ctx={ctx} seen={local.seen} />
          ) : sec === "courses" ? (
            <CoursesIntro ctx={ctx} />
          ) : sec === "notes" ? (
            <NotesPage ctx={ctx} />
          ) : sec === "team" ? (
            <TeamPage />
          ) : (
            <SectionPage ctx={ctx} />
          )}
        </main>

        {showAside && (
          <AsidePanel
            track={track}
            role={role}
            prog={prog}
            ctx={ctx}
            onDrawer={setDrawer}
            setTrack={(v) => patchLocal({ ctx: v })}
          />
        )}

        {drawer && <Drawer id={drawer} onClose={() => setDrawer(null)} go={go} />}
      </div>
    </AcademyRoleProvider>
  );
}

const itemTrack = (L: Lib, i: LearnItem | null): string | null => {
  const t = i ? L.itemCourse.get(i.id)?.track : null;
  return t === "auto" || t === "realty" ? t : null;
};

/* ── навигация по разделам ─────────────────────────────────────── */

function LearnNav({ sec, role, go }: { sec: SectionId; role: Parameters<typeof sectionsFor>[0]; go: (s: SectionId) => void }) {
  return (
    <nav className="lrn-nav">
      {sectionsFor(role).map((g) => (
        <div key={g.g}>
          <div className="lrn-navg">{g.g}</div>
          {g.items.map((n) => (
            <button key={n.id} className={`lrn-navi${sec === n.id ? " on" : ""}`} onClick={() => go(n.id)}>
              <Icon name={n.i} size={16} />
              <span>{n.t}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/* ── главная ───────────────────────────────────────────────────── */

function Home({ ctx, seen }: { ctx: Ctx; seen: string[] }) {
  const { me } = useCrm();
  const op = ctx.role === "operator";
  const pr = progressAll(ctx.prog, ctx.role, ctx.progName);
  const nx = nextUp(ctx.prog, ctx.role, ctx.progName);
  const L = lib(ctx.role);
  const course = nx ? L.itemCourse.get(nx.id) : null;
  const quizItems = programItems(ctx.role, ctx.progName).filter((i) => i.quiz);
  const passed = quizItems.filter((i) => ctx.prog.get(i.id)?.pass).length;
  const d = new Date();
  const days = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const hi = d.getHours() < 5 ? "Доброй ночи" : d.getHours() < 12 ? "Доброе утро" : d.getHours() < 18 ? "Добрый день" : "Добрый вечер";
  const seenItems = seen.map((id) => L.byId.get(id)).filter(Boolean) as LearnItem[];

  const work: CardDef[] = op
    ? [
        { t: "Скрипты звонка", d: "Открытие, квалификация, перевод — по недвижимости и авто", go: "scripts", i: "doc" },
        { t: "Возражения", d: "20 готовых ответов и тренажёр карточками", go: "objections", i: "chat" },
        { t: "Статусы Скорозвона", d: "Что ставить после разговора, с тренажёром", go: "statuses", i: "list" },
        { t: "Чек-листы", d: "Проверить себя перед переводом лида", go: "checklists", i: "clip" },
      ]
    : [
        { t: "Скрипт интервью", d: "Телефонное интервью с кандидатом, 10 минут", go: "scripts", i: "doc" },
        { t: "Чек-листы", d: "Интервью, первый день, оформление, отставание", go: "checklists", i: "clip" },
        { t: "Регламенты", d: "Обучение новичка, оформление, невыполнение плана", go: "regs", i: "rules" },
        { t: "Мотивация и бонус", d: "Грейды, сетка, апрув и калькулятор", go: "money", i: "money" },
      ];
  const refs: CardDef[] = op
    ? [
        { t: "Новостройки: цены", d: `Вилки по ${REFS.prices.length} городам и зоны перевода`, go: "realty", i: "build" },
        { t: "Авто: цены", d: `${REFS.autoPrices.length} марок со стартовыми ценами`, go: "autoprices", i: "car" },
        { t: "Города и расстояния", d: "До дилерских центров Москвы и СПб", go: "cities", i: "pin" },
        { t: "Глоссарий", d: `${REFS.glossary.length} терминов простыми словами`, go: "gloss", i: "book" },
      ]
    : [
        { t: "Базы и лиды", d: "Откуда приходит база и сколько её хватает", go: "bases", i: "base" },
        { t: "Материалы операторов", d: "Скрипты и справочники, по которым учите группу", go: "opmat", i: "users" },
        { t: "Тесты", d: "Проверка знаний и аттестация супервайзера", go: "tests", i: "test" },
      ];

  const pickCard = (c: CardDef) => {
    if (c.go) ctx.go(c.go as SectionId);
    else if (c.id) ctx.open(c.id);
  };

  return (
    <>
      <div className="dateline">
        <b>
          {hi}
          {me.name ? `, ${firstName(me.name)}` : ""}
        </b>
        <span>·</span>
        <span>
          {days[d.getDay()]}, {d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </span>
      </div>
      <h1 className="lpg">{op ? "Рабочий стол оператора" : "Рабочий стол супервайзера"}</h1>
      <p className="lead">
        {op
          ? "Всё для звонка: продукт, Скорозвон, скрипт, возражения и расчёт смены. Слева — обучение по шагам, в звонке — справочники и чек-листы."
          : "Всё для работы с группой: найм и вывод новичка, график и план, деньги и базы. Материалы операторов лежат отдельно — по ним вы проводите обучение."}
      </p>

      {nx ? (
        <div className="contcard">
          <div className="cc">
            <div className="eyebrow">
              {pr.d ? "Продолжить обучение" : "Начать обучение"} · {progLabel(ctx.role, ctx.progName)}
            </div>
            <h2>{nx.t}</h2>
            <p>
              {course?.title} · {L.itemModule.get(nx.id)?.t} · {nx.k}, {nx.m}
            </p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => ctx.open(nx.id)}>
            {pr.d ? "Продолжить" : "Начать"} <Icon name="arrowR" size={15} />
          </button>
        </div>
      ) : (
        <div className="contcard done">
          <div className="cc">
            <div className="eyebrow">Программа пройдена · {progLabel(ctx.role, ctx.progName)}</div>
            <h2>Обучение завершено</h2>
            <p>
              {pr.n} из {pr.n} материалов. Возвращайтесь к справочникам во время смен и пересдавайте тесты, когда нужно
              освежить знания.
            </p>
          </div>
          <button className="btn btn-lg" onClick={() => ctx.go("progress")}>
            Мой прогресс <Icon name="arrowR" size={15} />
          </button>
        </div>
      )}

      <Tiles
        items={[
          { l: "Пройдено материалов", v: pr.d, u: `из ${pr.n}`, s: `${pr.p}% программы «${progLabel(ctx.role, ctx.progName)}»` },
          { l: "Тестов сдано", v: passed, u: `из ${quizItems.length}`, s: "проходной балл 80%" },
          {
            l: "Моя программа",
            v: <span style={{ fontSize: 19, letterSpacing: "-.4px" }}>{progLabel(ctx.role, ctx.progName)}</span>,
            s: `${progIds(ctx.role, ctx.progName).length === 1 ? "один курс" : `${progIds(ctx.role, ctx.progName).length} курса`} · ${programItems(ctx.role, ctx.progName).length} материалов`,
          },
          op
            ? {
                l: "Марок и городов",
                v: REFS.autoPrices.length + REFS.prices.length + REFS.autoCities.length,
                s: "в справочниках",
              }
            : {
                l: "Чек-листов и регламентов",
                v: sectionItems(ctx.role, "checklists").length + sectionItems(ctx.role, "regs").length,
                s: "в разделе «В работе»",
              },
        ]}
      />

      <LSec>Программы обучения</LSec>
      <Subline>Проходите по порядку: каждый модуль заканчивается тестом, аттестация — в конце программы.</Subline>
      <div className="lgrid">
        {roleCourses(ctx.role).map((c) => {
          const p = courseProg(ctx.prog, c);
          return (
            <button className="lcard" key={c.id} onClick={() => ctx.openCourse(c.id)}>
              <span className="ci2">
                <Icon name={c.track === "auto" ? "car" : c.role === "supervisor" ? "users" : "chat"} size={18} />
              </span>
              <span className="ct">{c.title}</span>
              <span className="cd">{c.desc}</span>
              <span className="cf">
                {p.n} материалов <Bar pct={p.p} /> <b className="num">{p.p}%</b>
              </span>
            </button>
          );
        })}
      </div>

      <LSec>{op ? "Что нужно в звонке" : "Что нужно в работе"}</LSec>
      <Cards cards={work} onPick={pickCard} />

      <LSec>{op ? "Справочники" : "Данные и группа"}</LSec>
      <Cards cards={refs} onPick={pickCard} />

      {seenItems.length > 0 && (
        <>
          <LSec>Недавно открытое</LSec>
          <Rows items={seenItems.slice(0, 5)} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
        </>
      )}
    </>
  );
}

/* ── курсы: дерево и заставка ──────────────────────────────────── */

function CourseTree({
  role,
  prog,
  activeId,
  track,
  open,
  setTrack,
  toggle,
  onOpen,
  onLock,
}: {
  role: AcademyRole;
  prog: ReturnType<typeof progMap>;
  activeId: string | null;
  track: string;
  open: Record<string, boolean>;
  setTrack: (t: string) => void;
  toggle: (t: string) => void;
  onOpen: (id: string) => void;
  onLock: (t: string) => void;
}) {
  const courses = roleCourses(role).filter((c) => track === "all" || c.id === track);
  const mods: { n: number; c: Course; m: { t: string; items: LearnItem[] }; items: LearnItem[] }[] = [];
  let n = 0;
  for (const c of courses)
    for (const m of c.modules) {
      n++;
      mods.push({ n, c, m, items: m.items.filter((i) => !i.from) });
    }
  const activeMod = activeId ? lib(role).itemModule.get(activeId)?.t : null;
  const tabs = [{ v: "all", t: "Все курсы" }, ...roleCourses(role).map((c) => ({ v: c.id, t: c.title.replace(/^Оператор — /, "") }))];

  return (
    <div className="tree">
      <h1>Курсы</h1>
      <div className="tree-tabs">
        {tabs.map((t) => (
          <button key={t.v} className={track === t.v ? "on" : ""} onClick={() => setTrack(t.v)}>
            {t.t}
          </button>
        ))}
      </div>
      {mods.map((x) => {
        const isOpen = open[x.m.t] ?? activeMod === x.m.t;
        const dn = x.items.filter((i) => isDone(prog, i.id)).length;
        return (
          <div className="mod" key={`${x.c.id}-${x.m.t}`}>
            <button className={`modhd${isOpen ? " open" : ""}`} onClick={() => toggle(x.m.t)}>
              <span className="cv">
                <Icon name="chevR" size={15} />
              </span>
              <span className="mt">
                <b>
                  {x.n}. {x.m.t.replace(/^Модуль \d+\.\s*/, "")}
                </b>
                <span>
                  {x.items.length} {x.items.length === 1 ? "урок" : x.items.length < 5 ? "урока" : "уроков"}
                  {dn ? ` · пройдено ${dn}` : ""}
                </span>
              </span>
            </button>
            <Collapse open={isOpen}>
              <div className="mitems">
                {x.items.map((i, k) => {
                  const bl = blockerOf(prog, role, i.id);
                  const lock = !!bl && i.id !== activeId;
                  const done = isDone(prog, i.id);
                  const icon: IconName = done ? "checkc" : i.id === activeId ? "playc" : lock ? "lock" : "circle";
                  return (
                    <button
                      key={i.id}
                      className={`mitem${i.id === activeId ? " on" : ""}${done ? " done" : ""}${lock ? " lock" : ""}`}
                      onClick={() => (lock ? onLock(bl!.t) : onOpen(i.id))}
                    >
                      <span className="st">
                        <Icon name={icon} size={lock ? 14 : 17} stroke={1.6} />
                      </span>
                      <span className="tx">
                        {x.n}.{k + 1} {i.t}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Collapse>
          </div>
        );
      })}
      <div className="treefoot">
        Программа роли «{ROLES[role].toLowerCase()}» · {mods.length} {mods.length === 1 ? "модуль" : mods.length < 5 ? "модуля" : "модулей"}
      </div>
    </div>
  );
}

function CoursesIntro({ ctx }: { ctx: Ctx }) {
  const nx = nextUp(ctx.prog, ctx.role, ctx.progName);
  return (
    <>
      <PageHead
        title="Курсы"
        onHome={() => ctx.go("home")}
        lead="Программа роли по порядку: модуль за модулем. Следующий материал открывается, когда пройден предыдущий, а модуль закрывается тестом."
      />
      <div className="lrn-list">
        {roleCourses(ctx.role).map((c) => {
          const p = courseProg(ctx.prog, c);
          return (
            <button className="lrn-row" key={c.id} onClick={() => ctx.openCourse(c.id)}>
              <span className="ri">
                <Icon name={c.track === "auto" ? "car" : c.role === "supervisor" ? "users" : "chat"} size={16} />
              </span>
              <span className="rt">
                <b>{c.title}</b>
                <span>{c.desc}</span>
              </span>
              <span className="rprog">
                <Bar pct={p.p} />
                <b className="num">{p.p}%</b>
              </span>
              <span className="rc">
                <Icon name="chevR" size={14} />
              </span>
            </button>
          );
        })}
      </div>
      {nx && (
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => ctx.open(nx.id)}>
            Продолжить: {nx.t} <Icon name="arrowR" size={14} />
          </button>
        </div>
      )}
    </>
  );
}

/* ── материал ──────────────────────────────────────────────────── */

function ItemView({
  item,
  ctx,
  onOpen,
  onCert,
}: {
  item: LearnItem;
  ctx: Ctx;
  onOpen: (id: string, sec?: SectionId) => void;
  onCert: (id: string) => void;
}) {
  const { saveLearn, toast } = useCrm();
  const inCourse = ctx.sec === "courses";
  const L = lib(ctx.role);
  const c = L.itemCourse.get(item.id);
  const m = L.itemModule.get(item.id);
  const list = inCourse && c ? realItems(c) : sectionItems(ctx.role, ctx.sec);
  const idx = list.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  const total = list.length;
  const pos = idx >= 0 ? idx + 1 : 1;
  const doneN = list.filter((i) => isDone(ctx.prog, i.id)).length;
  const cpct = total ? Math.round((doneN / total) * 100) : 0;
  const done = isDone(ctx.prog, item.id);
  const blocker = blockerOf(ctx.prog, ctx.role, item.id);
  const courseId = c?.id ?? "";

  const num = useMemo(() => {
    if (!inCourse || !c || !m) return "";
    const mods = roleCourses(ctx.role).flatMap((cc) => cc.modules.map((mm) => ({ c: cc, m: mm })));
    const n = mods.findIndex((x) => x.m === m) + 1;
    const k = m.items.filter((i) => !i.from).findIndex((i) => i.id === item.id) + 1;
    return `${n}.${k} `;
  }, [c, ctx.role, inCourse, item.id, m]);

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?sec=${ctx.sec}&item=${item.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast("Ссылка на материал скопирована", "ok"))
      .catch(() => toast("Браузер не дал скопировать", "err"));
  };

  return (
    <>
      <div className="crumbrow">
        <div className="crumbs">
          {inCourse && c ? (
            <>
              <button onClick={() => ctx.go("courses")}>Курсы</button>
              <Icon name="chevR" size={12} />
              <button onClick={() => ctx.openCourse(c.id)}>{c.title}</button>
              <Icon name="chevR" size={12} />
              <b>
                {num}
                {item.t}
              </b>
            </>
          ) : (
            <>
              <button onClick={() => ctx.go(ctx.sec)}>{sectionName(ctx.role, ctx.sec)}</button>
              <Icon name="chevR" size={12} />
              <b>{item.t}</b>
            </>
          )}
        </div>
        {total > 1 && (
          <div className="lprog">
            <span className="t">
              {item.quiz ? "Тест" : "Материал"} {pos} из {total} · пройдено
            </span>
            <Bar pct={cpct} />
            <b className="num">{cpct}%</b>
          </div>
        )}
      </div>

      <div className="kindrow">
        <span className="lpill g">{item.k}</span>
        <span className="lpill g">{item.m}</span>
        <span className="lpill g">{inCourse ? m?.t : c?.title}</span>
      </div>
      <h1 className="lpg">{item.t}</h1>

      {item.quiz ? (
        <Quiz item={item} onOpen={(id) => onOpen(id)} onCert={onCert} />
      ) : (
        <>
          {item.b && <Lesson item={item} runMode={ctx.runMode} onRunMode={ctx.setRunMode} />}
          {item.w && <div className="wbox">{<Widget id={item.w} />}</div>}
        </>
      )}

      {inCourse && !done && (
        <div className="gatehint">
          <Icon name="lock" size={14} />
          <span>
            {item.quiz
              ? "Следующий материал откроется только после результата 80% и выше. Отметить тест пройденным вручную нельзя."
              : "Отметьте материал пройденным — следующий урок откроется сразу."}
          </span>
        </div>
      )}

      <div className="docnav">
        {prev ? (
          <button className="btn" onClick={() => onOpen(prev.id, ctx.sec)}>
            <Icon name="arrowL" size={15} /> Назад
          </button>
        ) : (
          <button className="btn" onClick={() => (inCourse && c ? ctx.openCourse(c.id) : ctx.go(ctx.sec))}>
            <Icon name="arrowL" size={15} /> {inCourse ? "К разделу" : "К списку"}
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={copyLink} title="Скопировать ссылку на этот материал">
          <Icon name="link" size={15} /> Ссылка
        </button>
        {item.quiz ? (
          done && (
            <span className="btn done">
              <Icon name="check" size={15} stroke={2.4} /> Тест сдан
            </span>
          )
        ) : blocker && !done ? (
          <button className="btn locked" onClick={() => toast(`Сначала пройдите: ${blocker.t}`, "info")}>
            <Icon name="lock" size={14} /> Урок пройден
          </button>
        ) : (
          <button
            className={`btn ${done ? "done" : "btn-primary"}`}
            onClick={() => void saveLearn(courseId, item.id, { done: !done })}
          >
            <Icon name="check" size={15} stroke={2.4} /> {done ? "Пройдено" : "Урок пройден"}
          </button>
        )}
        {next ? (
          inCourse && !done ? (
            <button className="btn locked" onClick={() => toast(`Сначала отметьте: ${item.t}`, "info")}>
              <Icon name="lock" size={14} /> Далее
            </button>
          ) : (
            <button className="btn" onClick={() => onOpen(next.id, ctx.sec)}>
              Далее <Icon name="arrowR" size={15} />
            </button>
          )
        ) : (
          <button className="btn" onClick={() => (inCourse && c ? ctx.openCourse(c.id) : ctx.go(ctx.sec))}>
            {inCourse ? "К разделу" : "К списку"} <Icon name="arrowR" size={15} />
          </button>
        )}
      </div>

      <NotePanel item={item} courseId={courseId} />
    </>
  );
}

/** Личная заметка и избранное — как в исходной академии, но в аккаунте. */
function NotePanel({ item, courseId }: { item: LearnItem; courseId: string }) {
  const { data, me, saveLearn } = useCrm();
  const rec = data.learn.find((l) => l.id === `${me.id}|${item.id}`);
  const [text, setText] = useState(rec?.note ?? "");
  const saved = rec?.note ?? "";
  useEffect(() => setText(saved), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // сохраняем сами, как в исходной академии: пауза в наборе — и заметка записана
  useEffect(() => {
    if (text === saved) return;
    const t = setTimeout(() => void saveLearn(courseId, item.id, { note: text }), 600);
    return () => clearTimeout(t);
  }, [text, saved, courseId, item.id, saveLearn]);
  const fav = !!rec?.fav;
  return (
    <div className="notepanel">
      <div className="row" style={{ gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h3 className="lsub" style={{ margin: 0, flex: 1 }}>
          Моя заметка к материалу
        </h3>
        <button
          className={`btn btn-sm${fav ? " fav" : ""}`}
          onClick={() => void saveLearn(courseId, item.id, { fav: !fav })}
        >
          <Icon name="star" size={14} /> {fav ? "В избранном" : "В избранное"}
        </button>
      </div>
      <textarea
        className="note-edit"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Формулировка, которая сработала. Вопрос наставнику. Цифра, которую забываете."
      />
      <div className="chknote">Сохраняется автоматически в вашем профиле. Все заметки — на странице «Мои заметки».</div>
    </div>
  );
}

/* ── заметки ───────────────────────────────────────────────────── */

function NotesPage({ ctx }: { ctx: Ctx }) {
  const { data, me } = useCrm();
  const { byId } = lib(ctx.role);
  const mine = data.learn.filter((l) => l.accountId === me.id);
  const notes = mine.filter((l) => (l.note ?? "").trim() && byId.has(l.itemId));
  const favs = mine.filter((l) => l.fav && byId.has(l.itemId));
  return (
    <>
      <PageHead
        title="Мои заметки"
        onHome={() => ctx.go("home")}
        lead="Личные пометки к материалам и избранное. Видно только вам — и на любом устройстве, где вы работаете под своим аккаунтом."
      />
      <LSec count={favs.length}>Избранное</LSec>
      {favs.length ? (
        <Rows items={favs.map((l) => byId.get(l.itemId)!) } onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
      ) : (
        <div className="lrn-list">
          <div className="lrn-empty">
            Отмечайте звёздочкой то, к чему возвращаетесь: скрипт, справочник, чек-лист. Кнопка — внизу каждого материала.
          </div>
        </div>
      )}
      <LSec count={notes.length}>Заметки</LSec>
      {notes.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.map((l) => (
            <div className="qacard" key={l.itemId}>
              <div className="q" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ flex: 1 }}>{byId.get(l.itemId)?.t}</span>
                <button className="btn btn-sm" onClick={() => ctx.open(l.itemId)}>
                  Открыть
                </button>
              </div>
              <div className="a" style={{ whiteSpace: "pre-wrap" }}>
                {l.note}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="lrn-list">
          <div className="lrn-empty">
            Внизу каждого материала есть поле для заметки: формулировка, которая сработала, вопрос наставнику, цифра, которую
            забываете.
          </div>
        </div>
      )}
    </>
  );
}

/* ── обучение команды (наш раздел) ─────────────────────────────── */

function TeamPage() {
  const { data, access } = useCrm();
  const accounts = data.accounts.filter((a) => !a.deletedAt && a.active && a.role !== "head");
  const rows = accounts.map((a) => {
    const p = progMap(data.learn, a.id);
    const r = academyRole(a.role);
    const pr = progressAll(p, r);
    const tests = programItems(r).filter((i) => i.quiz);
    const passed = tests.filter((i) => p.get(i.id)?.pass).length;
    return { a, pr, tests: tests.length, passed };
  });
  return (
    <>
      <PageHead
        title="Обучение команды"
        lead="Кто и сколько прошёл по своей программе. Раздел платформы: в исходных материалах его нет, прогресс считается по тем же правилам."
        crumbs={<b>Обучение команды</b>}
      />
      <div className="lrn-list">
        {rows.map(({ a, pr, tests, passed }) => (
          <div className="lrn-row static" key={a.id}>
            <span className="ri">
              <Avatar name={a.name} id={a.id} size={26} />
            </span>
            <span className="rt">
              <b>{a.name}</b>
              <span>
                {ROLES[academyRole(a.role)]} · {pr.d} из {pr.n} материалов · тестов сдано {passed} из {tests}
              </span>
            </span>
            <span className="rprog">
              <Bar pct={pr.p} />
              <b className="num">{pr.p}%</b>
            </span>
          </div>
        ))}
        {!rows.length && <div className="lrn-empty">Аккаунтов сотрудников пока нет.</div>}
      </div>
      {!access.can.manageAccounts && <div className="chknote">Показаны только сотрудники вашей зоны ответственности.</div>}
    </>
  );
}

/* ── боковая панель и выдвижной справочник ─────────────────────── */

function AsidePanel({
  track,
  role,
  prog,
  ctx,
  onDrawer,
  setTrack,
}: {
  track: string;
  role: AcademyRole;
  prog: ReturnType<typeof progMap>;
  ctx: Ctx;
  onDrawer: (k: string) => void;
  setTrack: (v: string) => void;
}) {
  const cfg = ASIDE[track] ?? ASIDE.realty;
  const pr = progressAll(prog, role, ctx.progName);
  const op = role === "operator";
  const row = (r: (typeof cfg.call)[number], plain?: boolean) => (
    <button
      key={r.t}
      className={`arow${plain ? " plain" : ""}`}
      onClick={() => (r.d.startsWith("item:") ? ctx.open(r.d.slice(5)) : onDrawer(r.d))}
    >
      <span className="ai">
        <Icon name={r.i} size={plain ? 17 : 16} />
      </span>
      <span className="at">
        <b>{r.t}</b>
        <span>{r.s}</span>
      </span>
      {!plain && (
        <span className="ac">
          <Icon name="chevR" size={14} />
        </span>
      )}
    </button>
  );
  return (
    <aside className="lrn-aside">
      {op && (
        <div className="ctxsw">
          <span className="ctxlbl">Направление</span>
          <div className="ctxbtns">
            {[
              ["realty", "Недвижимость"],
              ["auto", "Авто"],
            ].map(([v, t]) => (
              <button key={v} className={track === v ? "on" : ""} onClick={() => setTrack(v)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="acard">
        <h3>{op ? "Для этого звонка" : "Для этой задачи"}</h3>
        <p>Открывается поверх страницы — вы не теряете место</p>
        {cfg.call.map((r) => row(r))}
      </div>
      <div className="acard">
        <h3>Полезное рядом</h3>
        {cfg.near.map((r) => row(r, true))}
      </div>
      <div className="acard green">
        <span className="gi">
          <Icon name="target" size={20} />
        </span>
        <div>
          <b>{pr.p >= 100 ? "Программа пройдена" : pr.p ? `Прогресс ${pr.p}%` : "Начните с первого урока"}</b>
          <span>
            {pr.p >= 100 ? "Возвращайтесь к справочникам во время смен." : `Пройдено ${pr.d} из ${pr.n} материалов вашей роли.`}
          </span>
        </div>
      </div>
    </aside>
  );
}

function Drawer({ id, onClose, go }: { id: string; onClose: () => void; go: (s: SectionId) => void }) {
  const cfg = DRAWERS[id];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!cfg) return null;
  return (
    <div className="lrn-drawer-back" onClick={onClose}>
      <div className="lrn-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={cfg.t}>
        <div className="drw-h">
          <div>
            <b>{cfg.t}</b>
            <span>{cfg.s}</span>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              onClose();
              go(cfg.go);
            }}
          >
            Открыть раздел
          </button>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="drw-b">
          <Widget id={cfg.w} />
        </div>
      </div>
    </div>
  );
}

/* ── сертификат ────────────────────────────────────────────────── */

function CertPage({ role, id, onBack }: { role: AcademyRole; id: string; onBack: () => void }) {
  const { data, me } = useCrm();
  const L = lib(role);
  const it = L.byId.get(id);
  const rec = data.learn.find((l) => l.id === `${me.id}|${id}`);
  const course = L.itemCourse.get(id);
  if (!it || !course) return null;
  const cert = rec?.cert;
  if (!cert)
    return (
      <>
        <PageHead title="Сертификат" crumbs={<b>Сертификат</b>} lead="Сертификат появится после того, как вы сдадите аттестацию на 80% и выше." />
        <div className="lrn-list">
          <div className="lrn-empty">Аттестация ещё не сдана.</div>
        </div>
      </>
    );
  const prog = progMap(data.learn, me.id);
  const p = courseProg(prog, course);
  const d = new Date(cert.at);
  return (
    <>
      <div className="crumbrow">
        <div className="crumbs">
          <button onClick={onBack}>Мой прогресс</button>
          <Icon name="chevR" size={12} />
          <b>Сертификат</b>
        </div>
      </div>
      <div className="cert">
        <span className="certbar" />
        <div className="certinner">
          <div className="certbrand">Академия Обзвона</div>
          <div className="certorg">База знаний 3-го направления</div>
          <div className="certdiv">
            <span />
            <b>Сертификат</b>
            <span />
          </div>
          <div className="certlbl">выдан</div>
          <div className="certname">{cert.name || me.name}</div>
          <div className="certunder" />
          <div className="certlbl">за прохождение программы обучения и сдачу итоговой аттестации</div>
          <div className="certprog">{course.title}</div>
          <div className="certgrid">
            <div>
              <span>Аттестация</span>
              <b>{it.t}</b>
            </div>
            <div>
              <span>Лучший результат</span>
              <b>
                {cert.pct}% · {it.quiz?.length} вопросов
              </b>
            </div>
            <div>
              <span>Материалов пройдено</span>
              <b>
                {p.d} из {p.n}
              </b>
            </div>
          </div>
          <div className="certsign">
            <div className="sigcol">
              <i />
              <b>{d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</b>
              <span>Дата выдачи</span>
            </div>
            <div className="certseal">
              <Icon name="check" size={20} stroke={2.4} />
              <i className="num">{cert.pct}%</i>
              <u>сдано</u>
            </div>
            <div className="sigcol r">
              <i />
              <b>№ {certNo(id, cert.at)}</b>
              <span>Регистрационный номер</span>
            </div>
          </div>
        </div>
        <div className="certfoot">
          Документ сформирован автоматически и подтверждает результат внутреннего обучения Академии Обзвона. Данные
          справочников актуальны на {DATA_AS_OF}.
        </div>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <Icon name="print" size={15} /> Распечатать или сохранить в PDF
        </button>
        <button className="btn" onClick={onBack}>
          К прогрессу
        </button>
      </div>
    </>
  );
}
