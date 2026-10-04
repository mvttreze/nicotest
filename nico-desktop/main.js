const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

const localIndex = path.resolve(__dirname, "..", "index.html");
const appIcon = path.resolve(__dirname, "..", "icon.svg");

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

async function loadNico(win) {
  const frontendUrl = process.env.NICO_URL;
  if (frontendUrl) {
    try {
      await win.loadURL(frontendUrl);
      console.log(`Loaded Nico from ${frontendUrl}`);
      return;
    } catch (error) {
      console.warn(`Could not load ${frontendUrl}:`, error.message);
    }
  }

  console.warn("Backend not reachable; loading local fallback shell.");
  await win.loadFile(localIndex);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#050816",
    title: "Nico",
    icon: appIcon,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  loadNico(win);
}

app.setName("Nico");

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
