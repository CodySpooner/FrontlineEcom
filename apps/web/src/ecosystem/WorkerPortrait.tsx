import { useEffect, useRef } from 'react';
import type { OfficeAppearance } from '@frontline/shared';
import { paintPortrait } from './characters';

export function WorkerPortrait({ appearance, name }: { appearance: OfficeAppearance; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = canvas.current!.getContext('2d')!; c.clearRect(0, 0, 32, 40); c.drawImage(paintPortrait(appearance), 0, 0); }, [appearance]);
  return <canvas ref={canvas} width={32} height={40} role="img" aria-label={`${name} portrait`} className="eco-portrait" style={{ borderColor: appearance.color }} />;
}
