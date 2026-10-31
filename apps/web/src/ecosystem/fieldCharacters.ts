import type { OfficeAppearance } from '@frontline/shared';
import type { Animation } from './characters';

const shade = (hex: string, factor: number) => '#' + [1, 3, 5].map((at) => Math.min(255, Math.round(parseInt(hex.slice(at, at + 2), 16) * factor)).toString(16).padStart(2, '0')).join('');

/** Original field specialist art. Small value clusters, fixed feet, upper-left key light. */
export function paintFieldSpecialist(c: CanvasRenderingContext2D, look: Required<OfficeAppearance>, state: Animation, frame: number, back: boolean) {
  const ink = '#10131e', steel = '#70869b', pale = '#cedce0', leather = '#796353';
  const cloth = look.color, dark = shade(cloth, .45), mid = shade(cloth, .72), light = shade(cloth, 1.35);
  const skin = ['#efbe97', '#cc8b68', '#a46c52', '#744c3e'][look.skin]!;
  const hair = ['#242b40', '#a95840', '#dbe5ed', '#e5b653', '#b56cd6', '#4abcb9'][look.hair]!;
  const r = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  const p = (points: number[], color: string) => { c.beginPath(); c.moveTo(points[0]!, points[1]!); for (let i=2;i<points.length;i+=2)c.lineTo(points[i]!,points[i+1]!);c.closePath();c.fillStyle=color;c.fill(); };
  const plate = (x: number, y: number, w: number, h: number, color: string) => { r(x,y,w,h,ink);r(x+1,y+1,w-2,h-2,color);r(x+1,y+1,w-3,1,pale);r(x+w-2,y+2,1,h-3,steel); };
  const step = state === 'walk' ? [0,2,0,-2][frame]! : 0;
  const working = state === 'work' || state === 'collaborate';
  const seated = state === 'sit' || state === 'work';
  const arm = state === 'complete' ? -8 + frame : state === 'talk' ? -frame : working ? -4 : state === 'think' ? -12 : 0;
  r(9,61,29,2,'#05081080');
  // Boots have heel blocks, articulated knees and separate shafts, not a single block leg.
  for (const [x, stride] of [[16,step],[27,-step]]) {
    p([x!,40,x!+6,40,x!+7,51+stride!,x!+5,59+stride!,x!-1,59+stride!,x!-2,50],ink);
    r(x!,41,5,12+stride!, '#303e50');r(x!,43,2,9,steel);r(x!,50+stride!,5,3,dark);
    r(x!-1,54+stride!,7,6,leather);r(x!,54+stride!,2,5,'#b8a088');
    r(x!-3,59+stride!,10,3,ink);r(x!-2,59+stride!,8,1,steel);
  }
  c.save();c.translate(0,seated ? 2 : 0);
  // Long split survey coat: weight in the hem, a lit left fold and a cooler right fold.
  p([17,19,29,19,35,28,34,40,39,51,29,53,25,40,21,52,10,49,13,35,12,26],ink);
  p([15,24,22,21,24,38,20,49,12,47,15,34],cloth);
  p([25,21,30,23,33,33,31,40,36,50,29,50,25,37],mid);
  p([15,25,17,24,17,37,14,46,12,46],light);
  p([19,32,22,30,23,40,20,49,17,48],dark);
  p([28,33,30,34,29,40,33,49,30,49],dark);
  r(16,47,4,1,pale);r(30,49,5,1,steel);
  // Layered collar, undershirt and diagonal leather instrument strap.
  p([19,19,24,23,28,19,29,29,20,31,17,24], '#394655');
  p([16,22,19,20,24,25,21,29],pale);p([28,20,32,23,27,30,25,25],steel);
  p([15,23,17,22,31,38,29,40],leather);r(22,30,3,2,'#d8c4a1');
  r(17,38,15,3,ink);plate(23,38,4,3,steel);
  plate(9,33,8,12,leather);r(10,36,6,2,'#b8a088');r(12,37,2,3,pale);
  // Rear-mounted sample canisters and a shoulder sensor produce an asymmetric outline.
  plate(back ? 19 : 10,24,back ? 12 : 5,12, '#455465');
  r(back ? 21 : 11,27,2,6,look.accent);r(back ? 25 : 12,34,3,1,ink);
  if (look.gear === 'antenna') { r(11,14,1,13,steel);r(10,13,3,2,look.accent); }
  if (look.gear === 'cape') { p([13,25,17,25,15,42,8,47,9,37],dark);r(9,44,4,1,light); }
  if (back) { p([18,26,29,26,30,37,20,37],dark);plate(21,27,7,9,leather);r(23,29,3,1,pale); }
  // Separate upper sleeve, elbow and glove; the held instrument stays attached to the hand.
  p([12,25,17,24,18,31,15,39+step,10,38+step,9,31],ink);
  p([12,26,16,26,16,31,13,37+step,11,36+step,11,30],mid);r(11,28,2,5,light);
  r(11,38+step,4,4,skin);r(11,37+step,4,2,leather);
  p([31,25,35,27,37,32+arm,39,38+arm,34,40+arm,31,32],ink);
  p([32,27,34,28,35,33+arm,37,37+arm,34,38+arm,32,32],mid);
  r(34,35+arm,4,3,look.gear === 'cyberarm' ? steel : leather);r(35,38+arm,3,3,skin);
  plate(35,33+arm,9,7,'#26394a');r(37,35+arm,5,3,look.accent);r(38+(working?frame%2:0),35+arm,1,2,pale);
  // Smaller three-quarter face, stepped hair masses and a quiet glass monocular.
  p([20,4,28,4,31,7,31,15,27,20,22,19,18,14,18,8],ink);
  p([20,7,28,6,30,9,29,16,26,18,22,17,20,13],back ? hair : skin);
  r(27,10,2,6,back ? shade(hair,.7) : shade(skin,.7));r(22,7,4,2,back ? hair : shade(skin,1.15));
  p([19,7,20,3,26,2,30,5,31,9,27,8,24,6,22,11,19,12],hair);
  r(21,4,5,1,shade(hair,1.6));r(20,5,2,2,shade(hair,1.3));
  if (look.outfit === 'hoodie' || look.archetype === 'netrunner') { p([17,11,17,6,20,2,27,1,32,6,32,16,30,18,29,8,25,4,20,7,19,15],dark);r(19,4,4,1,light); }
  if (!back) { r(23,11,2,1,ink);r(28,11,2,1,ink);r(26,16,state==='talk'?2:3,1,shade(skin,.55));plate(27,10,5,4, '#233c4d');r(28,11,2,1,look.accent); }
  if (look.accessory === 'glasses' && !back) {r(22,10,8,1,steel);r(23,11,2,1,pale);}
  if (look.accessory === 'headset') {plate(17,10,4,6,steel);r(18,15,1,4,steel);r(19,18,4,1,steel);}
  if (look.variant % 2) { r(17,29,3,4,ink);r(18,30,1,2,pale); }
  c.restore();
  if (state === 'approval') {plate(38,4,7,10,'#f4bc53');r(41,6,1,4,ink);r(41,11,1,1,ink);}
  if (state === 'error') {r(38,4,7,7,ink);p([39,5,41,7,43,5,44,6,42,8,44,10,43,11,41,9,39,11,38,10,40,8,38,6],'#ff5265');}
  if (state === 'complete') {p([37,8,39,10,44,5,45,6,39,12,36,9],'#83dca7');}
  if (state === 'think') {r(37+frame,9,2,2,steel);}
}
