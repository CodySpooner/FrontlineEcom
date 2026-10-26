import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { DESKS, MEETING, ROOMS, iso, uniso, type Tile } from './world';
import { paintOffice } from './worldArt';
import { fitCamera, zoomAt } from './camera';
import { workerSprites } from './workerSprites';

export async function createOffice(host: HTMLElement, onDesk: (id: string) => void) {
  const app = new Application();
  await app.init({ width: host.clientWidth, height: host.clientHeight, backgroundAlpha: 0, antialias: false, resolution: 1, preference: 'webgl' });
  host.appendChild(app.canvas);
  app.canvas.setAttribute('aria-label', 'Interactive isometric office with ten departments and thirty workstations');
  app.canvas.tabIndex = 0;
  const world = new Container(); app.stage.addChild(world);
  const mapTexture = Texture.from(paintOffice()); mapTexture.source.scaleMode = 'nearest';
  world.addChild(new Sprite(mapTexture));
  const labels = new Container(); world.addChild(labels);
  for (const room of ROOMS) {
    const p = iso({x:room.x+4,y:room.y+7});
    const label = new Text({ text: room.name.toUpperCase(), style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 22, fontWeight: '600', fill: '#e6e6ec', stroke: {color:'#08080c',width:5} } });
    label.anchor.set(.5); label.position.set(p.x,p.y+20); labels.addChild(label);
  }
  const selection = new Graphics(); world.addChild(selection);
  let dragged = false;
  const lights = new Container(); world.addChild(lights);
  for (const [i,d] of DESKS.entries()) {
    const p=iso(d);
    const light = new Graphics().rect(-12,-32,24,2).fill(d.color);
    light.position.set(p.x,p.y); lights.addChild(light);
    const hit = new Graphics().rect(-30,-44,60,72).fill({color:0xffffff,alpha:0.001});
    hit.position.set(p.x,p.y); hit.eventMode='static'; hit.cursor='pointer';
    hit.on('pointertap',()=>{ if(dragged) return; selection.clear().poly([p.x,p.y-12,p.x+31,p.y+4,p.x,p.y+20,p.x-31,p.y+4]).stroke({color:0xffffff,width:2});onDesk(d.id); });
    world.addChild(hit); light.alpha=.45+(i%4)*.12;
  }
  const globe = new Container(); const hub=iso(MEETING); globe.position.set(hub.x,hub.y-60); world.addChild(globe);
  globe.addChild(new Graphics().circle(0,0,53).fill({color:0xff264f,alpha:.06}).circle(0,0,44).fill({color:0xa2193c,alpha:.3}).stroke({color:0xff627d,width:2}));
  const meridians = new Graphics(); globe.addChild(meridians);
  for (const w of [12,28,40]) meridians.ellipse(0,0,w,44).stroke({color:0xff496d,width:1,alpha:.8});
  for (const yy of [-22,0,22]) meridians.ellipse(0,yy,Math.sqrt(44*44-yy*yy),9).stroke({color:0xff496d,width:1,alpha:.8});
  const continents = new Graphics(); globe.addChild(continents);
  for(let i=0;i<60;i++) { const x=Math.sin(i*1.9)*35, y=Math.cos(i*2.7)*32; if(Math.sin(x*.14)+Math.cos(y*.18)>.1) continents.rect(Math.round(x/3)*3,Math.round(y/3)*3,3,3).fill('#ff6686'); }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const workers = workerSprites(world, (desk) => { if (!dragged) onDesk(desk); });
  let camera = fitCamera(host.clientWidth,host.clientHeight);
  world.scale.set(camera.scale); world.position.set(camera.x,camera.y);
  const fit = () => { camera = fitCamera(host.clientWidth,host.clientHeight); };
  const zoom = (factor:number, point:Tile={x:host.clientWidth/2,y:host.clientHeight/2}) => { camera = zoomAt(camera,factor,point); };
  const focus = (tile:Tile) => { const p=iso(tile);camera={scale:1.25,x:host.clientWidth/2-p.x*1.25,y:host.clientHeight/2-p.y*1.25}; };
  const point = (e:MouseEvent) => { const r=app.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}; };
  let drag: { pointer:number; x:number; y:number; startX:number; startY:number } | undefined;
  const down = (e:PointerEvent) => { if(e.button!==0) return;dragged=false;drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:camera.x,startY:camera.y};app.canvas.setPointerCapture(e.pointerId); };
  const move = (e:PointerEvent) => { if(!drag||e.pointerId!==drag.pointer) return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)dragged=true;camera={...camera,x:drag.startX+dx,y:drag.startY+dy}; };
  const up = () => { drag=undefined; };
  const wheel = (e:WheelEvent) => {e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15,point(e));};
  const double = (e:MouseEvent) => {const p=point(e);focus(uniso({x:(p.x-world.x)/world.scale.x,y:(p.y-world.y)/world.scale.y}));};
  const key = (e:KeyboardEvent) => {
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key)) e.preventDefault();
    if(e.key==='+'||e.key==='=') zoom(1.25);else if(e.key==='-') zoom(.8);else if(e.key==='0')fit();
    else if(e.key.startsWith('Arrow')) camera={...camera,x:camera.x+(e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0),y:camera.y+(e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0)};
  };
  app.canvas.addEventListener('pointerdown',down);app.canvas.addEventListener('pointermove',move);app.canvas.addEventListener('pointerup',up);app.canvas.addEventListener('pointercancel',up);
  app.canvas.addEventListener('wheel',wheel,{passive:false});app.canvas.addEventListener('dblclick',double);app.canvas.addEventListener('keydown',key);
  const resize = new ResizeObserver(()=>{app.renderer.resize(host.clientWidth,host.clientHeight);fit();}); resize.observe(host); fit();
  let elapsed=0;
  app.ticker.add((ticker)=>{
    const smooth=reduced.matches?1:1-Math.exp(-ticker.deltaMS/65);
    world.x+=(camera.x-world.x)*smooth;world.y+=(camera.y-world.y)*smooth;world.scale.set(world.scale.x+(camera.scale-world.scale.x)*smooth);
    workers.tick(ticker.deltaMS,reduced.matches);
    if(reduced.matches) return;
    elapsed+=ticker.deltaMS;
    globe.y=hub.y-60+Math.sin(elapsed/1600)*3;
    meridians.scale.x=.75+Math.sin(elapsed/2400)*.2;
    lights.children.forEach((light,i)=>{light.alpha=.45+.3*Math.sin(elapsed/1400+i);});
  });
  return { app, world, labels, fit, zoom, focus, setWorkers: workers.update, drainPositions: workers.drainPositions, destroy:()=>{ resize.disconnect();app.destroy(true,{children:true});workers.destroy();mapTexture.destroy(true); } };
}
export type OfficeRenderer = Awaited<ReturnType<typeof createOffice>>;
