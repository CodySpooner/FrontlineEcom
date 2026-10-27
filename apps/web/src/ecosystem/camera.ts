import { MAP_SIZE, type Tile } from './world';

export interface Camera extends Tile { scale: number }
export const annotationScale = (zoom: number, cap: number) => Math.min(1, cap / zoom);
export const cameraBlend = (delta: number, still: boolean) => still ? 1 : 1 - Math.exp(-delta / 140);
export function introCamera(camera: Camera, width: number, height: number, still: boolean): Camera {
  const wide = zoomAt(camera, .82, { x: width / 2, y: height / 2 });
  return still ? camera : { ...wide, y: wide.y + 30 };
}
export function cameraViewport(camera: Camera, width: number, height: number) {
  const x = Math.min(MAP_SIZE.width, Math.max(0, -camera.x / camera.scale)), y = Math.min(MAP_SIZE.height, Math.max(0, -camera.y / camera.scale));
  return { x, y, width: Math.max(0, Math.min(MAP_SIZE.width, (width - camera.x) / camera.scale) - x), height: Math.max(0, Math.min(MAP_SIZE.height, (height - camera.y) / camera.scale) - y) };
}
export function fitCamera(width: number, height: number): Camera {
  const scale = Math.max(.1, Math.min(width / MAP_SIZE.width, (height - 60) / MAP_SIZE.height));
  return { scale, x: (width - MAP_SIZE.width * scale) / 2, y: (height - MAP_SIZE.height * scale) / 2 };
}
export function zoomAt(camera: Camera, factor: number, point: Tile): Camera {
  const scale = Math.max(.1, Math.min(3, camera.scale * factor));
  return { scale, x: point.x - (point.x - camera.x) * scale / camera.scale, y: point.y - (point.y - camera.y) * scale / camera.scale };
}
