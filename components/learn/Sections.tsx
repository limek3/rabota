"use client";

import { useMemo } from "react";
import { useCrm } from "@/lib/crm/store";
import {
  DATA_AS_OF,
  PASS_PCT,
  PROGNAME,
  blockerOf,
  courseById,
  courseProg,
  isDone,
  lib,
  progIds,
  programItems,
  progLabel,
  quizLine,
  realItems,
  roleCourses,
  roleItems,
  sectionItems,
  type AcademyRole,
  type LearnItem,
  type Lib,
  type ProgMap,
  type SectionId,
} from "@/lib/learn";
import { tierFor } from "@/lib/crm/payroll";
import { fmtInt, fmtMoney, plural } from "@/lib/crm/format";
import { Icon } from "@/components/ui/icons";
import { Bar, Cards, LSec, PageHead, Rows, Subline, Tiles } from "@/components/learn/kit";
import { AutoPriceTable, CalcOp, CalcSv, CitiesTable, GlossList, ObjList, PriceTable, StatusTable } from "@/components/learn/Widgets";

/**
 * Разделы академии — те же, что в исходных материалах: «В звонке» / «В работе»,
 * справочники, тесты, прогресс и заметки. Тексты и состав страниц сохранены.
 */

/** «при 5 лидах» — предложный падеж, как в исходных материалах. */
const LEADS_AT: [string, string, string] = ["лиде", "лидах", "лидах"];

export interface Ctx {
  role: AcademyRole;
  prog: ProgMap;
  progName: string;
  setProgName: (p: string) => void;
  sec: SectionId;
  open: (id: string) => void;
  go: (sec: SectionId) => void;
  openCourse: (id: string) => void;
  openCert: (id: string) => void;
  filter: string;
  setFilter: (v: string) => void;
  newShift: () => void;
  /** Скрипты в режиме «Только реплики». */
  runMode: boolean;
  setRunMode: (v: boolean) => void;
}

const sub = (i: LearnItem, L: Lib) => `${L.itemModule.get(i.id)?.t} · ${i.k}, ${i.m}`;
const subCourse = (i: LearnItem, L: Lib) => `${L.itemCourse.get(i.id)?.title} · ${i.m}`;

export function SectionPage({ ctx }: { ctx: Ctx }) {
  switch (ctx.sec) {
    case "scripts":
      return <Scripts ctx={ctx} />;
    case "checklists":
      return <Checklists ctx={ctx} />;
    case "regs":
      return <Regs ctx={ctx} />;
    case "money":
      return <Money ctx={ctx} />;
    case "bases":
      return <Bases ctx={ctx} />;
    case "objections":
      return <Objections ctx={ctx} />;
    case "statuses":
      return <Statuses ctx={ctx} />;
    case "realty":
      return <Realty ctx={ctx} />;
    case "autoprices":
      return <AutoPrices ctx={ctx} />;
    case "cities":
      return <CitiesPage ctx={ctx} />;
    case "pay":
      return <Pay ctx={ctx} />;
    case "gloss":
      return <Gloss ctx={ctx} />;
    case "opmat":
      return <OpMat ctx={ctx} />;
    case "tests":
      return <Tests ctx={ctx} />;
    case "progress":
      return <ProgressPage ctx={ctx} />;
    default:
      return null;
  }
}

/* ── в звонке / в работе ───────────────────────────────────────── */

function Scripts({ ctx }: { ctx: Ctx }) {
  const items = sectionItems(ctx.role, "scripts");
  if (ctx.role === "supervisor")
    return (
      <>
        <PageHead
          title="Скрипт интервью"
          onHome={() => ctx.go("home")}
          lead="Телефонное интервью с кандидатом занимает около десяти минут: проверить техническую готовность, честно рассказать условия и назначить дату обучения."
        />
        <Rows items={items} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
        <div className="callout note-tip" style={{ marginTop: 22 }}>
          <span className="ci">
            <Icon name="info" size={15} stroke={2.2} />
          </span>
          <div>
            <b>Обязательно проверить</b>
            <div>
              Компьютер или ноутбук, гарнитура, стабильный интернет и тихий фон во время работы. Без этого кандидат не выйдет в
              линию, сколько бы он ни хотел работать.
            </div>
          </div>
        </div>
      </>
    );
  const { itemCourse } = lib(ctx.role);
  const re = items.filter((i) => itemCourse.get(i.id)?.track === "realty");
  const au = items.filter((i) => itemCourse.get(i.id)?.track === "auto");
  return (
    <>
      <PageHead
        title="Скрипты звонка"
        onHome={() => ctx.go("home")}
        lead="Дословные сценарии разговора. Формулировки можно подстроить под свою речь — порядок шагов и обязательные элементы менять нельзя."
      />
      <LSec count={re.length}>Недвижимость</LSec>
      <Subline>Реактивация базы: клиенты, которые раньше интересовались новостройками.</Subline>
      <Rows items={re} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
      <LSec count={au.length}>Авто</LSec>
      <Subline>Сценарий «Авто.ру без подбора»: только новые автомобили, подбор ведёт менеджер.</Subline>
      <Rows items={au} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
    </>
  );
}

function Checklists({ ctx }: { ctx: Ctx }) {
  const { data, me } = useCrm();
  const items = sectionItems(ctx.role, "checklists");
  let done = 0;
  let all = 0;
  for (const i of items)
    for (const b of i.b ?? [])
      if ("ck" in b) {
        all += b.ck.items.length;
        const rec = data.learn.find((l) => l.id === `${me.id}|${i.id}`);
        const set = new Set(rec?.checks ?? []);
        done += b.ck.items.filter((_, k) => set.has(`${b.ck.id}:${k}`)).length;
      }
  return (
    <>
      <PageHead
        title="Чек-листы"
        onHome={() => ctx.go("home")}
        lead={
          ctx.role === "operator"
            ? "Короткие проверки перед действием: каждая занимает меньше минуты. Отметки сохраняются в вашем профиле."
            : "Проверки для ключевых шагов работы с группой: интервью, первый день новичка, оформление и отставание от плана."
        }
      />
      <div className="shiftbar">
        <div>
          <b>
            Отмечено {done} из {all}
          </b>
          <span>Отметки копятся с первого дня — обнулите их в начале смены</span>
        </div>
        <button className="btn" onClick={ctx.newShift}>
          <Icon name="clock" size={15} /> Начать новую смену
        </button>
      </div>
      <Rows items={items} sub={subCourse} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
    </>
  );
}

function Regs({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Регламенты"
        onHome={() => ctx.go("home")}
        lead="Правила, которые не обсуждаются в моменте: как обучать новичка, как оформлять и что делать при отставании от плана."
      />
      <Rows items={sectionItems(ctx.role, "regs")} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
    </>
  );
}

function Money({ ctx }: { ctx: Ctx }) {
  const { data } = useCrm();
  return (
    <>
      <PageHead
        title="Мотивация и бонус"
        onHome={() => ctx.go("home")}
        lead={`Оклад ${fmtMoney(data.settings.svBonus.salary)} плюс бонус за объём лидов группы. На бонус влияют грейд, направление, процент апрува и динамика роста.`}
      />
      <Rows items={sectionItems(ctx.role, "money")} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
      <LSec>Быстрый расчёт</LSec>
      <Subline>Подставьте объём лидов, грейд и апрув — увидите бонус к выплате.</Subline>
      <CalcSv />
    </>
  );
}

function Bases({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Базы и лиды"
        onHome={() => ctx.go("home")}
        lead="Откуда приходит база, как она готовится и сколько её хватает на новую группу."
      />
      <Rows items={sectionItems(ctx.role, "bases")} sub={sub} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
      <div className="callout note-warn" style={{ marginTop: 24 }}>
        <span className="ci">
          <Icon name="alert" size={15} stroke={2.2} />
        </span>
        <div>
          <b>Главное ограничение</b>
          <div>
            Постоянного свободного резерва нет — весь текущий объём расписан между действующими проектами. Объём для новой
            группы обсуждается заранее, а не берётся из остатков.
          </div>
        </div>
      </div>
    </>
  );
}

function Objections({ ctx }: { ctx: Ctx }) {
  const f = (ctx.filter === "auto" ? "auto" : "realty") as "realty" | "auto";
  return (
    <>
      <PageHead
        title="Возражения"
        onHome={() => ctx.go("home")}
        lead="Возражение — не отказ, а запрос на информацию в защитной форме. Схема одна: принять → ответить фактом → вернуть вопрос по скрипту."
      />
      <div className="filters">
        {[
          { v: "realty", t: "Недвижимость" },
          { v: "auto", t: "Авто" },
        ].map((x) => (
          <button key={x.v} className={`filt${f === x.v ? " on" : ""}`} onClick={() => ctx.setFilter(x.v)}>
            {x.t}
          </button>
        ))}
      </div>
      <ObjList track={f} />
      <LSec>Разобрать и отработать</LSec>
      <Cards
        onPick={(c) => c.id && ctx.open(c.id)}
        cards={[
          { t: "Тренажёр возражений", d: "Карточки: вспоминаете ответ, сверяете с эталоном.", id: "t1", i: "bolt" },
          { t: "Как устроена отработка", d: "Три шага и типичная ошибка — молчание после ответа.", id: "r41", i: "doc" },
        ]}
      />
    </>
  );
}

function Statuses({ ctx }: { ctx: Ctx }) {
  const k = ctx.filter === "auto" ? "auto" : "re";
  return (
    <>
      <PageHead
        title="Статусы Скорозвона"
        onHome={() => ctx.go("home")}
        lead="Статус ставим по факту разговора. От него зависят перезаливы базы, ваша конверсия и качество лида для менеджера."
      />
      <div className="filters">
        {[
          { v: "re", t: "Недвижимость" },
          { v: "auto", t: "Авто" },
        ].map((x) => (
          <button key={x.v} className={`filt${k === x.v ? " on" : ""}`} onClick={() => ctx.setFilter(x.v)}>
            {x.t}
          </button>
        ))}
      </div>
      <StatusTable kind={k as "re" | "auto"} />
      <LSec>Проверить себя</LSec>
      <Cards
        onPick={(c) => c.id && ctx.open(c.id)}
        cards={[{ t: "Тренажёр статусов", d: "Ситуация из звонка — выбираете статус и сразу видите разбор.", id: "t2", i: "bolt" }]}
      />
    </>
  );
}

/* ── справочники ───────────────────────────────────────────────── */

function Realty({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Новостройки: цены"
        onHome={() => ctx.go("home")}
        lead="Нижняя граница вилки по городам. Цены озвучиваем только при прямом вопросе клиента и после проверки на уникальность."
      />
      <PriceTable />
      <LSec>Рядом по теме</LSec>
      <Rows items={sectionItems(ctx.role, "realty").filter((i) => i.id !== "r33")} sub={subCourse} onOpen={ctx.open} />
    </>
  );
}

function AutoPrices({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Авто: цены"
        onHome={() => ctx.go("home")}
        lead="Стартовые цены по маркам из скрипта «Авто.ру без подбора» — ориентир для разговора, а не подтверждённое предложение. Модель, комплектацию и наличие уточняет менеджер."
      />
      <AutoPriceTable />
      <div className="callout note-warn" style={{ marginTop: 22 }}>
        <span className="ci">
          <Icon name="alert" size={15} stroke={2.2} />
        </span>
        <div>
          <b>Что не предлагаем</b>
          <div>
            Спецтехнику, грузовые автомобили, микроавтобусы и фургоны. Для немецких и японских марок обязательно уточняем
            бюджет клиента.
          </div>
        </div>
      </div>
      <LSec>Рядом по теме</LSec>
      <Rows items={sectionItems(ctx.role, "autoprices").filter((i) => i.id !== "auto-prices")} sub={subCourse} onOpen={ctx.open} />
    </>
  );
}

function CitiesPage({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Города и расстояния"
        onHome={() => ctx.go("home")}
        lead="Приблизительные расстояния до дилерских центров Москвы и Санкт-Петербурга. Нужны для одного вопроса скрипта: готов ли клиент приехать в ближайшие 1–2 недели."
      />
      <CitiesTable />
      <div className="callout note-warn" style={{ marginTop: 22 }}>
        <span className="ci">
          <Icon name="alert" size={15} stroke={2.2} />
        </span>
        <div>
          <b>Исключение: Екатеринбург</b>
          <div>Если клиенту ближе Екатеринбург, по скрипту можно передать только запрос на китайский бренд.</div>
        </div>
      </div>
    </>
  );
}

function Pay({ ctx }: { ctx: Ctx }) {
  const { data, access } = useCrm();
  const s = data.settings;
  const myOp = access.opId ? data.operators.find((o) => o.id === access.opId) : null;
  const grid = s.rateGrids.find((g) => g.id === (myOp?.rateGridId ?? s.defaultGridId)) ?? s.rateGrids[0];
  const tiers = grid?.tiers ?? [];
  const items = sectionItems(ctx.role, "pay");
  // столбец «смена 8 часов» — по верхней границе ступени, как в материалах
  const rows = tiers.map((t, i) => {
    const next = tiers[i + 1];
    const sample = next ? next.from - 1 : t.from;
    return {
      range: next ? `до ${next.from - 1}` : `от ${t.from}`,
      rate: t.hourlyRate,
      bonus: t.leadBonus,
      sum: t.hourlyRate * 8 + t.leadBonus * sample,
      sample,
      top: !next,
    };
  });
  return (
    <>
      <PageHead
        title="Оплата и оформление"
        onHome={() => ctx.go("home")}
        lead="Справочная информация: сколько стоит смена, как считается эффективность, как оформляют и какие документы нужны. Это не часть курса и тестов здесь нет — открывайте, когда нужно свериться."
      />
      <LSec>Сколько стоит смена</LSec>
      <Subline>
        Почасовая ставка и цена лида растут вместе с результатом. Ставка пересчитывается на всю смену, а не только на «лишние»
        лиды.
      </Subline>
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Лидов за смену</th>
              <th>Ставка в час</th>
              <th>За каждый лид</th>
              <th>Смена 8 часов</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.range} className={r.top ? "hot" : undefined}>
                <td>{r.range}</td>
                <td className="num">{fmtInt(r.rate)} ₽</td>
                <td className="num">{fmtInt(r.bonus)} ₽</td>
                <td className="num">
                  {fmtMoney(r.sum)} при {r.sample} {plural(r.sample, LEADS_AT)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LSec>Посчитать свою смену</LSec>
      <CalcOp />
      <LSec>Стажировка</LSec>
      <div className="paygrid">
        <div className="paycard">
          <b>15 часов</b>
          <span>Столько длится стажировка. Оплата всё это время по обычной сетке: почасовая плюс за каждый лид.</span>
        </div>
        <div className="paycard">
          <b>10 лидов</b>
          <span>Столько нужно передать за эти 15 часов, чтобы стажировка была закрыта.</span>
        </div>
        <div className="paycard">
          <b>≈ 3 дня</b>
          <span>Обычный срок, за который стажировка проходится. Эффективность считается как лиды ÷ отработанные часы.</span>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Отработано часов</th>
              <th>Сколько лидов должно быть</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>5 часов</td>
              <td className="num">3 лида</td>
              <td>Идёте по плану</td>
            </tr>
            <tr>
              <td>10 часов</td>
              <td className="num">7 лидов</td>
              <td>Идёте по плану</td>
            </tr>
            <tr className="hot">
              <td>15 часов</td>
              <td className="num">10 лидов</td>
              <td>Стажировка закрыта</td>
            </tr>
          </tbody>
        </table>
      </div>
      <LSec>Оформление и выплаты</LSec>
      <div className="tbl-wrap">
        <table className="tbl learn-tbl">
          <thead>
            <tr>
              <th>Параметр</th>
              <th>Как устроено</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Форма</td>
              <td>Самозанятость. Регистрация в приложении «Мой налог» занимает около десяти минут</td>
            </tr>
            <tr>
              <td>Выплаты</td>
              <td>Два раза в месяц по графику</td>
            </tr>
            <tr>
              <td>ТК РФ</td>
              <td>Возможен после 3 месяцев работы при хорошей конверсии; выплаты 25-го и 10-го числа за предыдущий месяц</td>
            </tr>
            <tr>
              <td>Графики</td>
              <td>5/2, 4/4, 4/3, 4/2, 3/3, 3/2, 2/2, 2/1 — на выбор, по согласованию с руководителем</td>
            </tr>
            <tr>
              <td>Формат</td>
              <td>Полностью удалённо; подработка от 6 часов в день, линия работает с 9:00 до 21:00</td>
            </tr>
          </tbody>
        </table>
      </div>
      <LSec>Документы для оформления</LSec>
      <div className="paylist">
        {["Справка о регистрации самозанятого", "Реквизиты банковской карты", "Электронная почта", "Номер телефона"].map((x) => (
          <span className="paydoc" key={x}>
            <Icon name="check" size={13} stroke={2.4} />
            {x}
          </span>
        ))}
      </div>
      <div className="callout note-tip" style={{ marginTop: 20 }}>
        <span className="ci">
          <Icon name="info" size={15} stroke={2.2} />
        </span>
        <div>
          <b>Справку просите заранее</b>
          <div>
            Чаще всего выход в линию тормозит именно справка о регистрации самозанятого. Оформите её до первого дня — это
            бесплатно и быстро.
          </div>
        </div>
      </div>
      {items.length > 0 && (
        <>
          <LSec>Материалы целиком</LSec>
          <Rows items={items} sub={(i) => `${i.k} · ${i.m}`} onOpen={ctx.open} done={(id) => isDone(ctx.prog, id)} />
        </>
      )}
    </>
  );
}

function Gloss({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <PageHead
        title="Глоссарий"
        onHome={() => ctx.go("home")}
        lead="Термины разделены на три части: недвижимость, авто и внутренние слова группы. Всё простыми словами."
      />
      <GlossList />
    </>
  );
}

/* ── для группы ────────────────────────────────────────────────── */

function OpMat({ ctx }: { ctx: Ctx }) {
  const ops = ["op-realty", "op-auto"].map((id) => courseById(ctx.role, id)).filter(Boolean) as NonNullable<ReturnType<typeof courseById>>[];
  const scripts = ops.flatMap((c) => realItems(c).filter((i) => i.k === "Скрипт"));
  const all = sectionItems(ctx.role, "opmat");
  const byIds = (ids: string[]) => ids.map((id) => all.find((i) => i.id === id)).filter(Boolean) as LearnItem[];
  const refs = byIds(["f1", "f3", "f4", "f5", "f6", "f2", "auto-prices", "auto-cities"]);
  const drills = byIds(["t1", "t2", "t3"]);
  return (
    <>
      <PageHead
        title="Материалы операторов"
        onHome={() => ctx.go("home")}
        lead="То, по чему вы обучаете группу и что даёте новичку. Это отдельный раздел: в вашу программу и прогресс он не входит."
      />
      <LSec>Программы оператора</LSec>
      <Cards
        onPick={(c) => c.go && ctx.openCourse(c.go)}
        cards={ops.map((c) => ({
          t: c.title,
          d: c.desc,
          go: c.id,
          i: c.track === "auto" ? "car" : "chat",
          foot: `${realItems(c).length} материалов`,
        }))}
      />
      <LSec count={scripts.length}>Скрипты звонка</LSec>
      <Rows items={scripts} sub={subCourse} onOpen={ctx.open} />
      <LSec count={refs.length}>Справочники</LSec>
      <Rows items={refs} sub={(i) => `${i.k} · ${i.m}`} onOpen={ctx.open} />
      <LSec>Тренажёры и расчёты</LSec>
      <Rows items={drills} sub={(i) => `${i.k} · ${i.m}`} onOpen={ctx.open} />
    </>
  );
}

/* ── тесты и прогресс ──────────────────────────────────────────── */

function Tests({ ctx }: { ctx: Ctx }) {
  const { data, me } = useCrm();
  const items = sectionItems(ctx.role, "tests");
  const passed = items.filter((i) => ctx.prog.get(i.id)?.pass).length;
  const groups = roleCourses(ctx.role)
    .map((c) => ({ c, items: realItems(c).filter((i) => i.quiz) }))
    .filter((g) => g.items.length);
  return (
    <>
      <PageHead
        title="Тесты и аттестации"
        onHome={() => ctx.go("home")}
        lead={`Пройдено ${passed} из ${items.length}. Проходной результат — ${Math.round(PASS_PCT * 100)}%: после проверки видно разбор каждой ошибки, тест можно пройти заново.`}
      />
      {groups.map((g) => (
        <div key={g.c.id}>
          <LSec count={g.items.length}>{g.c.title}</LSec>
          <Rows
            items={g.items}
            onOpen={ctx.open}
            lockOf={(id) => blockerOf(ctx.prog, ctx.role, id)}
            sub={(i, L) => {
              const r = ctx.prog.get(i.id);
              return r?.last != null ? quizLine(r) : `${i.quiz?.length} вопросов · ${L.itemModule.get(i.id)?.t}`;
            }}
            pill={(i) => {
              if (blockerOf(ctx.prog, ctx.role, i.id)) return { t: "закрыт", hue: "g" };
              const r = ctx.prog.get(i.id);
              if (!r?.last) return { t: "не пройден", hue: "g" };
              return r.pass ? { t: `сдано ${r.best}%`, hue: "ok" } : { t: `пересдать ${r.last}%`, hue: "warn" };
            }}
          />
        </div>
      ))}
      <div style={{ fontSize: 11.5, color: "var(--dimmer)", marginTop: 20 }}>Материалы обновлены: {DATA_AS_OF}.</div>
    </>
  );
}

function ProgressPage({ ctx }: { ctx: Ctx }) {
  const { data, me, resetAllLearn } = useCrm();
  const pr = useMemo(() => {
    const it = programItems(ctx.role, ctx.progName);
    const d = it.filter((i) => isDone(ctx.prog, i.id)).length;
    return { d, n: it.length, p: it.length ? Math.round((d / it.length) * 100) : 0 };
  }, [ctx.prog, ctx.role, ctx.progName]);
  const all = programItems(ctx.role, ctx.progName).filter((i) => i.quiz);
  const passed = all.filter((i) => ctx.prog.get(i.id)?.pass);
  let ckDone = 0;
  let ckAll = 0;
  for (const i of roleItems(ctx.role))
    for (const b of i.b ?? [])
      if ("ck" in b) {
        ckAll += b.ck.items.length;
        const set = new Set(ctx.prog.get(i.id)?.checks ?? []);
        ckDone += b.ck.items.filter((_, k) => set.has(`${b.ck.id}:${k}`)).length;
      }
  const certs = data.learn.filter((l) => l.accountId === me.id && l.cert);
  const avg = passed.length ? Math.round(passed.reduce((a, i) => a + (ctx.prog.get(i.id)?.best ?? 0), 0) / passed.length) : 0;

  return (
    <>
      <PageHead
        title="Мой прогресс"
        onHome={() => ctx.go("home")}
        lead="Всё сохраняется в вашем аккаунте: отметки о пройденном, результаты тестов и чек-листы. У каждого сотрудника свой прогресс."
      />
      <Tiles
        items={[
          { l: `Программа «${progLabel(ctx.role, ctx.progName)}»`, v: pr.p, u: "%", s: `${pr.d} из ${pr.n} материалов` },
          { l: "Тесты сданы", v: passed.length, u: `из ${all.length}`, s: "проходной балл 80%" },
          { l: "Средний результат", v: avg, u: "%", s: "по сданным тестам" },
          { l: "Чек-листы", v: ckDone, u: `из ${ckAll}`, s: "отмеченных пунктов" },
        ]}
      />
      <LSec>По программам</LSec>
      {ctx.role === "operator" && (
        <>
          <Subline>
            Ваша программа — «{progLabel(ctx.role, ctx.progName)}». Прогресс и рекомендации считаются только по ней; остальные
            курсы остаются доступны как дополнительные.
          </Subline>
          <div className="filters" style={{ marginBottom: 14 }}>
            {[
              { v: "realty", t: "Недвижимость" },
              { v: "auto", t: "Авто" },
              { v: "both", t: "Обе программы" },
            ].map((x) => (
              <button key={x.v} className={`filt${ctx.progName === x.v ? " on" : ""}`} onClick={() => ctx.setProgName(x.v)}>
                {x.t}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="lrn-list">
        {roleCourses(ctx.role).map((c) => {
          const p = courseProg(ctx.prog, c);
          const extra = ctx.role === "operator" && !progIds(ctx.role, ctx.progName).includes(c.id);
          return (
            <button className="lrn-row" key={c.id} onClick={() => ctx.openCourse(c.id)}>
              <span className="ri">
                <Icon name={c.track === "auto" ? "car" : c.role === "supervisor" ? "users" : "chat"} size={16} />
              </span>
              <span className="rt">
                <b>{c.title}</b>
                <span>
                  {p.d} из {p.n} материалов{extra ? " · дополнительно" : ""}
                </span>
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
      {certs.length > 0 && (
        <>
          <LSec>Сертификаты</LSec>
          <div className="lrn-list">
            {certs.map((l) => (
              <button className="lrn-row" key={l.itemId} onClick={() => ctx.openCert(l.itemId)}>
                <span className="ri">
                  <Icon name="star" size={16} />
                </span>
                <span className="rt">
                  <b>{lib(ctx.role).itemCourse.get(l.itemId)?.title}</b>
                  <span>
                    {l.cert!.pct}% · {new Date(l.cert!.at).toLocaleDateString("ru-RU")}
                  </span>
                </span>
                <span className="lpill ok">сдано</span>
                <span className="rc">
                  <Icon name="chevR" size={14} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <LSec>Результаты тестов</LSec>
      <Rows
        items={all}
        onOpen={ctx.open}
        sub={(i, L) => {
          const r = ctx.prog.get(i.id);
          return r?.last != null ? quizLine(r) : (L.itemCourse.get(i.id)?.title ?? "");
        }}
        pill={(i) => {
          const r = ctx.prog.get(i.id);
          if (!r?.last) return { t: "не пройден", hue: "g" };
          return r.pass ? { t: `сдано ${r.best}%`, hue: "ok" } : { t: `последний ${r.last}%`, hue: "warn" };
        }}
      />
      <div style={{ marginTop: 26 }}>
        <button className="btn btn-danger" onClick={() => void resetAllLearn()}>
          Сбросить весь прогресс
        </button>
      </div>
    </>
  );
}
