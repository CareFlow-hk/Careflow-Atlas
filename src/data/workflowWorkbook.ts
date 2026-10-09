import * as XLSX from 'xlsx';
import { readWorkbook } from './readWorkbook';
import { validateSnapshot, occurrenceSchema } from '../domain/schema';
import { type Observation, type OutreachSnapshot } from '../domain/types';
import { alignDemoSnapshot } from './demoGeometry';
import { isUndeclaredLayout, parseLayoutSummary } from './layoutSummary';
import { WORKFLOW_VERSION, hkParts, assessmentLabels, buildingHeaders, contactLabels, coverageLabels, observationRow, optionalPaperHeaders, paperHeaders, personHeaders, sourceLabels, workflowSheets } from './workflowFormat';
import { getCorrectionConflicts, getOpenFollowUps } from '../domain/types';
import { issue, placeLabel, schemaIssues } from './issueText';
import { acceptedAssessment, acceptedContact, acceptedCoverage, acceptedSource, supportCategoryLabels } from '../domain/presentation';
import type { WorkbookImportIssue } from './workbookImport';

/** A floor/unit layout this file declares for a building that had none, shown for confirmation before merge. */
export interface DeclaredLayout { buildingId: string; name: string; floors: number; units: number; }
export interface WorkflowImport { snapshot?: OutreachSnapshot; baseline?: OutreachSnapshot; issues: WorkbookImportIssue[]; counts: Record<string, number>; layouts?: DeclaredLayout[]; }
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
  // `message` is for the person fixing the sheet; `detail` is for us (see issueText.ts).
  const add = (sheet: string, row: number | undefined, field: string, code: string, message: string, detail?: string, severity: 'error' | 'warning' = 'error') =>
    issues.push(issue({ sheet, row, field, code, message, detail, severity }));
  const known = ['使用說明', '大廈總表', '個人名冊', '紙本回錄', '待跟進', '跟進處理', '關聯封存'];
  for (const name of workbook.SheetNames) if (!known.includes(name)) add(name, undefined, '', 'UNKNOWN_SHEET', `「${name}」不是範本的工作表。請把這一頁搬到另一個 Excel 檔，再匯入。`, `sheets=${workbook.SheetNames.join(',')}`);
  const read = (name: string, headers: string[], optionalHeaders: string[] = []) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) { add(name, undefined, '', 'MISSING_SHEET', `少了「${name}」這一頁。請重新「匯出目前 Excel」，在新檔上填寫。`); return []; }
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
    const heading = matrix.findIndex(row => row[0] === headers[0]);
    if (heading < 0 || heading > 20) { add(name, undefined, headers[0], 'HEADER_NOT_FOUND', `「${name}」頁找不到表頭（第一欄應是「${headers[0]}」）。請不要刪除或移動表頭那一行。`, 'searched first 21 rows, column A'); return []; }
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    const actual = Array.from({ length: width }, (_, col) => String(matrix[heading][col] ?? ''));
    const missing = headers.filter(h => !actual.includes(h) && !optionalHeaders.includes(h));
    // One renamed header would otherwise flag every row below it; report the header and stop.
    for (const h of missing) add(name, heading + 1, h, 'MISSING_COLUMN', `「${name}」頁少了「${h}」這一欄。可能欄名被改了或整欄被刪了，請改回原來的欄名。`, `headers=${actual.filter(Boolean).join('|')}`);
    if (new Set(actual.filter(Boolean)).size !== actual.filter(Boolean).length) add(name, heading + 1, '', 'DUPLICATE_COLUMN', `「${name}」頁有兩欄名稱相同。請刪除重複的那一欄。`, `headers=${actual.filter(Boolean).join('|')}`);
    if (missing.length) return [];
    const stray = new Map<number, number[]>();
    const rows = matrix.slice(heading + 1).map((values, index) => {
      const row = heading + index + 2;
      actual.forEach((h, col) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: col })];
        if (cell?.f) add(name, row, h, 'FORMULA', '這格用了公式。請改為直接填寫內容（複製後「只貼上值」）。', `=${cell.f}`);
        if (values[col] !== '' && values[col] != null && !headers.includes(h)) stray.set(col, [...(stray.get(col) ?? []), row]);
      });
      return { row, values: Object.fromEntries(headers.map(h => [h, values[actual.indexOf(h)] ?? ''])) };
    }).filter(item => Object.values(item.values).some(v => v !== '' && v != null));
    for (const [col, at] of stray) {
      const label = actual[col] || `第 ${col + 1} 欄`;
      add(name, at[0], label, 'UNKNOWN_COLUMN', `「${label}」不是範本的欄位，但${at.length > 1 ? `第 ${at[0]}–${at.at(-1)} 行共 ${at.length} 格` : `第 ${at[0]} 行`}有內容。請把這些內容搬到另一個檔案，或刪除這一欄。`, `column=${XLSX.utils.encode_col(col)} rows=${at.slice(0, 20).join(',')}${at.length > 20 ? '…' : ''}`);
    }
    return rows;
  };
  const instructions = read('使用說明', ['項目', '內容']);
  const formatCell = instructions.find(r => r.values['項目'] === '格式')?.values['內容'], syntheticCell = instructions.find(r => r.values['項目'] === '合成資料')?.values['內容'];
  if (formatCell !== WORKFLOW_VERSION || syntheticCell !== 'true') add('使用說明', undefined, '格式', 'NOT_ATLAS_TEMPLATE', '這不是從 CareFlow Atlas 匯出的範本，或「使用說明」頁被改過。請用「匯出目前 Excel」得到的檔案填寫。', `格式=${String(formatCell)} 合成資料=${String(syntheticCell)} expected=${WORKFLOW_VERSION}/true`);
  const archive = read('關聯封存', ['分段', '資料']);
  let baseline: OutreachSnapshot;
  try {
    if (!archive.length || archive.some((r, i) => Number(r.values['分段']) !== i + 1)) throw new Error(`segments=${archive.map(r => r.values['分段']).join(',') || 'none'}`);
    baseline = alignDemoSnapshot(validateSnapshot(JSON.parse(archive.map(r => r.values['資料']).join(''))));
  } catch (error) { add('關聯封存', undefined, '', 'ARCHIVE_BROKEN', '最後一頁「關聯封存」被改動或刪減了。這一頁不用填寫：請重新「匯出目前 Excel」，把新填的行抄到新檔再匯入。', error instanceof Error ? error.message.slice(0, 300) : String(error)); return { issues, counts: {} }; }
  const incoming = structuredClone(baseline);
  const referenceSheets = workflowSheets(baseline);
  const str = (value: unknown) => value == null ? '' : String(value);
  const optional = (value: unknown) => str(value).trim() || undefined;
  // `accepted` carries every wording this product has ever written for the field, so a
  // sheet filled in before the options were simplified still imports as the same value.
  // The message lists the dropdown wording, which is what the person sees in the sheet.
  const enumValue = <T extends string>(value: unknown, labels: Record<T, string>, sheet: string, row: number, field: string, accepted: Record<string, T> = {}): T | undefined => {
    const raw = optional(value);
    if (!raw) return undefined;
    const key = (Object.keys(labels) as T[]).find(k => labels[k] === raw || k === raw) ?? accepted[raw as string];
    if (!key) add(sheet, row, field, 'INVALID_OPTION', `「${raw}」不是「${field}」可選的寫法。請用下拉選單選擇：${Object.values(labels).join('、')}。`, `value=${JSON.stringify(raw)}`);
    return key;
  };
  const pad = (n: string | number) => String(n).padStart(2, '0');
  const date = (value: unknown, sheet: string, row: number, field: string): string | undefined => {
    if (!optional(value)) return undefined;
    let day = str(value).trim();
    if (typeof value === 'number') { const parsed = XLSX.SSF.parse_date_code(value, { date1904: !!workbook.Workbook?.WBProps?.date1904 }); day = parsed ? `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}` : ''; }
    // Year first is unambiguous; 9/10/2026 could be either day order, so it is not guessed.
    const loose = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(day);
    if (loose) day = `${loose[1]}-${pad(loose[2])}-${pad(loose[3])}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !occurrenceSchema.safeParse(day).success) {
      add(sheet, row, field, 'INVALID_DATE', `「${str(value).trim()}」看不懂是哪一天。請用 Excel 日期，或寫成 2026-10-09（也接受 2026/10/09）。「下星期」「翌日」這類講法請寫在「時間原話／待確認」。`, `type=${typeof value} value=${JSON.stringify(value)}`);
      return undefined;
    }
    return day;
  };
  const setRecord = <T extends { id: string }>(list: T[], item: T) => { const index = list.findIndex(r => r.id === item.id); if (index < 0) list.push(item); else list[index] = item; };
  const layouts: DeclaredLayout[] = [];
  for (const [name, headers, key] of [['大廈總表', buildingHeaders, 'buildings'], ['個人名冊', personHeaders, 'people']] as const) {
    const seen = new Map<string, number>();
    const spec = referenceSheets.find(s => s.name === name)!;
    const noun = key === 'buildings' ? '大廈' : '個人';
    for (const { row, values: v } of read(name, headers)) {
      const id = optional(v[headers[0]]);
      if (!id) { add(name, row, headers[0], 'MISSING_ID', `未填${headers[0]}。每一行都要有自己的編號，新增的${noun}可以自訂，例如 ${key === 'buildings' ? 'SYP-001' : 'P-001'}。`); continue; }
      if (seen.has(id)) { add(name, row, headers[0], 'DUPLICATE_ID', `${headers[0]}「${id}」在第 ${seen.get(id)} 行已經用過。每個${noun}的編號不能重複。`); continue; }
      seen.set(id, row);
      const original = baseline[key].find(p => p.id === id);
      const previousRow = spec.rows.find(r => r[0] === id);
      // A building with no floors yet may declare them in 樓層單位摘要; every other summary cell stays read-only.
      const layoutOpen = key === 'buildings' && !baseline.floors.some(f => f.buildingId === id);
      const reference = (h: string) => !spec.editable?.includes(h) && !(layoutOpen && h === '樓層單位摘要');
      if (original && previousRow) headers.forEach((h, i) => { if (i && reference(h) && str(v[h]) !== str(previousRow[i])) add(name, row, h, 'REFERENCE_EDITED', `「${h}」由系統計算或只供參考，這裡的修改不會套用。${key === 'buildings' ? '到訪結果請在「紙本回錄」新增一行。' : ''}`, `was=${JSON.stringify(previousRow[i])} now=${JSON.stringify(v[h])}`, 'warning'); });
      if (!original) headers.forEach((h, i) => { if (i && reference(h) && optional(v[h])) add(name, row, h, 'REFERENCE_FILLED', `「${h}」由系統計算或只供參考，新增時填寫的內容不會套用，可以留空。`, `value=${JSON.stringify(v[h])}`, 'warning'); });
      if (key === 'buildings') {
        const b = baseline.buildings.find(b => b.id === id);
        const lng = Number(v['經度']), lat = Number(v['緯度']);
        const lacking = [!optional(v['大廈名稱']) && '大廈名稱', !optional(v['地址']) && '地址', (v['經度'] === '' || !Number.isFinite(lng)) && '經度', (v['緯度'] === '' || !Number.isFinite(lat)) && '緯度'].filter(Boolean);
        if (lacking.length) { add(name, row, lacking.join('／'), 'BUILDING_INCOMPLETE', `未填${lacking.join('、')}。新增大廈要有名稱、地址和座標；座標可在 Google 地圖右鍵複製（注意前面是緯度、後面是經度）。`, `經度=${JSON.stringify(v['經度'])} 緯度=${JSON.stringify(v['緯度'])}`); continue; }
        if (b?.footprint && (lng !== b.coordinates.lng || lat !== b.coordinates.lat)) { add(name, row, '經度／緯度', 'FOOTPRINT_MOVED', `「${b.name}」在地圖上已有形狀，不能只改座標。請把經度、緯度改回原來的數字；如果位置或形狀不對，請在地圖上選這幢大廈，用「調整大廈形狀」修改。`, `was=${b.coordinates.lng},${b.coordinates.lat} now=${lng},${lat}`); continue; }
        const building = { ...(b ?? { ...flags, layoutDeclared: false }), id, name: str(v['大廈名稱']).trim(), address: str(v['地址']).trim(), coordinates: { lng, lat } };
        const summary = str(v['樓層單位摘要']);
        if (layoutOpen && !isUndeclaredLayout(summary)) {
          const layout = parseLayoutSummary(id, summary);
          if ('error' in layout) { add(name, row, '樓層單位摘要', 'LAYOUT_UNREADABLE', `樓層單位摘要看不懂：${layout.error}`, `value=${JSON.stringify(summary.slice(0, 200))}`); continue; }
          const taken = [...layout.floors.filter(f => incoming.floors.some(x => x.id === f.id)), ...layout.units.filter(u => incoming.units.some(x => x.id === u.id))];
          if (taken.length) { add(name, row, '樓層單位摘要', 'LAYOUT_ID_TAKEN', '這個大廈編號和其他大廈的樓層編號撞了。請把大廈編號改成另一個（例如加上街名縮寫）。', `taken=${taken[0].id}`); continue; }
          if (layout.floors.length) {
            incoming.floors.push(...layout.floors); incoming.units.push(...layout.units);
            Object.assign(building, { layoutDeclared: true, floorCount: layout.floors.length });
            layouts.push({ buildingId: id, name: building.name, floors: layout.floors.length, units: layout.units.length });
          }
        }
        setRecord(incoming.buildings, building);
      } else {
        const p = baseline.people.find(p => p.id === id);
        if (typeof v['電話'] === 'number') { add(name, row, '電話', 'PHONE_AS_NUMBER', `電話「${v['電話']}」被 Excel 當成數字，開頭的 0 或空格可能已經不見了。請把這一格設成「文字」格式，再重新輸入電話。`, `number=${v['電話']}`); continue; }
        if (!optional(v['姓名／稱呼'])) { add(name, row, '姓名／稱呼', 'MISSING_NAME', '未填姓名或稱呼。可以只寫稱呼，例如「黃伯」。'); continue; }
        setRecord(incoming.people, { ...(p ?? flags), id, displayName: str(v['姓名／稱呼']).trim(), phone: optional(v['電話']), contactNote: optional(v['接觸備註']), addressNote: previousRow && str(v['住址原文']) === str(previousRow[3]) ? p?.addressNote : optional(v['住址原文']) });
      }
    }
  }
  const sheet = '紙本回錄';
  const seen = new Map<string, number>();
  // Location labels match exactly first; failing that, ignoring case and spaces, but only when that is unique.
  const loose = (text: string) => text.replace(/\s+/g, '').toLowerCase();
  const pick = <T extends { id: string; label: string }>(items: T[], label: string) => {
    const exact = items.filter(item => item.id === label || item.label === label);
    return exact.length ? exact : items.filter(item => loose(item.label) === loose(label));
  };
  for (const { row, values: v } of read(sheet, paperHeaders, optionalPaperHeaders)) {
    const buildingId = optional(v['大廈編號']);
    const paperRef = optional(v['紙本編號']), paperLine = optional(v['紙本行號']);
    const id = optional(v['記錄編號']) ?? (paperRef && paperLine && buildingId ? `paper:${encodeURIComponent(paperRef)}:${encodeURIComponent(paperLine)}:${buildingId}` : undefined);
    if (!id) {
      const lacking = [!paperRef && '紙本編號', !paperLine && '紙本行號', !buildingId && '大廈編號'].filter(Boolean);
      add(sheet, row, lacking.join('／'), 'MISSING_PAPER_KEY', `未填${lacking.join('、')}。新加的行要寫明是哪張紙、第幾行、哪幢大廈，系統才能分辨，避免重複錄入。`); continue;
    }
    if (seen.has(id)) {
      add(sheet, row, paperRef ? '紙本編號／紙本行號' : '記錄編號', 'DUPLICATE_PAPER_LINE', paperRef ? `紙本「${paperRef}」第 ${paperLine} 行在第 ${seen.get(id)} 行已經錄入過。同一張紙的行號不能重複；如果是另一張紙，請改紙本編號。` : `記錄編號在第 ${seen.get(id)} 行已經出現過，同一個編號不能用兩次。`, `id=${id}`); continue;
    }
    seen.set(id, row);
    if (!incoming.buildings.some(b => b.id === buildingId)) {
      const byName = incoming.buildings.find(b => b.name === buildingId);
      add(sheet, row, '大廈編號', 'UNKNOWN_BUILDING', byName ? `這裡要填大廈編號，不是大廈名稱。「${byName.name}」的編號是 ${byName.id}。` : `大廈編號「${buildingId}」不在「大廈總表」裡。請從大廈總表複製編號；如果是新大廈，請先在大廈總表加一行。`, `value=${JSON.stringify(buildingId)}`); continue;
    }
    const buildingName = incoming.buildings.find(b => b.id === buildingId)!.name;
    const old = baseline.observations.find(o => o.id === id);
    const day = date(v['到訪日期'], sheet, row, '到訪日期');
    const dueDate = date(v['確定跟進日期'], sheet, row, '確定跟進日期');
    let time = optional(v['到訪時間']);
    if (typeof v['到訪時間'] === 'number' && v['到訪時間'] >= 0 && v['到訪時間'] < 1) { const seconds = Math.round(v['到訪時間'] * 86400); time = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`; }
    // Untouched history is reused verbatim, including precise timestamps and provenance.
    const oldRow = old ? observationRow(baseline, old) : undefined;
    const sameCell = (h: string, i: number) => h === '到訪日期' ? day === hkParts(old!.occurredAt)[0] : h === '確定跟進日期' ? dueDate === old!.followUp?.dueDate : h === '到訪時間' ? (time?.length === 5 ? time + ':00' : time ?? '') === (str(oldRow![i]).length === 5 ? str(oldRow![i]) + ':00' : str(oldRow![i])) : str(v[h]) === str(oldRow![i]);
    if (oldRow && paperHeaders.every(sameCell)) continue;
    if (old) {
      const changed = paperHeaders.filter((h, i) => !sameCell(h, i));
      add(sheet, row, changed.join('／'), 'HISTORY_EDITED', `這是之前已經錄入的記錄，「${changed.join('」「')}」被改動了。舊記錄不能直接改：請把這一行改回原樣，然後在最底新增一行，「更正原記錄編號」填 ${id}，並寫上更正原因。`, changed.map(h => `${h}: ${JSON.stringify(oldRow![paperHeaders.indexOf(h)])} → ${JSON.stringify(v[h])}`).join('; ')); continue;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) add(sheet, row, '到訪時間', 'INVALID_TIME', `「${time}」看不懂。請寫成 24 小時制，例如 19:05；不知道時間就留空，系統不會估。`, `value=${JSON.stringify(v['到訪時間'])}`);
    const occurredAt = day ? time ? `${day}T${time.length === 5 ? time + ':00' : time}+08:00` : day : undefined;
    // A date that was written but unreadable has already been explained above.
    if (!optional(v['到訪日期'])) add(sheet, row, '到訪日期', 'MISSING_DATE', '未填到訪日期。');
    if (!optional(v['工作員'])) add(sheet, row, '工作員', 'MISSING_WORKER', '未填工作員（紙本上落樓的同事，不是入 Excel 的人）。');
    if (!occurredAt || !optional(v['工作員'])) continue;
    const floorLabel = optional(v['樓層']), unitLabel = optional(v['單位']);
    const buildingFloors = incoming.floors.filter(f => f.buildingId === buildingId);
    const floors = floorLabel ? pick(buildingFloors, floorLabel) : [];
    const units = unitLabel ? pick(incoming.units.filter(u => u.buildingId === buildingId && (!floorLabel || u.floorId === floors[0]?.id)), unitLabel) : [];
    if ((floorLabel && floors.length !== 1) || (unitLabel && units.length !== 1)) {
      const example = buildingFloors[0] ? `${buildingFloors[0].label}／${incoming.units.find(u => u.floorId === buildingFloors[0].id)?.label ?? ''}` : '';
      add(sheet, row, '樓層／單位', 'UNKNOWN_LOCATION', !buildingFloors.length ? `「${buildingName}」未設定樓層和單位，只能記錄整幢：請把樓層和單位留空，位置寫在原話欄。（可在大廈總表的「樓層單位摘要」為它設定樓層）` : `在「${buildingName}」找不到${[floorLabel && `樓層「${floorLabel}」`, unitLabel && `單位「${unitLabel}」`].filter(Boolean).join('、')}。請照「大廈總表 › 樓層單位摘要」的寫法，例如「${example}」。不肯定位置可以兩格都留空，寫在原話欄。`, `floor=${JSON.stringify(floorLabel)} unit=${JSON.stringify(unitLabel)} floorMatches=${floors.length} unitMatches=${units.length}`); continue;
    }
    // Floors keep no record of their own: a floor's colour is only the sum of its units.
    if (floorLabel && !unitLabel) { add(sheet, row, '單位', 'FLOOR_WITHOUT_UNIT', `只填了樓層「${floorLabel}」，未填單位。請補上單位；如果是整幢的記錄，樓層也要留空。`); continue; }
    const coverage = enumValue(v['覆蓋結果'], coverageLabels, sheet, row, '覆蓋結果', acceptedCoverage);
    if (!optional(v['覆蓋結果'])) add(sheet, row, '覆蓋結果', 'MISSING_COVERAGE', '未選覆蓋結果。資料不足可選「暫無可靠記錄」，不能留空。');
    const action = optional(v['跟進行動']);
    const followUpBits = ['跟進類別', '負責人', '確定跟進日期', '時間原話／待確認'].filter(k => optional(v[k]));
    if (!action && followUpBits.length) add(sheet, row, '跟進行動', 'MISSING_ACTION', `填了「${followUpBits.join('」「')}」，但沒寫「跟進行動」。請寫明要做什麼，例如「再上門」。`);
    const correctsId = optional(v['更正原記錄編號']);
    // Resolve links after every row is read: spreadsheet sorting cannot change validity.
    const visitId = optional(v['外出編號']) ?? `paper-visit:${encodeURIComponent(paperRef ?? id)}`;
    const observation: Observation = { ...flags, id, visitId, buildingId: buildingId!, floorId: units[0]?.floorId ?? floors[0]?.id, unitId: units[0]?.id, occurredAt, recordedAt: now, workerName: str(v['工作員']).trim(), coverage: coverage ?? 'UNKNOWN',
      contactOutcome: enumValue(v['接觸結果'], contactLabels, sheet, row, '接觸結果', acceptedContact), assessment: enumValue(v['住房判斷'], assessmentLabels, sheet, row, '住房判斷', acceptedAssessment), sourceType: enumValue(v['資料來源'], sourceLabels, sheet, row, '資料來源', acceptedSource), note: optional(v['紙本原話／備註']), evidence: str(v['依據']).split('\n').map(s => s.trim()).filter(Boolean),
      paperRef, paperLine, importSource: { file, sheet, row }, resolvesObservationId: optional(v['結束跟進編號']),
      correctsObservationId: correctsId, correctionReason: optional(v['更正原因']),
      followUp: action ? { action, status: 'OPEN', category: enumValue(v['跟進類別'], supportCategoryLabels, sheet, row, '跟進類別'), assignee: optional(v['負責人']), dueDate, timingNote: optional(v['時間原話／待確認']) } : undefined };
    incoming.observations.push(observation);
    if (!incoming.visits.some(visit => visit.id === visitId)) incoming.visits.push({ ...flags, id: visitId, occurredAt, recordedAt: now, workerName: observation.workerName, note: paperRef ? `紙本 ${paperRef}` : undefined });
  }
  checkResolutions(baseline, incoming, file, add);
  // Two live corrections for one original cannot be ordered by time; a human must pick one.
  const rowOf = (id: string) => incoming.observations.find(o => o.id === id)?.importSource?.row;
  for (const conflict of getCorrectionConflicts(incoming)) {
    const rows = conflict.correctionIds.map(rowOf);
    add(sheet, rows.find(Boolean), '更正原記錄編號', 'CORRECTION_FORK', `同一條舊記錄被${rows.every(Boolean) ? `第 ${rows.join('、')} 行` : '多行'}同時更正，系統無法判斷哪一行才對。請只保留一行。`, `original=${conflict.observationId} corrections=${conflict.correctionIds.join(',')}`);
  }
  // The follow-up sheet is a derived view, not a second write surface.
  const tasks = read('待跟進', referenceSheets.find(s => s.name === '待跟進')!.headers);
  const taskSpec = referenceSheets.find(s => s.name === '待跟進')!;
  if (!same(tasks.map(r => taskSpec.headers.map(h => r.values[h])), taskSpec.rows)) add('待跟進', undefined, '', 'READ_ONLY_SHEET', '「待跟進」頁只供查看，這頁的改動不會套用。跟進結果請在「紙本回錄」新增一行，並填「結束跟進編號」。', undefined, 'warning');
  // 跟進處理 is a reading view like 待跟進; files exported before it existed have none.
  if (workbook.SheetNames.includes('跟進處理')) {
    const eventSpec = referenceSheets.find(s => s.name === '跟進處理')!;
    const events = read('跟進處理', eventSpec.headers);
    if (!same(events.map(r => eventSpec.headers.map(h => r.values[h])), eventSpec.rows)) add('跟進處理', undefined, '', 'READ_ONLY_SHEET', '「跟進處理」頁只供查看，這頁的改動不會套用。完成或取消跟進請在工作台上操作。', undefined, 'warning');
  }
  const counts = { Buildings: incoming.buildings.length, People: incoming.people.length, Units: incoming.units.length, Observations: incoming.observations.length };
  if (issues.some(i => i.severity === 'error')) return { issues, counts, baseline };
  try { return { snapshot: validateSnapshot(incoming), baseline, issues, counts, layouts }; }
  catch (error) { issues.push(...schemaIssues(error, incoming)); return { issues, counts, baseline }; }
}

type Add = (sheet: string, row: number | undefined, field: string, code: string, message: string, detail?: string, severity?: 'error' | 'warning') => void;
/** Explain closing problems in the sheet's words before the schema rejects them. Mirrors schema.ts. */
function checkResolutions(baseline: OutreachSnapshot, incoming: OutreachSnapshot, file: string, add: Add) {
  const fresh = incoming.observations.filter(o => o.importSource?.file === file && !baseline.observations.some(b => b.id === o.id));
  const open = new Set(getOpenFollowUps(baseline).map(task => task.observationId));
  const closedBy = new Map<string, number>();
  for (const o of fresh) {
    const target = o.resolvesObservationId;
    if (!target) continue;
    const row = o.importSource?.row;
    const origin = incoming.observations.find(x => x.id === target);
    const isNew = !!origin && fresh.includes(origin);
    if (!origin) { add('紙本回錄', row, '結束跟進編號', 'CLOSE_UNKNOWN', `結束跟進編號「${target}」找不到。請從「待跟進」頁複製「原記錄編號」，不要自己打。`, `target=${target}`); continue; }
    if (!origin.followUp) { add('紙本回錄', row, '結束跟進編號', 'CLOSE_NOT_A_TASK', '這個編號的記錄沒有跟進事項，不需要結案。請檢查是否抄錯了編號。', `target=${target}`); continue; }
    if (!isNew && !open.has(target)) { add('紙本回錄', row, '結束跟進編號', 'CLOSE_ALREADY_CLOSED', `「${origin.followUp.action}」這個跟進之前已經結案或已被更正，不需要再結一次。`, `target=${target}`); continue; }
    if (origin.buildingId !== o.buildingId || origin.floorId !== o.floorId || origin.unitId !== o.unitId) { add('紙本回錄', row, '樓層／單位', 'CLOSE_WRONG_PLACE', `結案的位置要和原本的跟進一樣：原跟進在「${placeLabel(incoming, origin)}」，這一行寫的是「${placeLabel(incoming, o)}」。`, `target=${target}`); continue; }
    if (closedBy.has(target)) { add('紙本回錄', row, '結束跟進編號', 'CLOSE_TWICE', `同一個跟進在第 ${closedBy.get(target)} 行已經結案，這一行重複了。請刪除其中一行。`, `target=${target}`); continue; }
    closedBy.set(target, row ?? 0);
  }
}
