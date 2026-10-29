import { describe, expect, it } from 'vitest';
import { scheduleFlatPitchLock } from './flatPitchLock';

describe('flat editing camera lock', () => {
  function camera() {
    let listener: (() => void) | undefined, queued: (() => void) | undefined, maxPitch = 85;
    return {
      once: (_event: 'moveend', fn: () => void) => { listener = fn; queued = fn; },
      off: (_event: 'moveend', fn: () => void) => { if (listener === fn) listener = undefined; },
      setMaxPitch: (pitch: number) => { maxPitch = pitch; },
      end: () => { const fn = listener; listener = undefined; fn?.(); },
      dispatchQueued: () => queued?.(),
      max: () => maxPitch,
    };
  }
  it('locks the flat view even when reduced motion ends the transition immediately', () => {
    const map = camera(); const release = scheduleFlatPitchLock(map);
    map.end(); expect(map.max()).toBe(0);
    release(); map.setMaxPitch(85); map.dispatchQueued(); expect(map.max()).toBe(85);
  });
  it('cannot relock the camera when cancelling mid-animation emits moveend', () => {
    const map = camera(); const release = scheduleFlatPitchLock(map);
    release(); map.setMaxPitch(85); map.end(); map.dispatchQueued();
    expect(map.max()).toBe(85);
  });
  it('does not let an old session lock a later restored camera', () => {
    const map = camera(); const old = scheduleFlatPitchLock(map); old();
    const current = scheduleFlatPitchLock(map); map.end(); expect(map.max()).toBe(0);
    current(); map.setMaxPitch(85); map.end(); expect(map.max()).toBe(85);
  });
});
