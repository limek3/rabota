// Bridge for the custom title bar (components/TitleBar.tsx).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vexaElectron", {
  minimize: () => ipcRenderer.send("vexa:minimize"),
  toggleMaximize: () => ipcRenderer.send("vexa:toggle-maximize"),
  close: () => ipcRenderer.send("vexa:close"),
  onMaximized: (cb) => {
    const handler = (_e, isMax) => cb(isMax);
    ipcRenderer.on("vexa:maximized", handler);
    return () => ipcRenderer.removeListener("vexa:maximized", handler);
  },
});
