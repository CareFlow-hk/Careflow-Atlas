import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../data/demoFixture';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from '../data/workflowWorkbook';
import { appendPhotoPages, mapRow, rowIssues, storedPhotoPageSchema, unitLocation } from './model';
import { blankRow, samplePage } from './sample';
import { getOpenFollowUps } from '../domain/types';

const operator = { accountId: 'reviewer-1', name: '核對同事' };
const reviewedPage = () => { const page = samplePage(demoSnapshot); page.rows.forEach(r => { r.reviewed = true; }); return page; };
describe('photo review and atomic append', () => {
  it('rejects malformed stored drafts and unfinished pages without silently repairing records', () => {
    const page = reviewedPage();
    expect(storedPhotoPageSchema.safeParse(page).success).toBe(true);
    expect(storedPhotoPageSchema.safeParse({ ...page, rows: [{ ...page.rows[0], worker: 10 }] }).success).toBe(false);
    expect(() => appendPhotoPages(demoSnapshot, [{ ...page, status: 'error' }], operator)).toThrow('未完成');
    expect(unitLocation(demoSnapshot, 'bldg-yu-an-f1-A')).toBe('1F A室');
  });
  it('matches exact names and floor/unit aliases, never selects an ambiguous building', () => {
    const row = { ...blankRow, building: '裕安樓', floor: '1F', unit: 'A室', scope: 'UNIT' as const };
    expect(mapRow(row, 'hash', 0, demoSnapshot).unitId).toBe('bldg-yu-an-f1-A');
    const duplicate = { ...demoSnapshot, buildings: [...demoSnapshot.buildings, { ...demoSnapshot.buildings[0], id: 'duplicate' }] };
    expect(mapRow(row, 'hash', 0, duplicate).buildingId).toBe('');
    expect(mapRow({ ...row, floor: null }, 'hash', 0, demoSnapshot).unitId).toBe('');
  });
  it('does not infer missing dates, field workers, scope or coverage', () => {
    const row = mapRow(blankRow, 'hash', 0, demoSnapshot);
    expect(rowIssues(row, demoSnapshot)).toHaveLength(5);
    expect(row.date).toBeNull(); expect(row.worker).toBeNull();
    row.date = '2026-02-31'; expect(rowIssues(row, demoSnapshot)).toContain('填寫確實的到訪日期');
  });
  it('matches explicit numeric floor notation without guessing or resolving ambiguity', () => {
    const row = { ...blankRow, building: '裕安樓', floor: '1 樓', unit: 'A 室', scope: 'UNIT' as const };
    for (const floor of ['1 樓', '1層', '1/F', '1f']) {
      expect(mapRow({ ...row, floor }, 'hash', 0, demoSnapshot).unitId).toBe('bldg-yu-an-f1-A');
    }
    for (const floor of [null, '', '1', '1樓或2樓', '地下']) {
      expect(mapRow({ ...row, floor }, 'hash', 0, demoSnapshot).unitId).toBe('');
    }
    const floor = demoSnapshot.floors.find(f => f.id === 'bldg-yu-an-f1')!;
    const ambiguous = { ...demoSnapshot, floors: [...demoSnapshot.floors, { ...floor, id: 'duplicate-floor', label: '1樓' }] };
    expect(mapRow(row, 'hash', 0, ambiguous).unitId).toBe('');
    expect(mapRow({ ...row, unit: null }, 'hash', 0, demoSnapshot).unitId).toBe('');
  });
  it('blocks the complete batch if one included row is unreviewed or mismatched', () => {
    const page = reviewedPage(); page.rows[1].reviewed = false;
    const before = JSON.stringify(demoSnapshot);
    expect(() => appendPhotoPages(demoSnapshot, [page], operator)).toThrow('逐筆');
    expect(JSON.stringify(demoSnapshot)).toBe(before);
    page.rows[1].reviewed = true; page.rows[1].buildingId = 'bldg-hoi-king';
    expect(() => appendPhotoPages(demoSnapshot, [page], operator)).toThrow('逐筆');
  });
  it('appends reviewed results with provenance and uncertain timing, preserving all history', () => {
    const page = reviewedPage();
    const result = appendPhotoPages(demoSnapshot, [page], operator, '2026-10-03T08:00:00Z');
    expect(result.added).toBe(2);
    expect(result.snapshot.observations.slice(0, demoSnapshot.observations.length)).toEqual(demoSnapshot.observations);
    expect(result.snapshot.observations.at(-1)).toMatchObject({ occurredAt: '2026-10-03', followUp: { timingNote: '下星期再聯絡' }, photoSource: { reviewedBy: operator, sample: true } });
    expect(result.snapshot.observations.at(-1)?.followUp?.dueDate).toBeUndefined();
    expect(getOpenFollowUps(result.snapshot).length).toBe(getOpenFollowUps(demoSnapshot).length + 1);
    expect(appendPhotoPages(result.snapshot, [{ ...page, name: 'renamed.jpg' }], operator)).toMatchObject({ added: 0, duplicates: 2 });
  });
  it('never changes child observations when saving a building result', () => {
    const page = reviewedPage(); page.rows = [{ ...page.rows[0], scope: 'BUILDING', coverage: 'INACCESSIBLE', unitId: '' }];
    const result = appendPhotoPages(demoSnapshot, [page], operator);
    expect(result.snapshot.observations.at(-1)?.unitId).toBeUndefined();
    expect(result.snapshot.observations.at(-1)?.floorId).toBeUndefined();
  });
  it('skips explicitly excluded rows and requires a follow-up action for timing data', () => {
    const page = reviewedPage(); page.rows[0].excluded = true; page.rows[0].reviewed = false;
    expect(appendPhotoPages(demoSnapshot, [page], operator).added).toBe(1);
    page.rows[1].followUp = null;
    expect(rowIssues(page.rows[1], demoSnapshot)).toContain('填寫跟進行動或清空跟進欄位');
  });
  it('round trips photo provenance and stable IDs through the existing Excel workflow', () => {
    const page = reviewedPage();
    page.model = 'gpt-6.1-sol';
    page.fallback = { primaryModel: 'gpt-6-luna', model: 'gpt-6.1-sol', reason: 'LOW_LEGIBILITY', outcome: 'used' };
    expect(storedPhotoPageSchema.parse(page).fallback).toEqual(page.fallback);
    const result = appendPhotoPages(demoSnapshot, [page], operator);
    expect(result.snapshot.observations.at(-1)?.photoSource).toMatchObject({ model: page.model, fallback: page.fallback });
    const imported = parseWorkflowWorkbook(exportWorkflowWorkbook(result.snapshot), 'photo-export.xlsx');
    expect(imported?.issues).toEqual([]);
    expect(imported?.snapshot).toEqual(result.snapshot);
  });
  it('preserves failed fallback provenance while retaining the actual Luna result model', () => {
    const page = reviewedPage();
    page.model = 'gpt-6-luna';
    page.fallback = { primaryModel: 'gpt-6-luna', model: 'gpt-6.1-sol', reason: 'LOW_LEGIBILITY', outcome: 'failed' };
    const restored = storedPhotoPageSchema.parse(page);
    const result = appendPhotoPages(demoSnapshot, [restored], operator);
    expect(result.snapshot.observations.at(-1)?.photoSource).toMatchObject({ model: 'gpt-6-luna', fallback: { outcome: 'failed' } });
  });
});
