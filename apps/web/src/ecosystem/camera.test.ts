import { expect, test } from 'vitest';
import { cameraBlend, cameraViewport, fitCamera, introCamera, zoomAt } from './camera';
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
test('cinematic entry and focus settle independently of frame rate and respect reduced motion', () => {
  const fit = fitCamera(1000, 600);
  expect(introCamera(fit, 1000, 600, false).scale).toBeLessThan(fit.scale);
  expect(introCamera(fit, 1000, 600, true)).toEqual(fit);
  expect(1 - (1 - cameraBlend(20, false)) ** 5).toBeCloseTo(cameraBlend(100, false));
  expect(cameraBlend(20, true)).toBe(1);
  const view = cameraViewport(fit, 1000, 600);
  expect(view.width).toBeCloseTo(MAP_SIZE.width); expect(view.height).toBeCloseTo(MAP_SIZE.height);
  expect(cameraViewport({ scale: 1, x: -99999, y: -99999 }, 1000, 600)).toMatchObject({ width: 0, height: 0 });
});
