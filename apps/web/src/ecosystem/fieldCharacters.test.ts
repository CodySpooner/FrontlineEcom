import { expect, test } from 'vitest';
import { ANIMATIONS, appearanceFor, resolveAppearance } from './characters';
import { FIELD_ROLES, paintFieldSpecialist } from './fieldCharacters';

test('field specialist keeps every pose within its atlas cell and gives work a distinct tool gesture', () => {
  const look = resolveAppearance(appearanceFor('glow:product_hunter'), 'glow:product_hunter');
  const poses = new Set<string>();
  for (const role of FIELD_ROLES) for (const state of ANIMATIONS) for (const back of [false, true]) for (let frame=0;frame<4;frame++) {
    let dy=0; const rects: number[][]=[];
    const c = { fillRect: (x:number,y:number,w:number,h:number)=>rects.push([x,y+dy,w,h]), beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, fill(){}, save(){}, restore(){dy=0;}, translate(_x:number,y:number){dy+=y;} } as unknown as CanvasRenderingContext2D;
    paintFieldSpecialist(c,look,state,frame,back,role);
    for (const [x,y,w,h] of rects) { expect(x).toBeGreaterThanOrEqual(0);expect(y).toBeGreaterThanOrEqual(0);expect(x!+w!).toBeLessThanOrEqual(48);expect(y!+h!).toBeLessThanOrEqual(64); }
    if (!back && frame === 1) poses.add(JSON.stringify(rects));
  }
  expect(poses.size).toBeGreaterThanOrEqual(7);
});


test('every role has distinct frames for its working tool',()=>{
  const look=resolveAppearance(appearanceFor('work-proof'),'work-proof');
  for(const role of FIELD_ROLES){
    const frames=[0,1,2,3].map(frame=>{
      const rects:number[][]=[];
      const c={fillRect:(x:number,y:number,w:number,h:number)=>rects.push([x,y,w,h]),beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},save(){},restore(){},translate(){}} as unknown as CanvasRenderingContext2D;
      paintFieldSpecialist(c,look,'work',frame,false,role);
      return JSON.stringify(rects);
    });
    expect(new Set(frames).size,role).toBeGreaterThan(1);
  }
});
