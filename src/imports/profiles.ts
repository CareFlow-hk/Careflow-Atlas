/** Fixed candidate workbook formats for W0 recognition.
 *
 * The scope is deliberately closed — see BACKEND_GAP_ANALYSIS §8.1.2. Only the
 * profiles listed here are recognised; anything else must be refused with a
 * reason rather than guessed at. This module has no browser or DOM dependency
 * so it can be moved into a server directory unchanged.
 */
import { recognitionAssessmentValues, recognitionCategoryValues, recognitionContactValues, recognitionCoverageValues, recognitionSourceValues } from '../domain/presentation';

export const DETECTOR_VERSION = 'careflow-detector-v2';

/** Per-field recognition state. Only KNOWN is safe to fill in automatically. */
export type FieldStatus = 'KNOWN' | 'CANDIDATE' | 'AMBIGUOUS' | 'UNKNOWN';
/** Per-sheet recognition state. */
export type DetectionStatus = 'KNOWN' | 'CANDIDATE' | 'AMBIGUOUS' | 'UNKNOWN';

export type ProfileId =
  | 'careflow-six-sheet' | 'legacy-synthetic'
  | 'one-person-per-row' | 'one-building-per-row' | 'one-visit-per-row';

/** `known` formats have a parser in this repository; `template` formats are guessed and have none. */
export type ProfileKind = 'known' | 'template';

export type CanonicalField =
  | 'recordId' | 'paperRef' | 'paperLine' | 'visitId'
  | 'buildingId' | 'buildingName' | 'address' | 'floor' | 'unit'
  | 'personId' | 'personName' | 'phone' | 'addressNote' | 'contactNote'
  | 'occurredAt' | 'occurredTime' | 'recordedAt' | 'worker' | 'coverage' | 'contactOutcome'
  | 'assessment' | 'sourceType' | 'note' | 'evidence'
  | 'followUpCategory' | 'followUpAction' | 'followUpAssignee' | 'followUpDueDate'
  | 'followUpTimingNote' | 'resolvesObservationId'
  | 'correctsObservationId' | 'correctionReason';

export interface FieldSpec {
  key: CanonicalField;
  label: string;
  /** Header spellings accepted for this field, in any of 繁中／简中／English. */
  aliases: string[];
  required?: boolean;
  kind?: 'text' | 'id' | 'date' | 'time' | 'enum';
  /** Allowed workbook values, used to sanity-check sampled cells. */
  choices?: string[];
}

export interface FormatProfile {
  id: ProfileId;
  label: string;
  kind: ProfileKind;
  description: string;
  /** Sheet names that hint at this format. A hint alone never recognises a sheet. */
  sheetHints: string[];
  /** Minimum number of matched fields before this profile may be reported. */
  minMatchedFields: number;
  /**
   * Sheet names and header sets. A profile matches on a single sheet, so the two
   * multi-sheet repository formats list the sheet that carries the business rows.
   */
  sheet: { names: string[]; fields: FieldSpec[] };
}

// Ideographic and non-breaking spaces are escaped rather than typed raw: they are
// invisible in review, and eslint rejects the raw characters outright.
const punctuation = /[\s\u3000\u00a0·・‧.,，。:：;；、/／\\|｜()（）[\]【】{}｛｝<>《》「」『』"'`~!！?？*#^_+=%$&@\-—–]+/g;

/** Character-level 繁→简 folding so both spellings meet in the middle. */
const folded: Record<string, string> = {
  廈: '厦', 編: '编', 號: '号', 稱: '称', 樓: '楼', 層: '层', 單: '单', 電: '电', 話: '话',
  聯: '联', 絡: '络', 繫: '系', 蓋: '盖', 結: '结', 員: '员', 訪: '访', 時: '时', 間: '间',
  進: '进', 動: '动', 負: '负', 責: '责', 備: '备', 註: '注', 據: '据', 資: '资', 來: '来',
  記: '记', 錄: '录', 個: '个', 紙: '纸', 觸: '触', 斷: '断', 類: '类', 別: '别', 確: '确',
  會: '会', 狀: '状', 態: '态', 數: '数', 經: '经', 緯: '纬', 區: '区', 況: '况', 覽: '览',
  說: '说', 關: '关', 檔: '档', 為: '为', 務: '务', 專: '专', 業: '业', 證: '证', 費: '费',
  內: '内', 項: '项', 見: '见', 與: '与', 從: '从', 這: '这', 過: '过', 還: '还', 們: '们',
  對: '对', 應: '应', 開: '开', 實: '实', 際: '际', 統: '统', 計: '计', 總: '总', 場: '场',
  處: '处', 點: '点', 線: '线', 級: '级', 組: '组', 構: '构', 標: '标', 準: '准', 認: '认',
  須: '须', 讓: '让', 訊: '讯', 網: '网', 頁: '页', 顯: '显',
};

/**
 * Folds a header cell into a comparable key: punctuation and spacing removed,
 * case lowered, 繁中 folded to 简中. Both profile aliases and workbook headers
 * pass through here, so a spelling only has to be listed once.
 */
export function normalizeHeader(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(punctuation, '')
    .toLowerCase()
    .replace(/[一-鿿]/gu, (character) => folded[character] ?? character);
}

// Recognition only: every wording ever written, so a simplified form never makes an old sheet unreadable.
const coverageChoices = recognitionCoverageValues;
const contactChoices = recognitionContactValues;
const assessmentChoices = recognitionAssessmentValues;
const sourceChoices = recognitionSourceValues;
const categoryChoices = recognitionCategoryValues;

const paperExcelFields: FieldSpec[] = [
  { key: 'buildingId', label: '大廈編號', aliases: ['大廈編號', '大厦编号', '建築編號', '建筑编号', '大廈', '大廈ID', 'building id', 'buildingid'], required: true, kind: 'id' },
  { key: 'occurredAt', label: '到訪日期', aliases: ['到訪日期', '到访日期', '探訪日期', '探访日期', '日期', 'visit date', 'date'], required: true, kind: 'date' },
  { key: 'worker', label: '工作員', aliases: ['工作員', '工作员', '工作人員', '工作人员', '同事', 'worker', 'staff'], required: true },
  { key: 'coverage', label: '覆蓋結果', aliases: ['覆蓋結果', '覆盖结果', '覆蓋情況', '覆蓋', '覆蓋狀態', '狀況', '結果', 'coverage'], required: true, kind: 'enum', choices: coverageChoices },
  { key: 'occurredTime', label: '到訪時間', aliases: ['到訪時間', '到访时间', '時間', '时间', 'visit time', 'time'], kind: 'time' },
  { key: 'recordId', label: '記錄編號', aliases: ['記錄編號', '记录编号', '紀錄編號', '編號', 'record id'], kind: 'id' },
  { key: 'paperRef', label: '紙本編號', aliases: ['紙本編號', '纸本编号', '紙本號', 'paper ref', 'paperref'] },
  { key: 'paperLine', label: '紙本行號', aliases: ['紙本行號', '纸本行号', '行號', '行号', 'paper line'] },
  { key: 'visitId', label: '外出編號', aliases: ['外出編號', '外出编号', '外出', 'visit id', 'visitid'] },
  { key: 'floor', label: '樓層', aliases: ['樓層', '楼层', '層數', 'floor'] },
  { key: 'unit', label: '單位', aliases: ['單位', '单位', '室號', 'unit'] },
  { key: 'contactOutcome', label: '接觸結果', aliases: ['接觸結果', '接触结果', '接觸情況', 'contact outcome'], kind: 'enum', choices: contactChoices },
  { key: 'assessment', label: '住房判斷', aliases: ['住房判斷', '住房判断', '住屋判斷', '評估', 'assessment'], kind: 'enum', choices: assessmentChoices },
  { key: 'sourceType', label: '資料來源', aliases: ['資料來源', '资料来源', '來源', '来源', 'source'], kind: 'enum', choices: sourceChoices },
  { key: 'note', label: '備註', aliases: ['紙本原話／備註', '紙本原話', '原話', '備註', '备注', '說明', 'note', 'remarks'] },
  { key: 'evidence', label: '依據', aliases: ['依據', '依据', 'evidence'] },
  { key: 'followUpCategory', label: '跟進類別', aliases: ['跟進類別', '跟进类别', '類別', 'category'], kind: 'enum', choices: categoryChoices },
  { key: 'followUpAction', label: '跟進行動', aliases: ['跟進行動', '跟进行动', '行動', '行動項目', 'follow up', 'action'] },
  { key: 'followUpAssignee', label: '負責人', aliases: ['負責人', '负责人', '跟進人', 'assignee'] },
  { key: 'followUpDueDate', label: '確定跟進日期', aliases: ['確定跟進日期', '确定跟进日期', '跟進日期', '到期日', 'due date', 'duedate'], kind: 'date' },
  { key: 'followUpTimingNote', label: '時間原話', aliases: ['時間原話／待確認', '時間原話', '时间原话', '待確認', 'timing note'] },
  { key: 'resolvesObservationId', label: '結束跟進編號', aliases: ['結束跟進編號', '结束跟进编号', '結束跟進', 'resolves'] },
  { key: 'correctsObservationId', label: '更正原記錄編號', aliases: ['更正原記錄編號', '更正原记录编号', '更正原記錄', '原記錄編號', 'corrects'] },
  { key: 'correctionReason', label: '更正原因', aliases: ['更正原因', '更正理由', 'correction reason'] },
];

const legacyFields: FieldSpec[] = [
  { key: 'recordId', label: 'id', aliases: ['id', 'observation id', 'observationid', '記錄編號'], required: true, kind: 'id' },
  { key: 'visitId', label: 'visitId', aliases: ['visitid', 'visit id', '外出編號'], required: true, kind: 'id' },
  { key: 'buildingId', label: 'buildingId', aliases: ['buildingid', 'building id', '大廈編號'], required: true, kind: 'id' },
  { key: 'occurredAt', label: 'occurredAt', aliases: ['occurredat', 'occurred at', '到訪日期'], required: true, kind: 'date' },
  { key: 'worker', label: 'workerName', aliases: ['workername', 'worker name', 'worker', '工作員'], required: true },
  { key: 'coverage', label: 'coverage', aliases: ['coverage', '覆蓋結果'], required: true, kind: 'enum', choices: coverageChoices },
  { key: 'recordedAt', label: 'recordedAt', aliases: ['recordedat', 'recorded at'], kind: 'date' },
  { key: 'floor', label: 'floorId', aliases: ['floorid', 'floor id', '樓層'] },
  { key: 'unit', label: 'unitId', aliases: ['unitid', 'unit id', '單位'] },
  { key: 'assessment', label: 'assessment', aliases: ['assessment'], kind: 'enum', choices: assessmentChoices },
  { key: 'contactOutcome', label: 'contactOutcome', aliases: ['contactoutcome', 'contact outcome'], kind: 'enum', choices: contactChoices },
  { key: 'sourceType', label: 'sourceType', aliases: ['sourcetype', 'source type'], kind: 'enum', choices: sourceChoices },
  { key: 'evidence', label: 'evidence', aliases: ['evidence'] },
  { key: 'note', label: 'note', aliases: ['note', '備註'] },
];

const personFields: FieldSpec[] = [
  { key: 'personId', label: '個人編號', aliases: ['個人編號', '个人编号', '編號', 'person id'], kind: 'id' },
  { key: 'personName', label: '姓名／稱呼', aliases: ['姓名／稱呼', '姓名', '稱呼', '称呼', '住戶姓名', 'name', 'display name'], required: true },
  { key: 'phone', label: '電話', aliases: ['電話', '电话', '聯絡電話', '联系电话', '手機', '手机', 'phone', 'mobile', 'tel'], kind: 'text' },
  { key: 'addressNote', label: '住址原文', aliases: ['住址原文', '住址', '地址原文', '地址', 'address'] },
  { key: 'contactNote', label: '接觸備註', aliases: ['接觸備註', '接触备注', '備註', '备注', 'note', 'remarks'] },
];

const buildingFields: FieldSpec[] = [
  { key: 'buildingId', label: '大廈編號', aliases: ['大廈編號', '大厦编号', '建築編號', '編號', 'building id'], kind: 'id' },
  { key: 'buildingName', label: '大廈名稱', aliases: ['大廈名稱', '大厦名称', '大廈', '建築名稱', '名称', 'building', 'name'], required: true },
  { key: 'address', label: '地址', aliases: ['地址', '大廈地址', 'address'] },
  { key: 'note', label: '備註', aliases: ['備註', '备注', '說明', 'note', 'remarks'] },
];

const visitFields: FieldSpec[] = [
  { key: 'occurredAt', label: '到訪日期', aliases: ['到訪日期', '到访日期', '探訪日期', '日期', 'visit date', 'date'], required: true, kind: 'date' },
  { key: 'buildingId', label: '大廈編號', aliases: ['大廈編號', '大厦编号', '大廈', '建築編號', 'building id'], required: true, kind: 'id' },
  { key: 'worker', label: '工作員', aliases: ['工作員', '工作员', '工作人員', '工作人员', '同事', 'worker', 'staff'] },
  { key: 'unit', label: '單位', aliases: ['單位', '单位', '室號', 'unit'] },
  { key: 'floor', label: '樓層', aliases: ['樓層', '楼层', 'floor'] },
  { key: 'coverage', label: '覆蓋結果', aliases: ['覆蓋結果', '覆盖结果', '覆蓋', '結果', 'coverage'], kind: 'enum', choices: coverageChoices },
  { key: 'note', label: '備註', aliases: ['備註', '备注', '原話', 'note', 'remarks'] },
  { key: 'followUpAction', label: '跟進行動', aliases: ['跟進行動', '跟进行动', '行動', 'action'] },
];

/** The closed list of formats W0 recognises. Adding one is a new version, not a tweak. */
export const FORMAT_PROFILES: FormatProfile[] = [
  {
    id: 'careflow-six-sheet',
    label: '中文六表封存格式',
    kind: 'known',
    description: '本工作台匯出的紙本回錄工作簿；業務列在「紙本回錄」工作表。',
    sheetHints: ['紙本回錄', '纸本回录', '大廈總表', '使用說明', '關聯封存'],
    minMatchedFields: 4,
    sheet: { names: ['紙本回錄', '纸本回录'], fields: paperExcelFields },
  },
  {
    id: 'legacy-synthetic',
    label: '舊英文合成格式',
    kind: 'known',
    description: '演示用英文活頁簿；業務列在 Observations 工作表。此格式並非機構原表。',
    sheetHints: ['observations', 'metadata', 'buildings'],
    minMatchedFields: 4,
    sheet: { names: ['Observations', 'observations'], fields: legacyFields },
  },
  {
    id: 'one-person-per-row',
    label: '一人一行（推測格式）',
    kind: 'template',
    description: '傳聞中的個人表模板；未取得機構原表驗證，只作候選。',
    sheetHints: ['個人', '名冊', 'person', 'people', '個人名冊'],
    minMatchedFields: 2,
    sheet: { names: ['個人名冊', '個人', '名冊', 'People', 'People List'], fields: personFields },
  },
  {
    id: 'one-building-per-row',
    label: '一幢建築一行（推測格式）',
    kind: 'template',
    description: '傳聞中的大廈表模板；未取得機構原表驗證，只作候選。',
    sheetHints: ['大廈', '大厦', 'building', '大廈總表'],
    minMatchedFields: 2,
    sheet: { names: ['大廈總表', '大廈', '大厦', 'Buildings'], fields: buildingFields },
  },
  {
    id: 'one-visit-per-row',
    label: '一處一次探訪一行（推測格式）',
    kind: 'template',
    description: '傳聞中的探訪明細模板；未取得機構原表驗證，只作候選。',
    sheetHints: ['探訪', '到訪', 'visit', '紙本回錄'],
    minMatchedFields: 3,
    sheet: { names: ['探訪記錄', '到訪記錄', 'Visits', '紙本回錄'], fields: visitFields },
  },
];

export function profileById(id: ProfileId): FormatProfile | undefined {
  return FORMAT_PROFILES.find((profile) => profile.id === id);
}
