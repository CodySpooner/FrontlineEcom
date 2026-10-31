import { Container, Graphics, Text } from 'pixi.js';
import { money } from '../lib/format';
import type { OfficeState } from './events';
import { MEETING, iso } from './world';
import { annotationScale } from './camera';

export function hubReadout(office: OfficeState, activeTasks?: number, now = Date.now()) {
  const date = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = office.analytics?.series.find((p) => p.date === date);
  const demoStores=office.stores.filter(s=>!s.connected).length;
  const provenance=today && demoStores ? demoStores===office.stores.length ? 'DEMO METRICS' : 'INCLUDES DEMO' : '';
  return {
    provenance,
    revenue: today ? money(today.revenue, office.analytics?.currency ?? 'USD') : '—',
    orders: today ? today.orders.toLocaleString() : '—',
    tasks: activeTasks === undefined ? '—' : activeTasks.toLocaleString(),
    note: office.analytics?.unconverted?.length ? `Excludes ${office.analytics.unconverted.join(', ')}: exchange rate unavailable` : '',
  };
}
export function orbitPoint(elapsed: number, index: number, still: boolean) {
  const angle = (still ? 0 : elapsed / 5200) + index * Math.PI * 2 / 3;
  return { x: Math.cos(angle) * 172, y: -92 + Math.sin(angle) * 43 };
}

export function hubTelemetry(world: Container) {
  const root = new Container(), p = iso(MEETING); root.position.set(p.x, p.y); world.addChild(root);
  const rings = new Graphics().ellipse(0, -92, 172, 43).stroke({ color: '#ff91b5', width: 2, alpha: .6 })
    .ellipse(0, -92, 181, 48).stroke({ color: '#ff3c75', width: 1, alpha: .25 })
    .ellipse(0, 18, 112, 47).stroke({ color: '#ff628b', width: 2, alpha: .5 });
  root.addChild(rings);
  const particles = Array.from({ length: 3 }, () => { const g = new Graphics().circle(0, 0, 5).fill({ color: '#ff6799', alpha: .2 }).circle(0, 0, 2).fill('#ffe3f0'); root.addChild(g); return g; });
  const display = new Container(); display.position.set(p.x,p.y+84); world.addChild(display);
  const plate = new Graphics().roundRect(-168, -27, 336, 54, 5).fill({ color: '#100f20', alpha: .97 }).stroke({ color: '#8b3c60', width: 1 })
    .rect(-147, -27, 294, 2).fill('#ed5685').rect(-147, 25, 294, 2).fill('#7d344e');
  const value = new Text({ text: '— · — ORDERS', style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 20, fontWeight: '600', fill: '#fff1f8' } }); value.anchor.set(.5); value.y = -7;
  const meta = new Text({ text: 'TODAY · — ACTIVE TASKS', style: { fontFamily: 'monospace', fontSize: 11, fill: '#f796b8' } }); meta.anchor.set(.5); meta.y = 15;
  display.addChild(plate, value, meta);
  return {
    display, zoom: (scale: number) => display.scale.set(annotationScale(scale,.95)),
    update: (office: OfficeState, activeTasks?: number) => {
      const readout = hubReadout(office, activeTasks);
      value.text = `${readout.revenue} · ${readout.orders} ORDERS`; value.scale.set(1); if (value.width > 310) value.scale.set(310 / value.width);
      meta.text = `TODAY · ${readout.tasks} ACTIVE TASKS${readout.provenance ? ' · '+readout.provenance : ''}${readout.note ? ' · PARTIAL FX' : ''}`; meta.scale.set(1);if(meta.width>310)meta.scale.set(310/meta.width);
    },
    tick: (elapsed: number, still: boolean) => particles.forEach((g, i) => { const point = orbitPoint(elapsed, i, still); g.position.set(point.x, point.y); }),
  };
}
