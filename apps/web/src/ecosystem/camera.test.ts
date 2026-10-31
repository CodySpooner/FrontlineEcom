import { boundCamera } from './camera';
import { expect, test } from 'vitest';
import { annotationScale, cameraBlend, cameraViewport, fitCamera, introCamera, zoomAt } from './camera';
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
test('annotations keep their overview size and cap their screen footprint at close zoom', () => {
  expect(annotationScale(.38, .8)).toBe(1);
  for (const zoom of [.8,1.25,2,3]) expect(annotationScale(zoom,.8)*zoom).toBeCloseTo(.8);
  expect(annotationScale(.1,1.1)).toBe(1);
  expect(annotationScale(3,1.1)*3).toBeCloseTo(1.1);
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


test('pan bounds keep the world reachable at extreme drags and center a small overview',()=>{
  const left=boundCamera({x:-1e6,y:-1e6,scale:1},1200,800),right=boundCamera({x:1e6,y:1e6,scale:1},1200,800);
  expect(left.x).toBeGreaterThan(-3000);expect(left.y).toBeGreaterThan(-2000);
  expect(right.x).toBe(32);expect(right.y).toBe(32);
  expect(boundCamera({x:999,y:-999,scale:.1},1200,800)).toEqual(boundCamera({x:-999,y:999,scale:.1},1200,800));
});
