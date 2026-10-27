import { useState } from 'react';
import { MAP_SIZE, MEETING, ROOMS, ROOM_SIZE, iso, type Tile } from './world';

export function Minimap({ viewport, onFocus }: { viewport?: { x: number; y: number; width: number; height: number }; onFocus: (tile: Tile) => void }) {
  const [open, setOpen] = useState(true);
  const markers = [...ROOMS.map((r) => ({ name: r.name, color: r.color, x: r.x + ROOM_SIZE / 2, y: r.y + ROOM_SIZE / 2 })), { ...MEETING, name: 'central hub', color: '#ff496c' }];
  return <div className="eco-minimap">
    <button className="eco-minimap-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>Office map <span aria-hidden>{open ? '−' : '+'}</span></button>
    {open && <div className="eco-minimap-plan">
      <svg viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`} aria-hidden>
        {ROOMS.map((r) => <polygon key={r.id} points={[[r.x, r.y], [r.x + ROOM_SIZE, r.y], [r.x + ROOM_SIZE, r.y + ROOM_SIZE], [r.x, r.y + ROOM_SIZE]].map(([x, y]) => { const p = iso({ x: x!, y: y! }); return `${p.x},${p.y}`; }).join(' ')} fill={r.color} fillOpacity=".18" stroke={r.color} strokeWidth="10" />)}
        {viewport && <rect {...viewport} className="eco-minimap-viewport" fill="#ffffff09" stroke="#fff0f4" strokeWidth="14" />}
      </svg>
      {markers.map((r) => { const p = iso(r); return <button key={r.name} aria-label={`Focus ${r.name} on minimap`} title={r.name} style={{ left: `${p.x / MAP_SIZE.width * 100}%`, top: `${p.y / MAP_SIZE.height * 100}%`, color: r.color }} onClick={() => onFocus({ x: r.x, y: r.y })}><span aria-hidden>◆</span></button>; })}
    </div>}
  </div>;
}
