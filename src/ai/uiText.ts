/** Translate generated explanations at the display boundary, never source text or saved values. */
import { aiCoverageLabels, assessmentLabels, contactLabels, sourceLabels, supportCategoryLabels } from '../domain/presentation';
import { FORMAT_PROFILES } from '../imports/profiles';

const labels: Record<string, string> = {
  ...Object.fromEntries(FORMAT_PROFILES.flatMap(profile => profile.sheet.fields.map(field => [field.key, field.label]))),
  ...aiCoverageLabels, ...assessmentLabels, ...contactLabels, ...sourceLabels, ...supportCategoryLabels,
  UNKNOWN: '未能確定', coverage: '覆蓋結果', assessment: '住房判斷', sourceType: '資料來源', today: '今天',
  buildingId: '大廈', buildingName: '大廈', buildings: '大廈清單', locations: '樓層及單位清單',
  floorLabel: '樓層', unitLabel: '單位', occurredDate: '到訪日期', occurredTime: '到訪時間', workerName: '工作員',
  contactOutcome: '接觸結果', contacts: '接觸結果', assessments: '住房判斷', categories: '跟進類別',
  note: '備註', followUp: '跟進', action: '跟進行動', category: '跟進類別', assignee: '負責人', dueDate: '跟進日期', timingNote: '日期說明',
  missing: '未填內容', warnings: '提醒', status: '處理結果', drafts: '草稿清單',
  MATCH: '已找到對應', NO_MATCH: '未找到對應', REFUSE: '無法處理', DRAFT: '草稿', PATCH: '修改建議', NO_CHANGE: '毋須修改',
  READY: '可以寫入', NEEDS_REVIEW: '需要核對', INVALID: '無法寫入',
  fields: '欄位清單', field: '欄位', key: '欄位名稱', columnIndex: '欄位位置', column: '欄位', columns: '欄位清單',
  confidence: '把握程度', reason: '理由', header: '表頭', headers: '表頭清單', headerRow: '表頭行',
  unmappedColumns: '未對應欄位', sheetName: '工作表名稱', profileId: '表格格式', profileIds: '候選格式',
  patches: '修改清單', explanation: '說明', row: '行', rows: '資料行', value: '內容', values: '內容',
  text: '輸入文字', context: '補充說明', part: '分段', index: '位置', count: '數目', columnCount: '欄數',
  withheldColumns: '未送交 AI 的欄位', omitted: '略過行數', kind: '處理方式', JSON: '資料',
  store: '儲存設定', model: '模型設定', endpoint: '連線設定', schema: '回覆格式', requestId: '請求編號',
};

export const aiUiText = (text: string): string => text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, token => labels[token] ?? token);
