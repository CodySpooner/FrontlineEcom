type Rect = { x: number; y: number; width: number; height: number };
/** What `window.json` keeps between launches. */
export type WindowState = { bounds?: Rect; maximized?: boolean };

const inside = (a: Rect, x: number, y: number) => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height;

/**
 * Where the window opens: last launch's place while its title bar is still on a screen (shrunk to fit that screen), else
 * the default size fitted to the primary screen's work area (`areas[0]`; a 1366×768 laptop has less than 1440×900), centered.
 */
export function initialBounds(saved: WindowState, areas: Rect[], def = { width: 1440, height: 900 }) {
  const b = saved.bounds;
  const on = b && areas.find((a) => inside(a, b.x + b.width / 2, b.y + 20));
  if (b && on) return { x: b.x, y: b.y, width: Math.min(b.width, on.width), height: Math.min(b.height, on.height), maximized: !!saved.maximized };
  const a = areas[0]!;
  const [width, height] = [Math.min(def.width, a.width), Math.min(def.height, a.height)];
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height, maximized: !!saved.maximized };
}
