import { effectiveObservations, getCoverageSummary, getOpenFollowUps, type OutreachSnapshot, type Observation } from '../domain/types';
import { exportAssessmentLabels, exportContactLabels, exportCoverageLabels, exportSourceLabels, followUpEventLabels, supportCategoryLabels } from '../domain/presentation';

export const WORKFLOW_VERSION = 'careflow-paper-excel-v1';
/*
 * The workbook is a round-trip format: a changed spelling would be read back as a
 * different value. So the sheets keep the paper wording from presentation.ts rather
 * than the on-screen wording, and this file never redefines a label of its own.
 *
 * One column stays outside that rule on purpose. A follow-up with no category shows
 * as an unclassified badge in the product, but the 待跟進 sheet still prints 一般跟進
 * in its 跟進類別 cell: that sheet is compared byte for byte against hand-maintained
 * layout templates (`public/demo/careflow-paper-excel-mock.xlsx` and its archived
 * copy), which have no generator and must not be rewritten by a script. Do not
 * "fix" this to match the badge without also rebuilding both templates by hand.
 *
 * The dropdowns are a second deliberate difference. The entry form offers three
 * choices per field (COLOR_PIPELINE_DESIGN §10), but the 紙本回錄 sheet keeps all seven
 * coverage wordings: it mirrors the printed form, it is the transcription surface for
 * paper that was already filled in by hand, and the pipeline still tells a partial
 * visit from a failed one. Shrinking the list would put our own exported cells outside
 * their own dropdown. The form is what was simplified, not the record.
 */
export const coverageLabels = exportCoverageLabels;
export const contactLabels = exportContactLabels;
export const assessmentLabels = exportAssessmentLabels;
export const sourceLabels = exportSourceLabels;
export const membershipLabels = { UNKNOWN: '未核實', PENDING: '待處理', ACTIVE: '有效', INACTIVE: '非有效' };
export type Cell = string | number | boolean | null;
export interface WorkflowSheet { name: string; note: string; headers: string[]; rows: Cell[][]; widths: number[]; editable?: string[]; choices?: Record<string, string[]>; dates?: string[]; }
/** A reading view of tasks closed or reopened in the app. The data itself travels in 關聯封存. */
export const followUpEventHeaders = ['處理時間', '操作人', '處理', '原因', '原記錄編號', '大廈', '樓層／單位', '跟進行動'];
export const buildingHeaders = ['大廈編號', '大廈名稱', '地址', '樓層單位摘要', '覆蓋概況', '最近到訪', '待跟進數', '經度', '緯度'];
export const personHeaders = ['個人編號', '姓名／稱呼', '電話', '住址原文', '接觸備註', '會員狀態（參考）', '家庭編號（參考）'];
export const paperHeaders = ['記錄編號', '紙本編號', '紙本行號', '外出編號', '到訪日期', '到訪時間', '工作員', '大廈編號', '樓層', '單位', '覆蓋結果', '接觸結果', '住房判斷', '紙本原話／備註', '依據', '資料來源', '跟進類別', '跟進行動', '負責人', '確定跟進日期', '時間原話／待確認', '結束跟進編號', '更正原記錄編號', '更正原因'];
/** Added after v1 shipped, so older exports stay importable: absent means "not a correction". */
export const optionalPaperHeaders = ['更正原記錄編號', '更正原因'];
export function hkParts(value: string): [string, string] {
  if (value.length === 10) return [value, ''];
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}:${p.second}`];
}
export function excelDate(day: string): number { return (Date.parse(`${day}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000; }
export function observationRow(snapshot: OutreachSnapshot, o: Observation): Cell[] {
  const [date, time] = hkParts(o.occurredAt);
  return [o.id, o.paperRef ?? '', o.paperLine ?? '', o.visitId, excelDate(date), time, o.workerName, o.buildingId,
    snapshot.floors.find(f => f.id === o.floorId)?.label ?? '', snapshot.units.find(u => u.id === o.unitId)?.label ?? '',
    coverageLabels[o.coverage], o.contactOutcome ? contactLabels[o.contactOutcome] : '', o.assessment ? assessmentLabels[o.assessment] : '',
    o.note ?? '', o.evidence.join('\n'), o.sourceType ? sourceLabels[o.sourceType] : '',
    o.followUp?.category ? supportCategoryLabels[o.followUp.category] : '', o.followUp?.action ?? '', o.followUp?.assignee ?? '',
    o.followUp?.dueDate ? excelDate(o.followUp.dueDate) : '', o.followUp?.timingNote ?? '', o.resolvesObservationId ?? '',
    o.correctsObservationId ?? '', o.correctionReason ?? ''];
}
export function workflowSheets(snapshot: OutreachSnapshot): WorkflowSheet[] {
  const followUps = getOpenFollowUps(snapshot);
  const effective = effectiveObservations(snapshot);
  const json = JSON.stringify(snapshot);
  return [
    { name: '使用說明', note: '紙本外展與中心回錄。此檔為自訂 mock 格式，並非機構原表。', headers: ['項目', '內容'], widths: [24, 110], rows: [
      ['格式', WORKFLOW_VERSION], ['合成資料', 'true'], ['外出前', '在工作台選擇大廈，列印一廈一張紙本；一次外出可以填多張。'],
      ['回中心', '在「紙本回錄」末尾新增行。填紙本編號、紙本行號、到訪日期、工作員及大廈編號；不確定的時間留空。'],
      ['個人與大廈', '個人名冊一人一行，大廈總表一廈一行。姓名、電話或同址不會用來自動合併個人。'],
      ['穩定編號', '既有編號不要更改。新增紙本記錄可留空記錄編號，由紙本編號＋行號＋大廈編號產生穩定編號。'],
      ['歷史更正', '已保存的到訪行不可覆寫。更正請新增一行，在「更正原記錄編號」填上要更正的原記錄編號，並寫明更正原因；原行保留。更正生效後以新行的日期與結果為準，原行不再計入覆蓋，但仍留在歷史。'],
      ['跟進結束', '新增一次結果，將要結束的原記錄編號填入「結束跟進編號」。原跟進歷史仍保留。毋須再訪的，可在工作台按「標記完成」或「取消跟進」，記錄見「跟進處理」頁。'],
      ['日期與來源', '日期用 Excel 日期；時間可留空。「明年二月」「翌日午後」留在時間原話欄，未確認前不換算期限。'],
      ['匯入', '先核對新增、重複、更新及衝突，再合併。刪掉 Excel 行不會刪掉本機資料。'],
      ['參考欄', '大廈摘要、會員狀態與家庭編號是參考。請勿用它們覆寫明細；修改會在匯入時提示。'],
      ['關聯封存', '最後一頁保存樓層、單位、家庭、會員及歷史關聯，用於完整匯出和衝突核對；請保留原樣。'],
      ['依據', 'Master 資料包 S25、01_MASTER_CONTEXT §4.4–5；mock/person_view、building_view、visit_paper_view。精確原始表頭、顏色與唯一鍵仍待機構提供。'],
      ['新情境', '住屋變動、健康關懷、服務邀約為暫擬分類。轉錄有雜音；不從原話推定診斷、搬遷日期或法規結論。'],
    ] },
    { name: '大廈總表', note: '一幢大廈一行；摘要由回錄明細計算，不能代表整幢已完成。', headers: buildingHeaders, widths: [24, 18, 38, 42, 25, 18, 14, 20, 20], editable: ['大廈名稱', '地址', '經度', '緯度'], dates: ['最近到訪'], rows: snapshot.buildings.map(b => {
      const summary = getCoverageSummary(snapshot, b.id);
      const dates = effective.filter(o => o.buildingId === b.id).map(o => o.occurredAt).sort((a, b) => Date.parse(b) - Date.parse(a));
      return [b.id, b.name, b.address, b.layoutDeclared ? snapshot.floors.filter(f => f.buildingId === b.id).map(f => `${f.label}：${snapshot.units.filter(u => u.floorId === f.id).map(u => u.label).join('、')}`).join('\n') : '樓層／單位未核實', coverageLabels[summary.status], dates[0] ? excelDate(hkParts(dates[0])[0]) : '', summary.followUps, b.coordinates.lng, b.coordinates.lat];
    }) },
    { name: '個人名冊', note: '一人一行。電話以文字保存；相同姓名或電話不代表同一人。', headers: personHeaders, widths: [24, 22, 20, 44, 50, 24, 28], editable: personHeaders.slice(1, 5), rows: snapshot.people.map(p => {
      const households = snapshot.householdMemberships.filter(h => h.personId === p.id).map(h => h.householdId);
      const addresses = snapshot.householdResidences.filter(r => households.includes(r.householdId) && !r.endsOn).map(r => `${snapshot.buildings.find(b => b.id === r.buildingId)?.address ?? r.buildingId} ${snapshot.units.find(u => u.id === r.unitId)?.label ?? ''}`);
      const membership = snapshot.memberships.filter(m => m.personId === p.id).at(-1);
      return [p.id, p.displayName, p.phone ?? '', p.addressNote ?? addresses.join('\n'), p.contactNote ?? '', membershipLabels[membership?.status ?? 'UNKNOWN'], households.join('、')];
    }) },
    { name: '紙本回錄', note: '每行是一處的本次記錄；新增行回錄，既有行保留。更正請新增行並填「更正原記錄編號」。日期必填，時間未知可留空。', headers: paperHeaders, widths: [29, 21, 13, 28, 16, 15, 20, 23, 13, 17, 25, 20, 23, 62, 45, 22, 19, 48, 20, 20, 48, 30, 29, 40], editable: paperHeaders, dates: ['到訪日期', '確定跟進日期'], choices: { '覆蓋結果': Object.values(coverageLabels), '接觸結果': Object.values(contactLabels), '住房判斷': Object.values(assessmentLabels), '資料來源': Object.values(sourceLabels), '跟進類別': Object.values(supportCategoryLabels), '大廈編號': snapshot.buildings.map(b => b.id) }, rows: snapshot.observations.map(o => observationRow(snapshot, o)) },
    { name: '待跟進', note: '由未結束跟進產生的閱讀清單；結果請新增到紙本回錄，再填結束跟進編號。', headers: ['原記錄編號', '大廈', '樓層／單位', '跟進類別', '跟進行動', '負責人', '確定日期', '時間原話／待確認'], widths: [29, 18, 20, 19, 58, 20, 18, 48], dates: ['確定日期'], rows: followUps.map(f => { const o = snapshot.observations.find(o => o.id === f.observationId)!; return [o.id, snapshot.buildings.find(b => b.id === f.buildingId)?.name ?? f.buildingId, snapshot.units.find(u => u.id === f.unitId)?.label ?? snapshot.floors.find(l => l.id === f.floorId)?.label ?? '大廈層面', o.followUp?.category ? supportCategoryLabels[o.followUp.category] : '一般跟進', f.action, o.followUp?.assignee ?? '', f.dueDate ? excelDate(f.dueDate) : '', o.followUp?.timingNote ?? '']; }) },
    { name: '跟進處理', note: '在工作台按「標記完成」「取消跟進」「撤銷」的記錄，只供閱讀；修改不會套用。操作人是登入帳號，不是紙本工作員。', headers: followUpEventHeaders, widths: [22, 18, 12, 40, 29, 18, 20, 58], rows: (snapshot.followUpEvents ?? []).map(e => {
      const o = snapshot.observations.find(o => o.id === e.observationId);
      const [day, time] = hkParts(e.at);
      return [`${day} ${time}`, e.operator.name, followUpEventLabels[e.action], e.reason ?? '', e.observationId, snapshot.buildings.find(b => b.id === o?.buildingId)?.name ?? o?.buildingId ?? '', snapshot.units.find(u => u.id === o?.unitId)?.label ?? snapshot.floors.find(l => l.id === o?.floorId)?.label ?? '大廈層面', o?.followUp?.action ?? ''];
    }) },
    { name: '關聯封存', note: '完整資料與版本核對用，請保留原樣。工作員請使用前面的中文工作表。', headers: ['分段', '資料'], widths: [12, 100], rows: Array.from({ length: Math.ceil(json.length / 25000) }, (_, i) => [i + 1, json.slice(i * 25000, (i + 1) * 25000)]) },
  ];
}
