import { AlertTriangle, CheckCircle2, HelpCircle, ScanSearch } from 'lucide-react';
import { columnChoice, IGNORED_COLUMN, profileOptions, type DetectionResult, type MappingOverride } from '../imports/detector';
import type { DetectionStatus } from '../imports/profiles';

/** The format picker's "let the detector decide" option; it is not a profile id. */
const AUTOMATIC = '__automatic__';

const statusLabels: Record<DetectionStatus, string> = {
  KNOWN: '已識別', CANDIDATE: '大致識別', AMBIGUOUS: '有待核對', UNKNOWN: '未能識別',
};
const fieldLabels: Record<string, string> = {
  KNOWN: '已對應', CANDIDATE: '待確認', AMBIGUOUS: '多個可能', UNKNOWN: '未對應',
};

export interface RecognitionPanelProps {
  recognition: DetectionResult;
  onRemap: (override: MappingOverride) => void;
}

/** The mapping preview: which format was recognised, and which column is which.
 *
 * Everything here is a proposal. The person in charge can change any single column
 * mapping, mark one as not present, or force a different candidate format; each
 * change re-runs recognition and re-renders this panel. Nothing here writes data.
 */
export function RecognitionPanel({ recognition, onRemap }: RecognitionPanelProps) {
  const { status, fields, headers, unmatchedColumns, appliedOverrides } = recognition;
  const warned = unmatchedColumns.filter((column) => column.hasData);
  /* A clean recognition needs no decision, so its detail stays folded. Anything that asks
     for a person's judgement — a guess, a clash, an override, an unmatched column with
     data, an issue — opens it. */
  const clean = status === 'KNOWN' && appliedOverrides.length === 0 && warned.length === 0 && recognition.issues.length === 0;
  return <section className={`cf-recognition is-${status.toLowerCase()}`} aria-labelledby="recognition-title">
    <header className="cf-recognition__head">
      <div>
        <span className="cf-eyebrow">格式識別與欄位對應</span>
        <h3 id="recognition-title">{recognition.profileLabel ?? '未識別出候選格式'}</h3>
        <p>{recognition.profileDescription ?? '這份活頁簿的表頭與目前支援的候選格式都不相符。'}</p>
      </div>
      <div className="cf-recognition__badges">
        <span className={`cf-status is-${status.toLowerCase()}`}>{status === 'KNOWN' ? <CheckCircle2 size={15} /> : status === 'UNKNOWN' ? <AlertTriangle size={15} /> : <HelpCircle size={15} />}{statusLabels[status]}</span>
        {recognition.profileKind === 'template' && <span className="cf-status is-template">推測格式・未經驗證</span>}
      </div>
    </header>

    <details className="cf-recognition__detail" open={!clean}>
    <summary>{clean ? '查看欄位對應' : '核對欄位對應'}</summary>
    <dl className="cf-recognition__facts">
      <div><dt>工作表</dt><dd>{recognition.sheetName ?? '—'}</dd></div>
      <div><dt>表頭行</dt><dd>{recognition.headerRow === undefined ? '—' : recognition.headerRow + 1}</dd></div>
      <div><dt>識別依據</dt><dd className="cf-mono">{recognition.detectorVersion}</dd></div>
    </dl>

    <label className="cf-recognition__profile">
      <span>候選格式</span>
      <select value={recognition.profileId ?? AUTOMATIC} onChange={(event) => onRemap({ profileId: event.currentTarget.value === AUTOMATIC ? undefined : event.currentTarget.value as DetectionResult['profileId'], columns: {} })}>
        <option value={AUTOMATIC}>自動判斷</option>
        {profileOptions().map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
      <small>此處只供對應預覽。更改後請按預覽整理原檔，再重新載入，才可合併資料。</small>
    </label>

    {fields.length > 0 && <div className="cf-mapping" role="table" aria-label="欄位對應表">
      <div role="row" className="cf-mapping__row cf-mapping__row--head">
        <span role="columnheader">欄位</span>
        <span role="columnheader">工作表欄</span>
        <span role="columnheader">判斷依據</span>
      </div>
      {fields.map((field) => <div role="row" key={field.key} className={`cf-mapping__row is-${field.status.toLowerCase()}`}>
        <span role="cell" className="cf-mapping__field">
          <strong>{field.label}</strong>
          {field.required && <em className="cf-required">必填</em>}
          <em className={`cf-field-status is-${field.status.toLowerCase()}`}>{fieldLabels[field.status]}</em>
        </span>
        <span role="cell">
          <select
            aria-label={`${field.label} 對應欄位`}
            value={field.columnIndex === undefined ? (field.overridden === 'ignored' ? IGNORED_COLUMN : '') : String(field.columnIndex)}
            onChange={(event) => { const change = columnChoice(field.key, event.currentTarget.value); if (change) onRemap(change); }}
          >
            {/* Only while nothing is mapped: once it is, the placeholder would be a dead option. */}
            {field.columnIndex === undefined && field.overridden !== 'ignored' && <option value="">{field.status === 'AMBIGUOUS' ? '請選擇…' : '未對應'}</option>}
            {headers.map((header, index) => <option key={`${index}-${header}`} value={String(index)}>{index + 1}. {header || '（空白）'}</option>)}
            <option value={IGNORED_COLUMN}>原表沒有此欄／忽略</option>
          </select>
          {field.candidates.length > 0 && <small className="cf-candidates">可能欄位：{field.candidates.map((candidate) => `${candidate.columnIndex + 1}. ${candidate.sourceHeader}`).join('、')}</small>}
        </span>
        <span role="cell" className="cf-mapping__basis">{field.basis}</span>
      </div>)}
    </div>}

    </details>

    {appliedOverrides.length > 0 && <p className="cf-recognition__applied"><CheckCircle2 size={15} />已按你的選擇更新：{appliedOverrides.join('、')}</p>}

    {warned.length > 0 && <section className="cf-recognition__extra">
      <h4><ScanSearch size={16} />未能對應但有內容的欄位 <span>{warned.length}</span></h4>
      <p>這些欄不會被靜默丟棄；如屬必要資料，請在上方指定對應欄位。</p>
      <ul>{warned.map((column) => <li key={column.columnIndex}><b>{column.columnIndex + 1}. {column.sourceHeader || '（空白表頭）'}</b></li>)}</ul>
    </section>}

    {recognition.issues.length > 0 && <ul className="cf-recognition__issues">
      {recognition.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}>
        {issue.severity === 'error' ? <AlertTriangle size={15} /> : <HelpCircle size={15} />}{issue.message}
      </li>)}
    </ul>}
  </section>;
}
