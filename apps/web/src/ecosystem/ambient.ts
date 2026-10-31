import { Container, Graphics } from 'pixi.js';
import { iso, type Tile } from './world';

export const AMBIENT_ROUTES = [
  [{ x: 15, y: 15 }, { x: 47, y: 15 }, { x: 47, y: 32 }, { x: 15, y: 32 }],
  [{ x: 1, y: 1 }, { x: 62, y: 1 }, { x: 62, y: 46 }, { x: 1, y: 46 }],
] as const;
export function ambientPosition(route: readonly Tile[], elapsed: number, offset: number, still: boolean): Tile {
  const lengths = route.map((p, i) => { const q = route[(i + 1) % route.length]!; return Math.abs(q.x - p.x) + Math.abs(q.y - p.y); });
  let distance = ((still ? 0 : elapsed / 1400) + offset) % lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < route.length; i++) {
    const p = route[i]!, q = route[(i + 1) % route.length]!, length = lengths[i]!;
    if (distance <= length) { const t = distance / length; return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
    distance -= length;
  }
  return route[0]!;
}
export function idleMoment(elapsed: number, worker: number, still: boolean) {
  const t = (elapsed + worker * 1700) % 24000;
  return still ? 0 : t >= 18000 && t < 19400 ? 2 : t >= 11000 && t < 13300 ? 1 : 0;
}

/** Rare, staggered personal gestures. They never imply a task or collaboration. */
export function specialistIdle(elapsed: number, identity: string, role: string, still: boolean) {
  if(still) return 0;
  const seed=Array.from(identity+role).reduce((n,c)=>Math.imul(n,31)+c.charCodeAt(0)|0,7)>>>0;
  const period=28000+seed%11000, t=(Math.max(0,elapsed)+seed%period)%period;
  return t<900 ? 1 : t<1700 ? 2 : 0;
}

export function ambientOffice(world: Container) {
  const layer = new Container(); world.addChild(layer);
  const drone = new Container(), shadow = new Graphics().ellipse(0, 0, 19, 8).fill({ color: '#000614', alpha: .4 });
  const craft = new Graphics().rect(-16, -10, 32, 17).fill('#5b7591').rect(-9, -15, 18, 9).fill('#9eafc4').rect(-7, -8, 14, 5).fill('#7cfff5')
    .rect(-28, -13, 12, 3).fill('#718aa2').rect(16, -13, 12, 3).fill('#718aa2');
  const rotors = new Graphics().ellipse(-26, -16, 14, 4).stroke({ color: '#b3d8e9', width: 2, alpha: .7 }).ellipse(26, -16, 14, 4).stroke({ color: '#b3d8e9', width: 2, alpha: .7 });
  drone.addChild(craft, rotors); layer.addChild(shadow, drone);
  const cleaner = new Graphics().ellipse(0, 6, 20, 9).fill({ color: '#050b14', alpha: .6 }).roundRect(-18, -7, 36, 18, 7).fill('#425165').ellipse(0, -7, 18, 8).fill('#8da8b7').rect(-9, -12, 18, 4).fill('#83eec9').rect(-21, 7, 42, 3).fill('#539d9e'); layer.addChild(cleaner);
  const nook = new Graphics(), n = iso({ x: 17, y: 21 }); nook.position.set(n.x, n.y);
  nook.poly([-20, -7, 1, -17, 23, -7, 23, 9, 1, 19, -20, 9]).fill('#334559').stroke({ color: '#61809b', width: 2 })
    .rect(-15, -54, 30, 48).fill('#c1d0d8').rect(-11, -43, 22, 20).fill('#20384d').rect(-7, -34, 5, 5).fill('#ff7c8d').rect(4, -34, 5, 5).fill('#69d4ff')
    .roundRect(-12, -83, 24, 31, 5).fill({ color: '#61b9eb', alpha: .8 }).rect(-8, -79, 4, 22).fill('#b6effa').rect(-7, -20, 14, 3).fill('#567a91');
  layer.addChild(nook);
  const sparks = Array.from({ length: 8 }, (_, i) => { const p = iso({ x: 20 + i * 7 % 24, y: 18 + i * 5 % 14 }); const g = new Graphics().rect(-1, -1, 2, 2).fill(i % 2 ? '#75dff4' : '#ff7ba8'); g.position.set(p.x, p.y - 40); layer.addChild(g); return { g, y: p.y - 40 }; });
  const floor = new Graphics(); layer.addChild(floor);
  for (const p of AMBIENT_ROUTES[0]) { const point = iso(p); floor.poly([point.x - 10, point.y, point.x, point.y - 5, point.x + 10, point.y, point.x, point.y + 5]).stroke({ color: '#7397c7', width: 2 }); }
  return { tick: (elapsed: number, still: boolean) => {
    const d = iso(ambientPosition(AMBIENT_ROUTES[0], elapsed, 24, still)), b = iso(ambientPosition(AMBIENT_ROUTES[1], elapsed * .7, 150, still));
    shadow.position.set(d.x, d.y + 10); drone.position.set(d.x, d.y - 76 + (still ? 0 : Math.sin(elapsed / 1100) * 3)); cleaner.position.set(b.x, b.y);
    rotors.scale.x = still ? 1 : .9 + Math.sin(elapsed / 180) * .1;
    floor.alpha = still ? .3 : .25 + Math.sin(elapsed / 4800) * .06;
    sparks.forEach(({ g, y }, i) => { g.y = y - (still ? 0 : (elapsed / 120 + i * 13) % 36); g.alpha = still ? .22 : .18 + (Math.sin(elapsed / 1300 + i) + 1) * .13; });
  } };
}
