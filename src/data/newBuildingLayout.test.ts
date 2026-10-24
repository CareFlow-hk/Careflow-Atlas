import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { workflowDemo } from './workflowDemo';
import { exportWorkflowWorkbook, parseWorkflowWorkbook } from './workflowWorkbook';
import { mergeWorkflow } from './workflowMerge';
import { buildingHeaders, excelDate, paperHeaders } from './workflowFormat';
import type { OutreachSnapshot } from '../domain/types';

const now = '2026-10-05T04:00:00Z';
const flags = { isSynthetic: true, provisional: true } as const;
const LAYOUT = '1 樓：1樓 A室、1樓 B室、1樓 C室\n2 樓：2樓 A室、2樓 B室、2樓 C室';
const workbook = (snapshot: OutreachSnapshot = workflowDemo) => XLSX.read(exportWorkflowWorkbook(snapshot), { type: 'array' });
const parse = (wb: XLSX.WorkBook) => parseWorkflowWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'test.xlsx', now)!;
const addBuilding = (wb: XLSX.WorkBook, fields: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { '大廈編號': 'district-17', '大廈名稱': 'A楼', '地址': '演示街區 17 號', '樓層單位摘要': LAYOUT, '經度': 114.14003764851, '緯度': 22.2867829260151, ...fields };
  XLSX.utils.sheet_add_aoa(wb.Sheets['大廈總表'], [buildingHeaders.map(h => data[h] ?? '')], { origin: -1 });
};
const addVisit = (wb: XLSX.WorkBook, fields: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { '紙本編號': 'P-A', '紙本行號': '1', '到訪日期': excelDate('2026-10-04'), '工作員': '合成工作員', '大廈編號': 'district-17', '樓層': '2 樓', '單位': '2樓 B室', '覆蓋結果': '已查看・無發現', ...fields };
  XLSX.utils.sheet_add_aoa(wb.Sheets['紙本回錄'], [paperHeaders.map(h => data[h] ?? '')], { origin: -1 });
};

describe('adding a building with its floors from Excel', () => {
  it('creates the declared floors and units, and lists them for confirmation', () => {
    const wb = workbook();
    addBuilding(wb);
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    const building = result.snapshot!.buildings.find(b => b.id === 'district-17')!;
    expect(building).toMatchObject({ layoutDeclared: true, floorCount: 2 });
    expect(result.snapshot!.floors.filter(f => f.buildingId === 'district-17').map(f => f.label)).toEqual(['1 樓', '2 樓']);
    expect(result.snapshot!.units.filter(u => u.buildingId === 'district-17')).toHaveLength(6);
    expect(result.layouts).toEqual([{ buildingId: 'district-17', name: 'A楼', floors: 2, units: 6 }]);
  });
  it('lets the same file record a visit to one of the new units', () => {
    const wb = workbook();
    addBuilding(wb);
    addVisit(wb);
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(result.snapshot!.observations.at(-1)).toMatchObject({ buildingId: 'district-17', floorId: 'district-17-f2', unitId: 'district-17-f2-u2' });
  });
  it('round trips: the re-exported file declares nothing new and repeats as duplicates', () => {
    const wb = workbook();
    addBuilding(wb);
    const first = parse(wb);
    const merged = mergeWorkflow(workflowDemo, first.snapshot!, first.baseline).snapshot!;
    const again = parse(workbook(merged));
    expect(again.issues).toEqual([]);
    expect(again.layouts).toEqual([]);
    expect(mergeWorkflow(merged, again.snapshot!, again.baseline).summary).toMatchObject({ added: 0, updated: 0 });
  });
  it('declares floors for an existing building whose layout was never declared', () => {
    const undeclared = workflowDemo.buildings.find(b => !b.layoutDeclared && !workflowDemo.floors.some(f => f.buildingId === b.id))!;
    const wb = workbook();
    const sheet = wb.Sheets['大廈總表'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const r = rows.findIndex(row => row[0] === undeclared.id);
    sheet[XLSX.utils.encode_cell({ r, c: buildingHeaders.indexOf('樓層單位摘要') })] = { t: 's', v: LAYOUT };
    const result = parse(wb);
    expect(result.issues).toEqual([]);
    expect(result.layouts?.map(l => l.buildingId)).toEqual([undeclared.id]);
    const merged = mergeWorkflow(workflowDemo, result.snapshot!, result.baseline);
    expect(merged.issues).toEqual([]);
    expect(merged.snapshot!.floors.filter(f => f.buildingId === undeclared.id)).toHaveLength(2);
  });
  it('fills in floors for a building first imported without them, from the same older file', () => {
    // The NGO trial file: A楼 was merged before this fix, so it exists here with no floors,
    // and the file's archive predates it.
    const wb = workbook();
    addBuilding(wb);
    const before = structuredClone(workflowDemo);
    before.buildings.push({ isSynthetic: true, provisional: true, id: 'district-17', name: 'A楼', address: '演示街區 17 號', coordinates: { lng: 114.14003764851, lat: 22.2867829260151 }, layoutDeclared: false });
    const result = parse(wb);
    const merged = mergeWorkflow(before, result.snapshot!, result.baseline);
    expect(merged.issues).toEqual([]);
    expect(merged.snapshot!.buildings.find(b => b.id === 'district-17')).toMatchObject({ layoutDeclared: true, floorCount: 2 });
    expect(merged.snapshot!.units.filter(u => u.buildingId === 'district-17')).toHaveLength(6);
  });
  it('rejects an unreadable layout with its row instead of dropping it', () => {
    const wb = workbook();
    addBuilding(wb, { '樓層單位摘要': '1樓 A室 1樓 B室' });
    const result = parse(wb);
    expect(result.snapshot).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ sheet: '大廈總表', field: '樓層單位摘要', severity: 'error' })]);
    expect(result.issues[0].message).toContain('缺少冒號');
  });
  it('still never rewrites floors a building already has', () => {
    const declared = workflowDemo.buildings.find(b => workflowDemo.floors.some(f => f.buildingId === b.id))!;
    const wb = workbook();
    const sheet = wb.Sheets['大廈總表'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const r = rows.findIndex(row => row[0] === declared.id);
    sheet[XLSX.utils.encode_cell({ r, c: buildingHeaders.indexOf('樓層單位摘要') })] = { t: 's', v: LAYOUT };
    const result = parse(wb);
    expect(result.layouts).toEqual([]);
    expect(result.snapshot!.floors).toEqual(workflowDemo.floors);
    expect(result.issues).toEqual([expect.objectContaining({ field: '樓層單位摘要', severity: 'warning' })]);
  });
  it('adopts a declaration the file did not change, instead of adding its floors without one', () => {
    // 另一部裝置為德昌樓聲明了 1 樓、2 樓，之後匯出 Excel；這個檔案裡的「關聯封存」因此
    // 已經帶着這個聲明，檔案本身沒有改過這幢大廈。而這部裝置（例如無痕視窗）從未收到它，
    // 德昌樓在這裡仍然未有樓層。只把新樓層加進去、不接收聲明，樓層就會沒有所屬聲明
    // （DATA_RELATION，2026-10-23）。
    const exported = structuredClone(workflowDemo);
    Object.assign(exported.buildings.find(b => b.id === 'bldg-duk-cheong')!, { layoutDeclared: true, floorCount: 2 });
    exported.floors.push(
      { ...flags, id: 'bldg-duk-cheong-f1', buildingId: 'bldg-duk-cheong', level: 1, label: '1 樓' },
      { ...flags, id: 'bldg-duk-cheong-f2', buildingId: 'bldg-duk-cheong', level: 2, label: '2 樓' },
    );
    const result = mergeWorkflow(workflowDemo, exported, structuredClone(exported));
    expect(result.issues).toEqual([]);
    expect(result.snapshot!.buildings.find(b => b.id === 'bldg-duk-cheong')).toMatchObject({ layoutDeclared: true, floorCount: 2 });
    expect(result.snapshot!.floors.filter(f => f.buildingId === 'bldg-duk-cheong').map(f => f.id)).toEqual(['bldg-duk-cheong-f1', 'bldg-duk-cheong-f2']);
  });
  it('warns when a new row fills columns the system calculates', () => {
    const wb = workbook();
    addBuilding(wb, { '覆蓋概況': '部分有記錄', '待跟進數': 0 });
    const result = parse(wb);
    expect(result.snapshot).toBeDefined();
    expect(result.issues.map(i => [i.field, i.severity])).toEqual([['覆蓋概況', 'warning'], ['待跟進數', 'warning']]);
  });
});
