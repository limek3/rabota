// LEADUP CRM Desktop — Electron main process.
//
// Modes:
//   npm run desktop:dev  → connects to the running `next dev` server (:3000).
//   npm run desktop      → serves the static export from ./out and loads it.
//
// Native features: custom title bar, window-state memory, application menu,
// system tray (minimize-to-tray), native lead notifications, launch-at-login.

import { app, BrowserWindow, ipcMain, shell, Menu, Tray, Notification, nativeImage } from "electron";
import path from "path";
import http from "http";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV = process.argv.includes("--vexa-dev");
const DEV_URL = "http://localhost:3000";

const IS_MAC = process.platform === "darwin";

// Prefer the user's own logo (public/brand-logo.png) for native surfaces,
// falling back to the bundled icon.
const USER_LOGO = path.join(__dirname, "..", "public", "brand-logo.png");
const APP_ICON = fs.existsSync(USER_LOGO) ? USER_LOGO : path.join(__dirname, "icon.png");
/**
 * Иконка в трее/меню-баре.
 *
 * У macOS меню-бар свой жанр: туда идёт монохромный силуэт с суффиксом
 * `Template` в имени — система сама перекрашивает его под светлую и тёмную
 * тему и под выделение. Цветной логотип там превращается в мутный квадратик,
 * который темнеет вместе с фоном и становится неразличим.
 */
const TRAY_ICON = path.join(__dirname, IS_MAC ? "trayTemplate.png" : "tray.png");

let win = null;
let tray = null;
app.isQuitting = false;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  // Воркер pdf.js — ES-модуль в .mjs. Без этой строки он уезжает клиенту как
  // application/octet-stream, и браузер отказывается его исполнять: модуль
  // обязан приехать с JS-типом. Разбор резюме молча падал бы только в десктопе.
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".map": "application/json",
};

/**
 * Порт локального сервера — фиксированный, и это не мелочь.
 *
 * Раньше здесь стоял listen(0) — «любой свободный порт». Каждый запуск давал
 * новый порт, а порт входит в origin. localStorage живёт per-origin, поэтому
 * http://127.0.0.1:54321 и http://127.0.0.1:61234 — два разных хранилища:
 * приложение стартовало с чистого листа каждый раз. Настройки таблицы, метки,
 * тема, зеркало сессии — всё сохранялось исправно и всё «пропадало», потому
 * что на следующем запуске их искали по другому адресу.
 *
 * Число произвольное, но выше 1024 и вне диапазона эфемерных портов Windows
 * (49152+), чтобы система не заняла его сама под чужое исходящее соединение.
 */
const APP_PORT = 47821;
/** Если порт занят — пробуем соседние. Диапазон детерминированный: origin
 *  меняется только когда порт реально отобрали, а не при каждом запуске. */
const PORT_TRIES = 8;

function serveOut() {
  const root = path.join(__dirname, "..", "out");
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(root, "index.html"))) {
      reject(new Error("Static export not found. Run `npm run build` first."));
      return;
    }
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, "");
        const candidates = [
          path.join(root, safe),
          path.join(root, safe, "index.html"),
          path.join(root, `${safe.replace(/[\/\\]+$/, "")}.html`),
        ];
        let file = null;
        for (const c of candidates) {
          if (c.startsWith(root) && fs.existsSync(c) && fs.statSync(c).isFile()) {
            file = c;
            break;
          }
        }
        if (!file) file = path.join(root, "404.html");
        if (!fs.existsSync(file)) file = path.join(root, "index.html");
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end("error");
      }
    });
    let attempt = 0;
    server.on("error", (e) => {
      if (e.code !== "EADDRINUSE" || attempt >= PORT_TRIES) {
        reject(e);
        return;
      }
      // Занят — берём следующий по порядку. Origin при этом меняется, и
      // локальные настройки на нём будут свои: это плата за то, что порт
      // отобрали, а не поведение по умолчанию.
      attempt++;
      server.listen(APP_PORT + attempt, "127.0.0.1");
    });
    server.listen(APP_PORT, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function waitForDev(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const ping = (left) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(url);
      });
      req.on("error", () => {
        if (left <= 0) reject(new Error(`Dev server not reachable at ${url}. Run \`npm run dev\` first.`));
        else setTimeout(() => ping(left - 1), 1000);
      });
    };
    ping(tries);
  });
}

// ── window state (size / position) persistence ───────────────────────────
const stateFile = path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (s && typeof s.width === "number" && typeof s.height === "number") return s;
  } catch {
    /* first run */
  }
  return { width: 1440, height: 900, isMaximized: false };
}

let saveTimer = null;
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const b = (!isMaximized && win.getNormalBounds) ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile, JSON.stringify({ ...b, isMaximized }));
  } catch {
    /* ignore */
  }
}
function scheduleSaveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindowState, 400);
}

// ── native notifications ─────────────────────────────────────────────────
function showLeadNotification(payload) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: String(payload?.title || "LEADUP CRM"),
    body: String(payload?.body || ""),
    icon: APP_ICON,
    silent: false,
  });
  n.on("click", () => {
    revealWindow();
    if (win) win.webContents.send("vexa:navigate", "/matches");
  });
  n.show();
}

// ── автообновление ───────────────────────────────────────────────────────
// Источник обновлений — GitHub Releases (см. build.publish в package.json).
// Ставится не молча: главный процесс только сообщает рендеру, что вышла новая
// версия, а качать и перезапускаться решает человек. Приложение, которое
// перезагружает себя посреди работы с лидом, — это потерянный лид.

/** Последнее состояние — новое окно должно узнать про обновление, а не ждать следующего опроса. */
let updateState = { state: "idle" };

function pushUpdate(next) {
  updateState = next;
  if (win && !win.isDestroyed()) win.webContents.send("vexa:update", next);
}

async function initUpdater() {
  // dev грузится с localhost — обновлять там нечего
  if (DEV) return;

  /**
   * macOS: автообновление требует подписи разработчика.
   *
   * Squirrel.Mac перед установкой сверяет подпись скачанной сборки с подписью
   * установленной. У неподписанной сборки этой проверки не пройти, поэтому
   * обновление скачается и молча не встанет — человек увидит «перезапустите
   * для обновления», перезапустит и останется на прежней версии.
   *
   * Пока подписи нет, честнее не показывать обновления вовсе: mac-пользователь
   * ставит новую версию, скачивая .dmg заново. Когда появится сертификат
   * Apple Developer — снять этот выход и убрать mac.identity:null из
   * package.json.
   */
  if (IS_MAC) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = (await import("electron-updater")).default);
  } catch {
    // модуля нет (например, собрали без него) — приложение работает без обновлений
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => pushUpdate({ state: "available", version: info?.version ?? "" }));
  autoUpdater.on("update-not-available", () => pushUpdate({ state: "idle" }));
  autoUpdater.on("download-progress", (p) => pushUpdate({ state: "downloading", percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (info) => pushUpdate({ state: "ready", version: info?.version ?? "" }));
  autoUpdater.on("error", (e) => pushUpdate({ state: "error", message: String(e?.message ?? e) }));

  ipcMain.on("vexa:update-download", () => {
    pushUpdate({ state: "downloading", percent: 0 });
    autoUpdater.downloadUpdate().catch((e) => pushUpdate({ state: "error", message: String(e?.message ?? e) }));
  });

  ipcMain.on("vexa:update-install", () => {
    // Окно перехватывает close и прячется в трей (см. win.on("close")). Без
    // этого флага quitAndInstall() упрётся в тот же перехват и повиснет:
    // установщик ждёт выхода, а приложение считает, что его просто свернули.
    app.isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  // рендер спрашивает состояние на маунте — окно могло открыться после проверки
  ipcMain.handle("vexa:update-state", () => updateState);

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* нет сети — молчим до следующего раза */ });
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ── window helpers ───────────────────────────────────────────────────────
function revealWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

// ── tray ─────────────────────────────────────────────────────────────────
function buildTray() {
  if (tray) return;
  let img = nativeImage.createFromPath(TRAY_ICON);
  if (img.isEmpty()) img = nativeImage.createFromPath(APP_ICON);
  tray = new Tray(img);
  tray.setToolTip("LEADUP CRM");
  refreshTrayMenu();
  tray.on("click", () => (win && win.isVisible() ? win.focus() : revealWindow()));
  tray.on("double-click", revealWindow);
}

function getAutoLaunch() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
function setAutoLaunch(v) {
  try {
    app.setLoginItemSettings({ openAtLogin: v });
  } catch {
    /* not available in some dev setups */
  }
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Открыть LEADUP CRM", click: revealWindow },
    { type: "separator" },
    { label: "Запускать при входе в систему", type: "checkbox", checked: getAutoLaunch(), click: (mi) => setAutoLaunch(mi.checked) },
    { type: "separator" },
    { label: "Выход", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ── application menu (keyboard shortcuts even with a frameless window) ─────
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Файл",
      submenu: [
        { label: "Свернуть в трей", accelerator: "CmdOrCtrl+W", click: () => win && win.hide() },
        isMac ? { role: "close" } : { label: "Выход", accelerator: "CmdOrCtrl+Q", click: () => { app.isQuitting = true; app.quit(); } },
      ],
    },
    { role: "editMenu" },
    {
      label: "Вид",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 980,
    minHeight: 640,
    /**
     * Рамка окна.
     *
     * Windows/Linux: frame:false — рисуем свой титлбар целиком, вместе с
     * кнопками свернуть/развернуть/закрыть.
     *
     * macOS: frame:false убрал бы и «светофор» — окно осталось бы вообще без
     * системных кнопок, а свои три кнопки на маке выглядят чужеродно.
     * hiddenInset прячет системную полосу, но оставляет светофор, который мы
     * опускаем по центру нашей 38-пиксельной шапки.
     */
    ...(IS_MAC
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 11 } }
      : { frame: false }),
    autoHideMenuBar: true,
    backgroundColor: "#f3f4f6",
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (st.isMaximized) win.maximize();

  // window controls for the custom title bar
  ipcMain.on("vexa:minimize", () => win && win.minimize());
  ipcMain.on("vexa:toggle-maximize", () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
  // the title bar close button hides to tray instead of quitting
  ipcMain.on("vexa:close", () => win && win.close());
  ipcMain.on("vexa:notify", (_e, payload) => showLeadNotification(payload));

  win.on("maximize", () => win.webContents.send("vexa:maximized", true));
  win.on("unmaximize", () => win.webContents.send("vexa:maximized", false));
  win.on("resize", scheduleSaveState);
  win.on("move", scheduleSaveState);

  // close → minimize to tray (real quit goes through the tray / menu)
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      saveWindowState();
      win.hide();
      if (tray && process.platform === "win32" && !win.__trayHintShown) {
        win.__trayHintShown = true;
        tray.displayBalloon?.({ title: "LEADUP CRM свернулась в трей", content: "Приложение работает в фоне. Правый клик по иконке — меню." });
      }
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.once("ready-to-show", () => win.show());

  // Desktop app always boots into its own flow: splash → login → dashboard.
  const base = DEV ? await waitForDev(DEV_URL) : await serveOut();
  const entry = base.replace(/\/+$/, "") + "/desktop/";
  await win.loadURL(entry);
}

// single-instance: focus the existing window instead of opening a second one
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", revealWindow);

  app.whenReady().then(() => {
    buildAppMenu();
    createWindow()
      .then(buildTray)
      .then(initUpdater)
      .catch((e) => {
        console.error(e.message);
        app.quit();
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else revealWindow();
    });
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    saveWindowState();
  });

  // keep running in the tray when all windows are closed
  app.on("window-all-closed", () => {
    /* stay alive in tray; quit only via tray/menu */
  });
}
