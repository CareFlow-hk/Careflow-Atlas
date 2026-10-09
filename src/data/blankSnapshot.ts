import type { OutreachSnapshot } from '../domain/types';

/** An empty workspace, so a centre can start from a template with its own buildings only. */
export function blankSnapshot(): OutreachSnapshot {
  return {
    schemaVersion: '0.1-demo', isSynthetic: true,
    notice: '空白範本：只含機構自行加入的合成或去識別化資料。',
    buildings: [], floors: [], units: [], households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations: [],
  };
}
