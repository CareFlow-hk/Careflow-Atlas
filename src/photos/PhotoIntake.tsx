import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, ChevronRight, FileImage, ImagePlus, LoaderCircle, RotateCcw, ScanLine, ShieldCheck, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Operator, OutreachSnapshot } from '../domain/types';
import { assessmentLabels, contactLabels, coverageLabels, sourceLabels, supportCategoryLabels } from '../domain/presentation';
import { api } from '../auth/api';
import { extractionSchema, mapRow, photoObservationId, rowIssues, unitLocation, type PhotoPage, type ReviewRow } from './model';
import { loadPhotoDraft, MAX_PHOTOS, preparePhoto, savePhotoDraft } from './files';
import { blankRow, samplePage } from './sample';
import './photos.css';

interface Props { open: boolean; snapshot: OutreachSnapshot; operator: Operator; onClose: () => void; onSave: (pages: PhotoPage[]) => { added: number; duplicates: number }; onView: (buildingId: string, unitId?: string) => void }
interface Service { configured: boolean; model: string; fallbackModel?: string | null; provider: string }
export function PhotoIntake({ open, snapshot, operator, onClose, onSave, onView }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(null), controller = useRef<AbortController | null>(null), busyRef = useRef(false);
  const [pages, setPages] = useState<PhotoPage[]>([]), [hydrated, setHydrated] = useState(false);
  const [canPersist, setCanPersist] = useState(false);
  const [step, setStep] = useState<'upload' | 'review' | 'confirm' | 'success'>('upload');
  const [pageIndex, setPageIndex] = useState(0), [rowIndex, setRowIndex] = useState(0), [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false), [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const [draftState, setDraftState] = useState('正在讀取草稿…'), [restored, setRestored] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [service, setService] = useState<Service>(), [serviceError, setServiceError] = useState('');
  const [removeId, setRemoveId] = useState<string>(), [saved, setSaved] = useState<{ added: number; duplicates: number; buildingId?: string; unitId?: string }>();
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pagesRef = useRef(pages); pagesRef.current = pages;
  useEffect(() => {
    let live = true;
    loadPhotoDraft(operator.accountId).then(value => { if (live) { setPages(value); setRestored(value.length > 0); setCanPersist(true); setHydrated(true); } }).catch(() => { if (live) { setHydrated(true); setDraftState('草稿未能讀取'); setDraftError('此瀏覽器未能讀取草稿。原有草稿保留；新操作只留在此頁，請勿重新整理。'); } });
    return () => { live = false; controller.current?.abort(); };
  }, [operator.accountId]);
  useEffect(() => {
    if (!hydrated || !canPersist) return;
    setDraftState('正在儲存草稿…');
    let live = true;
    writeQueue.current = writeQueue.current.catch(() => undefined).then(() => savePhotoDraft(operator.accountId, pages));
    void writeQueue.current.then(() => { if (live) { setDraftState(pages.length ? '草稿已存於此裝置' : '照片只在確認辨識時傳送'); setDraftError(''); } }).catch(() => { if (live) { setDraftState('草稿未能儲存'); setDraftError('草稿未能儲存，請勿關閉或重新整理。請檢查瀏覽器儲存空間後再修改草稿以重試。'); } });
    return () => { live = false; };
  }, [pages, hydrated, canPersist, operator.accountId]);
  const refreshService = () => { setServiceError(''); void api<Service>('/photos/status').then(setService).catch(() => { setService(undefined); setServiceError('未能連接辨識服務'); }); };
  useEffect(() => { if (open) { refreshService(); setStep(current => current === 'success' ? 'upload' : current); } }, [open]);
  useEffect(() => {
    if (open && !dialog.current?.open) { trigger.current = document.activeElement as HTMLElement; dialog.current?.showModal(); }
    if (!open && dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [open]);
  const updatePage = (id: string, change: Partial<PhotoPage>) => setPages(current => current.map(p => p.id === id ? { ...p, ...change } : p));
  const close = () => { onClose(); };
  const selectPage = (index: number) => { setPageIndex(index); setRowIndex(0); setZoom(1); setError(''); };
  const page = pages[pageIndex] ?? pages[0]; const row = page?.rows[rowIndex] ?? page?.rows[0];
  const all = pages.flatMap(p => p.rows.map(r => ({ p, r, duplicate: snapshot.observations.some(o => o.id === photoObservationId(p, r)) })));
  const included = all.filter(({ r, duplicate }) => !r.excluded && !duplicate);
  const reviewed = included.filter(({ r }) => r.reviewed && !rowIssues(r, snapshot).length).length;
  const unsettled = pages.some(p => p.status !== 'done');
  const ready = all.length > 0 && reviewed === included.length && !unsettled && !busy;
  const issues = row ? rowIssues(row, snapshot) : [];
  const isDuplicate = row && page && snapshot.observations.some(o => o.id === photoObservationId(page, row));
  const edit = (change: Partial<ReviewRow>) => { if (!page || !row) return; updatePage(page.id, { rows: page.rows.map(r => r.id === row.id ? { ...r, ...change, reviewed: false } : r) }); };
  async function addFiles(files: File[]) {
    if (busyRef.current || !hydrated) return;
    busyRef.current = true; setBusy(true); setError(''); setStep('upload'); setSaved(undefined);
    const next = [...pagesRef.current]; const errors: string[] = [];
    try { for (const file of files) {
      if (next.length >= MAX_PHOTOS) { errors.push('每批最多 8 張照片；請先完成目前批次。'); break; }
      try { const item = await preparePhoto(file); if (next.some(p => p.id === item.id)) errors.push(`${file.name} 已在這個批次內。`); else next.push(item); }
      catch (e) { errors.push(e instanceof Error ? e.message : '照片未能讀取。'); }
    } setPages(next); setPageIndex(Math.max(0, next.length - 1)); setRowIndex(0); setError(errors.join(' ')); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function recognize(onlyId?: string) {
    if (busyRef.current) return;
    const queue = pagesRef.current.filter(p => !p.sample && (onlyId ? p.id === onlyId : p.status !== 'done'));
    if (!queue.length) { setStep('review'); return; }
    busyRef.current = true; setBusy(true); setError(''); setStep('review');
    const abort = new AbortController(); controller.current = abort;
    setPageIndex(pagesRef.current.findIndex(p => p.id === queue[0].id)); setRowIndex(0);
    try { for (const item of queue) {
      if (abort.signal.aborted) break;
      updatePage(item.id, { status: 'processing', error: undefined });
      try {
        const raw = await api<unknown>('/photos/recognize', 'POST', { image: item.image }, { signal: abort.signal, timeoutMs: 200000 });
        const result = extractionSchema.parse(raw);
        updatePage(item.id, { status: 'done', model: result.model, fallback: result.fallback, warnings: result.warnings, rows: result.rows.map((r, i) => mapRow(r, item.id, i, snapshot)) });
      } catch (e) {
        updatePage(item.id, { status: 'error', error: abort.signal.aborted ? '已停止，可隨時重試。' : e instanceof Error && e.name !== 'ZodError' ? e.message : '辨識回覆格式不完整，請重試。' });
      }
    } } finally { controller.current = null; busyRef.current = false; setBusy(false); }
  }
  function markReviewed() {
    if (!page || !row || issues.length) return;
    updatePage(page.id, { rows: page.rows.map(r => r.id === row.id ? { ...r, reviewed: true } : r) });
    const next = page.rows.findIndex((r, i) => i > rowIndex && !r.reviewed && !r.excluded);
    if (next >= 0) setRowIndex(next);
  }
  function commit() {
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = onSave(pages); const first = included[0]?.r;
      setSaved({ ...result, buildingId: first?.buildingId, unitId: first?.scope === 'UNIT' ? first.unitId : undefined }); setStep('success'); setPages([]); setRestored(false);
    } catch (e) { setError(e instanceof Error ? e.message : '儲存失敗，核對結果仍保留。'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const progress = step === 'upload' ? 0 : step === 'review' ? 1 : 2;
  return <dialog className="photo-dialog" ref={dialog} aria-labelledby="photo-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="photo-header"><div className="photo-brand-icon"><ScanLine size={23} /></div><div><span className="cf-caps">FIELD NOTES / PHOTO INTAKE</span><h2 id="photo-title">把紙上的到訪，帶回街區。</h2></div><button className="photo-icon" aria-label="關閉照片工作台，保留草稿" onClick={close}><X size={22} /></button></header>
    <nav className="photo-steps" aria-label="照片回錄步驟">{['加入照片', '核對結果', '確認入庫'].map((label, i) => <span key={label} className={progress === i ? 'is-current' : progress > i ? 'is-complete' : ''} aria-current={progress === i ? 'step' : undefined}><b>{progress > i ? <Check size={13} /> : `0${i + 1}`}</b>{label}{i < 2 && <ChevronRight size={14} />}</span>)}<small><ShieldCheck size={13} />{draftState}</small></nav>
    <div className="photo-content">
      {draftError && <p className="photo-alert" role="alert"><AlertCircle size={17} />{draftError}</p>}
      {error && <p className="photo-alert" role="alert"><AlertCircle size={17} />{error}</p>}
      {restored && step === 'upload' && <div className="photo-restored" role="status"><RotateCcw size={16} /><span>已恢復上次的 {pages.length} 張照片與核對草稿。</span><button onClick={() => { setStep('review'); setRestored(false); }}>繼續核對 <ArrowRight size={14} /></button></div>}
      {step === 'upload' && <div className="photo-upload-layout"><section className="photo-upload-main"><div className="photo-section-title"><span className="cf-caps">01 / CAPTURE</span><h3>一張紙本，一次清楚的回錄。</h3><p>上傳洗樓記錄照片，逐筆核對大廈、單位與探訪結果。</p></div>
        <div className={`photo-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void addFiles([...e.dataTransfer.files]); }}><div className="photo-drop-icon"><ImagePlus size={36} strokeWidth={1.2} /></div><h4>拖放照片到這裡</h4><p>JPG、PNG、WebP · 每張最多 15 MB · 每批 8 張</p><div><button className="photo-button primary" disabled={busy || !hydrated || pages.length >= MAX_PHOTOS} onClick={() => fileInput.current?.click()}><ImagePlus size={16} />選擇照片</button><button className="photo-button" disabled={busy || !hydrated || pages.length >= MAX_PHOTOS} onClick={() => cameraInput.current?.click()}><Camera size={16} />拍攝紙本</button></div></div>
        {pages.length > 0 && <div className="photo-upload-list" aria-label="已加入照片">{pages.map((p, i) => <article key={p.id}><img src={p.image} alt={`${p.name} 縮圖`} /><div><strong>{p.name}</strong><small>{p.sample ? '流程示範' : p.status === 'done' ? `${p.rows.length} 筆待核對` : p.status === 'error' ? '需要重試' : '已準備'} · 第 {i + 1} 張</small></div><button className="photo-icon" disabled={busy} aria-label={`移除 ${p.name}`} onClick={() => setRemoveId(p.id)}><X size={17} /></button></article>)}</div>}
        <p className="photo-privacy"><ShieldCheck size={16} />開始辨識後，照片會傳送至機構的 Azure AI 服務。原圖與草稿暫存在此瀏覽器；入庫後移除照片草稿。此工作區仍使用合成資料。</p>
      </section><aside className="photo-guide"><span className="cf-caps">A SMALL FIELD GUIDE</span><div className="photo-paper-art" aria-hidden="true"><span>CareFlow / 外展記錄</span><b>每一行，都值得被記得。</b><i /><i /><i /><i /><div><Check size={18} /> 拍清楚，再核對。</div></div><h4>拍得清楚，核對更輕鬆。</h4><ol><li>攤平紙本，讓四角完整入鏡。</li><li>避免反光，確認手寫文字清晰。</li><li>每張拍一頁，多頁可一次加入。</li></ol><div className={`photo-service ${service?.configured ? 'is-ready' : ''}`}><span><i />{service?.configured ? '辨識服務已配置' : serviceError || (service ? '辨識服務待配置' : '正在檢查服務…')}</span><small>{service?.model ?? 'gpt-6-luna'} · Azure OpenAI</small>{service?.configured && service.fallbackModel && <p>一般照片由 Luna 辨識；多處文字看不清時，再交由 {service.fallbackModel} 讀取。</p>}{!service?.configured && <><p>管理員填入 API key 後即可使用照片辨識。現在可先體驗完整核對流程。</p><button onClick={refreshService}>重新檢查</button></>}</div><button className="photo-sample" disabled={busy || !hydrated || pages.length > 0} onClick={() => { setPages([samplePage(snapshot)]); setStep('review'); setPageIndex(0); setRowIndex(0); }}>試用示範紙本 <ArrowRight size={15} /></button><small className="photo-fine">預設示範結果，不會呼叫 AI。</small></aside></div>}
      {step === 'review' && <div className="photo-review-layout"><aside className="photo-pages"><span className="cf-caps">PAGES / {pages.length}</span>{pages.map((p, i) => <button key={p.id} onClick={() => selectPage(i)} className={page?.id === p.id ? 'is-active' : ''} aria-label={`第 ${i + 1} 張：${p.name}`} aria-pressed={page?.id === p.id}><img src={p.image} alt="" /><span>{String(i + 1).padStart(2, '0')}</span>{p.status === 'processing' ? <LoaderCircle className="photo-spin" size={14} /> : p.status === 'error' ? <AlertCircle size={14} /> : p.rows.length > 0 && p.rows.every(r => r.reviewed || r.excluded) ? <CheckCircle2 size={14} /> : null}</button>)}<button className="photo-add-page" disabled={busy || pages.length >= MAX_PHOTOS} onClick={() => { setStep('upload'); }}><ImagePlus size={20} /><span>加照片</span></button></aside>
        <section className="photo-source"><div className="photo-source-toolbar"><span title={page?.name}><FileImage size={15} />{page?.name ?? '尚未加入照片'}</span><button className="photo-icon" disabled={zoom <= 0.75} aria-label="縮小原圖" onClick={() => setZoom(v => v - 0.25)}><ZoomOut size={17} /></button><small>{Math.round(zoom * 100)}%</small><button className="photo-icon" disabled={zoom >= 3} aria-label="放大原圖" onClick={() => setZoom(v => v + 0.25)}><ZoomIn size={17} /></button></div><div className="photo-image-scroll">{page && <img src={page.image} alt={`核對原圖：${page.name}`} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} />}</div><div className="photo-source-caption">{page?.sample ? '示範紙本 · 非 AI 實際辨識結果' : '請以照片原文為準，AI 結果仍需人工核對。'}</div></section>
        <section className="photo-review-panel" aria-label="辨識結果核對">{!page ? <div className="photo-empty"><ImagePlus /><h3>先加入一張照片</h3><button className="photo-button" onClick={() => setStep('upload')}>加入照片</button></div> : page.status === 'processing' ? <div className="photo-empty" role="status"><ScanLine className="photo-scan" size={36} /><h3>正在讀取這張紙本</h3><p>辨識大廈、逐行結果與跟進原話。較難辨識的照片可能再讀一次，最多約 3 分鐘。你可以先核對其他已完成的照片。</p><button className="photo-button" onClick={() => controller.current?.abort()}>停止辨識</button></div> : page.status !== 'done' ? <div className="photo-empty"><AlertCircle size={32} /><h3>{page.status === 'error' ? '這張照片未完成辨識' : '照片已準備'}</h3><p role={page.status === 'error' ? 'alert' : undefined}>{page.error || '開始辨識後，結果會出現在這裡。'}</p><button className="photo-button primary" disabled={busy || !service?.configured} onClick={() => void recognize(page.id)}><RotateCcw size={16} />{page.status === 'error' ? '重試這張照片' : '辨識這張照片'}</button><button className="photo-button" disabled={busy} onClick={() => updatePage(page.id, { status: 'done', model: '手動回錄', fallback: undefined, warnings: [], rows: [mapRow(blankRow, page.id, 0, snapshot)] })}>對照照片手動回錄</button><button className="photo-text-button" disabled={busy} onClick={() => setRemoveId(page.id)}>移除這張照片</button></div> : <>
          <div className="photo-review-heading"><div><span className="cf-caps">02 / REVIEW</span><h3>對照原圖，逐筆確認。</h3></div><span>{page.rows.filter(r => r.reviewed || r.excluded).length} / {page.rows.length}</span></div>
          {page.fallback && <div className={`photo-fallback ${page.fallback.outcome === 'used' ? '' : 'needs-review'}`} role="status"><ScanLine size={17} /><div><strong>{page.fallback.outcome === 'used' ? '已完成進階辨識' : page.fallback.outcome === 'failed' ? '進階辨識未完成，已保留首輪結果' : '兩輪記錄數不一致，已保留首輪結果'}</strong><p>{page.fallback.reason === 'LOW_LEGIBILITY' ? '首輪有多個關鍵欄位看不清。' : page.fallback.reason === 'UNREADABLE' ? '首輪未能讀出記錄。' : '首輪未能產生完整結果。'}{page.fallback.outcome === 'used' ? '以下是第二輪結果，仍請逐筆對照原圖。' : '請仔細對照原圖，必要時重新拍攝或手動補錄。'}</p><small>{page.fallback.primaryModel} → {page.fallback.model}{page.fallback.outcome !== 'used' && ` · 目前採用：${page.model}`}</small></div></div>}
          {page.warnings.map((warning, i) => <p key={i} className="photo-warning"><AlertCircle size={15} />{warning}</p>)}
          <div className="photo-row-tabs" aria-label="照片內記錄">{page.rows.map((r, i) => <button key={r.id} aria-pressed={row?.id === r.id} className={r.excluded ? 'is-excluded' : ''} onClick={() => setRowIndex(i)}>{r.reviewed ? <Check size={13} /> : null}{i + 1}{r.unit ? ` · ${r.unit}` : r.scope === 'BUILDING' ? ' · 全廈' : ''}</button>)}<button aria-label="新增一筆手動回錄" onClick={() => { const index = page.rows.length; updatePage(page.id, { rows: [...page.rows, mapRow({ ...blankRow, line: `補錄 ${index + 1}` }, page.id, index, snapshot)] }); setRowIndex(index); }} disabled={page.rows.length >= 60}>＋</button></div>
          {!row ? <div className="photo-empty"><FileImage size={32} /><h3>未找到可回錄的記錄</h3><p>檢查照片是否清晰，或按 ＋ 對照原圖手動新增。</p><button className="photo-text-button" onClick={() => setRemoveId(page.id)}>移除這張照片</button></div> : <div className="photo-fields" key={row.id}>
            {isDuplicate && <p className="photo-warning"><CheckCircle2 size={16} />這筆照片記錄已入庫，將略過以保留歷史。</p>}
            <div className="photo-row-meta"><span>紙本定位：{row.line || '未標行號'}</span><button className="photo-text-button" disabled={!!isDuplicate} onClick={() => edit({ excluded: !row.excluded })}>{row.excluded ? '恢復這筆' : '略過這筆'}</button></div>
            {row.excluded ? <div className="photo-empty"><p>這筆不會入庫。可隨時恢復。</p></div> : <fieldset disabled={!!isDuplicate}>
              {(row.uncertainties.length > 0 || row.confidence < 0.8) && <div className="photo-warning"><AlertCircle size={17} /><div><strong>請特別核對</strong>{row.uncertainties.length ? row.uncertainties.map((v, i) => <p key={i}>{v}</p>) : <p>這筆辨識把握較低，請逐欄對照原圖。</p>}</div></div>}
              <div className="photo-source-text">原文位置：{[row.building, row.address, row.floor, row.unit].filter(Boolean).join(' · ') || '未辨識到位置'}</div>
              <label>對應大廈 <em>必填</em><select value={row.buildingId} onChange={e => edit({ buildingId: e.target.value, unitId: '' })}><option value="">選擇大廈</option>{snapshot.buildings.map(b => <option key={b.id} value={b.id}>{b.name} · {b.address}</option>)}</select></label>
              <div className="photo-field-pair"><label>記錄範圍 <em>必填</em><select value={row.scope ?? ''} onChange={e => edit({ scope: e.target.value as ReviewRow['scope'] || null, unitId: '' })}><option value="">請確認</option><option value="UNIT">單位</option><option value="BUILDING">整幢大廈</option></select></label>{row.scope === 'UNIT' && <label>樓層／單位 <em>必填</em><select value={row.unitId} onChange={e => edit({ unitId: e.target.value })}><option value="">選擇單位</option>{snapshot.units.filter(u => u.buildingId === row.buildingId).map(u => <option key={u.id} value={u.id}>{unitLocation(snapshot, u.id)}</option>)}</select></label>}</div>
              {row.scope === 'BUILDING' && <p className="photo-fine">只新增大廈層面的觀察，不會代填每個單位。</p>}
              <div className="photo-field-pair"><label>到訪日期 <em>必填</em><input type="date" value={row.date ?? ''} onChange={e => edit({ date: e.target.value || null })} /></label><label>紙本工作員 <em>必填</em><input maxLength={200} value={row.worker ?? ''} placeholder="依紙本填寫" onChange={e => edit({ worker: e.target.value || null })} /></label></div>
              <label>探訪結果 <em>必填</em><select value={row.coverage ?? ''} onChange={e => edit({ coverage: e.target.value as ReviewRow['coverage'] || null })}><option value="">請確認結果</option>{Object.entries(coverageLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
              <label>紙本原話／備註<textarea rows={3} maxLength={3000} value={row.note} onChange={e => edit({ note: e.target.value })} /></label>
              <details className="photo-details" open={!!row.followUp || undefined}><summary>跟進安排{row.followUp ? ' · 有待辦' : ' · 未記載'}</summary><label>跟進行動<input maxLength={200} value={row.followUp ?? ''} placeholder="只填紙本明確記載的待辦" onChange={e => edit({ followUp: e.target.value || null })} /></label><div className="photo-field-pair"><label>負責人<input maxLength={200} value={row.assignee ?? ''} onChange={e => edit({ assignee: e.target.value || null })} /></label><label>確定跟進日期<input type="date" value={row.dueDate ?? ''} onChange={e => edit({ dueDate: e.target.value || null })} /></label></div><label>時間原話<input maxLength={200} placeholder="例如：下星期再聯絡" value={row.timingNote ?? ''} onChange={e => edit({ timingNote: e.target.value || null })} /></label><label>跟進類別<select value={row.category ?? ''} onChange={e => edit({ category: e.target.value as ReviewRow['category'] || null })}><option value="">未記載</option>{Object.entries(supportCategoryLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></details>
              <details className="photo-details"><summary>接觸、住房判斷與依據</summary>{([{ field: 'contact', label: '接觸結果', options: contactLabels }, { field: 'assessment', label: '住房判斷', options: assessmentLabels }, { field: 'source', label: '資料來源', options: sourceLabels }] as const).map(({ field, label, options }) => <label key={field}>{label}<select value={row[field] ?? ''} onChange={e => edit({ [field]: e.target.value || null })}><option value="">未記載</option>{Object.entries(options).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>)}<label>依據<textarea rows={2} maxLength={3000} value={row.evidence} onChange={e => edit({ evidence: e.target.value })} /></label></details>
              {issues.length > 0 && <p className="photo-missing">尚需：{issues.join('、')}</p>}
              <button className={`photo-button ${row.reviewed ? 'reviewed' : 'primary'}`} disabled={issues.length > 0 || row.reviewed} onClick={markReviewed}><CheckCircle2 size={17} />{row.reviewed ? '這筆已核對' : '確認這筆，繼續核對'}</button>
            </fieldset>}
          </div>}
        </>}</section></div>}
      {step === 'confirm' && <section className="photo-confirm"><span className="cf-caps">03 / SAVE TO THE NEIGHBOURHOOD</span><h3>核對完成，準備回到街區。</h3><p>將追加 {included.length} 筆到訪記錄；舊記錄與跟進歷史會完整保留。</p><div className="photo-summary"><div><b>{included.length}</b><span>新增記錄</span></div><div><b>{included.filter(({ r }) => r.followUp).length}</b><span>待跟進</span></div><div><b>{all.filter(({ r, duplicate }) => r.excluded || duplicate).length}</b><span>略過記錄</span></div></div><div className="photo-confirm-list">{included.map(({ p, r }) => <article key={r.id}><CheckCircle2 size={18} /><div><strong>{snapshot.buildings.find(b => b.id === r.buildingId)?.name} · {r.scope === 'BUILDING' ? '整幢大廈' : unitLocation(snapshot, r.unitId)}</strong><p>{r.date} · {r.worker} · {r.coverage && coverageLabels[r.coverage]}</p>{r.followUp && <p>跟進：{r.followUp}{r.timingNote ? ` · ${r.timingNote}` : ''}</p>}<small>{p.name} · 第 {r.line || '—'} 行{p.sample ? ' · 示範結果' : ''}</small></div></article>)}</div><p className="photo-privacy"><ShieldCheck size={16} />核對人：{operator.name}。儲存到此帳號在本瀏覽器的工作區，之後可匯出 Excel。照片草稿將移除，保留檔名、來源指紋與核對紀錄。</p></section>}
      {step === 'success' && <section className="photo-success" role="status"><span><Check size={36} /></span><p className="cf-caps">BACK IN THE NEIGHBOURHOOD</p><h3>{saved?.added ? `${saved.added} 筆到訪，已記下。` : '核對完成，沒有新增記錄。'}</h3><p>{saved?.added ? '地圖狀態、到訪歷史與待跟進事項已更新。' : '原有到訪與跟進記錄完整保留。'}<br />{saved?.duplicates ? `已略過 ${saved.duplicates} 筆重複記錄。` : '可在「紙本與 Excel」匯出這次記錄。'}</p><button className="photo-button primary" onClick={() => { if (saved?.buildingId) onView(saved.buildingId, saved.unitId); close(); }}>查看入庫記錄 <ArrowRight size={16} /></button><button className="photo-text-button" onClick={() => { setStep('upload'); setSaved(undefined); }}>繼續上傳下一批</button></section>}
    </div>
    {step !== 'success' && <footer className="photo-footer"><div>{step === 'upload' ? <><FileImage size={17} /><span>{pages.length} / 8 張照片</span></> : <><CheckCircle2 size={17} /><span>{reviewed} / {included.length} 筆已核對{unsettled ? ' · 尚有照片未完成' : ''}</span></>}</div><div>{busy && <button className="photo-button" onClick={() => controller.current?.abort()} disabled={!controller.current}>停止辨識</button>}{step !== 'upload' && <button className="photo-button" disabled={busy} onClick={() => setStep(step === 'confirm' ? 'review' : 'upload')}><ArrowLeft size={16} />{step === 'confirm' ? '返回核對' : '管理照片'}</button>}{step === 'upload' && pages.length > 0 && !service?.configured && <button className="photo-button" disabled={busy} onClick={() => setStep('review')}>手動核對</button>}{step === 'upload' ? <button className="photo-button primary" disabled={busy || !pages.length || (pages.some(p => p.status !== 'done') && !service?.configured)} onClick={() => void recognize()}>{busy ? <LoaderCircle className="photo-spin" size={16} /> : <ScanLine size={16} />}{pages.length && pages.every(p => p.status === 'done') ? '繼續核對' : '開始辨識'}<ArrowRight size={16} /></button> : step === 'review' ? <button className="photo-button primary" disabled={!ready} onClick={() => setStep('confirm')}>預覽入庫 <ArrowRight size={16} /></button> : <button className="photo-button primary" disabled={!ready} onClick={commit}><Check size={16} />{included.length ? `確認儲存 ${included.length} 筆` : '完成核對，略過已有或排除記錄'}</button>}</div></footer>}
    <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} /><input ref={cameraInput} type="file" hidden accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
    {removeId && <div className="photo-remove-confirm" role="alertdialog" aria-modal="true" aria-label="移除照片草稿" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRemoveId(undefined); }
      if (event.key === 'Tab') { event.preventDefault(); const buttons = event.currentTarget.querySelectorAll('button'); (document.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus(); }
    }}><div><Trash2 size={24} /><h3>移除這張照片？</h3><p>這張照片的辨識和核對草稿會一起移除。已入庫記錄不受影響。</p><div><button autoFocus className="photo-button" onClick={() => setRemoveId(undefined)}>保留照片</button><button className="photo-button primary" onClick={() => { setPages(v => v.filter(p => p.id !== removeId)); setPageIndex(0); setRowIndex(0); setRemoveId(undefined); }}>移除草稿</button></div></div></div>}
  </dialog>;
}
