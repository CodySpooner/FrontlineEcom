import { Container, Graphics, Text } from 'pixi.js';
import type { OfficeState } from './events';
import { emptyOffice } from './events';
import { ROOMS, iso } from './world';

export function showpieceActivity(office: OfficeState, now: number) {
  const fresh = (at: string) => now >= Date.parse(at) && now - Date.parse(at) < 5000;
  return { orders: office.storeEvents.filter((e) => e.type === 'order' && fresh(e.at)), tools: office.events.filter((e) => e.type === 'tool.started' && fresh(e.at)) };
}
export function orderBars(office: OfficeState) {
  const values = office.analytics?.series.slice(-7).map((p) => Math.max(0, p.orders)) ?? [];
  const max = Math.max(1, ...values);
  return values.map((value) => ({ value, height: value / max * 60 }));
}

export function departmentShowpieces(world: Container) {
  const roots = new Map<string, Container>();
  let chart: Graphics | undefined, chartLabel: Text | undefined;
  for (const room of ROOMS) {
    const root = new Container(), p = iso({ x: room.x + 10, y: room.y + 2 }); root.position.set(p.x, p.y); roots.set(room.id, root); world.addChild(root);
    const g = new Graphics(); root.addChild(g);
    const r = (x: number, y: number, w: number, h: number, color: string) => { g.rect(x, y, w, h).fill(color); };
    const line = (points: number[], color = room.color, width = 2) => { g.poly(points, false).stroke({ color, width }); };
    const panel = (x: number, y: number, w: number, h: number) => { r(x - 4, y - 4, w + 8, h + 8, '#51586c'); r(x, y, w, h, '#0a1321'); r(x + 3, y + 3, w - 6, 2, room.color); };
    g.poly([-65, -8, 0, -40, 65, -8, 65, 4, 0, 38, -65, 4]).fill('#181f2d').stroke({ color: '#566078', width: 2 });
    g.poly([-65, -8, 0, -40, 65, -8, 0, 24]).fill('#2d3548').stroke({ color: room.color, width: 2 });
    let caption = '';
    if (room.id === 'executive') {
      caption = 'COMMAND BRIDGE'; panel(-60, -110, 120, 64); r(-70, -116, 7, 94, '#783447'); r(64, -116, 7, 94, '#783447'); r(-70, -118, 141, 5, room.color);
      for (const x of [-38, 0, 38]) { line([x - 12, -83, x, -97, x + 12, -83, x, -69, x - 12, -83], '#ff96ad'); line([x, -68, x, -50], room.color); }
      g.poly([-49, -25, 0, -48, 49, -25, 0, 0]).fill('#4d3a50').stroke({ color: '#ff8ba9', width: 2 }); r(-11, -38, 22, 11, '#ff7195');
    } else if (room.id === 'research') {
      caption = 'PRODUCT SCANNER'; r(-48, -102, 8, 90, '#4c6471'); r(41, -102, 8, 90, '#4c6471'); r(-48, -105, 97, 12, '#718a91'); r(-37, -89, 74, 3, room.color);
      g.poly([-34, -84, 34, -84, 45, -12, -45, -12]).fill({ color: room.color, alpha: .12 });
      g.poly([-22, -42, 0, -53, 22, -42, 22, -16, 0, -5, -22, -16]).fill('#bc976b').stroke({ color: '#f2cea1', width: 2 }); line([0, -52, 0, -6], '#65462e', 4); r(-12, -32, 10, 7, '#ebefd9');
    } else if (room.id === 'advertising') {
      caption = 'CAMPAIGN UPLINK'; panel(-62, -94, 65, 49); panel(12, -121, 52, 65);
      for (let i = 0; i < 3; i++) { r(-54 + i * 18, -82, 11, 25, ['#fb6d99', '#7796ff', '#f1cb72'][i]!); }
      g.circle(38, -89, 16).stroke({ color: room.color, width: 3 }); line([27, -90, 36, -80, 50, -100]); r(-3, -56, 6, 44, '#708198');
      g.poly([-27, -45, 25, -45, 14, -25, -14, -25]).fill('#a6b5d4'); line([0, -45, 15, -62], '#d5eaff', 3);
    } else if (room.id === 'creative') {
      caption = 'CAPTURE STAGE'; r(-56, -116, 112, 78, '#397d63'); r(-49, -109, 98, 64, '#59d28f'); r(-59, -121, 5, 113, '#647082'); r(54, -121, 5, 113, '#647082'); r(-60, -121, 119, 5, '#8494a6');
      g.poly([-51, -38, 52, -38, 65, 1, -65, 1]).fill('#306c59');
      line([-30, -30, -45, 13, -30, -30, -14, 10], '#aeb8cc', 3); r(-48, -57, 36, 25, '#252c42'); r(-13, -52, 14, 15, '#8092aa'); g.circle(-33, -45, 9).stroke({ color: '#dcd7ff', width: 3 });
      g.circle(40, -56, 18).stroke({ color: '#fff0da', width: 5 }); line([40, -38, 40, 6], '#aab8ca');
    } else if (room.id === 'development') {
      caption = 'BUILD FARM';
      for (const x of [-48, 8]) { r(x, -112, 44, 108, '#424d66'); r(x + 4, -108, 36, 99, '#111c2b'); for (let i = 0; i < 8; i++) { r(x + 7, -101 + i * 11, 29, 6, '#2d3e54'); r(x + 10, -99 + i * 11, 4, 2, i % 3 ? room.color : '#f0cb76'); } }
      line([-57, -2, -57, 10, 56, 10, 56, -1], room.color, 3);
    } else if (room.id === 'analytics') {
      caption = 'SEVEN-DAY ORDERS'; panel(-78, -118, 156, 103); r(-9, -13, 18, 28, '#63758a');
      for (let i = 0; i < 4; i++) line([-68, -35 - i * 20, 68, -35 - i * 20], '#28384b', 1);
      chart = new Graphics(); root.addChild(chart);
      chartLabel = new Text({ text: 'NO DATA', style: { fontFamily: 'monospace', fontSize: 11, fill: '#c5eafa' } }); chartLabel.anchor.set(.5); chartLabel.y = -111; root.addChild(chartLabel);
    } else if (room.id === 'copywriting') {
      caption = 'STORY LIBRARY'; r(-58, -105, 116, 91, '#655344');
      for (let shelf = 0; shelf < 3; shelf++) { r(-53, -100 + shelf * 28, 106, 23, '#201f2b'); for (let i = 0; i < 11; i++) { r(-48 + i * 9, -96 + shelf * 28, 6, 15 + i % 5, [room.color, '#7d9eaf', '#c77c8f'][i % 3]!); } }
      g.poly([-29, -22, -2, -16, 28, -22, 28, -2, 0, 5, -29, -2]).fill('#e8dcc8'); line([0, -16, 0, 4], '#9a8a79');
    } else if (room.id === 'operations') {
      caption = 'ORDER INTAKE'; g.poly([-64, -32, 12, -68, 68, -40, -10, -4]).fill('#6b7789').stroke({ color: '#c0cbd1', width: 3 });
      for (let i = 0; i < 9; i++) line([-58 + i * 8, -32 - i * 4, -9 + i * 8, -8 - i * 4], '#303b4b', 4);
      r(-60, -25, 5, 40, '#798795'); r(57, -31, 5, 40, '#798795'); r(-70, -89, 7, 62, '#a29b88'); r(-70, -91, 125, 7, '#a29b88'); r(48, -91, 7, 32, '#a29b88'); r(-58, -80, 100, 3, room.color);
    } else if (room.id === 'retention') {
      caption = 'MESSAGE RELAY'; g.circle(0, -63, 38).stroke({ color: room.color, width: 4 }); g.circle(0, -63, 30).fill({ color: room.color, alpha: .09 });
      r(-26, -81, 52, 35, '#bfdcec'); line([-26, -81, 0, -59, 26, -81], '#48778c', 3); r(-6, -26, 12, 29, '#566c86'); g.ellipse(0, 2, 30, 11).stroke({ color: room.color, width: 3 });
    } else {
      caption = 'TOOL EXCHANGE'; panel(-34, -107, 68, 61);
      for (const [x, y] of [[-57, -30], [51, -25], [-30, 10], [28, 10]] as const) { line([0, -45, 0, -25, x, y], room.color, 3); r(x - 11, y - 10, 22, 17, '#43536b'); r(x - 7, y - 7, 14, 8, '#a7d7ef'); }
      line([-18, -80, -8, -70, -18, -60], '#b0eaff', 3); line([17, -80, 7, -70, 17, -60], '#b0eaff', 3);
    }
    const label = new Text({ text: caption, style: { fontFamily: 'monospace', fontSize: 11, fill: room.color, stroke: { color: '#0b1020', width: 3 } } }); label.anchor.set(.5); label.y = 44; root.addChild(label);
  }
  const parcels = new Map<string, Graphics>(), packets = new Map<string, Graphics>();
  let office = emptyOffice();
  return {
    update: (value: OfficeState) => {
      office = value; chart!.clear(); const bars = orderBars(office);
      bars.forEach((bar, i) => { if (bar.height) chart!.rect(-63 + i * 19, -32 - bar.height, 12, bar.height).fill('#64d5ff'); });
      chartLabel!.text = bars.length ? `${bars.reduce((sum, b) => sum + b.value, 0).toLocaleString()} ORDERS / 7D` : 'ORDERS UNAVAILABLE';
    },
    tick: (still: boolean, now = Date.now()) => {
      const activity = showpieceActivity(office, now);
      for (const [id, graphic] of parcels) if (!activity.orders.some((e) => e.id === id)) { graphic.destroy(); parcels.delete(id); }
      for (const event of activity.orders) {
        let parcel = parcels.get(event.id);
        if (!parcel) { parcel = new Graphics().poly([-12, -19, 0, -25, 12, -19, 12, -5, 0, 1, -12, -5]).fill('#c79a66').stroke({ color: '#f4d4a3', width: 1 }).rect(-2, -23, 4, 19).fill('#f0d3a4'); roots.get('operations')!.addChild(parcel); parcels.set(event.id, parcel); }
        const t = still ? .5 : (now - Date.parse(event.at)) / 5000; parcel.position.set(-35 + t * 70, -24 - t * 35);
      }
      for (const [id, graphic] of packets) if (!activity.tools.some((e) => e.id === id)) { graphic.destroy(); packets.delete(id); }
      for (const event of activity.tools) {
        let packet = packets.get(event.id);
        if (!packet) { packet = new Graphics().rect(-4, -3, 8, 6).fill('#d1f5ff'); roots.get('integrations')!.addChild(packet); packets.set(event.id, packet); }
        const t = still ? .5 : (now - Date.parse(event.at)) / 5000; packet.position.set(-57 + t * 108, -30 - Math.sin(t * Math.PI) * 18);
      }
    },
  };
}
