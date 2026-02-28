const { app, BrowserWindow } = require("electron");
const path = require("path");

process.env.USER_DATA_PATH = app.getPath("userData");

const server = require("./server.js");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f1f5f9",
      symbolColor: "#1e293b",
      height: 40,
    },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    autoHideMenuBar: true,
    title: "Infinity Todo",
  });

  const loadApp = () => {
    const port = server.address().port;
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  };

  const { ipcMain } = require("electron");
  ipcMain.on("toggle-always-on-top", (event) => {
    if (mainWindow) {
      const isAlwaysOnTop = mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(!isAlwaysOnTop);
      event.sender.send("always-on-top-changed", !isAlwaysOnTop);
    }
  });

  if (server.address()) {
    loadApp();
  } else {
    server.once("listening", loadApp);
  }

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
