import { validateSnapshot } from '../domain/schema';
import type { Building, Observation, OutreachSnapshot } from '../domain/types';
import type { WorkbookImportIssue } from './workbookImport';
export interface MergeSummary { added: number; updated: number; duplicates: number; retained: number; }
const collections = ['buildings', 'floors', 'units', 'people', 'households', 'householdMemberships', 'householdResidences', 'memberships', 'visits', 'observations', 'followUpEvents'] as const;
const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, normalize(value)])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
export function mergeWorkflow(current: OutreachSnapshot | undefined, incoming: OutreachSnapshot, baseline?: OutreachSnapshot) {
  const summary: MergeSummary = { added: 0, updated: 0, duplicates: 0, retained: 0 };
  const issues: WorkbookImportIssue[] = [];
  if (!current) { summary.added = collections.reduce((n, key) => n + (incoming[key]?.length ?? 0), 0); return { snapshot: validateSnapshot(incoming), summary, issues }; }
  const next = structuredClone(current);
  for (const key of collections) {
    // followUpEvents is absent in snapshots saved before it existed; never add an empty one.
    if (!incoming[key]?.length) continue;
    const rows = (next[key] ??= []) as Array<{ id: string }>;
    for (const candidate of incoming[key]) {
      const index = rows.findIndex(row => row.id === candidate.id);
      if (index < 0) { rows.push(candidate); summary.added++; continue; }
      if (same(rows[index], candidate)) { summary.duplicates++; continue; }
      if (key === 'observations' && 'paperRef' in candidate && candidate.paperRef && paperRecordEqual(rows[index] as Observation, candidate as Observation)) { summary.duplicates++; continue; }
      if (key === 'visits' && candidate.id.startsWith('paper-visit:') && same({ ...rows[index], recordedAt: '' }, { ...candidate, recordedAt: '' })) { summary.duplicates++; continue; }
      const original = baseline?.[key]?.find(row => row.id === candidate.id);
      if (original && same(candidate, original)) { summary.retained++; continue; }
      if (['buildings', 'people'].includes(key) && original && same(rows[index], original)) { rows[index] = candidate; summary.updated++; continue; }
      // A file can declare floors for a building that has none here, even when the file predates
      // the building: nothing else may differ, and no local floor can be overwritten.
      if (key === 'buildings' && declaresLayoutOnly(next, rows[index] as Building, candidate as Building)) { rows[index] = candidate; summary.updated++; continue; }
      issues.push({ severity: 'error', code: 'MERGE_CONFLICT', sheet: key === 'observations' ? '紙本回錄' : key === 'people' ? '個人名冊' : key, field: '編號', message: `${candidate.id} 與本機內容衝突。到訪請新增行；檔案如已過期，請重新匯出後回錄。` });
    }
  }
  if (!issues.length) {
    try { return { snapshot: validateSnapshot(next), summary, issues }; }
    catch (error) { issues.push({ severity: 'error', code: 'MERGE_VALIDATION', sheet: '關聯資料', message: error instanceof Error ? error.message : '合併後資料關聯不一致。' }); }
  }
  return { summary, issues, snapshot: undefined };
}

/** Semantic equality for an already imported paper row, independent of file name/time. */
export function paperRecordEqual(a: Observation, b: Observation) {
  const clean = (item: Observation) => ({ ...item, recordedAt: undefined, importSource: undefined });
  return same(clean(a), clean(b));
}

function declaresLayoutOnly(current: OutreachSnapshot, local: Building, candidate: Building) {
  const rest = (b: Building) => ({ ...b, layoutDeclared: undefined, floorCount: undefined });
  return !local.layoutDeclared && candidate.layoutDeclared && !current.floors.some(f => f.buildingId === local.id) && same(rest(local), rest(candidate));
}
