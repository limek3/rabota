// Typed access to the Electron preload bridge, WITHOUT augmenting the global
// Window type. Using a local cast here (instead of `declare global`) avoids
// "Subsequent property declarations must have the same type" errors if more
// than one copy of the project ever ends up in the same TypeScript program.

/**
 * Состояние обновления, каким его видит рендер.
 *
 * "idle" — и «ещё не проверяли», и «обновлений нет»: для интерфейса это одно и
 * то же (показывать нечего), а разделять их значило бы рисовать «вы на
 * последней версии» — сообщение, которого никто не просил.
 */
export type VexaUpdate =
  | { state: "idle" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string };

export interface VexaBridge {
  /** Платформа хоста. Старые сборки её не отдают — отсюда optional. */
  platform?: NodeJS.Platform;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  onMaximized: (cb: (isMax: boolean) => void) => () => void;
  notify: (payload: { title: string; body: string; matchId?: string }) => void;
  onNavigate: (cb: (path: string) => void) => () => void;
  onUpdate?: (cb: (s: VexaUpdate) => void) => () => void;
  getUpdateState?: () => Promise<VexaUpdate>;
  downloadUpdate?: () => void;
  installUpdate?: () => void;
}

export function getVexaBridge(): VexaBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { vexaElectron?: VexaBridge }).vexaElectron;
}
