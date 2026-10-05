import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Printer, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { RecognitionPanel } from "./RecognitionPanel";
import { recognitionBlocker, type DetectionResult, type MappingOverride } from "../imports/detector";

export interface ImportIssueView { sheet?: string; row?: number; field?: string; message: string; severity?: "error" | "warning"; }
export interface ImportReview { fileName: string; issues: ImportIssueView[]; counts: Record<string, number>; canReplace: boolean; preview?: Array<{ label: string; detail: string }>; layouts?: Array<{ label: string; detail: string }>; changes?: { added: number; updated: number; duplicates: number; retained: number }; recognition?: DetectionResult; }
export interface ImportDialogProps {
  open: boolean;
  review?: ImportReview;
  loading?: boolean;
  error?: string;
  notice?: string;
  onClose: () => void;
  onFile: (file: File) => Promise<void> | void;
  onLoadDistrict?: () => Promise<void> | void;
  onExport?: () => void;
  onPrint?: () => void;
  onRetry: () => void;
  onRemap?: (override: MappingOverride) => void;
  onConfirmReplace: () => Promise<void> | void;
}

export function ImportDialog({ open, review, loading = false, error, notice, onClose, onFile, onLoadDistrict, onConfirmReplace, onExport, onPrint, onRetry, onRemap }: ImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  if (confirmError) error = confirmError;
  if (review) review = { ...review, counts: { "大廈": review.counts.Buildings ?? 0, "個人": review.counts.People ?? 0, "單位": review.counts.Units ?? 0, "觀察": review.counts.Observations ?? 0 } };
  // The same rule the keyboard path in App enforces on submit.
  const blocker = recognitionBlocker(review?.recognition);
  useEffect(() => { if (open) setConfirmError(""); }, [open]);
  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; if (open && !dialog.open) { triggerRef.current = document.activeElement as HTMLElement; dialog.showModal(); } else if (!open && dialog.open) dialog.close(); }, [open]);
  const close = () => { if (loading || confirming) return; dialogRef.current?.close(); onClose(); requestAnimationFrame(() => triggerRef.current?.focus()); };
  const accept = (files: FileList | null) => { const file = files?.[0]; if (file) void onFile(file); };
  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files); };
  const confirm = async () => {
    setConfirming(true); setConfirmError("");
    try {
      await onConfirmReplace();
      dialogRef.current?.close(); onClose(); requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (reason) {
      setConfirmError(reason instanceof Error ? reason.message : "未能套用匯入資料，原有資料仍然保留。");
    } finally { setConfirming(false); }
  };
  return <dialog aria-labelledby="import-title" ref={dialogRef} className="cf-dialog cf-dialog--import" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { if (open && !loading && !confirming) onClose(); }}><div className="cf-import"><header className="cf-dialog__header"><div><span className="cf-eyebrow">中心回錄</span><h2 id="import-title">紙本與 Excel 工作台</h2></div><button className="cf-icon-button" onClick={close} aria-label="關閉"><X /></button></header><p className="cf-callout">沿用紙本外展、回中心整理 Excel 的方式。</p>
    {!review && <>{onLoadDistrict && <section className="excel-district-demo"><div><strong>示範資料</strong><p>重新核對並合併示範街區；現有記錄會保留。</p></div><button className="cf-button cf-button--secondary" disabled={loading} onClick={() => void onLoadDistrict()}>重新載入示範資料</button></section>}<div className="excel-steps"><section><b>01</b><h3>外出前</h3><p>一廈一張，保留紙本編號與行號。</p><button className="cf-button cf-button--secondary" disabled={!onPrint} onClick={onPrint}><Printer size={17} />列印大廈紙本</button></section><section><b>02</b><h3>回中心</h3><p>個人一人一行，大廈一廈一行，逐筆回錄原話。</p><button className="cf-button cf-button--secondary" disabled={!onExport} onClick={onExport}><Download size={17} />匯出目前 Excel</button></section><section><b>03</b><h3>核對合併</h3><p>保留舊歷史，重複資料略過，衝突先修正。</p></section></div><button type="button" disabled={loading} className={`cf-dropzone ${dragging ? "is-dragging" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><Upload size={28} /><strong>{loading ? "正在解析…" : "拖放 Excel 檔案到這裡"}</strong><span>或按此選擇 .xlsx 檔案</span></button><input ref={inputRef} className="cf-visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => accept(event.currentTarget.files)} /></>}
    {review && <section className="cf-review"><div className="cf-review__summary"><div><FileSpreadsheet /><span><strong>{review.fileName}</strong><small>已解析，尚未套用</small></span></div>{review.canReplace && !blocker ? <span className="cf-ready"><CheckCircle2 />可以匯入</span> : <span className="cf-not-ready"><AlertTriangle />需要修正</span>}</div>{review.recognition && onRemap && <RecognitionPanel recognition={review.recognition} onRemap={onRemap} />}<dl className="cf-counts">{Object.entries(review.counts).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{review.changes && <div className="excel-merge-summary"><span>新增 <b>{review.changes.added}</b></span><span>更新 <b>{review.changes.updated}</b></span><span>重複略過 <b>{review.changes.duplicates}</b></span><span>保留較新 <b>{review.changes.retained}</b></span></div>}{review.layouts && review.layouts.length > 0 && <section className="excel-record-preview"><h3>新建樓層結構 <span>{review.layouts.length}</span></h3><div>{review.layouts.map((item, i) => <article key={i}><strong>{item.label}</strong><p>{item.detail}</p></article>)}</div></section>}{review.preview && review.preview.length > 0 && <section className="excel-record-preview"><h3>新增到訪明細 <span>{review.preview.length}</span></h3><div>{review.preview.map((item, i) => <article key={i}><strong>{item.label}</strong><p>{item.detail || '沒有附加備註'}</p></article>)}</div></section>}<div className="cf-issues"><h3>驗證結果 <span>{review.issues.length}</span></h3>{review.issues.length === 0 ? <p className="cf-success"><CheckCircle2 />未發現格式問題。</p> : <div className="cf-issue-table" role="table" aria-label="所有匯入問題"><div role="row" className="cf-issue-row cf-issue-row--head"><span role="columnheader">工作表</span><span role="columnheader">行</span><span role="columnheader">欄位</span><span role="columnheader">問題</span></div>{review.issues.map((issue, index) => <div role="row" className={`cf-issue-row is-${issue.severity ?? "error"}`} key={`${issue.sheet}-${issue.row}-${issue.field}-${index}`}><span role="cell">{issue.sheet ?? "—"}</span><span role="cell">{issue.row ?? "—"}</span><span role="cell">{issue.field ?? "—"}</span><span role="cell">{issue.message}</span></div>)}</div>}</div><footer className="cf-dialog__footer"><span>{blocker ?? "只合併核對通過的變更；刪除 Excel 行不會刪除舊記錄。"}</span><div><button className="cf-button cf-button--ghost" onClick={onRetry}>換一個檔案</button><button className="cf-button cf-button--primary" disabled={!review.canReplace || confirming || !!blocker} onClick={() => void confirm()}>{confirming ? "套用中…" : "確認合併資料"}</button></div></footer></section>}{notice && <p className="cf-success" role="status"><CheckCircle2 />{notice}</p>}{error && <p className="cf-error" role="alert"><AlertTriangle />{error}</p>}</div></dialog>;
}
