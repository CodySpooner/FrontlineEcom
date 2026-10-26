// Renders build/icon.svg to build/icon.png (256×256: installer, exe, window and tray icon). Run: electron scripts/icon.mjs
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '../build');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  let loaded = false;
  win.webContents.on('paint', (_e, _dirty, image) => {
    if (!loaded) return;
    writeFileSync(join(dir, 'icon.png'), image.resize({ width: 256, height: 256 }).toPNG());
    app.quit();
  });
  win.webContents.once('did-finish-load', () => setTimeout(() => ((loaded = true), win.webContents.invalidate()), 500));
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
  void win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent;overflow:hidden">${svg}</body>`)}`);
});
