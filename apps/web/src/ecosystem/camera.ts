import { MAP_SIZE, type Tile } from './world';

export interface Camera extends Tile { scale: number }
export function fitCamera(width: number, height: number): Camera {
  const scale = Math.max(.1, Math.min(width / MAP_SIZE.width, (height - 60) / MAP_SIZE.height));
  return { scale, x: (width - MAP_SIZE.width * scale) / 2, y: (height - MAP_SIZE.height * scale) / 2 };
}
export function zoomAt(camera: Camera, factor: number, point: Tile): Camera {
  const scale = Math.max(.1, Math.min(3, camera.scale * factor));
  return { scale, x: point.x - (point.x - camera.x) * scale / camera.scale, y: point.y - (point.y - camera.y) * scale / camera.scale };
}
