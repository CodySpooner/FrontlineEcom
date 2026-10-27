import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Tile } from './world';

export const CITY_URL = '/ecosystem/night-city.png';
export const backdropOffset = (pan: Tile, still: boolean) => still ? { x: 0, y: 0 } : { x: Math.tanh(pan.x / 800) * 20, y: Math.tanh(pan.y / 800) * 12 };

export function cityBackdrop(stage: Container, texture: Texture) {
  const root = new Container(), city = new Sprite(texture); city.anchor.set(.5); city.alpha = .8; root.addChild(city); stage.addChild(root);
  const rain = Array.from({ length: 60 }, (_, i) => { const streak = new Graphics().moveTo(0, 0).lineTo(-3, 11 + i % 9).stroke({ color: '#93adc1', width: 1, alpha: .1 + i % 3 * .025 }); root.addChild(streak); return streak; });
  const sign = new Container(), frame = new Graphics().rect(-73, -23, 146, 46).fill('#140c19').stroke({ color: '#dd3457', width: 2 }).rect(-68, -18, 3, 36).fill('#ff5977').rect(65, -18, 3, 36).fill('#ff5977');
  const lettering = new Text({ text: 'FRONTLINE\nDISTRICT', style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 13, letterSpacing: 2, fontWeight: '700', fill: '#f58ba4', align: 'center' } }); lettering.anchor.set(.5); sign.addChild(frame, lettering); root.addChild(sign);
  let width = 1, height = 1;
  return {
    resize: (w: number, h: number) => { width = w; height = h; city.scale.set(Math.max((w + 48) / texture.width, (h + 32) / texture.height)); sign.position.set(w * .85, Math.max(110, h * .17)); },
    tick: (elapsed: number, still: boolean, pan: Tile) => {
      const offset = backdropOffset(pan, still); city.position.set(width / 2 + offset.x, height / 2 + offset.y);
      sign.x = width * .85 + offset.x * 1.4; sign.alpha = still ? .85 : .85 + Math.sin(elapsed / 2200) * .1;
      rain.forEach((streak, i) => { streak.visible = !still; if (!still) streak.position.set((i * 137 + elapsed * .018) % width, (i * 191 + elapsed * .16) % height); });
    },
  };
}
