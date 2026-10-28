import { appearanceFor, type OfficeAppearance } from '@frontline/shared';

export { appearanceFor };

export const ANIMATIONS = ['idle', 'walk', 'sit', 'work', 'think', 'talk', 'collaborate', 'complete', 'approval', 'error'] as const;
export type Animation = (typeof ANIMATIONS)[number];
export type Direction = 0 | 1 | 2 | 3;
export const CELL = { width: 48, height: 64 };
export const SHEET = { width: CELL.width * 16, height: CELL.height * ANIMATIONS.length, columns: 5 };
export const ARCHETYPE_LABELS = ['Tactical operator', 'Hooded netrunner', 'Synthetic android', 'Heavy mech', 'Long-coat executive', 'Neon punk', 'Flight specialist', 'Circuit engineer'];
export const GEAR_LABELS = ['Cyber arm', 'Reactor pack', 'Signal cape', 'Antenna rig', 'Utility belt'];
export function frameAt(animation: Animation, elapsed: number, direction: Direction, worker: number) {
  const state = animation === 'complete' && elapsed > 1800 ? 'sit' : animation;
  const frame = Math.floor(Math.max(0, elapsed) / (state === 'walk' ? 110 : 230)) % 4;
  return { x: (worker % SHEET.columns) * SHEET.width + (direction * 4 + frame) * CELL.width,
    y: Math.floor(worker / SHEET.columns) * SHEET.height + ANIMATIONS.indexOf(state) * CELL.height };
}

export const resolveAppearance = (look: OfficeAppearance, agentId: string): Required<OfficeAppearance> => ({ ...appearanceFor(agentId), ...look });

/** Four frames and four directions per pose; thirty workers share a 3840 × 3840 atlas. */
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
const shade = (hex: string, factor: number) => '#' + [1, 3, 5].map((at) => Math.min(255, Math.round(parseInt(hex.slice(at, at + 2), 16) * factor)).toString(16).padStart(2, '0')).join('');

function paintPerson(c: CanvasRenderingContext2D, raw: OfficeAppearance, state: Animation, frame: number, back: boolean) {
  const look = resolveAppearance(raw, raw.color + raw.hair + raw.outfit);
  const r = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  const ink = '#0b1020', steel = '#7d8ba6', pale = '#e3edf5', glow = look.accent;
  const dark = shade(look.color, .42), mid = shade(look.color, .7), light = shade(look.color, 1.25);
  const skin = ['#efbe97', '#cc8b68', '#a46c52', '#744c3e'][look.skin]!;
  const hair = ['#242b40', '#a95840', '#dbe5ed', '#e5b653', '#b56cd6', '#4abcb9'][look.hair]!;
  const kind = look.archetype, mech = kind === 'mech', synthetic = mech || kind === 'android';
  const seated = state === 'sit' || state === 'work', step = state === 'walk' ? [0, 2, 0, -2][frame]! : 0;
  const bob = !seated && (frame === 1 || frame === 3) ? 1 : 0;
  const broad = mech ? 4 : kind === 'operator' ? 2 : look.variant % 2;
  const plate = (x: number, y: number, w: number, h: number, color: string) => {
    r(x, y, w, h, ink); r(x + 1, y + 1, w - 2, h - 2, color);
    r(x + 2, y + 1, w - 4, 1, shade(color, 1.3)); r(x + 1, y + h - 3, w - 2, 2, shade(color, .6));
  };
  const lightbar = (x: number, y: number, w: number, h = 2) => {
    r(x - 1, y - 1, w + 2, h + 2, glow + '30'); r(x, y, w, h, glow); r(x + 1, y, Math.max(1, w - 2), 1, '#efffff');
  };
  r(10 - broad, 60, 29 + broad * 2, 2, '#05081080');
  // Distinct boot widths, knee plates and coat tails remain readable at fit zoom.
  const legY = seated ? 46 : 45;
  for (const [x, offset] of [[16 - broad, step], [27, -step]]) {
    plate(x!, legY, mech ? 10 : 7, 13 + offset!, synthetic ? steel : '#303b55');
    r(x! + 1, 50 + offset!, mech ? 8 : 5, 3, synthetic ? mid : dark);
    plate(x! - 1, (seated ? 55 : 57) + offset!, mech ? 12 : 9, 4, '#59677f');
    lightbar(x! + 1, (seated ? 56 : 58) + offset!, 4, 1);
  }
  c.save(); c.translate(0, seated ? 2 : -bob);
  if (look.gear === 'cape' || kind === 'executive') {
    r(12 - broad, 29, 25 + broad, 22, ink); r(13 - broad, 31, 23 + broad, 19, dark);
    r(11 - broad - frame % 2, 43, 12, 10, dark); r(29, 42, 9 + broad + frame % 2, 12, mid);
    lightbar(12 - broad, 50, 7, 1); lightbar(31, 51, 6, 1);
  }
  if (look.gear === 'reactor' || kind === 'pilot') {
    plate(back ? 17 : 9, 28, back ? 18 : 10, 22, '#414f69');
    lightbar(back ? 22 : 11, 32, 4, 9); r(back ? 20 : 11, 45, 5, 4, steel);
  }
  if (look.gear === 'antenna') {
    r(10, 18, 2, 26, steel); plate(7, 31, 8, 14, dark); lightbar(9, 16, 4, 3);
    r(13, 22, 2, 14, '#8795ad'); lightbar(12, 20, 4);
  }
  plate(14 - broad, 29, 21 + broad * 2, 19, look.color);
  r(15 - broad, 31, 4, 13, light); r(31 + broad, 32, 3, 13, mid);
  if (kind === 'executive' || look.outfit === 'suit') {
    r(21, 29, 8, 15, pale); r(24, 32, 3, 10, '#ff526e'); r(19, 30, 3, 6, dark); r(29, 30, 3, 7, dark);
  } else if (kind === 'engineer') {
    r(17, 31, 3, 14, '#33445e'); r(29, 31, 3, 14, '#33445e'); plate(20, 35, 9, 8, '#344560'); lightbar(22, 38, 5);
  } else if (kind === 'android') {
    plate(19, 31, 12, 13, '#d6e5e9'); plate(22, 34, 6, 7, '#24324b'); lightbar(23, 35, 4, 4);
    r(18, 43, 14, 3, steel);
  } else if (mech || kind === 'operator') {
    plate(17 - broad, 31, 15 + broad * 2, 10, dark); lightbar(20, 34, mech ? 12 : 8, 3);
    for (let j = 0; j < 3; j++) r(19 + j * 4, 42, 2, 3, steel);
  } else {
    r(23, 30, 2, 15, '#c9d7e8'); plate(16, 34, 6, 5, dark); lightbar(17, 35, 3, 1);
    if (kind === 'punk') { for (let j = 0; j < 5; j++) r(17 + j * 3, 32 + j * 2, 2, 2, pale); }
  }
  if (back) {
    plate(18, 32, 14, 12, dark); lightbar(21, 35, 8);
    if (look.gear === 'reactor') { plate(17, 29, 16, 19, '#394b66'); lightbar(21, 33, 8, 8); }
    else for (let j = 0; j < 3; j++) r(21, 39 + j * 2, 8, 1, steel);
  }
  r(14 - broad, 46, 21 + broad * 2, 3, ink); plate(23, 45, 6, 4, steel);
  if (look.gear === 'belt' || kind === 'engineer') { plate(13, 43, 7, 7, dark); plate(31, 43, 6, 8, '#6d8093'); lightbar(14, 44, 4); }
  const raised = state === 'complete' || state === 'collaborate' || state === 'sit' && frame === 2;
  const armY = raised ? 22 - frame % 2 * 2 : state === 'sit' && frame === 1 ? 26 : state === 'work' ? 36 + frame % 2 : state === 'talk' ? 30 + frame % 2 : 33;
  plate(9 - broad, raised ? armY : 31 + step, 7 + broad, raised ? 12 : 15, kind === 'android' ? steel : mid);
  plate(34 + broad, armY, mech ? 9 : 7, state === 'work' ? 10 : 14, look.gear === 'cyberarm' || synthetic ? steel : dark);
  if (look.gear === 'cyberarm' || synthetic) { lightbar(36 + broad, armY + 3, 3, 5); r(35 + broad, armY + 10, 5, 2, '#b9ccdf'); }
  r(10 - broad, raised ? armY - 2 : 44 + step, 5 + broad, 4, synthetic ? steel : skin);
  r(35 + broad, armY + 12, mech ? 6 : 5, 4, synthetic || look.gear === 'cyberarm' ? pale : skin);
  if (state === 'sit' && frame === 1) { plate(35 + broad, 35, 7, 8, synthetic ? glow : '#e8e1cf'); r(41 + broad, 37, 3, 4, pale); if (!synthetic) { r(37 + broad, 29, 1, 4, '#b8c1ce'); r(39 + broad, 27, 1, 3, '#77869b'); } }
  if (kind === 'operator' || mech || kind === 'punk') { plate(7 - broad, 29, 11 + broad, 7, look.color); lightbar(9 - broad, 30, 6); plate(34, 28, 9 + broad, 8, mid); }
  if (state === 'think') { plate(32, 24, 7, 17, mid); r(30, 22, 7, 5, synthetic ? steel : skin); }
  if (state === 'work' || state === 'collaborate') { r(29, 39 + frame % 2, 15, 9, '#13374dbb'); lightbar(30, 39 + frame % 2, 13, 1); r(31, 42, 8 + frame % 3, 1, glow); r(32, 45, 6, 1, glow); }
  // Each archetype owns its head outline; accessories add detail without replacing identity.
  if (kind === 'netrunner') {
    r(17, 8, 14, 3, ink); r(14, 11, 20, 4, dark); r(11, 15, 26, 13, dark); r(13, 27, 22, 4, mid);
    r(15, 15, 18, 12, ink); r(16, 12, 3, 14, light); r(32, 15, 3, 14, mid);
    if (!back) { lightbar(18, 20, 5, 3); lightbar(26, 20, 5, 3); r(21, 26, 8, 3, '#354159'); }
    else { lightbar(20, 16, 9, 1); r(22, 20, 6, 8, mid); }
  } else if (mech) {
    plate(9, 10, 30, 20, '#526780'); plate(12, 13, 25, 12, '#1d2c46');
    if (!back) { lightbar(15, 17, look.variant % 2 ? 18 : 9, 4); r(17, 26, 14, 3, '#c5d6e4'); for (let j = 0; j < 4; j++) r(18 + j * 3, 27, 1, 2, ink); }
    else { plate(17, 15, 17, 10, mid); lightbar(20, 18, 10); }
    plate(6, 16, 5, 10, mid); plate(39, 15, 4, 11, mid); r(33, 5, 2, 6, steel); lightbar(32, 3, 4, 3);
  } else if (kind === 'pilot' || kind === 'operator') {
    r(16, 8, 17, 3, ink); plate(12, 11, 25, 19, kind === 'pilot' ? light : '#465771');
    r(16, 10, 16, 3, look.color); plate(14, 15, 22, 9, '#182b44');
    if (!back) { lightbar(16, 17, 17, 3); plate(21, 23, 13, 7, '#66778e'); r(23, 25, 8, 2, ink); }
    else { r(18, 17, 15, 6, dark); lightbar(20, 18, 10, 1); }
    plate(10, 18, 5, 9, steel); r(12, 27, 4, 7, dark); lightbar(14, 29, 4, 1);
  } else if (kind === 'android') {
    plate(16, 9, 18, 20, '#ccdfeb'); r(14, 15, 3, 10, steel); r(34, 14, 3, 10, dark);
    r(17, 10, 5, 15, '#eaf4f4'); r(30, 11, 3, 17, '#778ca7');
    if (!back) { r(20, 17, 12, 6, ink); lightbar(21, 18, 10, 2); r(24, 26, 6, 1, dark); }
    else { r(22, 13, 5, 13, dark); lightbar(23, 15, 3, 6); }
    r(34, 6, 1, 10, pale); lightbar(33, 5, 3);
  } else {
    plate(15, 12, 20, 17, back ? hair : skin); r(13, 17, 4, 8, back ? hair : skin);
    r(15, 10, 19, 7, hair); r(13, 14, 5, 10, hair); r(32, 15, 3, 9, hair);
    r(17, 11, 12, 2, shade(hair, 1.8)); r(13, 16, 1, 7, steel);
    if (look.hair % 3 === 1) { r(13, 21, 4, 10, hair); r(31, 21, 5, 10, hair); }
    if (kind === 'punk') { r(21, 3, 6, 12, look.color); r(24, 1, 5, 7, glow); r(18, 6, 5, 8, light); r(30, 11, 5, 4, glow); }
    if (kind === 'executive') { r(13, 11, 20, 4, hair); r(12, 12, 6, 7, hair); r(31, 17, 4, 8, steel); }
    if (kind === 'engineer') { plate(13, 10, 23, 7, dark); r(24, 16, 14, 3, look.color); lightbar(16, 12, 8, 2); }
    if (!back) { r(22, 20, 2, 3, ink); r(30, 20, 2, 3, ink); r(26, 26, state === 'talk' ? 3 + frame % 2 : 3, 1, '#864d55'); }
    if (look.accessory === 'glasses' && !back) { r(20, 19, 14, 2, pale); lightbar(20, 21, 5, 2); lightbar(28, 21, 5, 2); }
  }
  if (look.accessory === 'headset') { plate(11, 18, 5, 9, '#4e5f78'); lightbar(12, 20, 3, 3); r(12, 26, 3, 4, steel); r(14, 28, 7, 2, steel); }
  if (look.outfit === 'hoodie' && kind !== 'netrunner') { r(12, 27, 6, 5, dark); r(32, 27, 6, 5, dark); }
  if (look.variant % 2) { plate(29, 33, 5, 7, '#18253c'); lightbar(30, 34, 3, 3); }
  c.restore();
  if (state === 'approval') { plate(39, 3, 7, 10, '#f4bc53'); r(42, 5, 1, 4, ink); r(42, 10, 1, 1, ink); }
  if (state === 'error') { for (let i = 0; i < 7; i++) { r(39 + i, 3 + i, 1, 2, '#ff3953'); r(45 - i, 3 + i, 1, 2, '#ff3953'); } }
  if (state === 'complete') { lightbar(5 + frame * 2, 9, 3, 3); lightbar(35 - frame, 2, 3, 4); }
  if (state === 'think') { r(37, 4, 4, 4, '#afcfff'); r(42, 10, 3, 3, '#afcfff'); }
  if (state === 'collaborate') { r(4, 17 + frame % 2, 3, 3, '#d4a0ff'); r(40, 14 - frame % 2, 3, 3, '#d4a0ff'); }
}
