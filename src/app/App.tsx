import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Building2, Check, ChevronRight, CircleHelp, Settings2, ClipboardList, FileSpreadsheet, Footprints, Map, MapPin, RotateCcw, Search, ShieldCheck, Upload, X } from 'lucide-react';
import { useWorkspace } from './store';
import { registerWorkspaceTools } from './webmcp';
import { createRecordId } from './recordId';
import { buildingState, floorState, getCoverageSummary, getOpenFollowUps, isTagged, stateBreakdown, unitState, type OutreachSnapshot } from '../domain/types';
import type { MapBuilding } from '../map/mapModel';
import { BuildingCard } from '../components/BuildingCard';
import { BuildingDetail } from '../components/BuildingDetail';
import { ObservationEditor, type ObservationDraft } from '../components/ObservationEditor';
import { ImportDialog, type ImportReview } from '../components/ImportDialog';
import { PaperForm } from '../components/PaperForm';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { mergeWorkflow } from '../data/workflowMerge';
import { detectWorkbook, mergeOverride, recognitionBlocker, remapWorkbook, type MappingOverride } from '../imports/detector';
import '../components/workflow.css';
import '../styles.css';
import '../refinement.css';

const MapScene = lazy(() => import('../map/MapScene'));
interface EditTarget { buildingId: string; floorId?: string; unitId?: string; label: string; eventId: string; visitId: string; }

function download(url: string, name: string) {
  const a = document.createElement('a'); a.href = url; a.download = name;
  (document.querySelector('dialog[open]') ?? document.body).append(a); a.click(); a.remove();
}

export default function App() {
  const workspace = useWorkspace();
  const { snapshot, selectedBuildingId, selectedFloorId, selectedUnitId, expanded } = workspace;
  const [importOpen, setImportOpen] = useState(false);
  const [importReview, setImportReview] = useState<ImportReview>();
  const importSource = useRef<{ buffer: ArrayBuffer; fileName: string } | undefined>(undefined);
  const importOverride = useRef<MappingOverride>({});
  const [pendingSnapshot, setPendingSnapshot] = useState<OutreachSnapshot>();
  const [importBaseline, setImportBaseline] = useState<OutreachSnapshot>();
  const [paperOpen, setPaperOpen] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [importLoading, setImportLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>();
  const [activeVisitId] = useState(() => `visit-${createRecordId()}`);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'FOLLOWUP'>('ALL');
  const [toast, setToast] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listMode, setListMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') { setHelpOpen(false); helpButtonRef.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !helpRef.current?.contains(event.target) && !helpButtonRef.current?.contains(event.target)) setHelpOpen(false); };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside); };
  }, [helpOpen]);

  useEffect(registerWorkspaceTools, []);
  useEffect(() => { workspace.initialize(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);

  const mapBuildings = useMemo<MapBuilding[]>(() => snapshot?.buildings.map(building => {
    return {
      id: building.id, name: building.name, longitude: building.coordinates.lng, latitude: building.coordinates.lat,
      footprint: building.footprint, state: buildingState(snapshot, building.id), followUps: getCoverageSummary(snapshot, building.id).followUps,
      tagged: isTagged(snapshot, { buildingId: building.id }),
      floors: snapshot.floors.filter(f => f.buildingId === building.id).sort((a, b) => a.level - b.level).map(floor => {
        const scoped = getCoverageSummary(snapshot, building.id, floor.id);
        return {
          id: floor.id, label: floor.label, level: floor.level, state: floorState(snapshot, building.id, floor.id),
          hasFollowUp: scoped.followUps > 0, recorded: scoped.recorded, total: scoped.total ?? 0,
          breakdown: stateBreakdown(snapshot.units.filter(unit => unit.floorId === floor.id).map(unit => unitState(snapshot, building.id, unit.id))),
          tagged: isTagged(snapshot, { buildingId: building.id, floorId: floor.id }),
        };
      }),
    };
  }) ?? [], [snapshot]);

  const buildings = snapshot?.buildings.filter(building => `${building.name} ${building.address}`.includes(query) && (filter === 'ALL' || getCoverageSummary(snapshot, building.id).followUps > 0)) ?? [];
  const followupCount = snapshot?.buildings.reduce((sum, b) => sum + getCoverageSummary(snapshot, b.id).followUps, 0) ?? 0;
  const hasDistrictDemo = snapshot?.buildings.some(building => building.id === 'district-16');

  const openImport = () => { setImportReview(undefined); setPendingSnapshot(undefined); setImportBaseline(undefined); setImportError(undefined); importSource.current = undefined; importOverride.current = {}; setImportOpen(true); };
  const parseFile = async (buffer: ArrayBuffer, fileName: string, override?: MappingOverride) => {
    const { parseWorkbook } = await import('../data/workbookImport');
    const { parseWorkflowWorkbook } = await import('../data/workflowWorkbook');
    const workflow = parseWorkflowWorkbook(buffer, fileName);
    const result = workflow ?? parseWorkbook(buffer);
    const merged = result.snapshot ? mergeWorkflow(workspace.snapshot, result.snapshot, workflow?.baseline) : undefined;
    importOverride.current = override ?? {};
    const recognition = detectWorkbook(buffer, importOverride.current);
    importSource.current = { buffer, fileName };
    setPendingSnapshot(result.snapshot); setImportBaseline(workflow?.baseline);
    const preview = result.snapshot?.observations.filter(o => !workspace.snapshot?.observations.some(current => current.id === o.id)).map(o => ({
      label: `${result.snapshot!.buildings.find(b => b.id === o.buildingId)?.name ?? o.buildingId} · ${result.snapshot!.units.find(u => u.id === o.unitId)?.label ?? result.snapshot!.floors.find(f => f.id === o.floorId)?.label ?? '大廈層面'} · ${o.occurredAt.slice(0, 10)}`,
      detail: [o.paperRef ? `紙本 ${o.paperRef}／${o.paperLine ?? '—'}` : '', o.note, o.followUp?.action, o.followUp?.timingNote].filter(Boolean).join(' · '),
    }));
    setImportReview({ fileName, issues: [...result.issues, ...(merged?.issues ?? [])], counts: result.counts, canReplace: !!merged?.snapshot, changes: merged?.summary, preview, recognition });
  };
  /** Re-runs recognition only: the person's corrections change the preview, never the data. */
  const remapImport = (change: MappingOverride) => {
    const source = importSource.current;
    if (!source) return;
    // The preview on screen is the format in effect; compare against that, not the
    // forced one, so confirming the detected format keeps the column choices.
    importOverride.current = mergeOverride(importOverride.current, change, importReview?.recognition?.profileId);
    const recognition = remapWorkbook(source.buffer, importOverride.current);
    // W0 mapping is a preview only: discard the payload parsed before the change.
    setPendingSnapshot(undefined);
    setImportBaseline(undefined);
    setImportReview(current => current ? { ...current, recognition, canReplace: false, changes: undefined, preview: undefined,
      issues: [...current.issues.filter(issue => issue.field !== 'mapping-preview'), { field: 'mapping-preview', severity: 'error',
        message: '欄位對應已更改，目前只更新預覽。請按對應整理原檔，再重新載入；不會合併更改前的資料。' }] } : current);
  };
  const loadFile = async (file: File) => {
    setImportLoading(true); setImportError(undefined); setPendingSnapshot(undefined); setImportReview(undefined);
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('請選擇 .xlsx 活頁簿。');
      if (file.size > 5 * 1024 * 1024) throw new Error('示範匯入上限為 5 MB。');
      await parseFile(await file.arrayBuffer(), file.name);
    } catch (error) { setImportError(error instanceof Error ? error.message : '未能解析檔案。'); }
    finally { setImportLoading(false); }
  };
  const loadSample = async () => {
    setImportLoading(true); setImportError(undefined); setPendingSnapshot(undefined); setImportReview(undefined);
    try {
      const response = await fetch('/demo/careflow-paper-excel-mock.xlsx');
      if (!response.ok) throw new Error('示範活頁簿未能載入，請重試。');
      await parseFile(await response.arrayBuffer(), 'CareFlow 外展・合成示範.xlsx');
    } catch (error) { setImportError(error instanceof Error ? error.message : '未能載入示範資料。'); }
    finally { setImportLoading(false); }
  };
  const loadDistrict = async () => {
    openImport(); setImportLoading(true);
    try {
      const response = await fetch('/demo/careflow-district-demo.xlsx');
      if (!response.ok) throw new Error('街區範例未能載入，請重試。');
      await parseFile(await response.arrayBuffer(), 'CareFlow_街區擴展_mock.xlsx');
    } catch (error) { setImportError(error instanceof Error ? error.message : '未能載入街區範例。'); }
    finally { setImportLoading(false); }
  };
  const confirmImport = () => {
    if (!pendingSnapshot || !importReview?.canReplace) throw new Error('請重新載入並核對匯入資料。');
    // The dialog disables the button too; this is the same rule for the keyboard path.
    const blocked = recognitionBlocker(importReview?.recognition);
    if (blocked) throw new Error(blocked);
    try { workspace.mergeSnapshot(pendingSnapshot, importBaseline); setImportOpen(false); setToast('已合併 Excel 回錄，舊記錄與到訪歷史保留。'); }
    catch (error) { throw error instanceof Error ? error : new Error('未能儲存，原有資料未改動。'); }
  };
  const saveObservation = async (draft: ObservationDraft) => {
    if (!editTarget) return;
    workspace.saveObservation({
      id: editTarget.eventId, visitId: editTarget.visitId,
      buildingId: editTarget.buildingId, floorId: editTarget.floorId, unitId: editTarget.unitId,
      occurredAt: draft.occurredAt, recordedAt: new Date().toISOString(), workerName: '示範工作員',
      coverage: draft.coverage, assessment: draft.assessment, contactOutcome: draft.contactOutcome,
      sourceType: draft.sourceType, optionNotes: draft.optionNotes, note: draft.note, evidence: draft.evidence, followUp: draft.followUp, resolvesObservationId: draft.resolvesObservationId,
    });
    setEditTarget(undefined);
    setToast('已追加本次記錄，之前的觀察仍保留在時間線。');
  };
  const startObservation = (target: Omit<EditTarget, 'eventId' | 'visitId'>) => setEditTarget({ ...target, eventId: createRecordId(), visitId: activeVisitId });
  const exportExcel = async () => {
    if (!snapshot) return;
    try {
      const { exportWorkflowWorkbook } = await import('../data/workflowWorkbook');
      const url = URL.createObjectURL(new Blob([exportWorkflowWorkbook(snapshot)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      download(url, 'CareFlow_紙本回錄工作簿.xlsx');
      setTimeout(() => URL.revokeObjectURL(url), 10000); setToast('Excel 已準備，已交由瀏覽器下載。');
    } catch { setImportError('Excel 匯出失敗，請重試。'); }
  };
  const exportData = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    download(url, 'careflow-synthetic-records.json');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('已匯出演示資料，包含完整觀察歷史。');
  };

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); workspace.selectBuilding(); }} aria-label="CareFlow 街區總覽"><span className="brand-symbol"><Footprints size={21} strokeWidth={1.8} /></span><strong>CareFlow<span>Atlas</span></strong></a>
      <div className="product-divider" /><span className="product-name">外展工作台</span>
      <span className="demo-badge"><span />DEMO DATA · Synthetic records only</span>
      <button ref={helpButtonRef} className="help-button icon-button" aria-label="示範說明" aria-expanded={helpOpen} aria-controls="demo-help" onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={19} /></button>
      <button className="help-button icon-button" aria-label="工作台設定" title="工作台設定" onClick={() => setSettingsOpen(true)}><Settings2 size={19} /></button>
      <div className="worker-avatar" title="合成示範工作員">CF</div>
    </header>
    <main className={`workspace ${selectedBuildingId ? 'has-selection' : ''} ${listMode ? 'list-mode' : ''}`}>
      <aside className={`district-sidebar ${hasDistrictDemo ? 'is-expanded-demo' : ''}`} aria-label="外展大廈清單">
        <div className={`sidebar-heading ${snapshot ? "has-records" : ""}`}><span className="eyebrow">FIELD OUTREACH</span><h1>{snapshot ? "街區外展" : <>每一次到訪，<br /><span>都有跡可循。</span></>}</h1><p>西營盤社區客廳 · 洗樓示範</p></div>
        <div className="workspace-tabs" data-filter={filter}><button aria-pressed={filter === 'ALL'} className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}><Building2 size={16} />大廈<span>{snapshot?.buildings.length ?? '—'}</span></button><button aria-pressed={filter === 'FOLLOWUP'} className={filter === 'FOLLOWUP' ? 'active' : ''} onClick={() => setFilter('FOLLOWUP')}><RotateCcw size={15} />待跟進<span>{followupCount}</span></button></div>
        {snapshot ? <>
          <label className="building-search"><Search size={17} /><input ref={searchRef} type="search" onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} aria-label="搜尋大廈或地址" placeholder="搜尋大廈或地址" value={query} onChange={e => setQuery(e.target.value)} /><button type="button" className="search-clear" aria-label="清除搜尋" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={15} /></button></label>
          <div className="list-heading"><span>{filter === 'FOLLOWUP' ? '需要繼續跟進' : '街區大廈'}</span><span>{buildings.length} 幢</span></div>
          <div className="building-list">{buildings.map((building, index) => {
            const summary = getCoverageSummary(snapshot, building.id);
            const state = buildingState(snapshot, building.id);
            const selected = selectedBuildingId === building.id;
            return <BuildingCard key={building.id} name={building.name} address={building.address} floorCount={building.floorCount} index={index} state={state} summary={summary} selected={selected} onSelect={() => workspace.selectBuilding(building.id)} />;
          })}{!buildings.length && <div className="list-empty"><Search size={24} /><p>{query ? '找不到相符的大廈' : '暫無待跟進大廈'}</p><button onClick={() => { setQuery(''); setFilter('ALL'); }}>查看所有大廈</button></div>}</div>
          <div className="sidebar-context"><ShieldCheck size={17} /><p>「沒有記錄」不等於「沒有發現」。<br /><span>查看上次結果，再決定下一步。</span></p></div>
        </> : <div className="start-import"><span className="import-file-icon"><FileSpreadsheet size={30} strokeWidth={1.4} /></span><h2>從現有記錄開始</h2><p>把大廈和個人資料帶到同一張地圖，接續每一次外展。</p><button className="primary-button" onClick={openImport}><Upload size={16} />匯入示範 Excel<ChevronRight size={16} /></button><span className="import-hint">內附合成資料 · 欄位待機構確認</span><div className="import-steps"><span><b>01</b>檢視資料</span><span><b>02</b>探索樓層</span><span><b>03</b>記錄到訪</span></div></div>}
        <button className={`district-demo-entry ${hasDistrictDemo ? 'is-loaded' : ''}`} onClick={() => void loadDistrict()} disabled={importLoading}><Building2 size={18} /><span><strong>{hasDistrictDemo ? '街區擴展情境' : '探索完整街區'}</strong><small>{hasDistrictDemo ? '合成外展 · 可重新核對與合併' : '20 個地點 · 多次探訪與家庭情境'}</small></span><ArrowUpRight size={16} /></button>
        <div className="sidebar-footer"><button onClick={openImport}><FileSpreadsheet size={16} />紙本與 Excel</button><button disabled={!snapshot} onClick={() => void exportExcel()} aria-label="匯出 Excel 工作簿"><ArrowDownToLine size={16} /></button></div>
      </aside>
      <section className="spatial-workspace" aria-label="街區探索">
        <div className="map-topbar"><div><MapPin size={15} /><span>西營盤</span>{selectedBuildingId && <><ChevronRight size={13} /><strong>{snapshot?.buildings.find(b => b.id === selectedBuildingId)?.name}</strong>{selectedFloorId && <><ChevronRight size={13} /><span>{snapshot?.floors.find(f => f.id === selectedFloorId)?.label}</span></>}{selectedUnitId && <><ChevronRight size={13} /><span>{snapshot?.units.find(u => u.id === selectedUnitId)?.label.replace(/^.*? /, '')}</span></>}</>}</div><div className="map-view-switch" data-view={listMode ? "list" : "map"}><button aria-pressed={!listMode} className={!listMode ? 'active' : ''} onClick={() => setListMode(false)}><Map size={15} />地圖</button><button aria-pressed={listMode} className={listMode ? 'active' : ''} onClick={() => setListMode(true)}><ClipboardList size={15} />清單</button></div></div>
        <div className="spatial-content"><Suspense fallback={<div className="map-loading">正在準備地圖…</div>}><MapScene buildings={mapBuildings} selectedBuildingId={selectedBuildingId} selectedFloorId={selectedFloorId} expanded={expanded} onSelectBuilding={workspace.selectBuilding} onSelectFloor={workspace.selectFloor} onToggleExpanded={workspace.toggleExpanded} onOverview={() => workspace.selectBuilding()} /></Suspense></div>
        {!selectedBuildingId && snapshot && !listMode && <div className="map-prompt"><span><Building2 size={19} /></span><div><strong>從一幢大廈開始</strong><p>選擇地圖標記，讓每一層的記錄展開。</p></div><ChevronRight size={18} /></div>}
      </section>
      {snapshot && selectedBuildingId && <BuildingDetail snapshot={snapshot} selectedBuildingId={selectedBuildingId} selectedFloorId={selectedFloorId} selectedUnitId={selectedUnitId} onBack={() => workspace.selectBuilding()} onSelectFloor={workspace.selectFloor} onSelectUnit={workspace.selectUnit} onToggleTag={workspace.setTag} onFollowUpAction={workspace.actOnFollowUp} onStartObservation={startObservation} />}
      {listMode && !selectedBuildingId && <div className="list-instruction"><ClipboardList size={30} /><h2>大廈與樓層清單</h2><p>從大廈清單選擇地點，即可查看及新增到訪記錄。</p><button className="primary-button" onClick={() => snapshot?.buildings[0] && workspace.selectBuilding(snapshot.buildings[0].id)}>查看第一幢大廈<ChevronRight size={17} /></button></div>}
    </main>
    <footer className="app-statusbar"><span><i />{snapshot ? '示範資料儲存於本機瀏覽器' : '準備匯入合成資料'}</span><span>欄位、住戶及樓層均為示範 · 非真實機構記錄</span><span>FIELD NOTES, CONNECTED.</span></footer>
    {workspace.storageError && <div className="storage-banner" role="alert">{workspace.storageError}</div>}
    {toast && <div className="toast" key={toast} role="status"><Check size={17} /><span>{toast}</span><button aria-label="關閉提示" onClick={() => setToast('')}><X size={16} /></button></div>}
    {helpOpen && <div ref={helpRef} id="demo-help" className="help-popover" role="region" aria-label="示範說明"><strong>這是一個外展流程示範</strong><p>所有業務記錄、住戶及樓層結構均為合成。地圖底圖由 OpenFreeMap / OpenStreetMap 提供。</p><ol><li>匯入附帶的 Excel 並檢視欄位提示。</li><li>選擇大廈，展開樓層並找出待跟進單位。</li><li>追加結果，查看歷史和覆蓋狀態的變化。</li></ol><p>只在這個瀏覽器儲存，尚未提供跨裝置同步。</p><button onClick={() => setHelpOpen(false)}>知道了</button></div>}
    <ImportDialog notice={toast.startsWith('Excel 已準備') ? toast : undefined} open={importOpen} review={importReview} loading={importLoading} error={importError} onClose={() => setImportOpen(false)} onFile={loadFile} onLoadSample={loadSample} onLoadDistrict={loadDistrict} onDownloadDistrict={() => download('/demo/careflow-district-demo.xlsx', 'CareFlow_街區擴展_mock.xlsx')} onDownloadSample={() => download('/demo/careflow-paper-excel-mock.xlsx', 'CareFlow_紙本回錄_mock範本.xlsx')} onExport={snapshot ? () => void exportExcel() : undefined} onBackup={snapshot ? exportData : undefined} onPrint={snapshot?.buildings.length ? () => { setImportOpen(false); setPaperOpen(true); } : undefined} onRetry={openImport} onRemap={remapImport} onConfirmReplace={confirmImport} />
    {settingsOpen && <WorkspaceSettings open optionPrefs={workspace.optionPrefs} onOptionPrefsChange={workspace.setOptionPrefs} onClose={() => setSettingsOpen(false)} />}
    {paperOpen && snapshot && <PaperForm snapshot={snapshot} buildingId={selectedBuildingId} onClose={() => setPaperOpen(false)} />}
    {editTarget && <ObservationEditor open openFollowUps={snapshot ? getOpenFollowUps(snapshot).filter(task => task.buildingId === editTarget.buildingId && task.floorId === editTarget.floorId && task.unitId === editTarget.unitId) : []} targetLabel={editTarget.label} subjectId={editTarget.unitId ?? editTarget.buildingId} subjectType={editTarget.unitId ? 'UNIT' : 'BUILDING'} optionPrefs={workspace.optionPrefs} onClose={() => setEditTarget(undefined)} onSubmit={saveObservation} />}
  </div>;
}
