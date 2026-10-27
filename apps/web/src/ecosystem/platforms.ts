import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { OfficeState } from './events';
import { PLATFORM_PYLONS, iso } from './world';

export function platformSignal(office: Pick<OfficeState, 'stores' | 'storeEvents'>, platform: string, now: number) {
  const stores = new Set(office.stores.filter((s) => s.platform === platform).map((s) => s.id));
  const order = office.storeEvents.find((e) => e.type === 'order' && stores.has(e.storeId) && now >= Date.parse(e.at) && now - Date.parse(e.at) < 2400);
  return { active: stores.size > 0, pulse: order ? 1 - (now - Date.parse(order.at)) / 2400 : 0 };
}

/** Original compact pixel renditions identify platforms; all artwork is generated offline. */
function paintMark(id: string, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 80;
  const c = canvas.getContext('2d')!; c.imageSmoothingEnabled = false;
  c.fillStyle = color; c.strokeStyle = color; c.lineWidth = 5; c.lineJoin = 'round';
  const text = (value: string, size: number, x = 48, y = 57, font = 'Arial') => { c.font = `bold ${size}px ${font}`; c.textAlign = 'center'; c.fillText(value, x, y); };
  if (id === 'shopify') {
    c.fillRect(24, 27, 48, 46); c.strokeRect(36, 14, 23, 25); c.fillStyle = '#142818'; text('S', 39, 48, 63, 'Georgia');
  } else if (id === 'amazon') {
    text('a', 68, 48, 55, 'Georgia'); c.beginPath(); c.moveTo(22, 64); c.quadraticCurveTo(48, 79, 75, 61); c.stroke(); c.fillRect(69, 59, 10, 4); c.fillRect(75, 59, 4, 10);
  } else if (id === 'ebay') {
    ['#ff6572', '#65a8ff', '#ffe56c', '#a6e46b'].forEach((ink, i) => { c.fillStyle = ink; text('ebay'[i]!, 35, 17 + i * 21, 53); });
  } else if (id === 'etsy') text('E', 70, 48, 65, 'Georgia');
  else if (id.startsWith('tiktok')) {
    for (const [x, y, ink] of [[-3, -2, '#5cfff1'], [3, 2, '#ff447e'], [0, 0, '#e9ffff']] as const) { c.fillStyle = ink; c.fillRect(48+x, 12+y, 9, 44); c.fillRect(54+x, 19+y, 21, 10); c.fillRect(28+x, 51+y, 27, 14); c.fillRect(24+x, 56+y, 9, 8); }
  } else if (id === 'woocommerce') {
    c.fillRect(5, 22, 86, 39); c.fillRect(19, 60, 12, 11); c.fillStyle = '#231536'; text('woo', 32, 48, 51);
  } else if (id === 'walmart') {
    c.translate(48, 40); for (let i = 0; i < 6; i++) { c.save(); c.rotate(i * Math.PI / 3); c.fillRect(-4, -34, 8, 22); c.restore(); }
  } else if (id === 'meta_ads') {
    c.beginPath(); c.moveTo(48, 44); c.bezierCurveTo(18, -13, -4, 74, 29, 64); c.bezierCurveTo(53, 57, 63, -7, 81, 32); c.bezierCurveTo(108, 91, 61, 71, 48, 44); c.stroke();
  } else {
    c.strokeStyle = '#6fa8ff'; c.lineWidth = 16; c.beginPath(); c.moveTo(49, 18); c.lineTo(76, 64); c.stroke(); c.strokeStyle = '#ffe078'; c.beginPath(); c.moveTo(49, 18); c.lineTo(22, 64); c.stroke(); c.fillStyle = '#69da9b'; c.fillRect(14, 56, 17, 17);
  }
  return canvas;
}

export function platformHolograms(world: Container) {
  const textures: Texture[] = [];
  const pylons = PLATFORM_PYLONS.map((p) => {
    const root = new Container(), floating = new Container(), point = iso(p); root.position.set(point.x, point.y);
    const base = new Graphics().poly([-33, 0, 0, -16, 33, 0, 33, 11, 0, 28, -33, 11]).fill('#171c29').stroke({ color: '#566075', width: 2 })
      .poly([-31, 0, 0, -15, 31, 0, 0, 15]).fill('#303447').stroke({ color: p.color, width: 2 })
      .ellipse(0, 0, 22, 8).fill({ color: p.color, alpha: .2 }).ellipse(0, 0, 15, 5).stroke({ color: p.color, width: 3 });
    const beam = new Graphics().poly([-19, -2, -42, -64, 42, -64, 19, -2]).fill({ color: p.color, alpha: .09 })
      .moveTo(-19, -2).lineTo(-42, -64).moveTo(19, -2).lineTo(42, -64).stroke({ color: p.color, alpha: .35, width: 1 });
    const texture = Texture.from(paintMark(p.id, p.color)); texture.source.scaleMode = 'nearest'; textures.push(texture);
    const glow = new Sprite(texture); glow.anchor.set(.5); glow.scale.set(1.08); glow.alpha = .18; glow.blendMode = 'add';
    const logo = new Sprite(texture); logo.anchor.set(.5); floating.addChild(glow, logo); floating.y = -72;
    const scan = new Graphics(); for (let y = -108; y < -35; y += 6) scan.rect(-43, y, 86, 1).fill({ color: '#111625', alpha: .2 });
    const label = new Text({ text: p.name, style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 15, fontWeight: '600', fill: p.color, stroke: { color: '#080b16', width: 3 } } }); label.anchor.set(.5); label.y = -128;
    root.addChild(beam, base, floating, scan, label); world.addChild(root);
    return { id: p.id, root, floating, beam, logo, base };
  });
  let office: Pick<OfficeState, 'stores' | 'storeEvents'> = { stores: [], storeEvents: [] };
  return {
    update: (value: OfficeState) => { office = value; },
    tick: (elapsed: number, still: boolean, now = Date.now()) => pylons.forEach((p, i) => {
      const signal = platformSignal(office, p.id, now), pulse = still ? 0 : signal.pulse;
      p.logo.alpha = signal.active ? 1 : .45; p.beam.alpha = signal.active ? .8 + pulse * .2 : .3;
      p.floating.y = -72 + (still ? 0 : Math.sin(elapsed / 1700 + i) * 3);
      p.floating.scale.set(1 + pulse * .14); p.base.alpha = .75 + pulse * .25;
    }),
    destroy: () => textures.forEach((t) => t.destroy(true)),
  };
}
