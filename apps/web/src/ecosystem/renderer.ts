import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { DESKS, MEETING, ROOMS, iso, uniso, type Tile } from './world';
import { paintOffice } from './worldArt';
import { fitCamera, zoomAt } from './camera';
import { workerSprites } from './workerSprites';
import type { DisplayOptions } from './display';
import { OFFICE_THEMES, type OfficeThemeId } from './themes';
import { createHologram, LOGO_URL } from './hologram';
import { platformHolograms } from './platforms';

export async function createOffice(host: HTMLElement, onDesk: (id: string) => void) {
  const logoTexture = await Assets.load<Texture>(LOGO_URL); logoTexture.source.scaleMode = 'nearest';
  const app = new Application();
  await app.init({ width: host.clientWidth, height: host.clientHeight, backgroundAlpha: 0, antialias: false, resolution: 1, preference: 'webgl' });
  host.appendChild(app.canvas);
  app.canvas.setAttribute('aria-label', 'Interactive isometric office with ten departments and thirty workstations');
  app.canvas.tabIndex = 0;
  const world = new Container(); app.stage.addChild(world);
  let mapTexture = Texture.from(paintOffice()); mapTexture.source.scaleMode = 'nearest';
  const map = new Sprite(mapTexture); world.addChild(map);
  let theme: OfficeThemeId = 'frontline';
  const setTheme = (value: OfficeThemeId) => { if (theme === value) return; theme = value; const old = mapTexture; mapTexture = Texture.from(paintOffice(OFFICE_THEMES[value])); mapTexture.source.scaleMode = 'nearest'; map.texture = mapTexture; old.destroy(true); };
  const labels = new Container(); world.addChild(labels);
  for (const room of ROOMS) {
    const p = iso({x:room.x+12.5,y:room.y+12.5});
    const label = new Text({ text: room.name.toUpperCase(), style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 26, fontWeight: '600', fill: '#e6e6ec', stroke: {color:'#08080c',width:5} } });
    label.anchor.set(.5); label.position.set(p.x,p.y); labels.addChild(label);
  }
  const selection = new Graphics(); world.addChild(selection);
  let dragged = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined, clickedWorker: string | undefined;
  // Let a second click focus the camera before opening the profile on a single click.
  const selectDesk = (id: string) => { clearTimeout(clickTimer); clickTimer = setTimeout(() => onDesk(id), 250); };
  const lights = new Container(); world.addChild(lights);
  for (const [i,d] of DESKS.entries()) {
    const p=iso(d);
    const light = new Graphics().rect(-12,-32,24,2).fill(d.color);
    light.position.set(p.x,p.y); lights.addChild(light);
    const hit = new Graphics().rect(-30,-44,60,72).fill({color:0xffffff,alpha:0.001});
    hit.position.set(p.x,p.y); hit.eventMode='static'; hit.cursor='pointer';
    hit.on('pointertap',()=>{ if(dragged) return; selection.clear().poly([p.x,p.y-12,p.x+31,p.y+4,p.x,p.y+20,p.x-31,p.y+4]).stroke({color:0xffffff,width:2});selectDesk(d.id); });
    world.addChild(hit); light.alpha=.45+(i%4)*.12;
  }
  const hub=iso(MEETING), hologram = createHologram(logoTexture); hologram.root.position.set(hub.x,hub.y-98); world.addChild(hologram.root);
  const platforms = platformHolograms(world);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let lowPower = false, autoLow = false;
  app.ticker.maxFPS = 60;
  const workers = workerSprites(world, (desk, id) => { if (!dragged) { clickedWorker = id; selectDesk(desk); } });
  const objective = new Text({ text: '', style: { fontFamily: 'Chakra Petch, sans-serif', fontSize: 19, fontWeight: '600', fill: '#ffd9e3', stroke: { color: '#100810', width: 6 }, wordWrap: true, wordWrapWidth: 300, align: 'center' } });
  objective.anchor.set(.5, 1); objective.position.set(hub.x, hub.y - 176); world.addChild(objective);
  let camera = fitCamera(host.clientWidth,host.clientHeight);
  world.scale.set(camera.scale); world.position.set(camera.x,camera.y);
  const fit = () => { camera = fitCamera(host.clientWidth,host.clientHeight); };
  const zoom = (factor:number, point:Tile={x:host.clientWidth/2,y:host.clientHeight/2}) => { camera = zoomAt(camera,factor,point); };
  const focus = (tile:Tile) => { const p=iso(tile);camera={scale:1.25,x:host.clientWidth/2-p.x*1.25,y:host.clientHeight/2-p.y*1.25}; };
  const point = (e:MouseEvent) => { const r=app.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}; };
  let drag: { pointer:number; x:number; y:number; startX:number; startY:number } | undefined;
  const down = (e:PointerEvent) => { if(e.button!==0) return;clearTimeout(clickTimer);clickedWorker=undefined;dragged=false;drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:camera.x,startY:camera.y};app.canvas.setPointerCapture(e.pointerId); };
  const move = (e:PointerEvent) => { if(!drag||e.pointerId!==drag.pointer) return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)dragged=true;camera={...camera,x:drag.startX+dx,y:drag.startY+dy}; };
  const up = () => { drag=undefined; };
  const wheel = (e:WheelEvent) => {e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15,point(e));};
  const double = (e:MouseEvent) => {clearTimeout(clickTimer);const p=point(e),worker=clickedWorker && workers.position(clickedWorker);focus(worker || uniso({x:(p.x-world.x)/world.scale.x,y:(p.y-world.y)/world.scale.y}));};
  const key = (e:KeyboardEvent) => {
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key)) e.preventDefault();
    if(e.key==='+'||e.key==='=') zoom(1.25);else if(e.key==='-') zoom(.8);else if(e.key==='0')fit();
    else if(e.key.startsWith('Arrow')) camera={...camera,x:camera.x+(e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0),y:camera.y+(e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0)};
  };
  app.canvas.addEventListener('pointerdown',down);app.canvas.addEventListener('pointermove',move);app.canvas.addEventListener('pointerup',up);app.canvas.addEventListener('pointercancel',up);
  app.canvas.addEventListener('wheel',wheel,{passive:false});app.canvas.addEventListener('dblclick',double);app.canvas.addEventListener('keydown',key);
  const resize = new ResizeObserver(()=>{app.renderer.resize(host.clientWidth,host.clientHeight);fit();}); resize.observe(host); fit();
  let elapsed=0, frames=0, sampleFrames=0, sampleStart=performance.now(), slowSamples=0;
  const started = sampleStart;
  let metrics = { fps: 0, frames: 0, elapsedMs: 0, mode: 'Standard', scale: camera.scale };
  const visibility = () => { if (document.hidden) app.ticker.stop(); else { sampleStart = performance.now(); sampleFrames = 0; app.ticker.start(); } };
  document.addEventListener('visibilitychange', visibility);
  app.ticker.add((ticker)=>{
    frames++; sampleFrames++;
    const now = performance.now(), period = now - sampleStart;
    if (period >= 1000) {
      const fps = sampleFrames * 1000 / period;
      slowSamples = fps >= 10 && fps < 35 && !lowPower ? slowSamples + 1 : 0;
      if (slowSamples >= 5) { autoLow = true; app.ticker.maxFPS = 30; }
      metrics = { fps, frames, elapsedMs: now - started, mode: lowPower || autoLow ? 'Low power' : 'Standard', scale: world.scale.x };
      sampleStart = now; sampleFrames = 0;
    }
    const smooth=reduced.matches?1:1-Math.exp(-ticker.deltaMS/65);
    world.x+=(camera.x-world.x)*smooth;world.y+=(camera.y-world.y)*smooth;world.scale.set(world.scale.x+(camera.scale-world.scale.x)*smooth);
    workers.tick(Math.min(ticker.elapsedMS, 1000),reduced.matches || lowPower || autoLow,{x:-world.x/world.scale.x,y:-world.y/world.scale.x,width:host.clientWidth/world.scale.x,height:host.clientHeight/world.scale.x,scale:world.scale.x});
    objective.text = workers.meetingTitle() ? `TEAM KICKOFF\n${workers.meetingTitle()}` : '';
    const still = reduced.matches || lowPower || autoLow;
    if (!still) elapsed+=ticker.deltaMS;
    hologram.tick(elapsed, still);
    platforms.tick(elapsed, still);
    if(still) return;
    lights.children.forEach((light,i)=>{light.alpha=.45+.3*Math.sin(elapsed/1400+i);});
  });
  return { app, world, labels, fit, zoom, focus, setTheme, performance: () => metrics, focusWorker: (id: string) => { const p = workers.position(id); if (p) focus(p); }, setWorkers: workers.update, setBusiness: platforms.update, setDisplay: (value: DisplayOptions) => { labels.visible = value.departments; objective.visible = value.bubbles; lowPower = value.lowPower; autoLow = false; app.ticker.maxFPS = lowPower ? 30 : 60; workers.setDisplay(value); }, drainPositions: workers.drainPositions, destroy:()=>{ clearTimeout(clickTimer);resize.disconnect();document.removeEventListener('visibilitychange',visibility);app.destroy(true,{children:true});hologram.destroy();platforms.destroy();workers.destroy();mapTexture.destroy(true); } };
}
export type OfficeRenderer = Awaited<ReturnType<typeof createOffice>>;
