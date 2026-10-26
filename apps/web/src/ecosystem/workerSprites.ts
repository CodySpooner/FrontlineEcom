import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { OfficeSeat } from '@frontline/shared';
import { CELL, frameAt, paintCharacters, type Animation, type Direction } from './characters';
import { ENTRANCE, deskTile, iso, tileKey, walkable, type Tile } from './world';
import { advanceMotion, nearestFree, startMotion, type Motion } from './pathfinding';
import type { OfficeStatus } from './events';

export interface OfficeWorker { seat: OfficeSeat; name: string; animation: Animation; target?: Tile; status?: OfficeStatus; tool?: string }

export function workerSprites(world: Container, select: (deskId: string) => void) {
  const layer = new Container(); layer.sortableChildren = true; world.addChild(layer);
  const workers = new Map<string, { data: OfficeWorker; root: Container; sprite: Sprite; name: Text; status: Graphics; elapsed: number; direction: Direction; index: number }>();
  let atlas: Texture | undefined;
  let signature = '';
  const frames = new Map<string, Texture>();
  const motions = new Map<string, Motion>();
  const positions = new Map<string, Tile>();
  function update(data: OfficeWorker[]) {
    const active = data.filter((w) => !w.seat.archived).slice(0, 30);
    const next = JSON.stringify(active.map((w) => [w.seat.agentId, w.seat.appearance]));
    if (next !== signature) {
      const old = atlas;
      atlas = Texture.from(paintCharacters(active.map((w) => w.seat.appearance)));
      atlas.source.scaleMode = 'nearest';
      for (const frame of frames.values()) frame.destroy();
      frames.clear(); signature = next;
      old?.destroy(true);
    }
    for (const [id, worker] of workers) if (!active.some((w) => w.seat.agentId === id)) { worker.root.destroy({ children: true }); workers.delete(id); motions.delete(id); positions.delete(id); }
    active.forEach((data, index) => {
      let worker = workers.get(data.seat.agentId);
      if (!worker) {
        const root = new Container(), sprite = new Sprite(), name = new Text({ text: data.name, style: { fontFamily: 'Inter, sans-serif', fontSize: 12, fill: '#f3ecf0', stroke: { color: '#0a0b13', width: 4 } } });
        sprite.anchor.set(.5, 1); sprite.scale.set(1.5); name.anchor.set(.5, 0); name.y = 3;
        const status = new Graphics().circle(0, -62, 3).fill('#ffffff');
        root.addChild(sprite, name, status); layer.addChild(root); sprite.eventMode = 'static'; sprite.cursor = 'pointer';
        sprite.on('pointertap', () => select(workers.get(data.seat.agentId)!.data.seat.deskId));
        worker = { data, root, sprite, name, status, elapsed: 0, direction: 2, index };
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
      motions.get(data.seat.agentId)!.target = data.target ?? deskTile(data.seat.deskId);
    });
    tick(0, true);
  }
  function tick(delta: number, reduced: boolean) {
    if (!atlas) return;
    for (const id of advanceMotion(motions, delta / 1000)) positions.set(id, { ...motions.get(id)!.cell });
    for (const worker of workers.values()) {
      worker.elapsed += delta;
      const motion = motions.get(worker.data.seat.agentId)!;
      if (motion.next) {
        const dx = motion.next.x - motion.cell.x, dy = motion.next.y - motion.cell.y;
        worker.direction = dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 3 : 2;
      } else if (motion.arrived) worker.direction = 2;
      const pos = iso(motion.position); worker.root.position.set(pos.x, pos.y + 12); worker.root.zIndex = pos.y;
      const p = frameAt(motion.next ? 'walk' : motion.arrived ? worker.data.animation : 'idle', reduced ? 0 : worker.elapsed, worker.direction, worker.index);
      const key = `${p.x},${p.y}`;
      let frame = frames.get(key);
      if (!frame) { frame = new Texture({ source: atlas.source, frame: new Rectangle(p.x, p.y, CELL.width, CELL.height) }); frames.set(key, frame); }
      worker.sprite.texture = frame;
    }
  }
  return { update, tick, position: (id: string) => motions.get(id)?.position, drainPositions: () => { const entries = [...positions]; positions.clear(); return entries; }, destroy: () => { for (const frame of frames.values()) frame.destroy(); atlas?.destroy(true); } };
}
