import { Container, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { OfficeSeat } from '@frontline/shared';
import { CELL, frameAt, paintCharacters, type Animation, type Direction } from './characters';
import { deskTile, iso } from './world';

export interface OfficeWorker { seat: OfficeSeat; name: string; animation: Animation }

export function workerSprites(world: Container, select: (deskId: string) => void) {
  const layer = new Container(); layer.sortableChildren = true; world.addChild(layer);
  const workers = new Map<string, { data: OfficeWorker; root: Container; sprite: Sprite; name: Text; elapsed: number; direction: Direction; index: number }>();
  let atlas: Texture | undefined;
  let signature = '';
  const frames = new Map<string, Texture>();
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
    for (const [id, worker] of workers) if (!active.some((w) => w.seat.agentId === id)) { worker.root.destroy({ children: true }); workers.delete(id); }
    active.forEach((data, index) => {
      let worker = workers.get(data.seat.agentId);
      if (!worker) {
        const root = new Container(), sprite = new Sprite(), name = new Text({ text: data.name, style: { fontFamily: 'Inter, sans-serif', fontSize: 12, fill: '#f3ecf0', stroke: { color: '#0a0b13', width: 4 } } });
        sprite.anchor.set(.5, 1); sprite.scale.set(1.5); name.anchor.set(.5, 0); name.y = 3;
        root.addChild(sprite, name); layer.addChild(root); sprite.eventMode = 'static'; sprite.cursor = 'pointer';
        sprite.on('pointertap', () => select(workers.get(data.seat.agentId)!.data.seat.deskId));
        worker = { data, root, sprite, name, elapsed: 0, direction: 2, index };
        workers.set(data.seat.agentId, worker);
      }
      if (worker.data.animation !== data.animation) worker.elapsed = 0;
      worker.data = data; worker.index = index; worker.name.text = data.name;
      const tile = data.seat.position ?? deskTile(data.seat.deskId), p = iso(tile);
      worker.root.position.set(p.x, p.y + 12); worker.root.zIndex = p.y;
    });
    tick(0, true);
  }
  function tick(delta: number, reduced: boolean) {
    if (!atlas) return;
    for (const worker of workers.values()) {
      worker.elapsed += delta;
      const p = frameAt(worker.data.animation, reduced ? 0 : worker.elapsed, worker.direction, worker.index);
      const key = `${p.x},${p.y}`;
      let frame = frames.get(key);
      if (!frame) { frame = new Texture({ source: atlas.source, frame: new Rectangle(p.x, p.y, CELL.width, CELL.height) }); frames.set(key, frame); }
      worker.sprite.texture = frame;
    }
  }
  return { update, tick, destroy: () => { for (const frame of frames.values()) frame.destroy(); atlas?.destroy(true); } };
}
