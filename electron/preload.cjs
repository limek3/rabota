// Bridge for the Vexi desktop shell (title bar + native features).
//
// CommonJS on purpose: Electron injects preload into a sandboxed renderer by
// default, and sandboxed preloads cannot use ESM `import`. CommonJS + require
// works with the default sandbox.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vexaElectron", {
  // "darwin" | "win32" | "linux" — титлбар рисует свои кнопки окна только там,
  // где нет системного «светофора» (см. TitleBar.tsx).
  platform: process.platform,
  minimize: () => ipcRenderer.send("vexa:minimize"),
  toggleMaximize: () => ipcRenderer.send("vexa:toggle-maximize"),
  close: () => ipcRenderer.send("vexa:close"),
  onMaximized: (cb) => {
    const handler = (_e, isMax) => cb(isMax);
    ipcRenderer.on("vexa:maximized", handler);
    return () => ipcRenderer.removeListener("vexa:maximized", handler);
  },
  // native OS notification for a new lead
  notify: (payload) => ipcRenderer.send("vexa:notify", payload),
  // main → renderer: "open this route" (e.g. clicking a notification)
  onNavigate: (cb) => {
    const handler = (_e, path) => cb(path);
    ipcRenderer.on("vexa:navigate", handler);
    return () => ipcRenderer.removeListener("vexa:navigate", handler);
  },

  // ── обновления ─────────────────────────────────────────────────────────
  onUpdate: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on("vexa:update", handler);
    return () => ipcRenderer.removeListener("vexa:update", handler);
  },
  // Состояние на маунте: проверка стартует раньше, чем react успевает
  // подписаться, и без этого запроса первое "доступно обновление" терялось бы
  // до следующего опроса — то есть на шесть часов.
  getUpdateState: () => ipcRenderer.invoke("vexa:update-state"),
  downloadUpdate: () => ipcRenderer.send("vexa:update-download"),
  installUpdate: () => ipcRenderer.send("vexa:update-install"),
});
