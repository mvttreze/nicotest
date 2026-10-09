const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, ipcMain, desktopCapturer } = require("electron");
const path = require("path");

const DEFAULT_URL = "https://nico-ai-assistant.onrender.com";
const localIndex = path.resolve(__dirname, "..", "index.html");
const windowIcon = path.resolve(__dirname, "assets", "icon-192.png");
const trayIconFile = path.resolve(__dirname, "assets", "icon-32.png");

const SUMMON_ACCELERATOR = "CommandOrControl+Shift+N";

let mainWindow = null;
let tray = null;
let isQuitting = false;

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function loadNico(win) {
  const frontendUrl = process.env.NICO_URL || DEFAULT_URL;
  try {
    await win.loadURL(frontendUrl);
    console.log(`Loaded Nico from ${frontendUrl}`);
    return;
  } catch (error) {
    console.warn(`Could not load ${frontendUrl}:`, error.message);
  }

  console.warn("Hosted frontend unreachable; loading local fallback shell.");
  try {
    await win.loadFile(localIndex);
  } catch (fallbackError) {
    console.error("Local fallback also failed:", fallbackError.message);
  }
}

function launchAtLogin() {
  return app.getLoginItemSettings().openAtLogin;
}

function setLaunchAtLogin(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

function buildTray() {
  let trayImage;
  try {
    const fileImage = nativeImage.createFromPath(trayIconFile);
    trayImage = fileImage.isEmpty() ? nativeImage.createFromPath(windowIcon) : fileImage;
    if (trayImage.isEmpty()) throw new Error("no tray icon");
  } catch (error) {
    console.warn("Tray icon missing, running without tray:", error.message);
    return;
  }
  tray = new Tray(trayImage);
  tray.setToolTip("Nico — personal AI assistant");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Nico",
      click: () => {
        if (!mainWindow) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Launch at startup",
      type: "checkbox",
      checked: launchAtLogin(),
      click: (item) => {
        setLaunchAtLogin(item.checked);
        console.log(`Launch at startup: ${item.checked ? "on" : "off"}`);
      },
    },
    { type: "separator" },
    { label: "Reload", click: () => mainWindow?.reload() },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", toggleWindow);
}

function buildMenu() {
  const template = [
    {
      label: "Nico",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#050816",
    title: "Nico",
    icon: windowIcon,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.resolve(__dirname, "preload.js"),
    },
  });

  // Jarvis behavior: closing hides to the tray instead of quitting.
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  loadNico(mainWindow);
}

// Vision mode: the web build uses getDisplayMedia, which Chromium does not
// expose inside Electron. The renderer asks here for desktop sources instead.
ipcMain.handle("nico:pick-screen-source", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

function registerSummonHotkey() {  try {
    const ok = globalShortcut.register(SUMMON_ACCELERATOR, toggleWindow);
    console.log(
      ok
        ? `Summon hotkey registered: ${SUMMON_ACCELERATOR}`
        : `Summon hotkey FAILED: ${SUMMON_ACCELERATOR} (taken by another app?)`,
    );
  } catch (error) {
    console.warn("Could not register summon hotkey:", error.message);
  }
}

app.setName("Nico");

// Second launch focuses the running window instead of opening a copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    buildTray();
    createWindow();
    registerSummonHotkey();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep running in the tray; quit explicitly from the tray menu.
  if (process.platform === "darwin") {
    // macOS convention still hides; tray Quit ends it everywhere.
  }
});
