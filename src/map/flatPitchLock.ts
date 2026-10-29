/** A flat editing session owns its pending animation callback. Cancel it before
 * stopping/restoring the camera: stopping an animation can synchronously emit moveend. */
export function scheduleFlatPitchLock(map: {
  once: (event: 'moveend', listener: () => void) => unknown;
  off: (event: 'moveend', listener: () => void) => unknown;
  setMaxPitch: (pitch: number) => unknown;
}): () => void {
  let active = true;
  const lock = () => { if (active) map.setMaxPitch(0); };
  map.once('moveend', lock);
  return () => { active = false; map.off('moveend', lock); };
}
