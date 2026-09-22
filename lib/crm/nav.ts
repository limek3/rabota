import type { IconName } from "@/components/ui/icons";

/**
 * Единый список разделов: из него строятся боковое меню, командная палитра и
 * заголовки страниц. Каждому href соответствует app/(crm)/<путь>/page.tsx —
 * это проверяет scripts/check-routes.mjs, поэтому пункт меню на несуществующую
 * страницу не соберётся незамеченным. Какие пункты видит аккаунт — решает
 * lib/crm/access.ts (routes).
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  hint: string;
  group: "Работа" | "Время и деньги" | "Аналитика" | "Система";
}

export const NAV: NavItem[] = [
  { href: "/me", label: "Мой кабинет", icon: "user", hint: "Мой план, лиды за сегодня, часы и заработок", group: "Работа" },
  { href: "/dashboard", label: "Сводка", icon: "dashboard", hint: "План, факт, темп и прогноз команды", group: "Работа" },
  { href: "/leads", label: "Лиды", icon: "leads", hint: "Журнал переданных лидов", group: "Работа" },
  { href: "/operators", label: "Операторы", icon: "users", hint: "Показатели и карточки сотрудников", group: "Работа" },
  { href: "/groups", label: "Группы", icon: "groups", hint: "Состав и выполнение планов групп", group: "Работа" },
  { href: "/schedule", label: "График", icon: "calendar", hint: "Смены и отработанные часы", group: "Время и деньги" },
  { href: "/payroll", label: "Зарплата", icon: "wallet", hint: "Ведомость, начисления и выплаты", group: "Время и деньги" },
  { href: "/dynamics", label: "Динамика", icon: "trend", hint: "Результат по дням и неделям", group: "Аналитика" },
  { href: "/reports", label: "Отчёты", icon: "doc", hint: "Отчёт за день и неделю картинкой — для чата", group: "Аналитика" },
  { href: "/projects", label: "Проекты", icon: "folder", hint: "Справочник и лиды по проектам", group: "Аналитика" },
  { href: "/plans", label: "Планы", icon: "target", hint: "Месячные планы команды, групп и операторов", group: "Аналитика" },
  { href: "/learn", label: "Обучение", icon: "book", hint: "Академия обзвона: курсы, скрипты, справочники, тренажёры", group: "Система" },
  { href: "/settings", label: "Настройки", icon: "settings", hint: "Параметры, данные и резервные копии", group: "Система" },
];

export const NAV_GROUPS: NavItem["group"][] = ["Работа", "Время и деньги", "Аналитика", "Система"];
