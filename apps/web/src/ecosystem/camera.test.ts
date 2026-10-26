import { expect, test } from 'vitest';
import { fitCamera, zoomAt } from './camera';
import { MAP_SIZE } from './world';

test('fit contains the office and cursor zoom preserves its world point', () => {
  const camera = fitCamera(1000, 600), point = { x: 250, y: 200 };
  expect(MAP_SIZE.width * camera.scale).toBeLessThanOrEqual(1000);
  expect(MAP_SIZE.height * camera.scale).toBeLessThanOrEqual(540);
  const zoomed = zoomAt(camera, 2, point);
  expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo((point.x - camera.x) / camera.scale);
  expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo((point.y - camera.y) / camera.scale);
  expect(zoomAt(camera, 100, point).scale).toBe(3);
  expect(zoomAt(camera, .001, point).scale).toBe(.1);
});
