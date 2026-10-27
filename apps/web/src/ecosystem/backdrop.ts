import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Tile } from './world';

export const CITY_URL = '/ecosystem/night-city.png';
export const backdropOffset = (pan: Tile, still: boolean) => still ? { x: 0, y: 0 } : { x: Math.tanh(pan.x / 800) * 20, y: Math.tanh(pan.y / 800) * 12 };
export function trafficPosition(elapsed: number, index: number, width: number, height: number, still: boolean) {
  const phase = ((still ? 0 : elapsed / (18000 + index * 7000)) + index * .23) % 1;
  return { x: (index % 2 ? 1-phase : phase) * (width+96)-48, y: height*(.13+index*.12)+Math.sin(phase*Math.PI*2)*8 };
}

export function cityBackdrop(stage: Container, texture: Texture) {
  const root = new Container(), city = new Sprite(texture); city.anchor.set(.5); city.alpha = .8; root.addChild(city); stage.addChild(root);
  const traffic = Array.from({ length: 4 }, (_, i) => {
    const color = i % 2 ? '#ff779c' : '#7ae4f3';
    const car = new Graphics().rect(-38, 2, 28, 2).fill({ color, alpha: .12 }).rect(-26, 2, 16, 2).fill({ color, alpha: .25 })
      .poly([-13,0,-6,-5,6,-5,14,0,18,1,18,6,-16,6,-16,2]).fill('#3d485d')
      .rect(-5,-3,10,4).fill('#a2d5e4').rect(-14,5,29,2).fill('#182330')
      .rect(14,1,5,2).fill('#fff0cf').rect(-17,2,4,3).fill(color).rect(-9,8,5,2).fill(color).rect(8,8,5,2).fill(color);
    car.scale.set(i % 2 ? -.75 : 1, i % 2 ? .75 : 1); car.alpha = .75; root.addChild(car); return car;
  });
  const rain = Array.from({ length: 60 }, (_, i) => { const streak = new Graphics().moveTo(0, 0).lineTo(-3, 11 + i % 9).stroke({ color: '#93adc1', width: 1, alpha: .1 + i % 3 * .025 }); root.addChild(streak); return streak; });
  const sign = new Container(), frame = new Graphics().rect(-73, -23, 146, 46).fill('#140c19').stroke({ color: '#dd3457', width: 2 }).rect(-68, -18, 3, 36).fill('#ff5977').rect(65, -18, 3, 36).fill('#ff5977');
  const lettering = new Text({ text: 'FRONTLINE\nDISTRICT', style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 13, letterSpacing: 2, fontWeight: '700', fill: '#f58ba4', align: 'center' } }); lettering.anchor.set(.5); sign.addChild(frame, lettering); root.addChild(sign);
  let width = 1, height = 1;
  return {
    resize: (w: number, h: number) => { width = w; height = h; city.scale.set(Math.max((w + 48) / texture.width, (h + 32) / texture.height)); sign.position.set(w * .85, Math.max(110, h * .17)); },
    tick: (elapsed: number, still: boolean, pan: Tile) => {
      const offset = backdropOffset(pan, still); city.position.set(width / 2 + offset.x, height / 2 + offset.y);
      traffic.forEach((car,i) => { const p=trafficPosition(elapsed,i,width,height,still); car.position.set(p.x+offset.x*.7,p.y+offset.y*.7); });
      sign.x = width * .85 + offset.x * 1.4; sign.alpha = still ? .85 : .85 + Math.sin(elapsed / 2200) * .1;
      rain.forEach((streak, i) => { streak.visible = !still; if (!still) streak.position.set((i * 137 + elapsed * .018) % width, (i * 191 + elapsed * .16) % height); });
    },
  };
}
