"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCrm } from "@/lib/crm/store";
import { currentMonth, nowMs } from "@/lib/crm/dates";
import { fmtInt, plural, shortName } from "@/lib/crm/format";
import { Avatar, Chip, PageHead, Seg } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { Select, type Opt } from "@/components/ui/select";
import { bestGrade, type Painter } from "@/lib/pixels";
import {
  CATALOG,
  DEAL_OFF,
  G3_BONUS,
  G4_BONUS,
  ITEMS,
  RARITY,
  SEASON,
  SLOTS,
  SPARKS_PER_LEAD,
  buyBlock,
  dealOf,
  priceOf,
  putShopRow,
  seasonOn,
  setShopRows,
  setTryOn,
  shopRowKnown,
  shopStore,
  sparksEarned,
  sparksSpent,
  useShopRows,
  type Item,
  type Look,
  type ShopCtx,
  type Slot,
} from "@/lib/shop";
import { Badge, TrailDemo } from "./ShopFx";

/**
 * «Лавка» — украшения профиля за искры (правила и каталог — lib/shop.ts).
 * Витрина: сезонная коллекция и скидка дня сверху, ниже — все вещи по вкладкам.
 * «Примерить» надевает вещь только у вас (рамка на аватарках, след за мышью) — коллеги
 * видят то, что куплено и надето. Купленное можно подарить коллеге.
 */

type Tab = "all" | Slot | "mine";

/** Покупки всех — один раз на вкладку: из них рамки на аватарках, имена и следы коллег. */
export function ShopSync() {
  const { access, toast } = useCrm();
  const me = access.account.id;
  const ready = me !== "__boot__";
  useEffect(() => {
    if (!ready) return;
    let off = false;
    const unsub = shopStore.subscribe((r) => {
      // новый подарок мне — сразу сказать
      if (!shopRowKnown(r.id) && r.ownerId === me && r.buyerId !== me) toast(`🎁 Подарок от ${shortName(r.buyerName) || "коллеги"}: «${ITEMS.get(r.item)?.name ?? r.item}» — наденьте в Лавке`);
      putShopRow(r);
    });
    shopStore.load().then(
      (rows) => !off && setShopRows(rows),
      () => {
        /* без Лавки CRM работает как обычно — просто без украшений */
      },
    );
    return () => {
      off = true;
      unsub();
    };
  }, [ready, me, toast]);
  return null;
}

/** Кому подарить: выбор коллеги прямо в окне подтверждения — наш список с поиском и аватарками. */
function GiftPick({ options, onPick }: { options: Opt[]; onPick: (id: string) => void }) {
  const [v, setV] = useState("");
  return (
    <Select
      value={v}
      options={options}
      searchable
      autoFocus
      placeholder="Кому подарить…"
      width="100%"
      minPopWidth={320}
      style={{ marginTop: 10 }}
      onChange={(x) => {
        setV(x);
        onPick(x);
      }}
    />
  );
}

const SPARK = "✦";

export function Shop() {
  const { full, access, me, today, toast, confirm } = useCrm();
  const rows = useShopRows();
  const myId = access.account.id;
  const who = useMemo<Painter>(() => ({ role: access.account.role, opId: access.opId, groups: access.ownGroups }), [access.account.role, access.opId, access.ownGroups]);
  const sparks = useMemo(() => sparksEarned(full.leads, who), [full.leads, who]);
  const grade = useMemo(() => bestGrade(full.leads, who, currentMonth()), [full.leads, who]);
  const spent = useMemo(() => sparksSpent(rows, myId), [rows, myId]);
  const left = sparks.total - spent;
  const ctx = useRef<ShopCtx>({ accountId: myId, name: me.name, today, earned: sparks.total, grade });
  ctx.current = { accountId: myId, name: me.name, today, earned: sparks.total, grade };

  const mine = useMemo(() => rows.filter((r) => r.ownerId === myId), [rows, myId]);
  const owned = useMemo(() => new Set(mine.map((r) => r.item)), [mine]);
  const worn = useMemo(() => {
    const l: Look = {};
    for (const r of mine) if (r.equipped) l[r.slot] = r.item;
    return l;
  }, [mine]);

  /* ── примерка: видна только вам; уходим со страницы — снимается ── */
  const [trying, setTrying] = useState<Look>({});
  useEffect(() => setTryOn(trying), [trying]);
  useEffect(() => () => setTryOn({}), []);
  const tryToggle = (it: Item) => setTrying((t) => (t[it.slot] === it.id ? { ...t, [it.slot]: undefined } : { ...t, [it.slot]: it.id }));
  const tryingAny = Object.values(trying).some(Boolean);
  const look: Look = { ...worn, ...Object.fromEntries(Object.entries(trying).filter(([, v]) => v)) };

  const [tab, setTab] = useState<Tab>("all");
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const season = seasonOn(today);
  const deal = dealOf(today);
  const dealItem = ITEMS.get(deal)!;
  // до конца «Скидки дня» — полночь по Москве (UTC+3), тикает раз в секунду
  const [now, setNow] = useState(() => nowMs());
  useEffect(() => {
    const iv = window.setInterval(() => setNow(nowMs()), 1000);
    return () => window.clearInterval(iv);
  }, []);
  const dealLeft = 86_400 - (Math.floor(now / 1000 + 3 * 3600) % 86_400);
  const dealClock = [Math.floor(dealLeft / 3600), Math.floor((dealLeft % 3600) / 60), dealLeft % 60].map((n) => String(n).padStart(2, "0")).join(":");

  const equip = async (slot: Slot, id: string | null) => {
    setBusy(`${slot}:${id}`);
    try {
      await shopStore.equip(slot, id, ctx.current);
      // не ждём Realtime: у себя меняем сразу
      for (const r of mine) if (r.slot === slot && r.equipped !== (r.item === id)) putShopRow({ ...r, equipped: r.item === id });
      setTrying((t) => ({ ...t, [slot]: undefined }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const buy = async (it: Item) => {
    const price = priceOf(it, today)!;
    const ok = await confirm({
      title: `Купить «${it.name}»?`,
      text: (
        <>
          {it.hint}. Спишется <b>{fmtInt(price)} {SPARK}</b>, останется {fmtInt(left - price)} {SPARK}. Вещь сразу наденется — снять или сменить можно в любой момент.
        </>
      ),
      ok: `Купить за ${fmtInt(price)} ${SPARK}`,
    });
    if (!ok) return;
    setBusy(`buy:${it.id}`);
    try {
      const r = await shopStore.buy(it.id, null, ctx.current);
      putShopRow(r);
      await shopStore.equip(it.slot, it.id, ctx.current);
      for (const x of [...mine, r]) if (x.slot === it.slot && x.equipped !== (x.item === it.id)) putShopRow({ ...x, equipped: x.item === it.id });
      setTrying((t) => ({ ...t, [it.slot]: undefined }));
      setFresh(it.id);
      window.setTimeout(() => setFresh((f) => (f === it.id ? null : f)), 1600);
      toast(`«${it.name}» теперь ваша — коллеги уже видят`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const colleagues = useMemo(
    () =>
      full.accounts
        .filter((a) => !a.deletedAt && a.active && a.id !== myId)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map((a): Opt => ({ value: a.id, label: a.name, hint: a.role === "head" ? "РОП" : a.role === "supervisor" ? "СВ" : undefined, icon: <Avatar name={a.name} id={a.id} size={20} /> })),
    [full.accounts, myId],
  );

  const gift = async (it: Item) => {
    const price = priceOf(it, today)!;
    let to = "";
    const options = colleagues.map((c) => (rows.some((r) => r.ownerId === c.value && r.item === it.id) ? { ...c, hint: "уже есть", disabled: true } : c));
    const ok = await confirm({
      title: `Подарить «${it.name}»`,
      text: (
        <>
          Спишется <b>{fmtInt(price)} {SPARK}</b> с вашего баланса, а вещь появится у коллеги в Лавке — с подписью, что от вас.
          <GiftPick options={options} onPick={(id) => (to = id)} />
        </>
      ),
      ok: "Подарить 🎁",
    });
    if (!ok) return;
    if (!to) {
      toast("Не выбрали, кому подарить", "err");
      return;
    }
    const why = buyBlock(it, { today, grade, left, owned: rows.some((r) => r.ownerId === to && r.item === it.id), gift: true });
    if (why) {
      toast(why, "err");
      return;
    }
    setBusy(`gift:${it.id}`);
    try {
      putShopRow(await shopStore.buy(it.id, to, ctx.current));
      toast(`Подарок отправлен: «${it.name}» → ${shortName(full.accounts.find((a) => a.id === to)?.name ?? "")}`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const list = CATALOG.filter((it) => {
    if (tab === "mine") return owned.has(it.id);
    if (it.season && !season && !owned.has(it.id)) return false;
    return tab === "all" || it.slot === tab;
  });

  // лента: последние покупки и подарки отдела
  const names = useMemo(() => new Map(full.accounts.map((a) => [a.id, a.name])), [full.accounts]);
  const feed = useMemo(() => [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7), [rows]);

  /** Вещь «на вас»: рамка на аватарке, имя, значок, фон или след. play — след рисуется сам. */
  const preview = (it: Item, play: boolean) => (
    <>
            {it.slot === "frame" && <Avatar name={me.name} id={myId} size={64} fx={it.id} />}
            {it.slot === "name" && (
              <div className="shop-prev-name">
                <span className="nmfx" data-nm={it.id} style={{ ["--nm" as string]: it.paint } as CSSProperties}>
                  {shortName(me.name) || "Ваше имя"}
                </span>
                <span className="shop-plate" data-nm={it.id} style={{ ["--nm" as string]: it.paint } as CSSProperties}>
                  {shortName(me.name) || "Вы"}
                </span>
              </div>
            )}
            {it.slot === "badge" && (
              <div className="shop-prev-name">
                <span className="shop-prev-b">
                  {shortName(me.name) || "Ваше имя"}
                  <span className="nm-badge" data-b={it.id}>
                    {it.glyph}
                  </span>
                </span>
                <span className="shop-plate">
                  {shortName(me.name) || "Вы"} <span className="nm-badge" data-b={it.id}>{it.glyph}</span>
                </span>
              </div>
            )}
            {it.slot === "banner" && (
              <div className="shop-prev-bn">
                <span className="bnfx" data-bn={it.id} aria-hidden />
                <span className="shop-prev-bn-ava">
                  <Avatar name={me.name} id={myId} size={40} fx={look.frame ?? null} />
                </span>
              </div>
            )}
            {it.slot === "trail" && (
              <>
                <span className="shop-glyph" data-hide={play ? "" : undefined}>
                  {it.glyph}
                </span>
                <TrailDemo kind={it.id} play={play} />
              </>
            )}
    </>
  );

  const card = (it: Item) => {
    const has = owned.has(it.id);
    const on = worn[it.slot] === it.id;
    const tried = trying[it.slot] === it.id;
    const price = priceOf(it, today);
    const block = buyBlock(it, { today, grade, left, owned: has, gift: false });
    const locked = !!it.grade && it.grade > grade;
    const giftFrom = mine.find((r) => r.item === it.id && r.buyerId !== myId);
    const r = RARITY[it.rarity];
    return (
      <div
        key={it.id}
        className={`shop-card r-${it.rarity}${fresh === it.id ? " fresh" : ""}`}
        data-on={on ? "" : undefined}
        onMouseEnter={() => setHover(it.id)}
        onMouseLeave={() => setHover((h) => (h === it.id ? null : h))}
      >
        <div className={`shop-prev s-${it.slot}`}>
          {preview(it, hover === it.id || tried)}
          <div className="shop-tags">
            {deal === it.id && price != null && <span className="shop-tag deal">−{DEAL_OFF}%</span>}
            {it.season && <span className="shop-tag season">🎃 {SEASON.name}</span>}
            {locked && (
              <span className="shop-tag lock">
                <Icon name="lock" size={11} /> Грейд {it.grade === 4 ? "IV" : "III"}
              </span>
            )}
          </div>
          {on && <span className="shop-worn">Надето</span>}
        </div>
        <div className="shop-body">
          <div className="shop-title">
            <b>{it.name}</b>
            <Chip hue={r.hue}>{r.label}</Chip>
          </div>
          <div className="shop-hint">{giftFrom ? `🎁 Подарок от ${shortName(giftFrom.buyerName)}` : it.hint}</div>
          <div className="shop-foot">
            {has ? (
              <span className="shop-price own">
                <Icon name="check" size={13} /> Есть
              </span>
            ) : price == null ? (
              <span className="shop-price gone">Не продаётся</span>
            ) : (
              <span className="shop-price">
                {price !== it.price && <s>{fmtInt(it.price)}</s>}
                <b>{fmtInt(price)}</b> {SPARK}
              </span>
            )}
            {!has && price != null && !it.grade && (
              <button type="button" className="btn btn-sm btn-ghost shop-gift" title="Подарить коллеге" disabled={!!busy} onClick={() => void gift(it)}>
                🎁 Подарить
              </button>
            )}
          </div>
          <div className="shop-acts">
              {!on && (
                <button type="button" className={`btn btn-sm${tried ? " shop-trying" : ""}`} onClick={() => tryToggle(it)} title="Только у вас: рамка на аватарках, имя и след за мышью">
                  {tried ? "Снять примерку" : "Примерить"}
                </button>
              )}
              {has ? (
                on ? (
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void equip(it.slot, null)}>
                    Снять
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => void equip(it.slot, it.id)}>
                    Надеть
                  </button>
                )
              ) : (
                price != null && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={!!block || !!busy} title={block ?? undefined} onClick={() => void buy(it)}>
                    Купить
                  </button>
                )
              )}
          </div>
        </div>
      </div>
    );
  };

  const seasonItems = CATALOG.filter((i) => i.season);
  const lookPaint = look.name ? ITEMS.get(look.name)?.paint : undefined;

  return (
    <div className="shop-page">
      <PageHead
        title="Лавка"
        sub={`Рамки, стиль имени, значки, фоны и следы курсора — их видят коллеги. 1 одобренный лид = ${SPARKS_PER_LEAD} ${SPARK}`}
        actions={
          <span className="shop-bal" title="Искры: заработано минус потрачено">
            <i>{SPARK}</i>
            <b>{fmtInt(left)}</b>
            <small>{plural(left, ["искра", "искры", "искр"])}</small>
          </span>
        }
      />

      <div className="shop-wrap">
        <div className="shop-main">
          <div className="shop-feature">
            {season ? (
              <div className="shop-season">
                <div className="shop-season-bg" aria-hidden>
                  {["🦇", "🦇", "🦇", "🕸", "🎃"].map((g, i) => (
                    <i key={i} style={{ ["--i" as string]: i } as CSSProperties}>
                      {g}
                    </i>
                  ))}
                </div>
                <div className="shop-season-t">
                  <small>Сезонная коллекция · до 7 ноября</small>
                  <h2>{SEASON.name} 🎃</h2>
                  <p>Тыква, паутина, призрачное имя, привидение у имени, ночной фон и стайка летучих мышей. После сезона их не купить — останутся только у тех, кто успел.</p>
                </div>
                <div className="shop-season-items">
                  {seasonItems.map((it) => (
                    <button key={it.id} type="button" className={`shop-season-it${owned.has(it.id) ? " has" : ""}`} onClick={() => tryToggle(it)} title={`Примерить «${it.name}»`}>
                      <span className="g">{it.glyph === "Aa" ? "✒️" : it.glyph}</span>
                      <span className="t">
                        <b>{it.name}</b>
                        <small>{owned.has(it.id) ? "есть" : `${fmtInt(priceOf(it, today) ?? it.price)} ${SPARK}`}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="shop-season off">
                <div className="shop-season-t">
                  <small>Сезонная коллекция</small>
                  <h2>Скоро новое</h2>
                  <p>Следующая коллекция появится к праздникам — копите искры.</p>
                </div>
              </div>
            )}
            <div className={`shop-deal r-${dealItem.rarity}`}>
              <div className="shop-deal-h">
                <span className="shop-deal-t">🔥 Скидка дня</span>
                <span className="shop-deal-clock" title="До полуночи по Москве — потом скидка перейдёт на другую вещь">
                  {dealClock}
                </span>
              </div>
              <div className={`shop-prev shop-deal-prev s-${dealItem.slot}`}>{preview(dealItem, true)}</div>
              <div className="shop-deal-name">
                <b>{dealItem.name}</b>
                <Chip hue={RARITY[dealItem.rarity].hue}>{RARITY[dealItem.rarity].label}</Chip>
              </div>
              <em className="shop-deal-slot">{SLOTS.find((x) => x.slot === dealItem.slot)!.one}</em>
              <div className="shop-deal-p">
                <s>{fmtInt(dealItem.price)}</s>
                <b>{fmtInt(priceOf(dealItem, today)!)}</b> {SPARK}
                <span className="shop-tag deal">−{DEAL_OFF}%</span>
              </div>
              <div className="shop-deal-acts">
                {owned.has(dealItem.id) ? (
                  <span className="shop-price own">
                    <Icon name="check" size={13} /> Уже есть
                  </span>
                ) : (
                  <>
                    <button type="button" className={`btn btn-sm${trying[dealItem.slot] === dealItem.id ? " shop-trying" : ""}`} onClick={() => tryToggle(dealItem)}>
                      {trying[dealItem.slot] === dealItem.id ? "Снять" : "Примерить"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!!busy || !!buyBlock(dealItem, { today, grade, left, owned: false, gift: false })}
                      title={buyBlock(dealItem, { today, grade, left, owned: false, gift: false }) ?? undefined}
                      onClick={() => void buy(dealItem)}
                    >
                      Купить
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <Seg<Tab>
            className="shop-tabs"
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "Всё" },
              ...SLOTS.map((s) => ({ value: s.slot as Tab, label: s.label })),
              { value: "mine", label: `Моё${owned.size ? ` · ${owned.size}` : ""}` },
            ]}
          />
          {list.length ? (
            <div className="shop-grid">{list.map(card)}</div>
          ) : (
            <div className="shop-empty">Пока ничего нет — загляните во «Всё» и выберите первую вещь.</div>
          )}
        </div>

        <aside className="shop-side">
          <div className="card shop-me">
            <div className="shop-me-banner bnfx" data-bn={look.banner} aria-hidden />
            <div className="shop-me-ava">
              <Avatar name={me.name} id={myId} size={72} />
            </div>
            <div className="shop-me-name">
              {lookPaint ? (
                <span className="nmfx" data-nm={look.name} style={{ ["--nm" as string]: lookPaint } as CSSProperties}>
                  {me.name}
                </span>
              ) : (
                me.name
              )}
              <Badge id={look.badge} />
            </div>
            <div className="shop-me-slots">
              {SLOTS.map((s) => {
                const id = look[s.slot];
                const it = id ? ITEMS.get(id) : undefined;
                const isTry = !!trying[s.slot];
                return (
                  <div key={s.slot} className="shop-me-slot">
                    <span>{s.one}</span>
                    <b data-try={isTry ? "" : undefined}>{it ? `${it.glyph === "Aa" ? "" : `${it.glyph} `}${it.name}` : "—"}</b>
                    {it && !isTry && (
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" title="Снять" disabled={!!busy} onClick={() => void equip(s.slot, null)}>
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {tryingAny && (
              <div className="shop-me-try">
                <span>Примерка — видна только вам</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTrying({})}>
                  Снять всё
                </button>
              </div>
            )}
            {look.trail && <div className="shop-me-hint">Проведите мышью по странице — за ней тянется след</div>}
          </div>

          <div className="card shop-sparks">
            <div className="shop-sparks-n">
              <b>{fmtInt(left)}</b> {SPARK}
            </div>
            <div className="shop-sparks-rows">
              {/* свои лиды и грейд — у кого есть карточка оператора */}
              {who.opId && (
                <>
                  <span>
                    Одобренные лиды · {fmtInt(sparks.own)} × {SPARKS_PER_LEAD}
                  </span>
                  <b>+{fmtInt(sparks.own * SPARKS_PER_LEAD)}</b>
                  <span>
                    Дни с Грейдом IV · {fmtInt(sparks.g4)} × {G4_BONUS}
                  </span>
                  <b>+{fmtInt(sparks.g4 * G4_BONUS)}</b>
                  <span>
                    Дни с Грейдом III · {fmtInt(sparks.g3)} × {G3_BONUS}
                  </span>
                  <b>+{fmtInt(sparks.g3 * G3_BONUS)}</b>
                </>
              )}
              {sparks.rate > 0 && (
                <>
                  <span>
                    Лиды команды · {fmtInt(sparks.team)} ÷ {sparks.rate} × {SPARKS_PER_LEAD}
                  </span>
                  <b>+{fmtInt(Math.floor(sparks.team / sparks.rate) * SPARKS_PER_LEAD)}</b>
                </>
              )}
              <span>Потрачено</span>
              <b>−{fmtInt(spent)}</b>
            </div>
            <p className="shop-sparks-s">Считаем с 1 октября. Лид ушёл из «доведён» — его искры уходят тоже.</p>
          </div>

          {feed.length > 0 && (
            <div className="card shop-feed">
              <div className="shop-feed-h">В Лавке недавно</div>
              {feed.map((r) => {
                const it = ITEMS.get(r.item);
                if (!it) return null;
                const owner = names.get(r.ownerId) ?? "коллега";
                return (
                  <div key={r.id} className="shop-feed-row">
                    <span className="shop-feed-g">{it.glyph === "Aa" ? "✒️" : it.glyph}</span>
                    <span>
                      {r.buyerId === r.ownerId ? (
                        <>
                          <b>{shortName(owner)}</b> — «{it.name}»
                        </>
                      ) : (
                        <>
                          🎁 <b>{shortName(r.buyerName)}</b> → <b>{shortName(owner)}</b>: «{it.name}»
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
