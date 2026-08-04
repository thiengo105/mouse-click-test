'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

// Chromium normally maps the X1/X2 side buttons to history navigation. This app
// is a single local page with no history, but disabling the swipe gesture and
// the Windows app-command keeps the buttons from doing anything except being
// reported to the renderer as mouse buttons 3 and 4.
app.commandLine.appendSwitch('disable-features', 'OverscrollHistoryNavigation');

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0f1216',
    title: 'Mouse Click Test',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The renderer is a diagnostic surface; background throttling would skew
      // the timestamps the chatter detector depends on.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Windows delivers the side buttons as app commands in addition to raw mouse
  // buttons. Swallow them here so navigation never fires; the renderer already
  // sees them via mousedown.
  mainWindow.on('app-command', (event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') {
      event.preventDefault();
    }
  });

  const contents = mainWindow.webContents;

  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
