import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESKS, MEETING, PLATFORM_PYLONS, ROOMS, iso } from './world';

export const lightStrength = (elapsed: number, index: number, still: boolean) => still ? 1 : 1 + Math.sin(elapsed / 3200 + index * 1.7) * .12;

/** One tiny shared light texture keeps the lighting pass cheap at thirty workstations. */
export function officeLighting(world: Container) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!, gradient = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.25, '#ffffffb0'); gradient.addColorStop(.65, '#ffffff28'); gradient.addColorStop(1, '#ffffff00');
  c.fillStyle = gradient; c.fillRect(0, 0, 64, 64);
  const texture = Texture.from(canvas), layer = new Container(); layer.blendMode = 'add'; world.addChild(layer);
  const lights: { sprite: Sprite; strength: number }[] = [];
  const pool = (x: number, y: number, width: number, height: number, color: string, strength: number) => {
    const sprite = new Sprite(texture); sprite.anchor.set(.5); sprite.position.set(x, y); sprite.width = width; sprite.height = height; sprite.tint = color; sprite.alpha = strength;
    layer.addChild(sprite); lights.push({ sprite, strength });
  };
  for (const desk of DESKS) { const p = iso(desk); pool(p.x, p.y + 10, 160, 76, desk.color, .25); pool(p.x, p.y - 30, 80, 52, desk.color, .2); }
  for (const room of ROOMS) {
    const hero = iso({ x: room.x + 10, y: room.y + 2 }); pool(hero.x, hero.y - 20, 200, 150, room.color, .22);
    const p = iso({ x: room.x + 5, y: room.y + .5 }); pool(p.x, p.y - 10, 260, 120, room.color, .3);
    const light = new Graphics().poly([p.x - 34, p.y - 38, p.x + 34, p.y - 38, p.x + 90, p.y + 42, p.x - 90, p.y + 42]).fill({ color: room.color, alpha: .035 }); layer.addChild(light);
    const doorway = iso({ x: room.x + 6.5, y: room.y }); pool(doorway.x, doorway.y, 150, 60, '#ff476d', .23);
  }
  for (const pylon of PLATFORM_PYLONS) { const p = iso(pylon); pool(p.x, p.y + 4, 150, 72, pylon.color, .25); }
  const hub = iso(MEETING); pool(hub.x, hub.y, 560, 270, '#ff315c', .4); pool(hub.x, hub.y - 26, 210, 110, '#ff96b0', .45);
  return {
    tick: (elapsed: number, still: boolean) => lights.forEach(({ sprite, strength }, i) => { sprite.alpha = strength * lightStrength(elapsed, i, still); }),
    destroy: () => texture.destroy(true),
  };
}
