import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';

declare global {
  interface Window {
    /** The desktop app's preload (apps/desktop/src/preload.ts); absent in a browser. */
    desktop?: { updateReady(): Promise<string | null>; onUpdate(cb: (version: string) => void): () => void; installUpdate(): Promise<void>; openDataFolder(): Promise<string> };
  }
}

/** Bottom-left card once the desktop app has downloaded a newer version. Later hides it; it then installs on quit. */
export function UpdatePrompt() {
  const [version, setVersion] = useState<string | null>(null);
  const [later, setLater] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    void desktop.updateReady().then((v) => v && setVersion(v));
    return desktop.onUpdate(setVersion);
  }, []);
  if (!version || version === later) return null;
  return (
    <div role="status" className="card fixed bottom-4 left-4 z-50 w-[min(320px,calc(100vw-32px))] animate-rise px-4 py-3.5">
      <p className="flex items-center gap-2 font-display text-sm tracking-[.12em] text-red uppercase">
        <Download aria-hidden size={15} />
        Update available
      </p>
      <p className="mt-1 text-[13px] text-text-2">
        Update to version <b className="text-text tabular-nums">{version}</b>? The app restarts in a few seconds.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={() => setLater(version)}>
          Later
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            void window.desktop?.installUpdate();
          }}
        >
          {installing ? 'Updating…' : 'Update now'}
        </Button>
      </div>
    </div>
  );
}
