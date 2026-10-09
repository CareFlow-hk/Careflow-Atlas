import { z } from 'zod';
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, SOURCE_TYPES, SUPPORT_CATEGORIES, type Observation, type Operator, type OutreachSnapshot, type PhotoFallback } from '../domain/types';
import { observationSchema, occurrenceSchema, photoFallbackSchema, validateSnapshot } from '../domain/schema';

const text = z.string().max(200).nullable();
export const extractedRowSchema = z.object({
  building: text, address: text, floor: text, unit: text, scope: z.enum(['BUILDING', 'UNIT']).nullable(), date: text, worker: text,
  coverage: z.enum(COVERAGE_STATUSES).nullable(), contact: z.enum(CONTACT_OUTCOMES).nullable(), assessment: z.enum(HOUSING_ASSESSMENTS).nullable(), source: z.enum(SOURCE_TYPES).nullable(),
  note: z.string().max(3000), evidence: z.string().max(3000), followUp: text, dueDate: text, timingNote: text, assignee: text, category: z.enum(SUPPORT_CATEGORIES).nullable(),
  line: z.string().max(100), confidence: z.number().min(0).max(1), uncertainties: z.array(z.string().max(300)).max(15),
});
export const extractionSchema = z.object({ rows: z.array(extractedRowSchema).max(60), warnings: z.array(z.string().max(300)).max(15), model: z.string().max(200), fallback: photoFallbackSchema.optional() });
export type ExtractedRow = z.infer<typeof extractedRowSchema>;
export interface ReviewRow extends ExtractedRow { id: string; buildingId: string; unitId: string; reviewed: boolean; excluded: boolean }
export interface PhotoPage {
  id: string; name: string; image: string; status: 'ready' | 'processing' | 'done' | 'error';
  rows: ReviewRow[]; warnings: string[]; model?: string; fallback?: PhotoFallback; error?: string; sample?: boolean;
}
export const storedPhotoPageSchema = z.object({
  id: z.string().min(1).max(200), name: z.string().min(1).max(255), image: z.string().max(5 * 1024 * 1024).startsWith('data:image/'),
  status: z.enum(['ready', 'processing', 'done', 'error']),
  rows: z.array(extractedRowSchema.extend({ id: z.string().min(1).max(200), buildingId: z.string().max(200), unitId: z.string().max(200), reviewed: z.boolean(), excluded: z.boolean() })).max(60),
  warnings: z.array(z.string().max(300)).max(15), model: z.string().max(200).optional(), fallback: photoFallbackSchema.optional(), error: z.string().max(2000).optional(), sample: z.boolean().optional(),
});
const normalized = (value?: string | null) => (value ?? '').trim().toUpperCase().replace(/[\s·・]/g, '');
// Only explicit numeric floor suffixes are equivalent; never guess a missing floor.
const floorKey = (value?: string | null) => normalized(value).replace(/^(\d+)(?:\/?F|樓|層)$/, '$1F');
export function unitLocation(snapshot: OutreachSnapshot, unitId: string): string {
  const unit = snapshot.units.find(u => u.id === unitId);
  if (!unit) return '未選單位';
  const floor = snapshot.floors.find(f => f.id === unit.floorId)?.label;
  return !floor || normalized(unit.label).startsWith(normalized(floor)) ? unit.label : `${floor} · ${unit.label}`;
}
export function mapRow(row: ExtractedRow, pageId: string, index: number, snapshot: OutreachSnapshot): ReviewRow {
  const buildings = snapshot.buildings.filter(b => (row.building && normalized(b.name) === normalized(row.building)) || (row.address && normalized(b.address) === normalized(row.address)));
  const building = buildings.length === 1 ? buildings[0] : undefined;
  const floors = building && row.floor ? snapshot.floors.filter(f => f.buildingId === building.id && floorKey(f.label) === floorKey(row.floor)) : [];
  const floor = floors.length === 1 ? floors[0] : undefined;
  const unitAliases = new Set([normalized(row.unit), normalized(`${row.floor} ${row.unit}`), normalized(`${floor?.label} ${row.unit}`)]);
  const matches = floor && row.unit ? snapshot.units.filter(u => u.floorId === floor.id && unitAliases.has(normalized(u.label))) : [];
  return { ...row, id: `photo:${pageId}:${index + 1}`, buildingId: building?.id ?? '', unitId: matches.length === 1 ? matches[0].id : '', reviewed: false, excluded: false };
}
export function rowIssues(row: ReviewRow, snapshot: OutreachSnapshot): string[] {
  const issues: string[] = [];
  if (!snapshot.buildings.some(b => b.id === row.buildingId)) issues.push('選擇對應大廈');
  if (!row.scope) issues.push('確認記錄範圍');
  if (row.scope === 'UNIT' && !snapshot.units.some(u => u.id === row.unitId && u.buildingId === row.buildingId)) issues.push('選擇對應單位');
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !occurrenceSchema.safeParse(row.date).success) issues.push('填寫確實的到訪日期');
  if (!row.worker?.trim()) issues.push('填寫紙本工作員');
  if (!row.coverage) issues.push('確認探訪結果');
  if (row.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate) || !occurrenceSchema.safeParse(row.dueDate).success)) issues.push('修正跟進日期');
  if (!row.followUp?.trim() && [row.dueDate, row.timingNote, row.assignee, row.category].some(Boolean)) issues.push('填寫跟進行動或清空跟進欄位');
  return issues;
}
export function photoObservationId(page: PhotoPage, row: ReviewRow) { return `${page.sample ? 'sample-' : ''}${row.id}`; }
/** Validate the complete batch before the repository performs its single write. */
export function appendPhotoPages(snapshot: OutreachSnapshot, pages: PhotoPage[], operator: Operator, now = new Date().toISOString()) {
  if (pages.some(page => page.status !== 'done')) throw new Error('尚有照片未完成，請重試、手動回錄或移除該張草稿。');
  const observations = [...snapshot.observations]; const visits = [...snapshot.visits];
  let added = 0, duplicates = 0;
  for (const page of pages) for (const row of page.rows) {
    if (row.excluded) continue;
    const id = photoObservationId(page, row);
    if (observations.some(o => o.id === id)) { duplicates++; continue; }
    if (!row.reviewed || rowIssues(row, snapshot).length) throw new Error('請逐筆完成位置、日期與結果核對，再儲存。');
    const unit = row.scope === 'UNIT' ? snapshot.units.find(u => u.id === row.unitId) : undefined;
    const visitId = `photo-visit:${id}`;
    const observation: Observation = observationSchema.parse({
      id, visitId, isSynthetic: true, provisional: true, buildingId: row.buildingId, floorId: unit?.floorId, unitId: unit?.id,
      occurredAt: row.date, recordedAt: now, workerName: row.worker?.trim(), coverage: row.coverage,
      contactOutcome: row.contact ?? undefined, assessment: row.assessment ?? undefined, sourceType: row.source ?? undefined,
      note: row.note.trim() || undefined, evidence: row.evidence.trim() ? [row.evidence.trim()] : [],
      paperRef: page.name.slice(0, 200), paperLine: row.line || '未標行號',
      followUp: row.followUp?.trim() ? { action: row.followUp.trim(), status: 'OPEN', dueDate: row.dueDate || undefined, timingNote: row.timingNote || undefined, assignee: row.assignee || undefined, category: row.category ?? undefined } : undefined,
      photoSource: { hash: page.id, file: page.name.slice(0, 200), line: row.line, model: page.model ?? 'unknown', fallback: page.fallback, reviewedBy: operator, reviewedAt: now, sample: !!page.sample },
    });
    observations.push(observation);
    visits.push({ id: visitId, occurredAt: observation.occurredAt, recordedAt: now, workerName: observation.workerName, isSynthetic: true, provisional: true });
    added++;
  }
  return { snapshot: validateSnapshot({ ...snapshot, observations, visits }), added, duplicates };
}
