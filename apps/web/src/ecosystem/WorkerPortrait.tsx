import { useEffect, useRef } from 'react';
import type { OfficeAppearance } from '@frontline/shared';
import { CELL, paintPortrait, resolveAppearance } from './characters';

export function WorkerPortrait({ appearance, name, agentId = name, role }: { appearance: OfficeAppearance; name: string; agentId?: string; role?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = canvas.current!.getContext('2d')!; c.clearRect(0, 0, CELL.width, CELL.height); c.drawImage(paintPortrait(resolveAppearance(appearance, agentId), role ?? agentId.split(':').at(-1)), 0, 0); }, [appearance, agentId, role]);
  return <canvas ref={canvas} width={CELL.width} height={CELL.height} role="img" aria-label={`${name} portrait`} className="eco-portrait" style={{ borderColor: appearance.color }} />;
}
