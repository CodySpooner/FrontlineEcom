import type { OfficeAppearance } from '@frontline/shared';

export const ANIMATIONS = ['idle', 'walk', 'sit', 'work', 'think', 'talk', 'collaborate', 'complete', 'approval', 'error'] as const;
export type Animation = (typeof ANIMATIONS)[number];
export type Direction = 0 | 1 | 2 | 3;
export const CELL = { width: 32, height: 40 };
export const SHEET = { width: 512, height: 400, columns: 6 };
export function frameAt(animation: Animation, elapsed: number, direction: Direction, worker: number) {
  const state = animation === 'complete' && elapsed > 1800 ? 'sit' : animation;
  const frame = Math.floor(Math.max(0, elapsed) / (state === 'walk' ? 110 : 230)) % 4;
  return { x: (worker % SHEET.columns) * SHEET.width + (direction * 4 + frame) * CELL.width,
    y: Math.floor(worker / SHEET.columns) * SHEET.height + ANIMATIONS.indexOf(state) * CELL.height };
}
export function appearanceFor(id: string): OfficeAppearance {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { color: ['#ef465b', '#557ee0', '#40b99c', '#bf78de', '#e1a652', '#6d9eaf'][hash % 6]!,
    hair: Math.floor(hash / 6) % 6, skin: Math.floor(hash / 36) % 4, outfit: (['jacket', 'suit', 'hoodie'] as const)[Math.floor(hash / 144) % 3]!,
    accessory: (['headset', 'glasses', 'none'] as const)[Math.floor(hash / 432) % 3]! };
}

/** Four frames and four isometric directions per pose, packed for every seated worker into one texture. */
export function paintCharacters(looks: OfficeAppearance[]) {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET.width * SHEET.columns;
  canvas.height = Math.max(1, Math.ceil(looks.length / SHEET.columns)) * SHEET.height;
  const c = canvas.getContext('2d')!;
  for (const [worker, look] of looks.entries()) for (const animation of ANIMATIONS) for (let direction = 0; direction < 4; direction++) for (let frame = 0; frame < 4; frame++) {
    const p = frameAt(animation, frame * (animation === 'walk' ? 110 : 230), direction as Direction, worker);
    c.save(); c.translate(p.x, p.y);
    if (direction % 2) { c.translate(CELL.width, 0); c.scale(-1, 1); }
    paintPerson(c, look, animation, frame, direction >= 2);
    c.restore();
  }
  return canvas;
}

export function paintPortrait(look: OfficeAppearance) {
  const canvas = document.createElement('canvas'); canvas.width = CELL.width; canvas.height = CELL.height;
  paintPerson(canvas.getContext('2d')!, look, 'idle', 0, false);
  return canvas;
}

function paintPerson(c: CanvasRenderingContext2D, look: OfficeAppearance, state: Animation, frame: number, back: boolean) {
  const r = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  const skin = ['#e9b48c', '#c88862', '#966149', '#6e4536'][look.skin]!;
  const hair = ['#24212c', '#5b302e', '#b76f3f', '#d6c29b', '#a75172', '#e3e3dc'][look.hair]!;
  const seated = state === 'sit' || state === 'work';
  const bob = !seated && (frame === 1 || frame === 3) ? 1 : 0;
  const step = state === 'walk' ? [0, 2, 0, -2][frame]! : 0;
  c.globalAlpha = .3; r(7, 36, 20, 3, '#000000'); c.globalAlpha = 1;
  // Boots and trouser folds preserve the silhouette on the dark floor.
  r(11, seated ? 29 : 28 + step, 5, seated ? 5 : 8 - step, '#202635'); r(19, seated ? 29 : 28 - step, 5, seated ? 5 : 8 + step, '#202635');
  r(10, seated ? 33 : 35 + step, 7, 3, '#77798b'); r(19, seated ? 33 : 35 - step, 7, 3, '#52596e');
  c.save(); c.translate(0, seated ? 3 : -bob);
  r(10, 18, 15, 13, '#121726'); r(11, 19, 12, 10, look.color);
  r(11, 19, 3, 9, '#ffffff33'); r(22, 21, 2, 8, '#00000055');
  r(16, 17, 5, 8, look.outfit === 'suit' ? '#e1e6ef' : '#242939');
  r(18, 19, 1, 11, look.outfit === 'suit' ? '#fa4159' : '#a5a7b1');
  r(11, 29, 12, 2, '#161c2c');r(18, 29, 3, 1, '#c4c7d1');
  const raised = state === 'complete' || state === 'collaborate';
  const armY = raised ? 14 - (frame % 2) * 2 : state === 'work' ? 22 + frame % 2 : state === 'talk' ? 19 + frame % 2 : 23;
  r(7, raised ? armY : 20 + step, 4, raised ? 8 : 9, look.color);r(7, raised ? armY - 2 : 28 + step, 4, 4, skin);
  r(24, armY, state === 'work' ? 6 : 4, 6, look.color);r(state === 'work' ? 27 : 24, armY + 5, 4, 4, skin);
  if (state === 'think') { r(23, 15, 4, 12, look.color);r(20, 14, 5, 4, skin); }
  // Chibi head with a one-pixel outline, directional eyes and distinct haircuts.
  r(10, 4, 14, 14, '#171a25');r(9, 7, 16, 8, '#171a25');
  r(11, 6, 12, 10, back ? hair : skin);r(13, 15, 8, 3, back ? hair : skin);
  r(10, 4, 14, 5, hair);r(9, 7, 3, 7, hair);r(22, 7, 3, look.hair % 2 ? 10 : 5, hair);
  if (look.hair % 3 === 1) r(13, 2, 9, 4, hair);
  if (look.hair % 3 === 2) { r(8, 13, 4, 7, hair);r(22, 14, 4, 6, hair); }
  r(12, 5, 9, 1, '#ffffff22');
  if (!back) {r(15, 11, 2, 2, '#181b2b');r(21, 11, 2, 2, '#181b2b');r(18, 15, state === 'talk' ? 2 + frame % 2 : 2, 1, '#7a3d45');}
  if (look.outfit === 'hoodie') { r(9, 16, 3, 4, look.color);r(23, 16, 3, 4, look.color); }
  if (look.accessory === 'headset') { r(9, 8, 2, 7, '#a6a9b8');r(23, 9, 3, 5, '#3d465e');r(23, 14, 4, 2, '#a6a9b8'); }
  if (look.accessory === 'glasses' && !back) { r(14, 10, 10, 1, '#dae5f5');r(14, 11, 4, 2, '#73d3e1');r(20, 11, 4, 2, '#73d3e1'); }
  c.restore();
  if (state === 'approval') { r(24, 2, 6, 8, '#f4bc53');r(26, 3, 2, 4, '#4e3428');r(26, 8, 2, 1, '#4e3428'); }
  if (state === 'error') { for(let i=0;i<6;i++){r(24+i,2+i,1,1,'#ff3953');r(29-i,2+i,1,1,'#ff3953');} }
  if (state === 'complete') { r(4 + frame * 2, 4, 2, 2, '#71edbd');r(26 - frame, 0, 2, 3, '#f4cf74'); }
  if (state === 'think') {r(24, 0, 3, 3, '#adcaff');r(28, 4, 2, 2, '#adcaff');}
  if (state === 'collaborate') {r(3, 7 + frame % 2, 3, 3, '#c68cf2');r(27, 9 - frame % 2, 3, 3, '#c68cf2');}
}
