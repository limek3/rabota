"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Телефон: окно до 760 px. Та же граница, что у мобильной раскладки в app/mobile.css —
 * CSS переставляет оболочку и страницы, а этот хук нужен там, где на телефоне рисуется
 * другое (форма лида на весь экран, списки шторкой снизу, карточки вместо таблиц).
 *
 * Страницы собираются заранее, без окна, поэтому хук годится для того, что появляется
 * после загрузки (окна, списки, страницы после данных), а не для первой отрисовки оболочки:
 * её прячет и показывает CSS.
 */
export const MOBILE_MQ = "(max-width: 760px)";

export function isMobileNow(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(MOBILE_MQ).matches;
}

/**
 * Окно на весь экран телефона закрывается системной кнопкой «Назад», а не уводит со страницы:
 * пока окно открыто, в истории лежит лишняя запись (с тем же адресом и состоянием Next), «Назад»
 * снимает её и закрывает окно. Закрыли окно сами — запись убираем. Запись ставим кадром позже:
 * в строгом режиме React эффект монтируется дважды, и снятая в первый раз запись закрыла бы окно.
 */
export function useBackClose(active: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!active || !isMobileNow()) return;
    let pushed = false;
    let popped = false;
    const t = window.setTimeout(() => {
      window.history.pushState({ ...window.history.state, mBack: true }, "");
      pushed = true;
    }, 0);
    const onPop = () => {
      popped = true;
      cb.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("popstate", onPop);
      if (pushed && !popped && window.history.state?.mBack) window.history.back();
    };
  }, [active]);
}

export function useMobile(): boolean {
  const [mobile, setMobile] = useState(isMobileNow);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}
