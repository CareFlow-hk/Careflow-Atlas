import { validateSnapshot } from '../domain/schema';
import type { Building, Observation, OutreachSnapshot } from '../domain/types';
import type { WorkbookImportIssue } from './workbookImport';
import { issue, schemaIssues } from './issueText';
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
      // A file can declare floors or an outline for a building that has neither here, even when the
      // file predates the building: nothing else may differ, and nothing local can be overwritten.
      if (key === 'buildings' && declaresLayoutOnly(next, rows[index] as Building, candidate as Building)) { rows[index] = candidate; summary.updated++; continue; }
      issues.push(conflictIssue(key, candidate, rows[index]));
    }
  }
  if (!issues.length) {
    try { return { snapshot: validateSnapshot(next), summary, issues }; }
    catch (error) { issues.push(...schemaIssues(error, next, '合併')); }
  }
  return { summary, issues, snapshot: undefined };
}

/** Semantic equality for an already imported paper row, independent of file name/time. */
export function paperRecordEqual(a: Observation, b: Observation) {
  const clean = (item: Observation) => ({ ...item, recordedAt: undefined, importSource: undefined });
  return same(clean(a), clean(b));
}

function declaresLayoutOnly(current: OutreachSnapshot, local: Building, candidate: Building) {
  // Only fills what the local copy lacks: floors it has none of, or an outline it has none of.
  const addsLayout = !local.layoutDeclared && candidate.layoutDeclared && !current.floors.some(f => f.buildingId === local.id);
  const addsOutline = !local.footprint && !!candidate.footprint;
  if (!addsLayout && !addsOutline) return false;
  const rest = (b: Building) => ({ ...b, ...(addsLayout ? { layoutDeclared: undefined, floorCount: undefined } : {}), ...(addsOutline ? { footprint: undefined, footprintSource: undefined } : {}) });
  return same(rest(local), rest(candidate));
}

/** Same id, different content, and the local copy changed since this file was exported. */
function conflictIssue(key: string, candidate: { id: string }, local: { id: string }): WorkbookImportIssue {
  const detail = `MERGE_CONFLICT ${key}/${candidate.id}`;
  if (key === 'observations') {
    const o = candidate as Observation;
    return issue({ code: 'MERGE_CONFLICT', sheet: '紙本回錄', row: o.importSource?.row, field: o.paperRef ? '紙本編號／紙本行號' : '記錄編號', detail,
      message: o.paperRef ? `紙本「${o.paperRef}」第 ${o.paperLine} 行之前已經錄入過，但這次內容不同。如果要更正，請新增一行並填「更正原記錄編號」；如果是同事用了舊檔，請重新匯出再補錄。` : '這條記錄在工作台上的內容和檔案不同。請重新「匯出目前 Excel」，再把新的內容抄過去。' });
  }
  const name = (local as { name?: string; displayName?: string }).name ?? (local as { displayName?: string }).displayName ?? candidate.id;
  if (key === 'people' || key === 'buildings') return issue({ code: 'MERGE_CONFLICT', sheet: key === 'people' ? '個人名冊' : '大廈總表', field: key === 'people' ? '個人編號' : '大廈編號', detail,
    message: `「${name}」在你匯出這個檔案之後，工作台上已經被改過，兩邊都改了同一筆。請重新「匯出目前 Excel」，再把你的修改抄到新檔。` });
  return issue({ code: 'MERGE_CONFLICT', sheet: '關聯封存', detail, message: '這個檔案和工作台上的資料有衝突，可能是用了較舊的匯出檔。請重新「匯出目前 Excel」後再填寫。' });
}
