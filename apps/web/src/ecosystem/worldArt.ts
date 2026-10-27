import { OFFICE_GRID } from '@frontline/shared';
import { DESKS, MAP_SIZE, MEETING, ROOMS, ROOM_SIZE, iso } from './world';
import { DEPARTMENT_DECOR, OFFICE_THEMES, type OfficeTheme } from './themes';

/** Original pixel art, cached once as a map texture. No external assets or requests. */
export function paintOffice(theme: OfficeTheme = OFFICE_THEMES.frontline) {
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
      if (variant % 3 === 1) { rect(x-w/2+3,y-h+7+i*3,5+(i*7+variant)%Math.max(6,w-9),1,i%2 ? color : '#6386a4'); }
      else { rect(x-w/2+3+(i%3)*(w-7)/3,y-h+7+Math.floor(i/3)*7,(w-12)/3,5,i%2 ? '#344671' : color); }
    }
    rect(x-2,y+2,4,5,'#535762'); rect(x-8,y+7,16,2,'#292b38');
  };
  const plant = (x: number, y: number) => {
    box(x,y,11,5,13,'#403d46','#2b2b35','#171923');
    rect(x-2,y-35,4,27,'#5d6040');
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, yy = y-20-i*4;
      poly([x,yy+5,x+side*19,yy-7,x+side*11,yy-9,x+side*3,yy-3],i%3 ? theme.plants[0] : theme.plants[1]);
    }
  };

  const corners = [iso({x:0,y:0}),iso({x:OFFICE_GRID.width,y:0}),iso({x:OFFICE_GRID.width,y:OFFICE_GRID.height}),iso({x:0,y:OFFICE_GRID.height})];
  poly(corners.flatMap((p) => [p.x,p.y+50]),'#030309');
  for (let y = 0; y < OFFICE_GRID.height; y++) for (let x = 0; x < OFFICE_GRID.width; x++) {
    const p = iso({x,y}); const room = ROOMS.find((r) => x >= r.x && x < r.x+ROOM_SIZE && y >= r.y && y < r.y+ROOM_SIZE);
    diamond(p.x,p.y,24,12,room ? theme.floor[(x+y)%2]! : (x+y)%2 ? '#1d202a' : '#22252e',room ? '#3c3b45' : '#292d39');
    if (room) {
      if (room.id === 'copywriting' || room.id === 'executive') {
        poly([p.x-18,p.y+10,p.x,p.y+19,p.x+18,p.y+10,p.x+18,p.y+11,p.x,p.y+20,p.x-18,p.y+11],'#54434a');
      } else if (room.id === 'operations' || room.id === 'development' || room.id === 'integrations') {
        for (const dx of [-10,10]) rect(p.x+dx,p.y+11,2,2,'#555864');
      }
      if (x === room.x+1 || y === room.y+1 || x === room.x+ROOM_SIZE-1 || y === room.y+ROOM_SIZE-1) {
        c.globalAlpha = .28;
        diamond(p.x,p.y+7,10,5,room.color);
        c.globalAlpha = 1;
      }
    }
    if (!room && (x%16===15 || y%16===15)) { rect(p.x-4,p.y+10,8,2,'#713b51'); }
  }
  // The front edges expose the headquarters' foundation and red power rails.
  for (const [a,b] of [[corners[1]!,corners[2]!],[corners[2]!,corners[3]!]] as const) {
    poly([a.x,a.y,b.x,b.y,b.x,b.y+50,a.x,a.y+50],'#191a23','#3d3645');
    poly([a.x,a.y+4,b.x,b.y+4,b.x,b.y+7,a.x,a.y+7],theme.rail);
    poly([a.x,a.y+43,b.x,b.y+43,b.x,b.y+47,a.x,a.y+47],'#333543');
    const bays = Math.abs(b.x-a.x)/96;
    for (let i=0;i<bays;i++) {
      const x=a.x+(b.x-a.x)*i/bays, y=a.y+(b.y-a.y)*i/bays, dx=(b.x-a.x)/bays, dy=(b.y-a.y)/bays;
      poly([x,y+10,x+4,y+12,x+4,y+43,x,y+41],'#515260');
      for (let j=0;j<3;j++) poly([x+dx*.25,y+dy*.25+14+j*5,x+dx*.75,y+dy*.75+14+j*5,x+dx*.75,y+dy*.75+16+j*5,x+dx*.25,y+dy*.25+16+j*5],'#0c1019');
    }
  }
  const props: { depth: number; draw: () => void }[] = [];
  for (const room of ROOMS) {
    for (const side of [0,1]) {
      const a=iso({x:room.x+(side ? ROOM_SIZE:0),y:room.y+(side ? 0:ROOM_SIZE)});
      const b=iso({x:room.x+ROOM_SIZE,y:room.y+ROOM_SIZE});
      poly([a.x,a.y,b.x,b.y,b.x,b.y+6,a.x,a.y+6],'#141824');
      poly([a.x,a.y,b.x,b.y,b.x,b.y+2,a.x,a.y+2],room.color);
      for (const i of [6,7]) {
        const p=iso({x:room.x+(side ? 0:i),y:room.y+(side ? i:0)}), dx=side ? -24:24;
        diamond(p.x,p.y+3,24,12,'#505464');
        poly([p.x,p.y+3,p.x+dx,p.y+15,p.x+dx,p.y+18,p.x,p.y+6],room.color);
        poly([p.x,p.y-64,p.x+dx,p.y-52,p.x+dx,p.y-47,p.x,p.y-59],'#727285');
        poly([p.x,p.y-59,p.x+dx,p.y-47,p.x+dx,p.y-45,p.x,p.y-57],room.color);
      }
    }
    for (let i = 0; i < ROOM_SIZE; i++) if (i !== 6 && i !== 7) {
      for (const side of [0,1]) {
        const p = iso({x:room.x+(side ? 0:i),y:room.y+(side ? i:0)});
        const dx = side ? -24:24;
        poly([p.x,p.y,p.x+dx,p.y+12,p.x+dx,p.y-52,p.x,p.y-64],theme.wall[side ? 0 : 1],'#55515e');
        poly([p.x,p.y-64,p.x+dx,p.y-52,p.x+dx+4,p.y-54,p.x+4,p.y-66],'#666370');
        poly([p.x,p.y-61,p.x+dx,p.y-49,p.x+dx,p.y-46,p.x,p.y-58],theme.rail);
        poly([p.x,p.y-8,p.x+dx,p.y+4,p.x+dx,p.y+6,p.x,p.y-6],'#912139');
        if (i%2===1) {
          poly([p.x+dx*.2,p.y-47,p.x+dx*.8,p.y-40,p.x+dx*.8,p.y-14,p.x+dx*.2,p.y-21],'#263448','#58708a');
          for (const dy of [0,7,14]) poly([p.x+dx*.25,p.y-43+dy,p.x+dx*.75,p.y-37+dy,p.x+dx*.75,p.y-35+dy,p.x+dx*.25,p.y-41+dy],'#111b2a');
        } else {
          rect(p.x-2,p.y-61,4,60,'#4b4d5b'); rect(p.x-1,p.y-49,2,12,room.color);
        }
      }
    }
    const sign = iso({x:room.x+5,y:room.y+0.5});
    c.save(); c.translate(sign.x,sign.y-12);
    rect(-48,-65,96,65,'#485165'); rect(-45,-62,90,59,'#111c2b');
    rect(-43,-60,86,2,room.color); rect(-43,-60,2,55,room.color);
    rect(41,-60,2,55,room.color); rect(-43,-5,86,2,room.color);
    const ink=room.color, pale='#d9e8ee';
    if (room.id==='executive') {
      poly([1,-56,-16,-34,-3,-34,-8,-19,16,-43,4,-43,10,-56],ink);
    } else if (room.id==='research') {
      poly([-16,-52,-5,-56,5,-52,9,-42,5,-32,-5,-28,-16,-32,-20,-42],ink);
      poly([-13,-48,-5,-51,2,-48,5,-42,2,-36,-5,-33,-13,-36,-15,-42],'#111c2b');
      poly([4,-33,9,-37,22,-24,17,-20],pale);
    } else if (room.id==='advertising') {
      poly([-19,-43,5,-43,20,-53,20,-25,5,-35,-19,-35],ink);
      rect(-14,-35,6,13,pale); rect(-22,-43,4,8,pale); rect(25,-43,6,3,ink);
    } else if (room.id==='creative') {
      rect(-22,-49,33,26,ink); rect(-18,-45,25,18,'#111c2b');
      poly([13,-43,25,-49,25,-23,13,-29],pale);
      rect(-15,-55,8,5,pale); rect(-3,-55,8,5,pale); rect(-9,-40,8,8,ink);
    } else if (room.id==='development') {
      poly([-9,-53,-24,-39,-9,-25,-5,-29,-16,-39,-5,-49],ink);
      poly([9,-53,24,-39,9,-25,5,-29,16,-39,5,-49],ink);
      poly([2,-55,7,-55,-2,-23,-7,-23],pale);
    } else if (room.id==='analytics') {
      rect(-15,-56,30,35,ink); rect(-11,-52,22,8,'#111c2b');
      for(let row=0;row<3;row++)for(let col=0;col<3;col++)rect(-10+col*8,-40+row*6,5,3,pale);
    } else if (room.id==='copywriting') {
      rect(-18,-54,26,32,pale); rect(-14,-49,17,2,'#4e6079');rect(-14,-43,13,2,'#4e6079');rect(-14,-37,10,2,'#4e6079');
      poly([15,-53,22,-46,6,-27,-2,-22,0,-31],ink); poly([-2,-22,1,-31,6,-27],pale);
    } else if (room.id==='operations') {
      poly([0,-57,22,-46,22,-29,0,-18,-22,-29,-22,-46],ink);
      poly([-19,-44,0,-34,19,-44,19,-32,0,-22,-19,-32],'#263549');
      rect(-2,-34,4,15,pale); poly([-8,-52,13,-42,8,-39,-13,-49],pale);
    } else if (room.id==='retention') {
      rect(-24,-52,48,31,ink); rect(-20,-48,40,23,'#111c2b');
      poly([-21,-48,0,-32,21,-48,17,-50,0,-37,-17,-50],pale);
      rect(16,-28,12,9,ink);rect(20,-32,4,17,ink);
    } else {
      rect(-18,-41,36,3,ink);rect(-2,-52,4,30,ink);
      for(const [x,y]of[[-22,-43],[-5,-57],[14,-43],[-5,-25]]) {rect(x!,y!,10,10,pale);rect(x!+2,y!+2,6,6,ink);}
    }
    c.fillStyle=pale; c.font='bold 9px monospace';c.textAlign='center';c.fillText(room.id.toUpperCase(),0,-9);
    c.restore();
    const pp = iso({x:room.x+1,y:room.y+10}); props.push({depth:pp.y,draw:()=>plant(pp.x,pp.y+8)});
    const corner = iso({x:room.x+1,y:room.y+1});
    props.push({depth:corner.y,draw:()=> {
      box(corner.x,corner.y+7,16,8,17,'#4e5260','#292e3b','#181d2a');
      plant(corner.x-5,corner.y-3); plant(corner.x+6,corner.y+3);
      rect(corner.x-10,corner.y+5,20,2,room.color);
    }});
    const lounge = iso({x:room.x+5.5,y:room.y+10});
    props.push({depth:lounge.y+12,draw:()=> {
      diamond(lounge.x,lounge.y-5,49,24,'#202432',room.color);
      box(lounge.x,lounge.y-4,34,16,14,'#454958','#222734','#151a27');
      poly([lounge.x-34,lounge.y-2,lounge.x,lounge.y+14,lounge.x,lounge.y-7,lounge.x-34,lounge.y-23],'#4e586b','#7b8395');
      poly([lounge.x-32,lounge.y-19,lounge.x-2,lounge.y-5,lounge.x-2,lounge.y+4,lounge.x-32,lounge.y-10],room.color);
      box(lounge.x-18,lounge.y+1,14,7,7,'#687184','#3b4354','#2b3447');
      box(lounge.x+5,lounge.y+12,14,7,7,'#687184','#3b4354','#2b3447');
      box(lounge.x-34,lounge.y-2,5,9,13,'#555f73'); box(lounge.x+21,lounge.y+24,5,9,13,'#555f73');
      const table=iso({x:room.x+7,y:room.y+10});
      box(table.x,table.y+3,12,6,12,'#ac8d73','#5d4f48','#342e30');
      rect(table.x-3,table.y-5,5,4,'#eee7d5'); rect(table.x-2,table.y-6,3,1,'#79543c');
    }});
    const decor = iso({x:room.x+10.5,y:room.y+10.5});
    props.push({depth:decor.y,draw:()=> {
      const kind = DEPARTMENT_DECOR[room.id];
      if (kind==='crates') {
        box(decor.x,decor.y,18,9,19,'#b2875f','#87603e','#62452f'); box(decor.x-14,decor.y-4,11,6,34,'#ca9f6b','#906940','#64452e');
        rect(decor.x-13,decor.y-25,3,12,'#e4be86');
      } else if (kind==='rack') {
        box(decor.x,decor.y,17,8,56,'#353947','#202333','#141724');
        for(let j=0;j<6;j++){ rect(decor.x-11,decor.y-43+j*7,9,3,'#0c111b');rect(decor.x-10,decor.y-43+j*7,2,2,j%2?'#ff3558':'#55dcb1'); }
      } else if (kind==='camera') {
        rect(decor.x-2,decor.y-29,4,34,'#646878'); poly([decor.x,decor.y-5,decor.x-13,decor.y+8,decor.x-9,decor.y+9,decor.x,decor.y], '#73727f');
        rect(decor.x-10,decor.y-37,20,15,'#292d3d');rect(decor.x+10,decor.y-34,9,10,'#667184');rect(decor.x-7,decor.y-34,8,8,'#bb6ddd');
      } else if (kind==='conference') {
        box(decor.x,decor.y,38,19,22,theme.desk); screen(decor.x,decor.y-23,room.color,0,30,21);
        for (const side of [-1,1]) { rect(decor.x+side*26-5,decor.y+4,10,14,'#1b202e'); rect(decor.x+side*26-3,decor.y+6,6,4,room.color); }
      } else if (kind==='products' || kind==='library') {
        box(decor.x,decor.y,22,11,34,theme.desk);
        for (let j=0;j<6;j++) { rect(decor.x-18+j*6,decor.y-24,4,kind==='products'?10+(j%3)*3:18,j%2?room.color:'#a6a8c0'); rect(decor.x-17+j*6,decor.y-20,2,2,'#f4eee8'); }
      } else if (kind==='charts' || kind==='campaigns') {
        box(decor.x,decor.y,23,11,18,theme.desk); screen(decor.x,decor.y-12,room.color,kind==='charts'?0:2,45,32);
      } else {
        box(decor.x,decor.y,22,11,24,theme.desk); rect(decor.x-15,decor.y-22,30,18,room.color);
        poly([decor.x-14,decor.y-21,decor.x,decor.y-12,decor.x+14,decor.y-21],'#dae5eb');
      }
    }});
  }
  for (const d of DESKS) {
    const p = iso(d);
    props.push({depth:p.y+16,draw:()=> {
      diamond(p.x,p.y+14,28,14,'#13141b');
      box(p.x,p.y+8,30,15,20,theme.desk,'#383641','#242330');
      poly([p.x-26,p.y-1,p.x,p.y+12,p.x+26,p.y-1,p.x+26,p.y+1,p.x,p.y+14,p.x-26,p.y+1],d.color);
      const technical = d.department === 'development' || d.department === 'integrations' || d.department === 'analytics';
      const creative = d.department === 'creative' || d.department === 'advertising';
      const documents = d.department === 'copywriting' || d.department === 'retention' || d.department === 'executive';
      if (technical) {
        screen(p.x-15,p.y-16,d.color,1,25,28); screen(p.x+15,p.y-20,d.color,2,25,28);
        box(p.x+23,p.y+7,5,3,12,'#444b60'); rect(p.x+21,p.y-1,2,4,d.color);
      } else {
        screen(p.x,p.y-18,d.color,documents ? 1:2,creative ? 48:40,creative ? 31:28);
        if (d.department === 'retention') {
          rect(p.x-11,p.y-38,22,13,'#d2e0ed'); poly([p.x-10,p.y-37,p.x,p.y-30,p.x+10,p.y-37],d.color);
        }
        if (creative) {
          rect(p.x-9,p.y-3,17,8,'#202b3e'); rect(p.x-7,p.y-2,13,5,d.color);
          rect(p.x+13,p.y-6,2,10,'#e0dce7');
        }
        if (d.department === 'research' || d.department === 'operations') {
          box(p.x+21,p.y+2,7,4,9,'#d0a574','#97714d','#634c3b'); rect(p.x+20,p.y-4,3,6,'#eed8ac');
        }
        if (documents) {
          rect(p.x+13,p.y-4,9,6,'#536487'); rect(p.x+14,p.y-5,8,4,'#e1d6ba'); rect(p.x+16,p.y-5,2,4,d.color);
        }
      }
      rect(p.x-10,p.y+4,18,5,'#242c3e');
      for (let row=0;row<2;row++) for(let key=0;key<6;key++) rect(p.x-9+key*2.5,p.y+5+row*2,2,1,row ? '#b1bdc9':d.color);
      rect(p.x+12,p.y+4,5,4,'#d4d5da');rect(p.x+14,p.y+4,1,2,d.color);
      rect(p.x-24,p.y-7,6,8,'#efebdd');rect(p.x-23,p.y-8,4,2,'#714c3c');rect(p.x-18,p.y-5,2,3,'#bab7b1');
      const chair = iso({x:d.x,y:d.y+1});
      box(chair.x,chair.y+11,10,5,9,'#414654');rect(chair.x-8,chair.y-11,16,19,'#171c2b');rect(chair.x-6,chair.y-9,12,7,'#5c5266');
      rect(chair.x-6,chair.y-9,2,12,d.color);rect(chair.x+4,chair.y-9,2,12,d.color);
      rect(chair.x-12,chair.y+5,5,3,'#697086');rect(chair.x+7,chair.y+5,5,3,'#697086');
    }});
  }
  const hub = iso(MEETING);
  props.push({depth:hub.y,draw:()=> {
    diamond(hub.x,hub.y-45,100,50,'#472735','#7e2a40');
    box(hub.x,hub.y-18,70,35,22,'#38343f','#31232f','#241c27');
    diamond(hub.x,hub.y-41,59,30,'#7a2038','#ff6074'); diamond(hub.x,hub.y-35,48,24,'#1e1726','#ff385d');
    diamond(hub.x,hub.y-35,29,14,'#f66986','#ffe2ec'); diamond(hub.x,hub.y-31,18,8,'#fff1f6','#ff9db2');
    for (const x of [-46,46]) { rect(hub.x+x-4,hub.y-14,8,4,'#ffe1e9'); rect(hub.x+x-5,hub.y-17,10,2,'#ff385d'); }
    rect(hub.x-3,hub.y+7,6,18,'#ff405e');
  }});
  props.sort((a,b)=>a.depth-b.depth).forEach((p)=>p.draw());
  return canvas;
}
