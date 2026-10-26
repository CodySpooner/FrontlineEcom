import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray, utilityProcess } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialBounds, type WindowState } from './bounds';
import { loadKey } from './key';
import { stablePort } from './port';

// Set FRONTLINE_DEV_URL (e.g. http://localhost:5173 with `pnpm dev` running) to load Vite with HMR; UI and API then
// come from the dev servers. Otherwise the app starts its own API, which also serves the web build.
const DEV_URL = process.env.FRONTLINE_DEV_URL;
// Installed: the bundled API and web build sit in resources/ (scripts/stage.mjs). From the repo: the sources.
const root = join(import.meta.dirname, '../../..');
const API_ENTRY = app.isPackaged ? join(process.resourcesPath, 'server/server.mjs') : join(root, 'apps/server/src/tsx-entry.mjs');
const WEB_DIR = app.isPackaged ? join(process.resourcesPath, 'web') : join(root, 'apps/web/dist');
const ICON = join(app.getAppPath(), 'build/icon.png');
const BG = '#08080a';
// Login item (tray → Start with Windows): Windows starts the app with --hidden, so it waits in the tray.
const LOGIN = { args: ['--hidden'] };
const HIDDEN = process.argv.includes('--hidden');

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
/** Last launch ended maximized: maximize on first show (maximize() also shows, so not before a --hidden start is opened). */
let maximize = false;

// Windows only shows toasts for an app id it knows: the installer's shortcut carries this one (electron-builder appId).
if (app.isPackaged) app.setAppUserModelId('com.frontline-ecom.app');

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
  if (maximize) win.maximize();
  maximize = false;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

async function start() {
  Menu.setApplicationMenu(null);
  const url = DEV_URL ?? (await startApi());
  // Before the window loads (the first start takes a while): nothing raised meanwhile is missed.
  toastNotifications(url);
  const stateFile = join(app.getPath('userData'), 'window.json');
  let saved: WindowState = {};
  try {
    saved = JSON.parse(readFileSync(stateFile, 'utf8')) ?? {};
  } catch {} // first launch
  const areas = [screen.getPrimaryDisplay(), ...screen.getAllDisplays()].map((d) => d.workArea);
  const { maximized, ...bounds } = initialBounds(saved, areas);
  maximize = maximized;
  win = new BrowserWindow({
    ...bounds,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: BG,
    title: 'Frontline Ecom',
    icon: ICON,
    // Frameless: the web app's top bar is the title bar (drag region); Windows keeps its native buttons on top.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#d4d4d8', height: 40 },
  });
  if (!HIDDEN) win.once('ready-to-show', show);
  // Closing hides to the tray so automations and agents keep running; Quit is in the tray menu.
  win.on('close', (e) => {
    try {
      writeFileSync(stateFile, JSON.stringify({ bounds: win!.getNormalBounds(), maximized: win!.isMaximized() } satisfies WindowState));
    } catch {} // a read-only profile just reopens at the default
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

  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Frontline Ecom');
  tray.on('click', show);
  // ponytail: installed app only; from the repo the login item would point at the bare electron.exe.
  const startWithWindows: Electron.MenuItemConstructorOptions[] = app.isPackaged
    ? [{ label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(LOGIN).openAtLogin, click: (item) => app.setLoginItemSettings({ ...LOGIN, openAtLogin: item.checked }) }]
    : [];
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Frontline Ecom', click: show }, ...startWithWindows, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
}

// Shown toasts are kept referenced: a garbage-collected Notification no longer reports its click.
const toasts = new Set<Notification>();

/**
 * While the window is hidden or in the background, the app's notifications (already filtered by Settings →
 * Notifications) also show as Windows toasts; a click opens the window on that notification's page.
 */
function toastNotifications(url: string) {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/api/live`);
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as { type: string; notification?: { title: string; body?: string; link?: string } };
    const n = msg.notification;
    if (msg.type !== 'notification' || !n || (win?.isVisible() && win.isFocused())) return;
    const toast = new Notification({ title: n.title, body: n.body ?? '', icon: ICON });
    const done = () => toasts.delete(toast);
    toast.on('click', () => {
      done();
      if (n.link && win && new URL(win.webContents.getURL()).pathname !== n.link) void win.loadURL(new URL(n.link, url).href);
      show();
    });
    toast.on('close', done);
    toasts.add(toast);
    toast.show();
  };
  // The API restarted (or the app is quitting): reconnect.
  ws.onclose = () => {
    if (!quitting) setTimeout(() => toastNotifications(url), 3000);
  };
}

/** Exit code the API uses to ask for a restart (e.g. after staging a backup restore); not counted as a crash. */
const RESTART = 75;

/**
 * Runs the API in a utility process on the last launch's localhost port (a free one if it's taken) and resolves its URL
 * once it answers. If it dies it is started again on the same port and the window reloads; after 3 crashes in 10
 * minutes the app gives up.
 */
async function startApi() {
  const userData = app.getPath('userData');
  const port = await stablePort(join(userData, 'api-port'));
  const env = {
    ...process.env,
    API_PORT: String(port),
    FRONTLINE_DATA_DIR: join(userData, 'data'),
    FRONTLINE_WEB_DIR: WEB_DIR,
    FRONTLINE_SECRET_KEY: loadKey(join(userData, 'secret.key.enc'), safeStorage, confirmKeyReset).toString('base64'),
  };
  const url = `http://127.0.0.1:${port}`;
  const crashes: number[] = [];
  let api: Electron.UtilityProcess;
  const spawn = () => {
    api = utilityProcess.fork(API_ENTRY, [], { serviceName: 'Frontline API', stdio: 'inherit', env });
    api.on('exit', (code) => {
      if (quitting) return;
      if (code !== RESTART) crashes.push(Date.now());
      if (crashes.filter((t) => Date.now() - t < 10 * 60_000).length > 3) {
        dialog.showErrorBox('Frontline Ecom', `The local server keeps stopping (exit code ${code}). Details are in the log folder next to your data.`);
        app.exit(1);
        return;
      }
      spawn();
      waitForApi(url).then(() => win?.reload(), () => {});
    });
  };
  spawn();
  app.on('will-quit', () => api.kill());
  await waitForApi(url);
  return url;
}

// First run seeds two years of demo data, so give it time.
async function waitForApi(url: string) {
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 250))) {
    if (await fetch(`${url}/api/health`).then((r) => r.ok, () => false)) return;
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

