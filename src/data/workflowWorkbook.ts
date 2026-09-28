import * as XLSX from 'xlsx';
import { readWorkbook } from './readWorkbook';
import { validateSnapshot, occurrenceSchema } from '../domain/schema';
import { type Observation, type OutreachSnapshot } from '../domain/types';
import { coverageLabels } from '../domain/presentation';
import { alignDemoSnapshot } from './demoGeometry';
import { WORKFLOW_VERSION, hkParts, assessmentLabels, buildingHeaders, contactLabels, observationRow, optionalPaperHeaders, paperHeaders, personHeaders, sourceLabels, workflowSheets } from './workflowFormat';
import { getCorrectionConflicts } from '../domain/types';
import { acceptedAssessment, acceptedContact, acceptedCoverage, acceptedSource, supportCategoryLabels } from '../domain/presentation';
import type { WorkbookImportIssue } from './workbookImport';

export interface WorkflowImport { snapshot?: OutreachSnapshot; baseline?: OutreachSnapshot; issues: WorkbookImportIssue[]; counts: Record<string, number>; }
const flags = { isSynthetic: true, provisional: true } as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function exportWorkflowWorkbook(snapshot: OutreachSnapshot): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const spec of workflowSheets(snapshot)) {
    const rows = [[], [spec.name], [spec.note], [], [], spec.headers, ...spec.rows];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = spec.widths.map(wch => ({ wch }));
    sheet['!rows'] = rows.map((_, i) => ({ hpt: i === 2 ? 32 : i === 5 ? 30 : 23 }));
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: Math.max(6, rows.length - 1), c: spec.headers.length - 1 } }) };
    for (const name of spec.dates ?? []) {
      const c = spec.headers.indexOf(name);
      spec.rows.forEach((_, i) => { const cell = sheet[XLSX.utils.encode_cell({ r: i + 6, c })]; if (cell?.t === 'n') cell.z = 'yyyy-mm-dd'; });
    }
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
}

export function parseWorkflowWorkbook(buffer: ArrayBuffer, file: string, now = new Date().toISOString()): WorkflowImport | undefined {
  const workbook = readWorkbook(buffer);
  if (!workbook.SheetNames.includes('使用說明')) return undefined;
  const issues: WorkbookImportIssue[] = [];
  const add = (sheet: string, row: number | undefined, field: string, message: string, severity: 'error' | 'warning' = 'error') => issues.push({ sheet, row, field, message, severity, code: severity === 'error' ? 'WORKFLOW_INVALID' : 'WORKFLOW_NOTE' });
  for (const name of workbook.SheetNames) if (!['使用說明', '大廈總表', '個人名冊', '紙本回錄', '待跟進', '關聯封存'].includes(name)) add(name, undefined, '', '未識別的工作表，請移至另一個檔案後再匯入，避免遺漏內容。');
  const read = (name: string, headers: string[], optionalHeaders: string[] = []) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) { add(name, undefined, '', '缺少此工作表。'); return []; }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    const heading = matrix.findIndex(row => row[0] === headers[0]);
    if (heading < 0 || heading > 20) { add(name, undefined, headers[0], '找不到範本表頭。'); return []; }
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    const actual = Array.from({ length: width }, (_, col) => String(matrix[heading][col] ?? ''));
    for (const h of headers) if (!actual.includes(h) && !optionalHeaders.includes(h)) add(name, heading + 1, h, '缺少此欄位。');
    if (new Set(actual.filter(Boolean)).size !== actual.filter(Boolean).length) add(name, heading + 1, '', '重複欄名。');
    return matrix.slice(heading + 1).map((values, index) => {
      const row = heading + index + 2;
      actual.forEach((h, col) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: col })];
        if (cell?.f) add(name, row, h, '資料欄請填值，不接受公式或外部連結。');
        if (values[col] !== '' && values[col] != null && !headers.includes(h)) add(name, row, h || `第 ${col + 1} 欄`, '未識別欄位有內容，請先整理，避免遺漏。');
      });
      return { row, values: Object.fromEntries(headers.map(h => [h, values[actual.indexOf(h)] ?? ''])) };
    }).filter(item => Object.values(item.values).some(v => v !== '' && v != null));
  };
  const instructions = read('使用說明', ['項目', '內容']);
  if (instructions.find(r => r.values['項目'] === '格式')?.values['內容'] !== WORKFLOW_VERSION || instructions.find(r => r.values['項目'] === '合成資料')?.values['內容'] !== 'true') add('使用說明', undefined, '格式', '只接受本工作台的合成紙本回錄範本。');
  const archive = read('關聯封存', ['分段', '資料']);
  let baseline: OutreachSnapshot;
  try {
    if (!archive.length || archive.some((r, i) => Number(r.values['分段']) !== i + 1)) throw new Error('段落不完整');
    baseline = alignDemoSnapshot(validateSnapshot(JSON.parse(archive.map(r => r.values['資料']).join(''))));
  } catch { add('關聯封存', undefined, '', '封存內容不完整，請重新下載範本並保留此頁。'); return { issues, counts: {} }; }
  const incoming = structuredClone(baseline);
  const referenceSheets = workflowSheets(baseline);
  const str = (value: unknown) => value == null ? '' : String(value);
  const optional = (value: unknown) => str(value).trim() || undefined;
  // `accepted` carries every wording this product has ever written for the field, so a
  // sheet filled in before the options were simplified still imports as the same value.
  const enumValue = <T extends string>(value: unknown, labels: Record<T, string>, sheet: string, row: number, field: string, accepted: Record<string, T> = {}): T | undefined => {
    const raw = optional(value);
    if (!raw) return undefined;
    const key = (Object.keys(labels) as T[]).find(k => labels[k] === raw || k === raw) ?? accepted[raw as string];
    if (!key) add(sheet, row, field, `請選擇：${Object.values(labels).join('、')}`);
    return key;
  };
  const date = (value: unknown, sheet: string, row: number, field: string): string | undefined => {
    if (!optional(value)) return undefined;
    let day = str(value).trim();
    if (typeof value === 'number') { const parsed = XLSX.SSF.parse_date_code(value, { date1904: !!workbook.Workbook?.WBProps?.date1904 }); day = parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : ''; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !occurrenceSchema.safeParse(day).success) { add(sheet, row, field, '請填有效 Excel 日期或 YYYY-MM-DD。相對時間請寫在時間原話欄。'); return undefined; }
    return day;
  };
  const setRecord = <T extends { id: string }>(list: T[], item: T) => { const index = list.findIndex(r => r.id === item.id); if (index < 0) list.push(item); else list[index] = item; };
  for (const [name, headers, key] of [['大廈總表', buildingHeaders, 'buildings'], ['個人名冊', personHeaders, 'people']] as const) {
    const seen = new Set<string>();
    const spec = referenceSheets.find(s => s.name === name)!;
    for (const { row, values: v } of read(name, headers)) {
      const id = optional(v[headers[0]]);
      if (!id || seen.has(id)) { add(name, row, headers[0], '編號必填且不可重複。'); continue; } seen.add(id);
      const original = baseline[key].find(p => p.id === id);
      const previousRow = spec.rows.find(r => r[0] === id);
      if (original && previousRow) headers.forEach((h, i) => { if (i && !spec.editable?.includes(h) && str(v[h]) !== str(previousRow[i])) add(name, row, h, '此為參考摘要，修改不會套用；請在紙本回錄新增明細。', 'warning'); });
      if (key === 'buildings') {
        const b = baseline.buildings.find(b => b.id === id);
        const lng = Number(v['經度']), lat = Number(v['緯度']);
        if (!optional(v['大廈名稱']) || !optional(v['地址']) || v['經度'] === '' || v['緯度'] === '' || !Number.isFinite(lng) || !Number.isFinite(lat)) { add(name, row, '名稱／地址／座標', '名稱、地址與有效座標必填；不能將缺少座標當作零。'); continue; }
        if (b?.footprint && (lng !== b.coordinates.lng || lat !== b.coordinates.lat)) { add(name, row, '經度／緯度', '此大廈已綁定占地輪廓，不能只改中心座標。'); continue; }
        setRecord(incoming.buildings, { ...(b ?? { ...flags, layoutDeclared: false }), id, name: str(v['大廈名稱']).trim(), address: str(v['地址']).trim(), coordinates: { lng, lat } });
      } else {
        const p = baseline.people.find(p => p.id === id);
        if (typeof v['電話'] === 'number') { add(name, row, '電話', '電話請設為文字並核對原值，數字格式可能已丟失開頭的 0。'); continue; }
        if (!optional(v['姓名／稱呼'])) { add(name, row, '姓名／稱呼', '姓名／稱呼必填。'); continue; }
        setRecord(incoming.people, { ...(p ?? flags), id, displayName: str(v['姓名／稱呼']).trim(), phone: optional(v['電話']), contactNote: optional(v['接觸備註']), addressNote: previousRow && str(v['住址原文']) === str(previousRow[3]) ? p?.addressNote : optional(v['住址原文']) });
      }
    }
  }
  const seen = new Set<string>();
  for (const { row, values: v } of read('紙本回錄', paperHeaders, optionalPaperHeaders)) {
    const sheet = '紙本回錄';
    const buildingId = optional(v['大廈編號']);
    const paperRef = optional(v['紙本編號']), paperLine = optional(v['紙本行號']);
    const id = optional(v['記錄編號']) ?? (paperRef && paperLine && buildingId ? `paper:${encodeURIComponent(paperRef)}:${encodeURIComponent(paperLine)}:${buildingId}` : undefined);
    if (!id || seen.has(id)) { add(sheet, row, '記錄編號', '既有編號不可重複；新行請填紙本編號、紙本行號與大廈編號。'); continue; } seen.add(id);
    if (!buildingId || !incoming.buildings.some(b => b.id === buildingId)) { add(sheet, row, '大廈編號', '請使用大廈總表中的編號。'); continue; }
    const old = baseline.observations.find(o => o.id === id);
    const day = date(v['到訪日期'], sheet, row, '到訪日期');
    const dueDate = date(v['確定跟進日期'], sheet, row, '確定跟進日期');
    let time = optional(v['到訪時間']);
    if (typeof v['到訪時間'] === 'number' && v['到訪時間'] >= 0 && v['到訪時間'] < 1) { const seconds = Math.round(v['到訪時間'] * 86400); time = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
    // Untouched history is reused verbatim, including precise timestamps and provenance.
    const oldRow = old ? observationRow(baseline, old) : undefined;
    if (oldRow && paperHeaders.every((h, i) => h === '到訪日期' ? day === hkParts(old!.occurredAt)[0] : h === '確定跟進日期' ? dueDate === old!.followUp?.dueDate : h === '到訪時間' ? (time?.length === 5 ? time + ':00' : time ?? '') === (str(oldRow[i]).length === 5 ? str(oldRow[i]) + ':00' : str(oldRow[i])) : str(v[h]) === str(oldRow[i]))) continue;
    if (old) { add(sheet, row, '記錄編號', '已保存的到訪不可覆寫。請在新行補充或更正，保留舊行。'); continue; }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) add(sheet, row, '到訪時間', '請填 HH:mm 或留空，不會推測時間。');
    const occurredAt = day ? time ? `${day}T${time.length === 5 ? time + ':00' : time}+08:00` : day : undefined;
    if (!occurredAt || !optional(v['工作員'])) { add(sheet, row, '日期／工作員', '到訪日期與工作員必填。'); continue; }
    const floorLabel = optional(v['樓層']), unitLabel = optional(v['單位']);
    const floors = incoming.floors.filter(f => f.buildingId === buildingId && (f.id === floorLabel || f.label === floorLabel));
    const units = incoming.units.filter(u => u.buildingId === buildingId && (u.id === unitLabel || u.label === unitLabel) && (!floorLabel || u.floorId === floors[0]?.id));
    if ((floorLabel && floors.length !== 1) || (unitLabel && units.length !== 1)) { add(sheet, row, '樓層／單位', '位置未能唯一對應。請用已有樓層及完整單位標籤；未知位置可留空並保留在原話欄。'); continue; }
    const coverage = enumValue(v['覆蓋結果'], coverageLabels, sheet, row, '覆蓋結果', acceptedCoverage);
    if (!coverage) add(sheet, row, '覆蓋結果', '請明確選擇；資料不足可選「暫無可靠記錄」，不能以空白代表無發現。');
    const action = optional(v['跟進行動']);
    if (!action && ['跟進類別', '負責人', '確定跟進日期', '時間原話／待確認'].some(k => optional(v[k]))) add(sheet, row, '跟進行動', '已填跟進資料，請寫明要做的行動。');
    const correctsId = optional(v['更正原記錄編號']);
    // Resolve links after every row is read: spreadsheet sorting cannot change validity.
    const visitId = optional(v['外出編號']) ?? `paper-visit:${encodeURIComponent(paperRef ?? id)}`;
    const observation: Observation = { ...flags, id, visitId, buildingId, floorId: units[0]?.floorId ?? floors[0]?.id, unitId: units[0]?.id, occurredAt, recordedAt: now, workerName: str(v['工作員']).trim(), coverage: coverage ?? 'UNKNOWN',
      contactOutcome: enumValue(v['接觸結果'], contactLabels, sheet, row, '接觸結果', acceptedContact), assessment: enumValue(v['住房判斷'], assessmentLabels, sheet, row, '住房判斷', acceptedAssessment), sourceType: enumValue(v['資料來源'], sourceLabels, sheet, row, '資料來源', acceptedSource), note: optional(v['紙本原話／備註']), evidence: str(v['依據']).split('\n').map(s => s.trim()).filter(Boolean),
      paperRef, paperLine, importSource: { file, sheet, row }, resolvesObservationId: optional(v['結束跟進編號']),
      correctsObservationId: correctsId, correctionReason: optional(v['更正原因']),
      followUp: action ? { action, status: 'OPEN', category: enumValue(v['跟進類別'], supportCategoryLabels, sheet, row, '跟進類別'), assignee: optional(v['負責人']), dueDate, timingNote: optional(v['時間原話／待確認']) } : undefined };
    incoming.observations.push(observation);
    if (!incoming.visits.some(visit => visit.id === visitId)) incoming.visits.push({ ...flags, id: visitId, occurredAt, recordedAt: now, workerName: observation.workerName, note: paperRef ? `紙本 ${paperRef}` : undefined });
  }
  // Two live corrections for one original cannot be ordered by time; a human must pick one.
  for (const conflict of getCorrectionConflicts(incoming)) add('紙本回錄', undefined, '更正原記錄編號', `記錄 ${conflict.observationId} 同時被 ${conflict.correctionIds.join('、')} 更正，無法判斷哪一條生效；請只保留一條再匯入。`);
  // The follow-up sheet is a derived view, not a second write surface.
  const tasks = read('待跟進', referenceSheets.find(s => s.name === '待跟進')!.headers);
  const taskSpec = referenceSheets.find(s => s.name === '待跟進')!;
  if (!same(tasks.map(r => taskSpec.headers.map(h => r.values[h])), taskSpec.rows)) add('待跟進', undefined, '', '此頁是參考清單，修改不會套用；請在紙本回錄新增結果。', 'warning');
  const counts = { Buildings: incoming.buildings.length, People: incoming.people.length, Units: incoming.units.length, Observations: incoming.observations.length };
  if (issues.some(i => i.severity === 'error')) return { issues, counts, baseline };
  try { return { snapshot: validateSnapshot(incoming), baseline, issues, counts }; }
  catch (error) { add('資料關聯', undefined, '', error instanceof Error ? error.message : '資料關聯未通過。'); return { issues, counts, baseline }; }
}
