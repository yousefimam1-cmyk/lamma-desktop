// LAMMA desktop host: the window for the TV / laptop that runs the host screen.
// Phones join from their browser at the same site, like a living-room party game.
const { app, BrowserWindow, Menu, shell, powerSaveBlocker, ipcMain, screen, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

// ── Crash safety: log everything, never die silently (Store cert flagged a crash at launch) ──
const logFile = () => { try { return path.join(app.getPath("userData"), "lamma.log"); } catch { return null; } };
function log(...a) {
  const f = logFile();
  try { if (f) fs.appendFileSync(f, `[${new Date().toISOString()}] ${a.map(String).join(" ")}\n`); } catch {}
}
process.on("uncaughtException", (e) => log("uncaught", e && e.stack || e));
process.on("unhandledRejection", (e) => log("unhandled", e && e.stack || e));
// If the GPU crashed last run (some desktop GPUs + fullscreen), start in safe software mode.
function safeFlag() { try { return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "settings.json"), "utf8")).safeGpu; } catch { return false; } }
if (safeFlag() || process.argv.includes("--safe-gpu")) app.disableHardwareAcceleration();

const SITE = (process.env.LAMMA_URL || "https://www.lammaonline.website").replace(/\/$/, "");
const HOST_URL = `${SITE}/host`;
const SITE_HOST = new URL(SITE).hostname.replace(/^www\./, "");
// lammaonline.website and www.lammaonline.website (the site redirects between them) are both ours.
const ours = (url) => {
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") && (u.hostname === SITE_HOST || u.hostname === `www.${SITE_HOST}`);
  } catch {
    return false;
  }
};

// ── Display mode: fullscreen | borderless (windowed fullscreen) | windowed ──
const MODES = ["fullscreen", "borderless", "windowed"];
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; }
}
function saveSettings(patch) {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch })); } catch {}
}
// Windows groups the taskbar button and picks its icon by this id; it must match build.appId.
if (process.platform === "win32") app.setAppUserModelId("website.lammaonline.host");
const ICON = path.join(__dirname, process.platform === "win32" ? "build/icon.ico" : "build/icon.png");

// Tester builds ship tester.json (see package.json "dist:tester"): it opens every paid pack, now and later.
function testerKey() {
  for (const dir of [process.resourcesPath, __dirname]) {
    try { return JSON.parse(fs.readFileSync(path.join(dir || "", "tester.json"), "utf8")).key || null; } catch {}
  }
  return null;
}
const TESTER_KEY = testerKey();

// Store builds ship store-steam.json or store-epic.json (see "dist:steam" / "dist:epic"). The site reads
// "LammaStore/<name>" from the user agent: the Steam build hides outside payments (Steam's rules).
function storeName() {
  for (const name of ["steam", "epic"]) {
    for (const dir of [process.resourcesPath, __dirname]) {
      if (dir && fs.existsSync(path.join(dir, `store-${name}.json`))) return name;
    }
  }
  return null;
}
const STORE = storeName();
ipcMain.handle("lamma:tester-key", () => TESTER_KEY);

let mode = "fullscreen";
let win;

// Show the offline screen. Deferred out of the failing load's own event, and only once per failure:
// two overlapping loadFile calls abort each other and can leave a blank window (or crash).
function offline(w) {
  if (!w || w.isDestroyed() || w.__offlinePending) return;
  w.__offlinePending = true;
  setImmediate(() => {
    if (w.isDestroyed()) return;
    w.loadFile(path.join(__dirname, "offline.html"), { query: { site: SITE } })
      .catch((e) => log("offline load", e && e.message))
      .finally(() => { w.__offlinePending = false; });
  });
}
function load(w = win) {
  if (!w || w.isDestroyed()) return;
  // slow or blocked network: show the offline screen instead of a frozen window
  const t = setTimeout(() => { log("load timeout"); offline(w); }, 20000);
  w.webContents.once("did-finish-load", () => clearTimeout(t));
  w.webContents.once("did-fail-load", () => clearTimeout(t));
  // a failed load is handled by did-fail-load (it shows the offline screen); here we only log
  w.loadURL(HOST_URL).catch((e) => { clearTimeout(t); log("loadURL", e && e.message); });
}

function create(nextMode, from) {
  mode = nextMode;
  const display = from ? screen.getDisplayMatching(from.getBounds()) : screen.getPrimaryDisplay();
  const b = display.bounds;
  const saved = readSettings().bounds;
  const windowed = saved && mode === "windowed" ? saved : { width: Math.min(1600, b.width), height: Math.min(900, b.height) };
  const w = new BrowserWindow({
    ...(mode === "borderless" ? { x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, thickFrame: false } : windowed),
    minWidth: 960, minHeight: 600,
    fullscreen: mode === "fullscreen", show: true,
    backgroundColor: "#1e1033", title: "LAMMA | لمّة",
    icon: ICON, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, devTools: false, autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (mode === "windowed" && !saved) w.center();
  // The website only opens the host screen inside the app; it looks for this marker.
  w.webContents.setUserAgent(`${w.webContents.getUserAgent()} LammaDesktop/${app.getVersion()}${TESTER_KEY ? " LammaTester" : ""}${STORE ? ` LammaStore/${STORE}` : ""}`);
  // Links that leave the game (e.g. help pages) open in the normal browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON } };
    shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("did-fail-load", (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3 && ours(url)) { log("load failed", code, url); offline(w); }
  });
  // never navigate the app window away from LAMMA; open other sites in the normal browser
  const guard = (e, url) => {
    if (!ours(url) && !url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); }
  };
  w.webContents.on("will-navigate", guard);
  w.webContents.on("will-redirect", guard);
  w.webContents.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown") return;
    if (i.key === "F11" || (i.alt && i.key === "Enter")) { setMode(mode === "fullscreen" ? readSettings().lastWindowed || "windowed" : "fullscreen"); e.preventDefault(); }
    else if (i.key === "Escape" && mode !== "windowed" && w.isFocused()) {
      // Escape leaves fullscreen only when nothing on the page is using it (e.g. a dialog)
      w.webContents.executeJavaScript("!!document.querySelector('[role=dialog],[aria-modal=true]')", true)
        .then((busy) => { if (!busy) setMode("windowed"); }).catch(() => {});
    }
    else if (i.key === "F5" || ((i.control || i.meta) && i.key.toLowerCase() === "r")) { load(w); e.preventDefault(); }
  });
  w.on("leave-full-screen", () => { if (w === win && mode === "fullscreen") { mode = "windowed"; saveSettings({ mode }); notify(); } });
  const remember = () => { if (w === win && mode === "windowed" && !w.isMaximized()) saveSettings({ bounds: w.getBounds() }); };
  w.on("resized", remember);
  w.on("moved", remember);
  // a dead page reloads instead of leaving a blank/closed window
  w.webContents.on("render-process-gone", (_e, d) => {
    log("renderer gone", d.reason);
    if (d.reason !== "clean-exit" && !w.isDestroyed()) setTimeout(() => load(w), 500);
  });
  w.webContents.on("unresponsive", () => log("unresponsive"));
  w.webContents.on("did-finish-load", notify);
  return w;
}

function notify() {
  if (win && !win.isDestroyed()) win.webContents.send("lamma:display-mode", mode);
}

function setMode(next) {
  if (!MODES.includes(next) || !win || next === mode) return notify();
  saveSettings({ mode: next, ...(next !== "fullscreen" ? { lastWindowed: next } : {}) });
  const frameChanges = (next === "borderless") !== (mode === "borderless");
  if (!frameChanges) {
    // fullscreen <-> windowed: same window, no reload
    mode = next;
    win.setFullScreen(next === "fullscreen");
    if (next === "windowed") {
      const saved = readSettings().bounds;
      if (saved) win.setBounds(saved);
    }
    return notify();
  }
  // borderless needs a window without a frame: open the new one, then close the old.
  // The page resumes the same room automatically (the host token is kept in the app's storage).
  const old = win;
  win = create(next, old);
  load(win);
  win.webContents.once("did-finish-load", () => { if (!old.isDestroyed()) old.destroy(); });
}

// ── Auto-update (installer builds only) ──
// The website hosts latest.yml + LAMMA-Setup.exe in /downloads (rebuilt by CI on every desktop change).
// Games always come from the live site; this only updates the app window itself.
// Skipped for the Microsoft Store (the Store updates it), Steam and Epic (their launchers do),
// the portable tester build (can't self-install) and dev runs.
function updatesAllowed() {
  return app.isPackaged && process.platform === "win32" && !process.windowsStore && !STORE && !TESTER_KEY
    && !process.env.PORTABLE_EXECUTABLE_DIR;
}
function setupUpdates() {
  if (!updatesAllowed()) return;
  let updater;
  try { ({ autoUpdater: updater } = require("electron-updater")); } catch (e) { return log("updater missing", e && e.message); }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // if they pick Later, it installs the next time LAMMA closes
  updater.disableDifferentialDownload = true;
  updater.logger = { info: (m) => log("update", m), warn: (m) => log("update warn", m), error: (m) => log("update error", m), debug: () => {} };
  updater.on("error", (e) => log("update error", e && e.message));
  let asked = false;
  updater.on("update-downloaded", async (info) => {
    if (asked) return;
    asked = true;
    const ar = (app.getLocale() || "").startsWith("ar");
    const owner = win && !win.isDestroyed() ? win : undefined;
    try {
      const { response } = await dialog.showMessageBox(owner, {
        type: "info",
        title: "LAMMA",
        message: ar ? `في تحديث جديد للمّة (${info.version})` : `A LAMMA update is ready (${info.version})`,
        detail: ar ? "نقفل ونفتح دلوقتي؟ لو في لعبة شغالة، اختار بعدين وهيتحدث لما تقفل لمّة"
          : "Restart now? If a game is running, pick Later and it updates when you close LAMMA.",
        buttons: ar ? ["حدّث دلوقتي", "بعدين"] : ["Restart now", "Later"],
        defaultId: 0, cancelId: 1, noLink: true,
      });
      if (response === 0) setImmediate(() => updater.quitAndInstall(true, true));
    } catch (e) { log("update dialog", e && e.message); }
  });
  const check = () => updater.checkForUpdates().catch((e) => log("update check", e && e.message));
  setTimeout(check, 15000); // let the game load first
  setInterval(check, 4 * 60 * 60 * 1000);
}

ipcMain.handle("lamma:get-display-mode", () => mode);
ipcMain.handle("lamma:set-display-mode", (_e, next) => { setMode(next); return mode; });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on("child-process-gone", (_e, d) => {
    log("child gone", d.type, d.reason);
    // GPU keeps crashing: remember it and restart in software mode once
    if (d.type === "GPU" && d.reason !== "clean-exit" && !safeFlag()) {
      saveSettings({ safeGpu: true });
      app.relaunch(); app.exit(0);
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    powerSaveBlocker.start("prevent-display-sleep"); // keep the TV awake during a game
    const saved = readSettings().mode;
    const start = process.argv.includes("--windowed") ? "windowed" : MODES.includes(saved) ? saved : "fullscreen";
    setupUpdates();
    try { win = create(start); load(); }
    catch (e) {
      log("start failed", e && e.stack || e);
      try { win = create("windowed"); load(); } catch (e2) { log("windowed start failed", e2 && e2.stack || e2); }
    }
  }).catch((e) => log("whenReady", e && e.stack || e));
  app.on("window-all-closed", () => app.quit());
}
