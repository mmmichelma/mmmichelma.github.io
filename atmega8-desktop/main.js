// AVR-Werkstatt als Windows-Programm (Electron).
// Die Web-App liegt beim Bauen im Ordner app/ und läuft komplett offline.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#14171d',
    title: 'AVR-Werkstatt ATmega8',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.maximize();
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // Links nach außen im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  // "Herunterladen" (.c/.asm speichern): immer den Speichern-Dialog zeigen
  win.webContents.session.on('will-download', (e, item) => {
    item.setSaveDialogOptions({ title: 'Programm speichern', defaultPath: item.getFilename() });
  });
  // Strg+Plus/Minus/0 zum Zoomen, F11 Vollbild, Strg+Umschalt+I Entwicklerwerkzeuge
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = win.webContents;
    if (input.control && (input.key === '+' || input.key === '=')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
    else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.control && input.shift && input.key.toLowerCase() === 'i') { wc.toggleDevTools(); e.preventDefault(); }
  });
}

Menu.setApplicationMenu(null); // kein Menü -> F5/F10 gehören der App
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
