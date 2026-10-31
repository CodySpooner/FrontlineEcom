import { expect, test } from 'vitest';
import { DEFAULT_DISPLAY, parseDisplay, statusColor } from './display';

test('device preferences accept only known booleans and preserve new defaults', () => {
  expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY);
  expect(parseDisplay({ names: false, bubbles: 'false', unknown: false })).toEqual({ ...DEFAULT_DISPLAY, names: false });
  expect(DEFAULT_DISPLAY.names).toBe(true);
});
test('status beacons distinguish actual work, waiting, failure and unavailable workers', () => {
  expect(statusColor('running')).toBe('#3ddc84'); expect(statusColor('using_tool')).toBe(statusColor('running'));
  expect(statusColor('queued')).toBe('#63b6ff'); expect(statusColor('failed')).toBe('#ff2a3a');
  expect(statusColor('awaiting_approval')).toBe('#f4bc53'); expect(statusColor('collaborating')).toBe('#ce7aff');
  expect(statusColor('idle')).not.toBe(statusColor('running'));expect(statusColor()).toBe(statusColor('offline'));
});


test('ambient pause and quality are independent persisted choices',()=>{
  expect(parseDisplay({pauseAmbient:true,lowPower:false})).toMatchObject({pauseAmbient:true,lowPower:false});
  expect(parseDisplay({pauseAmbient:'true',lowPower:true})).toMatchObject({pauseAmbient:false,lowPower:true});
});
