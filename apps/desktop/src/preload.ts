// The window has no Node access; this bridge exposes what only the desktop shell can do: a downloaded update (the web
// app's UpdatePrompt shows it bottom-left) and opening the data folder. Sandboxed preload, so it's bundled to CommonJS (dist/preload.cjs).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  /** Version of a downloaded update waiting to be installed, or null. */
  updateReady: (): Promise<string | null> => ipcRenderer.invoke('update:ready'),
  /** Calls back when an update finishes downloading; returns the unsubscribe. */
  onUpdate: (cb: (version: string) => void) => {
    const on = (_: unknown, version: string) => cb(version);
    ipcRenderer.on('update:ready', on);
    return () => void ipcRenderer.off('update:ready', on);
  },
  /** Quits, installs the update silently and starts the new version. */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  /** Opens the data folder (database, logs, backups) in Explorer; resolves to '' or Windows' error text. */
  openDataFolder: (): Promise<string> => ipcRenderer.invoke('data:open'),
});
