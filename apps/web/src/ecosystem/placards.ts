import { Container, Graphics, Text } from 'pixi.js';
import type { OfficeSeat } from '@frontline/shared';
import { DESKS, ROOMS, iso } from './world';
import { annotationScale } from './camera';

const PURPOSE = ['Strategy & coordination', 'Discover winning products', 'Create & scale campaigns', 'Images, video & UGC', 'Build & optimize stores', 'Data & insights', 'Words that convert', 'Fulfillment & support', 'Retention & growth', 'Apps & automation'];
export const departmentCounts = (seats: OfficeSeat[]) => Object.fromEntries(ROOMS.map((r) => [r.id, seats.filter((s) => !s.archived && DESKS.find((d) => d.id === s.deskId)?.department === r.id).length]));

export function departmentPlacards() {
  const root = new Container(), counts = new Map<string, Text>();
  ROOMS.forEach((room, i) => {
    const front = room.y >= 34;
    const sign = new Container(), p = iso({ x: room.x + (front ? 13.5 : 6), y: room.y + (front ? 13.5 : 0) }); sign.position.set(p.x, p.y - (front ? 0 : 130));
    const frame = new Graphics().roundRect(-171, -34, 346, 74, 6).fill({ color: '#030710', alpha: .6 })
      .roundRect(-170, -38, 340, 72, 6).fill('#0e1522').stroke({ color: room.color, width: 2, alpha: .75 })
      .rect(-148, -38, 296, 2).fill(room.color).roundRect(-158, -26, 44, 46, 5).fill({ color: room.color, alpha: .18 })
      .rect(-103, -24, 1, 43).fill({ color: room.color, alpha: .4 });
    const title = room.id === 'executive' ? 'EXECUTIVE HQ' : room.id === 'integrations' ? 'INTEGRATIONS' : room.name.toUpperCase();
    const label = new Text({ text: title, style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 24, fontWeight: '700', fill: '#edf2fb' } });
    label.anchor.set(0, .5); label.position.set(-92, -13); if (label.width > 249) label.scale.set(249 / label.width);
    const purpose = new Text({ text: PURPOSE[i], style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 15, fill: '#9eacc0' } }); purpose.anchor.set(0, .5); purpose.position.set(-92, 13);
    const count = new Text({ text: '0', style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 32, fontWeight: '700', fill: room.color } }); count.anchor.set(.5); count.position.set(-136, -3); counts.set(room.id, count);
    sign.addChild(frame, label, purpose, count); root.addChild(sign);
  });
  return { root, zoom: (scale: number) => { for (const sign of root.children) sign.scale.set(annotationScale(scale,.8)); }, update: (seats: OfficeSeat[]) => { const values = departmentCounts(seats); for (const [id, text] of counts) text.text = String(values[id]); } };
}
