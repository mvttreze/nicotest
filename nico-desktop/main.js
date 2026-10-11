const { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, ipcMain, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

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
    title: "Nico",
    icon: windowIcon,
    autoHideMenuBar: true,
    show: false,
    // Custom Nico chrome: no native frame, see the in-app title bar.
    // Opaque window so the desktop never shows through.
    frame: false,
    backgroundColor: "#07050f",
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

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("nico:window-state", { maximized: true });
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("nico:window-state", { maximized: false });
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  loadNico(mainWindow);
}

// Custom title-bar controls (min / max-restore / close).
ipcMain.handle("nico:window", (_event, action) => {
  if (!mainWindow) return false;
  if (action === "min") mainWindow.minimize();
  else if (action === "max") {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  } else if (action === "close") mainWindow.close();
  return true;
});

// CLI hands: run an allowlisted coding agent headless and return its output.
// The renderer invokes this for "/cli <task>" messages (desktop app only).
// Tasks run inside ~/nico-workspace so generated files land predictably.
const CLI_TOOLS = {
  claude: (task) => ["-p", task, "--dangerously-skip-permissions"],
  opencode: (task) => ["run", task],
  codex: (task) => ["exec", task],
};
const CLI_TIMEOUT_MS = 180000;
const CLI_MAX_OUTPUT = 6000;

function nicoWorkspaceDir() {
  const dir = path.join(app.getPath("documents"), "nico-workspace");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

// Batch-file quoting for .cmd/.bat shims: cmd.exe and the batch layer parse
// the line before node ever sees it, so MSVCRT backslash escapes would
// arrive literally. Doubled quotes survive both layers; doubled percents
// survive batch %-expansion. Everything else is literal inside quotes.
function batchQuote(arg) {
  return `"${String(arg).replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

// Resolve a CLI tool against PATH without a shell, preferring real
// executables over .cmd/.bat shims (shims take the cmd.exe path below).
function resolveBin(tool) {
  const names = process.platform === "win32"
    ? [`${tool}.exe`, tool, `${tool}.cmd`, `${tool}.bat`]
    : [tool];
  const dirs = String(process.env.PATH || "").split(path.delimiter);
  for (const rawDir of dirs) {
    const dir = rawDir.trim();
    if (!dir) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full);
        return full;
      } catch {}
    }
  }
  return null;
}

ipcMain.handle("nico:run-cli", async (_event, request) => {
  const tool = String(request?.tool || "claude").toLowerCase();
  const task = String(request?.task || "").trim();
  if (!CLI_TOOLS[tool]) return { ok: false, error: `Unknown CLI tool: ${tool}` };
  if (task.length < 3) return { ok: false, error: "Describe the task first" };
  if (task.length > 4000) return { ok: false, error: "Task too long (4000 chars max)" };
  const cwd = nicoWorkspaceDir();
  const resolved = resolveBin(tool);
  if (!resolved) {
    return { ok: false, error: `CLI '${tool}' not found — install it and retry` };
  }
  // .cmd/.bat shims ride one pre-quoted command string through the shell;
  // real binaries spawn directly with shell:false. Either way the task text
  // stays inside batchQuote() and can never break out into extra commands.
  const isBatch = /\.(cmd|bat)$/i.test(resolved);
  const parts = [resolved, ...CLI_TOOLS[tool](task)];
  const useShell = isBatch;
  const file = useShell ? parts.map(batchQuote).join(" ") : resolved;
  const args = useShell ? [] : CLI_TOOLS[tool](task);
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        timeout: CLI_TIMEOUT_MS,
        windowsHide: true,
        shell: useShell,
      });
    } catch (error) {
      resolve({ ok: false, error: `Could not start ${tool}: ${error.message}` });
      return;
    }
    let out = "";
    let err = "";
    child.stdout?.on("data", (data) => { out += data.toString(); });
    child.stderr?.on("data", (data) => { err += data.toString(); });
    child.on("error", () => resolve({
      ok: false,
      error: `CLI '${tool}' not found — install it and retry`,
    }));
    child.on("close", (code, signal) => {
      if (signal === "SIGTERM" && !out.trim()) {
        resolve({ ok: false, error: "CLI run timed out after 180s" });
        return;
      }
      if (/is not recognized as an internal/i.test(err)) {
        resolve({ ok: false, error: `CLI '${tool}' not found — install it and retry` });
        return;
      }
      const output = (out + (err ? `\n[stderr]\n${err}` : "")).trim();
      if ((code === 0 || signal === "SIGTERM") && output) {
        const truncated = output.length > CLI_MAX_OUTPUT;
        resolve({
          ok: true,
          tool,
          output: truncated ? output.slice(0, CLI_MAX_OUTPUT) : output,
          truncated,
          cwd,
        });
      } else {
        resolve({
          ok: false,
          error: (err || out || `exit code ${code}`).trim().slice(0, 500),
        });
      }
    });
  });
});

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
