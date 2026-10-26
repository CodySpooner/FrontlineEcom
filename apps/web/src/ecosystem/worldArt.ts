import { OFFICE_GRID } from '@frontline/shared';
import { DESKS, MAP_SIZE, MEETING, ROOMS, iso } from './world';

/** Original pixel art, cached once as a map texture. No external assets or requests. */
export function paintOffice() {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE.width; canvas.height = MAP_SIZE.height;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const rect = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const poly = (points: number[], color: string, stroke?: string) => {
    c.beginPath(); c.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i]!, points[i + 1]!);
    c.closePath(); c.fillStyle = color; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  };
  const diamond = (x: number, y: number, w: number, h: number, color: string, stroke?: string) => poly([x,y,x+w,y+h,x,y+2*h,x-w,y+h],color,stroke);
  const box = (x: number, y: number, w: number, h: number, z: number, top: string, left = '#262630', right = '#17171f') => {
    poly([x-w,y+h,x,y+2*h,x,y+2*h-z,x-w,y+h-z],left);
    poly([x,y+2*h,x+w,y+h,x+w,y+h-z,x,y+2*h-z],right);
    diamond(x,y-z,w,h,top,'#51515a');
  };
  const screen = (x: number, y: number, color: string, variant: number, w = 32, h = 24) => {
    rect(x-w/2-2,y-h-2,w+4,h+4,'#4f5365'); rect(x-w/2,y-h,w,h,'#080e1c'); rect(x-w/2+2,y-h+2,w-4,2,color);
    for (let i = 0; i < 6; i++) {
      const height = 4 + (i * 7 + variant * 3) % Math.max(5,h-8);
      if (variant % 3 === 0) rect(x-w/2+3+i*(w-6)/6,y-height-2,3,height,color);
      else if (variant % 3 === 1) { rect(x-w/2+3,y-h+7+i*3,5+(i*7+variant)%Math.max(6,w-9),1,i%2 ? color : '#6386a4'); }
      else { rect(x-w/2+3+(i%3)*(w-7)/3,y-h+7+Math.floor(i/3)*7,(w-12)/3,5,i%2 ? '#344671' : color); }
    }
    rect(x-2,y+2,4,5,'#535762'); rect(x-8,y+7,16,2,'#292b38');
  };
  const plant = (x: number, y: number) => {
    box(x,y,11,5,13,'#403d46','#2b2b35','#171923');
    rect(x-2,y-35,4,27,'#5d6040');
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, yy = y-20-i*4;
      poly([x,yy+5,x+side*19,yy-7,x+side*11,yy-9,x+side*3,yy-3],i%3 ? '#3e8056' : '#71a56d');
    }
  };

  const corners = [iso({x:0,y:0}),iso({x:OFFICE_GRID.width,y:0}),iso({x:OFFICE_GRID.width,y:OFFICE_GRID.height}),iso({x:0,y:OFFICE_GRID.height})];
  poly(corners.flatMap((p) => [p.x,p.y+24]),'#030309');
  for (let y = 0; y < OFFICE_GRID.height; y++) for (let x = 0; x < OFFICE_GRID.width; x++) {
    const p = iso({x,y}); const room = ROOMS.find((r) => x >= r.x && x < r.x+8 && y >= r.y && y < r.y+8);
    diamond(p.x,p.y,24,12,room ? (x+y)%2 ? '#30303b' : '#2b2b34' : (x+y)%2 ? '#1d202a' : '#22252e','#3c3b45');
    if (!room && (x%9===8 || y%9===8)) { rect(p.x-3,p.y+10,6,2,'#57303b'); }
  }
  // The front edges expose the headquarters' foundation and red power rails.
  for (const [a,b] of [[corners[1]!,corners[2]!],[corners[2]!,corners[3]!]] as const) {
    poly([a.x,a.y,b.x,b.y,b.x,b.y+22,a.x,a.y+22],'#191a23','#3d3645');
    poly([a.x,a.y+4,b.x,b.y+4,b.x,b.y+7,a.x,a.y+7],'#fc294a');
  }
  const props: { depth: number; draw: () => void }[] = [];
  for (const room of ROOMS) {
    for (let i = 0; i < 8; i++) if (i !== 4) {
      for (const side of [0,1]) {
        const p = iso({x:room.x+(side ? 0:i),y:room.y+(side ? i:0)});
        const dx = side ? -24:24;
        poly([p.x,p.y,p.x+dx,p.y+12,p.x+dx,p.y-38,p.x,p.y-50],side ? '#232330':'#181a24','#55515e');
        poly([p.x,p.y-48,p.x+dx,p.y-36,p.x+dx,p.y-33,p.x,p.y-45],'#df2545');
        poly([p.x,p.y-8,p.x+dx,p.y+4,p.x+dx,p.y+6,p.x,p.y-6],'#912139');
        if (i%2===1) poly([p.x+dx*.2,p.y-36,p.x+dx*.8,p.y-29,p.x+dx*.8,p.y-13,p.x+dx*.2,p.y-20],'#263448','#384c69');
      }
    }
    const sign = iso({x:room.x+3.5,y:room.y+0.5});
    screen(sign.x,sign.y-7,room.color,ROOMS.indexOf(room),68,34);
    const pp = iso({x:room.x+7,y:room.y+1}); props.push({depth:pp.y,draw:()=>plant(pp.x,pp.y+8)});
    const decor = iso({x:room.x+6.5,y:room.y+6.5});
    props.push({depth:decor.y,draw:()=> {
      if (room.id==='operations') {
        box(decor.x,decor.y,18,9,19,'#b2875f','#87603e','#62452f'); box(decor.x-14,decor.y-4,11,6,34,'#ca9f6b','#906940','#64452e');
        rect(decor.x-13,decor.y-25,3,12,'#e4be86');
      } else if (room.id==='integrations') {
        box(decor.x,decor.y,17,8,56,'#353947','#202333','#141724');
        for(let j=0;j<6;j++){ rect(decor.x-11,decor.y-43+j*7,9,3,'#0c111b');rect(decor.x-10,decor.y-43+j*7,2,2,j%2?'#ff3558':'#55dcb1'); }
      } else if (room.id==='creative') {
        rect(decor.x-2,decor.y-29,4,34,'#646878'); poly([decor.x,decor.y-5,decor.x-13,decor.y+8,decor.x-9,decor.y+9,decor.x,decor.y], '#73727f');
        rect(decor.x-10,decor.y-37,20,15,'#292d3d');rect(decor.x+10,decor.y-34,9,10,'#667184');rect(decor.x-7,decor.y-34,8,8,'#bb6ddd');
      } else { box(decor.x,decor.y,17,8,19,'#444452'); rect(decor.x-12,decor.y-6,10,2,room.color); }
    }});
  }
  for (const [i,d] of DESKS.entries()) {
    const p = iso(d);
    props.push({depth:p.y+16,draw:()=> {
      diamond(p.x,p.y+14,28,14,'#13141b');
      box(p.x,p.y+8,27,13,18,'#55515d','#383641','#242330');
      poly([p.x-26,p.y-1,p.x,p.y+12,p.x+26,p.y-1,p.x+26,p.y+1,p.x,p.y+14,p.x-26,p.y+1],d.color);
      screen(p.x,p.y-16,d.color,i);
      rect(p.x-9,p.y+2,15,4,'#a1a5b3'); rect(p.x+11,p.y+1,4,3,'#d4d5da');
      rect(p.x-19,p.y-6,4,6,'#efebdd');rect(p.x-18,p.y-7,2,1,'#b58765');
      const chair = iso({x:d.x,y:d.y+1});
      box(chair.x,chair.y+11,10,5,9,'#414654');rect(chair.x-8,chair.y-7,16,15,'#171c2b');rect(chair.x-6,chair.y-5,12,7,'#5c5266');
    }});
  }
  const hub = iso(MEETING);
  props.push({depth:hub.y,draw:()=> {
    diamond(hub.x,hub.y-45,100,50,'#472735','#7e2a40');
    box(hub.x,hub.y-18,70,35,22,'#38343f','#31232f','#241c27');
    diamond(hub.x,hub.y-41,59,30,'#b72241','#ff6074'); diamond(hub.x,hub.y-35,48,24,'#341724','#ff385d');
    rect(hub.x-3,hub.y+7,6,18,'#ff405e');
    c.font='bold 16px monospace';c.textAlign='center';c.fillStyle='#e9d9df';c.fillText('FRONTLINE',hub.x,hub.y+60);
  }});
  props.sort((a,b)=>a.depth-b.depth).forEach((p)=>p.draw());
  return canvas;
}
