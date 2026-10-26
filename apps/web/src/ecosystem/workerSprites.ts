import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { OfficeSeat } from '@frontline/shared';
import { CELL, frameAt, paintCharacters, type Animation, type Direction } from './characters';
import { ENTRANCE, deskTile, iso, tileKey, walkable, type Tile } from './world';
import { advanceFrame, nearestFree, startMotion, type Motion } from './pathfinding';
import type { OfficeStatus } from './events';
import { startVisit, visitFinished, type Handoff, type Visit } from './communications';
import { meetingFinished, type Meeting, type MeetingPlan } from './meetings';
import { DEFAULT_DISPLAY, type DisplayOptions } from './display';

export interface OfficeWorker { seat: OfficeSeat; name: string; animation: Animation; target?: Tile; status?: OfficeStatus; tool?: string; handoff?: Handoff; meeting?: MeetingPlan }

export function workerSprites(world: Container, select: (deskId: string) => void) {
  const connections = new Graphics(); world.addChild(connections);
  const layer = new Container(); layer.sortableChildren = true; world.addChild(layer);
  const workers = new Map<string, { data: OfficeWorker; root: Container; sprite: Sprite; name: Text; status: Graphics; bubble: Text; bubbleBack: Graphics; elapsed: number; direction: Direction; index: number }>();
  let atlas: Texture | undefined;
  let signature = '';
  const frames = new Map<string, Texture>();
  const motions = new Map<string, Motion>();
  const positions = new Map<string, Tile>();
  const visits = new Map<string, Visit>(), seen = new Set<string>();
  let meeting: Meeting | undefined;
  const meetingsSeen = new Set<string>();
  let display: DisplayOptions = DEFAULT_DISPLAY;
  function update(data: OfficeWorker[]) {
    const active = data.filter((w) => !w.seat.archived).slice(0, 30);
    const plan = active.find((w) => w.meeting)?.meeting;
    if (plan && !meetingsSeen.has(plan.id)) { meeting = { plan, elapsed: 0, together: 0 }; meetingsSeen.add(plan.id); }
    const next = JSON.stringify(active.map((w) => [w.seat.agentId, w.seat.appearance]));
    if (next !== signature) {
      const old = atlas;
      atlas = Texture.from(paintCharacters(active.map((w) => w.seat.appearance)));
      atlas.source.scaleMode = 'nearest';
      for (const frame of frames.values()) frame.destroy();
      frames.clear(); signature = next;
      old?.destroy(true);
    }
    for (const [id, worker] of workers) if (!active.some((w) => w.seat.agentId === id)) { worker.root.destroy({ children: true }); workers.delete(id); motions.delete(id); positions.delete(id); visits.delete(id); }
    active.forEach((data, index) => {
      let worker = workers.get(data.seat.agentId);
      if (!worker) {
        const root = new Container(), sprite = new Sprite(), name = new Text({ text: data.name, style: { fontFamily: 'Inter, sans-serif', fontSize: 12, fill: '#f3ecf0', stroke: { color: '#0a0b13', width: 4 } } });
        sprite.anchor.set(.5, 1); sprite.scale.set(1.5); name.anchor.set(.5, 0); name.y = 3;
        const status = new Graphics().circle(0, -62, 3).fill('#ffffff');
        const bubble = new Text({ text: '', style: { fontFamily: 'Inter, sans-serif', fontSize: 13, fill: '#f4d7ff', stroke: { color: '#181021', width: 5 }, wordWrap: true, wordWrapWidth: 180, align: 'center' } });
        bubble.anchor.set(.5, 1); bubble.y = -75;
        const bubbleBack = new Graphics();
        root.addChild(sprite, name, status, bubbleBack, bubble); layer.addChild(root); sprite.eventMode = 'static'; sprite.cursor = 'pointer';
        sprite.on('pointertap', () => select(workers.get(data.seat.agentId)!.data.seat.deskId));
        worker = { data, root, sprite, name, status, bubble, bubbleBack, elapsed: 0, direction: 2, index };
        workers.set(data.seat.agentId, worker);
        const occupied = new Set([...motions.values()].flatMap((m) => [tileKey(m.cell), ...(m.next ? [tileKey(m.next)] : [])]));
        const saved = data.seat.position;
        const start = saved && walkable(saved) && !occupied.has(tileKey(saved)) ? saved : nearestFree(ENTRANCE, occupied)!;
        motions.set(data.seat.agentId, startMotion(start, data.target ?? deskTile(data.seat.deskId)));
      }
      if (worker.data.animation !== data.animation) worker.elapsed = 0;
      worker.data = data; worker.index = index; worker.name.text = data.name;
      worker.root.alpha = data.status === 'offline' ? .45 : 1;
      worker.status.tint = data.status === 'failed' ? '#ff3953' : data.status === 'awaiting_approval' ? '#f4bc53' : data.status === 'running' || data.status === 'using_tool' ? '#3ddc84' : '#8993a9';
      motions.get(data.seat.agentId)!.target = meeting?.plan.targets[data.seat.agentId] ?? visits.get(data.seat.agentId)?.target ?? data.target ?? deskTile(data.seat.deskId);
    });
    const occupied = new Set([...active.map((w) => tileKey(deskTile(w.seat.deskId))), ...[...motions.values()].flatMap((m) => [tileKey(m.cell), ...(m.next ? [tileKey(m.next)] : [])]), ...[...visits.values()].map((v) => tileKey(v.target))]);
    for (const worker of active) {
      const handoff = worker.handoff, receiver = handoff && workers.get(handoff.toAgentId);
      if (!handoff || !receiver || seen.has(handoff.id)) continue;
      const visit = startVisit(handoff, deskTile(receiver.data.seat.deskId), occupied);
      seen.add(handoff.id);
      if (visit) { visits.set(worker.seat.agentId, visit); if (!meeting?.plan.targets[worker.seat.agentId]) motions.get(worker.seat.agentId)!.target = visit.target; occupied.add(tileKey(visit.target)); }
    }
    tick(0, true);
  }
  function tick(delta: number, reduced: boolean, view?: { x: number; y: number; width: number; height: number; scale: number }) {
    if (!atlas) return;
    for (const id of advanceFrame(motions, delta)) positions.set(id, { ...motions.get(id)!.cell });
    if (meeting && meetingFinished(meeting, Object.keys(meeting.plan.targets).every((id) => !motions.has(id) || motions.get(id)!.arrived), delta)) {
      meeting = undefined;
      for (const [id, worker] of workers) motions.get(id)!.target = visits.get(id)?.target ?? worker.data.target ?? deskTile(worker.data.seat.deskId);
    }
    connections.clear();
    for (const [id, visit] of visits) {
      const motion = motions.get(id)!;
      if (meeting?.plan.targets[id]) continue;
      if (!workers.has(visit.event.toAgentId) || visitFinished(visit, motion.arrived, delta)) { visits.delete(id); motion.target = workers.get(id)!.data.target ?? deskTile(workers.get(id)!.data.seat.deskId); continue; }
      const from = iso(motion.position), to = iso(motions.get(visit.event.toAgentId)!.position);
      connections.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: '#c87eed', width: 2, alpha: .35 });
    }
    for (const worker of workers.values()) {
      worker.elapsed += delta;
      const motion = motions.get(worker.data.seat.agentId)!;
      const inMeeting = !!meeting?.plan.targets[worker.data.seat.agentId];
      const visit = inMeeting ? undefined : visits.get(worker.data.seat.agentId);
      const details = !view || view.scale >= .65;
      worker.name.visible = details && (display.names || display.workload); worker.status.visible = display.status; worker.bubble.visible = worker.bubbleBack.visible = display.bubbles && details;
      worker.name.text = [display.names ? worker.data.name : '', display.workload ? worker.data.tool ?? worker.data.status?.replaceAll('_', ' ') ?? 'idle' : ''].filter(Boolean).join('\n');
      const speech = visit ? `Handoff → ${workers.get(visit.event.toAgentId)?.data.name}\n${visit.event.summary.split('\n')[0]!.slice(0, 110)}` : worker.data.status === 'awaiting_approval' ? 'Awaiting owner approval' : worker.data.status === 'failed' ? 'Task blocked · inspect output' : '';
      if (worker.bubble.text !== speech) {
        worker.bubble.text = speech; worker.bubbleBack.clear();
        if (speech) { const w = worker.bubble.width + 16, h = worker.bubble.height + 14;
          worker.bubbleBack.roundRect(-w / 2, -82 - h, w, h + 14, 5).fill({ color: '#1b1027', alpha: .95 }).stroke({ color: '#bc7be4', width: 1 }).poly([-5, -68, 0, -62, 5, -68]).fill('#bc7be4');
        }
      }
      if (motion.next) {
        const dx = motion.next.x - motion.cell.x, dy = motion.next.y - motion.cell.y;
        worker.direction = dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 3 : 2;
      } else if (motion.arrived) worker.direction = 2;
      const pos = iso(motion.position); worker.root.position.set(pos.x, pos.y + 12); worker.root.zIndex = pos.y;
      worker.root.renderable = !view || (pos.x > view.x - 200 && pos.x < view.x + view.width + 200 && pos.y > view.y - 80 && pos.y < view.y + view.height + 200);
      const receiving = [...visits.values()].some((v) => v.event.toAgentId === worker.data.seat.agentId && v.atDesk > 0);
      const p = frameAt(motion.next ? 'walk' : motion.arrived ? visit || receiving || inMeeting ? 'collaborate' : worker.data.animation : 'idle', reduced ? 0 : worker.elapsed, worker.direction, worker.index);
      const key = `${p.x},${p.y}`;
      let frame = frames.get(key);
      if (!frame) { frame = new Texture({ source: atlas.source, frame: new Rectangle(p.x, p.y, CELL.width, CELL.height) }); frames.set(key, frame); }
      worker.sprite.texture = frame;
    }
    connections.visible = display.connections;
  }
  return { update, tick, setDisplay: (value: DisplayOptions) => { display = value; }, meetingTitle: () => meeting?.plan.title ?? '', position: (id: string) => motions.get(id)?.position, drainPositions: () => { const entries = [...positions]; positions.clear(); return entries; }, destroy: () => { for (const frame of frames.values()) frame.destroy(); atlas?.destroy(true); } };
}
