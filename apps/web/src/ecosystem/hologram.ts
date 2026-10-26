import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

export const LOGO_URL = '/ecosystem/frontline-logo.png';
export function hologramPose(elapsed: number, still: boolean) {
  return still ? { lift: 0, opacity: .96, glitch: 0 } : {
    lift: Math.sin(elapsed / 1500) * 3,
    opacity: .94 + Math.sin(elapsed / 420) * .035,
    glitch: elapsed > 500 && Math.floor(elapsed / 90) % 73 === 0 ? 3 : 0,
  };
}

/** Every glow and scanline samples the original logo; no blur filter or replacement lettering. */
export function createHologram(texture: Texture) {
  const root = new Container(), floating = new Container();
  const width = 280, height = width * texture.height / texture.width;
  const beam = new Graphics()
    .poly([-43, 64, -140, 28, 140, 28, 43, 64]).fill({ color: '#ff365d', alpha: .1 })
    .poly([-22, 64, -84, 28, 84, 28, 22, 64]).fill({ color: '#ffb6c6', alpha: .035 })
    .moveTo(-43, 64).lineTo(-140, 28).moveTo(43, 64).lineTo(140, 28).stroke({ color: '#ff4c6c', alpha: .3, width: 1 })
    .moveTo(-18, 64).lineTo(-80, 28).moveTo(18, 64).lineTo(80, 28).moveTo(0, 64).lineTo(0, 28).stroke({ color: '#ffd5e0', alpha: .16, width: 1 })
    .ellipse(0, 64, 43, 15).stroke({ color: '#ff7891', width: 2, alpha: .8 })
    .ellipse(0, 64, 27, 8).fill({ color: '#ffdae3', alpha: .09 });
  root.addChild(beam, floating);
  const mark = () => { const sprite = new Sprite(texture); sprite.anchor.set(.5); sprite.width = width; sprite.height = height; return sprite; };
  for (const [x, y] of [[-3, 0], [3, 0], [0, -2], [0, 2]]) {
    const glow = mark(); glow.position.set(x, y); glow.tint = '#ff3054'; glow.alpha = .17; glow.blendMode = 'add'; floating.addChild(glow);
  }
  const logo = mark(); floating.addChild(logo);
  const lines: Sprite[] = [], slices: Texture[] = [];
  for (let y = 2; y < height - 1; y += 5) {
    const top = Math.floor(y * texture.height / height), depth = Math.max(1, Math.floor(texture.height / height));
    const slice = new Texture({ source: texture.source, frame: new Rectangle(0, top, texture.width, depth) });
    slices.push(slice);
    const line = new Sprite(slice); line.anchor.set(.5, 0); line.width = width; line.height = 1;
    line.y = y - height / 2; line.tint = '#7f1735'; line.alpha = .22; floating.addChild(line); lines.push(line);
  }
  const tick = (elapsed: number, still: boolean) => {
    const pose = hologramPose(elapsed, still); floating.y = pose.lift; logo.alpha = pose.opacity;
    lines.forEach((line, i) => { line.x = pose.glitch && i === 5 ? pose.glitch : 0; line.alpha = still ? .22 : .2 + Math.sin(elapsed / 700 + i) * .12; });
  };
  tick(0, true);
  return { root, tick, destroy: () => slices.forEach((slice) => slice.destroy()) };
}
