// Gives the LAMMA host page a tiny, safe bridge to the app window (display mode, and the tester key in tester builds).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lammaDesktop", {
  testerKey: () => ipcRenderer.invoke("lamma:tester-key"),
  getDisplayMode: () => ipcRenderer.invoke("lamma:get-display-mode"),
  setDisplayMode: (mode) => ipcRenderer.invoke("lamma:set-display-mode", String(mode)),
  onDisplayMode: (cb) => {
    const h = (_e, m) => cb(m);
    ipcRenderer.on("lamma:display-mode", h);
    return () => ipcRenderer.removeListener("lamma:display-mode", h);
  },
});
