import { app, BrowserWindow, dialog, Menu, nativeImage, safeStorage, shell, Tray, utilityProcess } from 'electron';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { loadKey } from './key';

// Set FRONTLINE_DEV_URL (e.g. http://localhost:5173 with `pnpm dev` running) to load Vite with HMR; UI and API then
// come from the dev servers. Otherwise the app starts its own API, which also serves the web build.
const DEV_URL = process.env.FRONTLINE_DEV_URL;
// ponytail: repo paths; CORE-19 (packaging) points these at the bundled server + web build under process.resourcesPath.
const root = join(import.meta.dirname, '../../..');
const BG = '#08080a';

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('before-quit', () => (quitting = true));
  app.whenReady().then(start).catch((e: Error) => {
    dialog.showErrorBox('Frontline Ecom', `Couldn't start: ${e.message}`);
    app.exit(1);
  });
}

function show() {
  if (!win) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

async function start() {
  Menu.setApplicationMenu(null);
  const url = DEV_URL ?? (await startApi());
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: BG,
    title: 'Frontline Ecom',
    // Frameless: the web app's top bar is the title bar (drag region); Windows keeps its native buttons on top.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#d4d4d8', height: 40 },
  });
  win.once('ready-to-show', show);
  // Closing hides to the tray so automations and agents keep running; Quit is in the tray menu.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  // Links open in the browser; the window never navigates away from the app.
  win.webContents.setWindowOpenHandler(({ url: link }) => {
    if (/^https?:\/\//.test(link)) void shell.openExternal(link);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, to) => {
    if (new URL(to).origin !== new URL(url).origin) e.preventDefault();
  });
  await win.loadURL(url);

  tray = new Tray(trayIcon());
  tray.setToolTip('Frontline Ecom');
  tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Frontline Ecom', click: show }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
}

/** Runs the API in a utility process on a free localhost port and resolves its URL once it answers. */
async function startApi() {
  const port = await freePort();
  const userData = app.getPath('userData');
  const api = utilityProcess.fork(join(root, 'apps/server/src/tsx-entry.mjs'), [], {
    serviceName: 'Frontline API',
    stdio: 'inherit',
    env: {
      ...process.env,
      API_PORT: String(port),
      FRONTLINE_DATA_DIR: join(userData, 'data'),
      FRONTLINE_WEB_DIR: join(root, 'apps/web/dist'),
      FRONTLINE_SECRET_KEY: loadKey(join(userData, 'secret.key.enc'), safeStorage, confirmKeyReset).toString('base64'),
    },
  });
  api.on('exit', (code) => {
    if (quitting) return;
    dialog.showErrorBox('Frontline Ecom', `The local server stopped (exit code ${code}).`);
    app.exit(1);
  });
  app.on('will-quit', () => api.kill());

  const url = `http://127.0.0.1:${port}`;
  // First run seeds two years of demo data, so give it time.
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 250))) {
    if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) return url;
  }
  throw new Error('the local server did not answer within 60s');
}

function confirmKeyReset() {
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Frontline Ecom',
    message: "Saved connector credentials can't be unlocked",
    detail:
      'Windows no longer has the key that protects them (for example after a crash right after the first start, or a ' +
      'new Windows profile). Reset to continue with a new key and enter your tokens again on the Integrations screen. ' +
      'Your stores and data are not affected; the old key file is kept next to the new one.',
    buttons: ['Reset credentials', 'Quit'],
    defaultId: 1,
    cancelId: 1,
  });
  return choice === 0;
}

// ponytail: the port is free when checked, not reserved; another process could grab it before the API binds.
function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
      .once('error', reject)
      .listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
  });
}

// ponytail: plain red square until CORE-19 adds the brand icon.
function trayIcon() {
  const px = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < px.length; i += 4) px.set([0x3a, 0x2a, 0xff, 0xff], i); // BGRA #ff2a3a
  return nativeImage.createFromBitmap(px, { width: 16, height: 16 });
}
