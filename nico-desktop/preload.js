// Preload bridge: the only code in the desktop shell with Node access.
// Renderer (sandboxed, no Node) talks to it via window.nicoDesktop.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nicoDesktop", {
  platform: process.platform,
  // Screen sources for vision mode (getDisplayMedia is unavailable in
  // Electron, so the renderer captures via desktopCapturer + getUserMedia).
  async pickScreenSource() {
    try {
      return await ipcRenderer.invoke("nico:pick-screen-source");
    } catch {
      return null;
    }
  },
  // CLI hands: run claude / opencode / codex headless in ~/nico-workspace.
  async runCli(task, tool = "claude") {
    try {
      return await ipcRenderer.invoke("nico:run-cli", { task, tool });
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  },
  // Custom frameless title-bar controls.
  window(action) {
    try {
      return ipcRenderer.invoke("nico:window", action);
    } catch {
      return Promise.resolve(false);
    }
  },
  onWindowState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("nico:window-state", listener);
    return () => ipcRenderer.removeListener("nico:window-state", listener);
  },
});
