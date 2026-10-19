import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronRight, CircleHelp, FileSpreadsheet, Footprints, MapPin, RotateCcw, Search, Upload, X } from 'lucide-react';
import { useWorkspace } from './store';
import { PhotoIntake } from '../photos/PhotoIntake';
import { Camera } from 'lucide-react';
import { registerWorkspaceTools } from './webmcp';
import { createRecordId } from './recordId';
import { OUTREACH_STATES, buildingState, floorState, getCoverageSummary, isTagged, stateBreakdown, unitState, type OutreachSnapshot } from '../domain/types';
import type { MapBuilding } from '../map/mapModel';
import { BuildingCard } from '../components/BuildingCard';
import { BuildingDetail } from '../components/BuildingDetail';
import { ObservationEditor, type ObservationDraft } from '../components/ObservationEditor';
import { ImportDialog, type ImportReview } from '../components/ImportDialog';
import { PaperForm } from '../components/PaperForm';
import { SyncConflictDialog } from '../components/SyncConflictDialog';
import { AccountMenu } from '../components/AccountMenu';
import { features } from './features';
import { useAccount } from '../auth/accountContext';
import { stateColors, stateLabels, stateLegendNotes } from '../domain/presentation';
import { roomFormDefaults } from '../components/observationDefaults';
import { mergeWorkflow } from '../data/workflowMerge';
import { detectWorkbook, mergeOverride, recognitionBlocker, remapWorkbook, type MappingOverride } from '../imports/detector';
import '../components/workflow.css';
import '../styles.css';
import '../refinement.css';
import '../layout.css';

const MapScene = lazy(() => import('../map/MapScene'));
/*
 * The paper worker this demo writes down. It is deliberately not the signed-in
 * account: the field worker and the operator are different roles and are never
 * substituted for one another.
 */
const DEMO_WORKER_NAME = '示範工作員';
interface EditTarget {
  buildingId: string; floorId?: string; unitId?: string; label: string; visitId: string;
  /** One id per record the dialog will write: one for a single place, one per unit for a batch. */
  eventIds: string[];
  /** The picked units, when one result is being recorded at several of them at once. */
  unitIds?: string[];
}

/**
 * The escape hatch for a merge that cannot be reconciled at all. It overwrites the account端
 * copy, so it takes a second, explicit click; the banner has already said what that costs.
 */
function ReplaceRemoteButton() {
  const forcePushLocal = useWorkspace(state => state.forcePushLocal);
  const [confirming, setConfirming] = useState(false);
  return <button type="button" className="storage-banner__action" onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); forcePushLocal(); }}>
    {confirming ? '再按一次：覆寫帳號端' : '以本機版本覆寫帳號端'}
  </button>;
}

function download(url: string, name: string) {
  const a = document.createElement('a'); a.href = url; a.download = name;
  (document.querySelector('dialog[open]') ?? document.body).append(a); a.click(); a.remove();
}

export default function App() {
  const workspace = useWorkspace();
  // Photo intake sends pages to Azure, so it only appears once an administrator has turned it on.
  const photoIntake = useAccount()?.features.photoIntake === true;
  const { snapshot, selectedBuildingId, selectedFloorId, selectedUnitId, expanded } = workspace;
  const [importOpen, setImportOpen] = useState(false);
  const [importReview, setImportReview] = useState<ImportReview>();
  const importSource = useRef<{ buffer: ArrayBuffer; fileName: string } | undefined>(undefined);
  const importOverride = useRef<MappingOverride>({});
  const [pendingSnapshot, setPendingSnapshot] = useState<OutreachSnapshot>();
  const [importBaseline, setImportBaseline] = useState<OutreachSnapshot>();
  const [paperOpen, setPaperOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [importLoading, setImportLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>();
  const [activeVisitId] = useState(() => `visit-${createRecordId()}`);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'FOLLOWUP'>('ALL');
  const [toast, setToast] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  // Desktop floats the finder and the building panel over the map; phones stack them.
  const [floating, setFloating] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 761px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(min-width: 761px)');
    const change = () => setFloating(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  // Open while there is nothing to show; once data arrives the map comes first.
  const [finderOpen, setFinderOpen] = useState(true);
  const hasSnapshot = Boolean(snapshot);
  useEffect(() => { setFinderOpen(!hasSnapshot); }, [hasSnapshot]);
  /** What the floating cards cover, so the camera centres a building in the visible map.
      With a building open the map tools sit beside the panel, so the right side keeps
      their column too (panel 412 + tools 58). */
  const mapInsets = useMemo(() => ({ left: floating && finderOpen ? 356 : 0, right: floating && selectedBuildingId ? 470 : 0 }), [floating, finderOpen, selectedBuildingId]);
  // The "start with a building" hint is for a first look only; once a building has been opened it stays away.
  const [explored, setExplored] = useState(() => { try { return localStorage.getItem('careflow-atlas.explored') === '1'; } catch { return false; } });
  useEffect(() => { if (!selectedBuildingId || explored) return; setExplored(true); try { localStorage.setItem('careflow-atlas.explored', '1'); } catch { /* a hint only */ } }, [selectedBuildingId, explored]);
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
  // Resolves once the account端 copy has been read (or the local copy when there is no session).
  useEffect(() => { void workspace.initialize(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timer); }, [toast]);

  const mapBuildings = useMemo<MapBuilding[]>(() => snapshot?.buildings.map(building => {
    return {
      id: building.id, name: building.name, longitude: building.coordinates.lng, latitude: building.coordinates.lat,
      footprint: building.footprint, state: buildingState(snapshot, building.id), followUps: getCoverageSummary(snapshot, building.id).followUps,
      tagged: features.nodeTags && isTagged(snapshot, { buildingId: building.id }),
      floors: snapshot.floors.filter(f => f.buildingId === building.id).sort((a, b) => a.level - b.level).map(floor => {
        const scoped = getCoverageSummary(snapshot, building.id, floor.id);
        return {
          id: floor.id, label: floor.label, level: floor.level, state: floorState(snapshot, building.id, floor.id),
          hasFollowUp: scoped.followUps > 0, recorded: scoped.recorded, total: scoped.total ?? 0,
          breakdown: stateBreakdown(snapshot.units.filter(unit => unit.floorId === floor.id).map(unit => unitState(snapshot, building.id, unit.id))),
          tagged: features.nodeTags && isTagged(snapshot, { buildingId: building.id, floorId: floor.id }),
        };
      }),
    };
  }) ?? [], [snapshot]);

  const buildings = snapshot?.buildings.filter(building => `${building.name} ${building.address}`.includes(query) && (filter === 'ALL' || getCoverageSummary(snapshot, building.id).followUps > 0)) ?? [];
  // Counts buildings, the same unit the filtered list shows ("13 幢"), not tasks.
  const followupCount = snapshot?.buildings.filter(b => getCoverageSummary(snapshot, b.id).followUps > 0).length ?? 0;
  const hasDistrictDemo = snapshot?.buildings.some(building => building.id === 'district-16');

  const openImport = () => { setImportReview(undefined); setPendingSnapshot(undefined); setImportBaseline(undefined); setImportError(undefined); importSource.current = undefined; importOverride.current = {}; setImportOpen(true); };
  const parseFile = async (buffer: ArrayBuffer, fileName: string, override?: MappingOverride) => {
    const { parseWorkbook } = await import('../data/workbookImport');
    const { parseWorkflowWorkbook } = await import('../data/workflowWorkbook');
    const workflow = parseWorkflowWorkbook(buffer, fileName);
    const parsed = workflow ?? parseWorkbook(buffer);
    // New buildings take the OSM outline under their coordinate; shown below for checking.
    const { attachOsmOutlines } = await import('../data/osmOutlines');
    const outlined = parsed.snapshot ? await attachOsmOutlines(parsed.snapshot, workspace.snapshot) : undefined;
    const result = { ...parsed, snapshot: outlined?.snapshot };
    const merged = result.snapshot ? mergeWorkflow(workspace.snapshot, result.snapshot, workflow?.baseline) : undefined;
    importOverride.current = override ?? {};
    const recognition = detectWorkbook(buffer, importOverride.current);
    importSource.current = { buffer, fileName };
    setPendingSnapshot(result.snapshot); setImportBaseline(workflow?.baseline);
    const preview = result.snapshot?.observations.filter(o => !workspace.snapshot?.observations.some(current => current.id === o.id)).map(o => ({
      label: `${result.snapshot!.buildings.find(b => b.id === o.buildingId)?.name ?? o.buildingId} · ${result.snapshot!.units.find(u => u.id === o.unitId)?.label ?? result.snapshot!.floors.find(f => f.id === o.floorId)?.label ?? '大廈層面'} · ${o.occurredAt.slice(0, 10)}`,
      detail: [o.paperRef ? `紙本 ${o.paperRef}／${o.paperLine ?? '—'}` : '', o.note, o.followUp?.action, o.followUp?.timingNote].filter(Boolean).join(' · '),
    }));
    // Only layouts this workspace does not have yet; a repeat import declares nothing new.
    const layouts = workflow?.layouts?.filter(l => !workspace.snapshot?.floors.some(f => f.buildingId === l.buildingId)).map(l => ({
      label: `${l.name} · 新建 ${l.floors} 層、${l.units} 個單位`,
      detail: result.snapshot!.floors.filter(f => f.buildingId === l.buildingId).map(f => `${f.label}：${result.snapshot!.units.filter(u => u.floorId === f.id).map(u => u.label).join('、') || '未有單位'}`).join(' ／ '),
    }));
    setImportReview({ fileName, issues: [...result.issues, ...(merged?.issues ?? [])], counts: result.counts, canReplace: !!merged?.snapshot, changes: merged?.summary, preview, layouts, outlines: outlined?.notes, recognition });
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
  /** The empty workspace's one button: load the bundled district straight in, no review screen. */
  const loadDemo = async () => {
    setImportLoading(true);
    try {
      const response = await fetch('/demo/careflow-district-demo.xlsx');
      if (!response.ok) throw new Error(`示範資料下載失敗（HTTP ${response.status}），請稍後重試。`);
      const { parseWorkflowWorkbook } = await import('../data/workflowWorkbook');
      const result = parseWorkflowWorkbook(await response.arrayBuffer(), 'CareFlow 示範資料.xlsx');
      if (!result?.snapshot) throw new Error(`示範資料檢查不通過：${result?.issues.find(i => i.severity === 'error')?.message ?? '檔案格式不正確'}`);
      workspace.mergeSnapshot(result.snapshot, result.baseline);
      setToast('已載入示範資料。');
    } catch (error) { setToast(error instanceof Error ? error.message : '示範資料未能載入，請重試。'); }
    finally { setImportLoading(false); }
  };
  const loadDistrict = async () => {
    openImport(); setImportLoading(true);
    try {
      const response = await fetch('/demo/careflow-district-demo.xlsx');
      if (!response.ok) throw new Error('街區範例未能載入，請重試。');
      await parseFile(await response.arrayBuffer(), 'CareFlow 示範資料.xlsx');
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
    const common = {
      visitId: editTarget.visitId, buildingId: editTarget.buildingId,
      occurredAt: draft.occurredAt, recordedAt: new Date().toISOString(), workerName: DEMO_WORKER_NAME,
      coverage: draft.coverage, assessment: draft.assessment,
      sourceType: draft.sourceType, optionNotes: draft.optionNotes, note: draft.note, evidence: draft.evidence, followUp: draft.followUp,
    };
    /*
     * One result at every picked unit. Each unit gets its own record id and its own floor,
     * and the whole set is written in one step: the units that cannot be confirmed free of
     * 劏房 are counted and left out rather than silently dropped.
     */
    if (editTarget.unitIds?.length) {
      const inputs = editTarget.unitIds.map((unitId, index) => ({
        ...common, id: editTarget.eventIds[index],
        floorId: snapshot?.units.find(unit => unit.id === unitId)?.floorId, unitId,
      }));
      const result = workspace.recordBatch(inputs, Boolean(draft.confirmNoSubdivision));
      setEditTarget(undefined);
      setToast(result.skipped
        ? `已為 ${result.saved} 個單位各寫入一筆記錄；${result.skipped} 個已分拆的單位不能確認無劏房，未有改動。`
        : `已為 ${result.saved} 個單位各寫入一筆記錄${result.confirmed ? `，並確認其中 ${result.confirmed} 個無劏房` : ''}。`);
      return;
    }
    workspace.saveObservation({ ...common, id: editTarget.eventIds[0], floorId: editTarget.floorId, unitId: editTarget.unitId });
    setEditTarget(undefined);
    setToast('已追加本次記錄，之前的觀察仍保留在時間線。');
  };
  /* A batch carries one id per picked unit, so every record it writes is its own record. */
  const startObservation = (target: Omit<EditTarget, 'eventIds' | 'visitId'>) => setEditTarget({
    ...target, visitId: activeVisitId,
    eventIds: Array.from({ length: target.unitIds?.length || 1 }, () => createRecordId()),
  });
  /*
   * What an entry form opens with for the place it is about. A 劏房 room is answered for and
   * follows the last record that speaks for it; an ordinary unit opens unanswered. The rule
   * and its reasoning live in `roomFormDefaults`, beside the coverage mapping it uses.
   */
  const editUnit = editTarget && snapshot ? snapshot.units.find(unit => unit.id === editTarget.unitId) : undefined;
  const editDefaults = snapshot ? roomFormDefaults(snapshot, editUnit) : {};
  const exportBlank = async () => {
    try {
      const [{ exportWorkflowWorkbook }, { blankSnapshot }] = await Promise.all([import('../data/workflowWorkbook'), import('../data/blankSnapshot')]);
      const url = URL.createObjectURL(new Blob([exportWorkflowWorkbook(blankSnapshot())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      download(url, 'CareFlow_空白範本.xlsx');
      setTimeout(() => URL.revokeObjectURL(url), 10000); setToast('Excel 已準備：空白範本已交由瀏覽器下載。');
    } catch { setImportError('空白範本下載失敗，請重試。'); }
  };
  /*
   * The current workbook, handed to the browser. It answers whether the file was actually
   * taken rather than only reporting it: deleting records waits on this answer, and a
   * download that failed must not read as a backup that exists.
   */
  const downloadWorkbook = async (): Promise<boolean> => {
    if (!snapshot) return false;
    try {
      const { exportWorkflowWorkbook } = await import('../data/workflowWorkbook');
      const url = URL.createObjectURL(new Blob([exportWorkflowWorkbook(snapshot)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      download(url, 'CareFlow_紙本回錄工作簿.xlsx');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    } catch { return false; }
  };
  const exportExcel = async () => {
    if (!snapshot) return;
    if (await downloadWorkbook()) setToast('Excel 已準備，已交由瀏覽器下載。');
    else setImportError('Excel 匯出失敗，請重試。');
  };

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); workspace.selectBuilding(); }} aria-label="CareFlow 街區總覽"><span className="brand-symbol"><Footprints size={21} strokeWidth={1.8} /></span><strong>CareFlow<span>Atlas</span></strong></a>
      <span className="cf-caps app-header__place">西營盤 · Sai Ying Pun · 外展工作台</span>
      <span className="demo-badge"><span />示範資料</span>
      <button ref={helpButtonRef} className="help-button icon-button" aria-label="示範說明" aria-expanded={helpOpen} aria-controls="demo-help" onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={19} /></button>
      <AccountMenu />
      {snapshot && photoIntake && <button className="photo-entry" onClick={() => setPhotoOpen(true)}><Camera size={16} />照片回錄</button>}
    </header>
    <main className={`workspace ${selectedBuildingId ? 'has-selection' : ''}`}>
      {/* On desktop the finder floats over the map: a one-line bar, opened when needed to
          locate a building and closed again once one is chosen. Phones keep the stacked list. */}
      <aside className={`district-sidebar ${hasDistrictDemo ? 'is-expanded-demo' : ''} ${finderOpen ? 'is-open' : ''}`} aria-label="外展大廈清單">
        <button type="button" className="finder-bar" aria-expanded={finderOpen} aria-controls="finder-body" onClick={() => setFinderOpen(!finderOpen)}>
          <MapPin size={16} /><strong>西營盤</strong>
          <span>{snapshot ? `${snapshot.buildings.length} 幢 · ${followupCount} 幢待跟進` : '未載入資料'}</span>
          <ChevronDown size={16} className="finder-bar__chevron" />
        </button>
        <div className="finder-body" id="finder-body">
        <div className={`sidebar-heading ${snapshot ? "has-records" : ""}`}><span className="eyebrow">FIELD OUTREACH</span><h1>{snapshot ? "街區外展" : <>每一次到訪，<br /><span>都有跡可循。</span></>}</h1><p>西營盤社區客廳 · 洗樓示範</p></div>
        {snapshot && <div className="workspace-tabs" data-filter={filter}><button aria-pressed={filter === 'ALL'} className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}><Building2 size={16} />大廈<span>{snapshot?.buildings.length ?? '—'}</span></button><button aria-pressed={filter === 'FOLLOWUP'} className={filter === 'FOLLOWUP' ? 'active' : ''} onClick={() => setFilter('FOLLOWUP')}><RotateCcw size={15} />待跟進<span>{followupCount}</span></button></div>}
        {snapshot ? <>
          <label className="building-search"><Search size={17} /><input ref={searchRef} type="search" onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} aria-label="搜尋大廈或地址" placeholder="搜尋大廈或地址" value={query} onChange={e => setQuery(e.target.value)} /><button type="button" className="search-clear" aria-label="清除搜尋" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={15} /></button></label>
          <div className="list-heading"><span className="cf-caps">Index · {filter === 'FOLLOWUP' ? '需要繼續跟進' : '街區大廈'}</span><span>{buildings.length} 幢</span></div>
          <div className="building-list">{buildings.map((building, index) => {
            const summary = getCoverageSummary(snapshot, building.id);
            const state = buildingState(snapshot, building.id);
            const selected = selectedBuildingId === building.id;
            return <BuildingCard key={building.id} name={building.name} address={building.address} floorCount={building.floorCount} index={index} state={state} summary={summary} selected={selected} onSelect={() => { workspace.selectBuilding(building.id); setFinderOpen(false); }} />;
          })}{!buildings.length && <div className="list-empty"><Search size={24} /><p>{query ? '找不到相符的大廈' : '暫無待跟進大廈'}</p><button onClick={() => { setQuery(''); setFilter('ALL'); }}>查看所有大廈</button></div>}</div>
        </> : workspace.loading
          // The account端 copy has not arrived yet; offering "load demo" here would invite a merge into it.
          ? <div className="start-import" role="status"><span className="import-file-icon"><FileSpreadsheet size={30} strokeWidth={1.4} /></span><h2>正在讀取帳號端的資料…</h2><p>稍候片刻。若長時間沒有回應，請檢查網絡後重新整理。</p></div>
          : <div className="start-import"><span className="import-file-icon"><FileSpreadsheet size={30} strokeWidth={1.4} /></span><h2>開始使用</h2><p>載入一個虛構街區試用：20 幢大廈、多次探訪和待跟進事項。也可以下載空白範本，填上你們自己的大廈再匯入。</p><button className="primary-button" disabled={importLoading} onClick={() => void loadDemo()}><Upload size={16} />{importLoading ? '載入中…' : '載入示範資料'}<ChevronRight size={16} /></button><button className="start-import__secondary" onClick={openImport}><FileSpreadsheet size={16} />匯入自己的 Excel／下載空白範本</button></div>}
        {/* One way into paper and Excel: printing, exporting and importing all live in that dialog. */}
        {snapshot && <div className="sidebar-footer"><button onClick={openImport}><FileSpreadsheet size={16} />紙本與 Excel</button></div>}
        </div>
      </aside>
      <section className="spatial-workspace" aria-label="街區探索">
        <div className="map-topbar"><div><MapPin size={15} /><span>西營盤</span>{selectedBuildingId && <><ChevronRight size={13} /><strong>{snapshot?.buildings.find(b => b.id === selectedBuildingId)?.name}</strong>{selectedFloorId && <><ChevronRight size={13} /><span>{snapshot?.floors.find(f => f.id === selectedFloorId)?.label}</span></>}{selectedUnitId && <><ChevronRight size={13} /><span>{snapshot?.units.find(u => u.id === selectedUnitId)?.label.replace(/^.*? /, '')}</span></>}</>}</div></div>
        <div className="spatial-content"><Suspense fallback={<div className="map-loading">正在準備地圖…</div>}><MapScene buildings={mapBuildings} insets={mapInsets} selectedBuildingId={selectedBuildingId} selectedFloorId={selectedFloorId} expanded={expanded} onSelectBuilding={workspace.selectBuilding} onSelectFloor={workspace.selectFloor} onToggleExpanded={workspace.toggleExpanded} onOverview={() => workspace.selectBuilding()} onSaveFootprint={(id, ring) => { try { workspace.setFootprint(id, ring); setToast('已儲存大廈形狀。記錄沒有改變。'); } catch { setToast('形狀未能儲存，請重試。'); } }} onAddBuilding={input => { try { const refused = workspace.addBuilding(input); if (!refused) { setToast(`已新增「${input.name.trim()}」。`); setFinderOpen(false); } return refused; } catch { return { error: '未能儲存，請重試。', field: '' }; } }} /></Suspense></div>
        {!selectedBuildingId && snapshot && !explored && <div className="map-prompt"><span><Building2 size={19} /></span><div><strong>從一幢大廈開始</strong><p>選擇地圖標記，讓每一層的記錄展開。</p></div><ChevronRight size={18} /></div>}
      </section>
      {snapshot && selectedBuildingId && <BuildingDetail snapshot={snapshot} selectedBuildingId={selectedBuildingId} selectedFloorId={selectedFloorId} selectedUnitId={selectedUnitId} onBack={() => workspace.selectBuilding()} onSelectFloor={workspace.selectFloor} onSelectUnit={workspace.selectUnit} onToggleTag={workspace.setTag} onFollowUpAction={workspace.actOnFollowUp} onStartObservation={startObservation} onStructureChange={features.structureEditing ? change => { const result = workspace.changeStructure(change); if ('error' in result) return result.error; setToast(result.message); return undefined; } : undefined} onBackup={downloadWorkbook} />}
    </main>
    {workspace.storageError && <div className="storage-banner" role="alert">
      <span>{workspace.storageError}</span>
      {workspace.pendingConflicts.length > 0 && <button type="button" className="storage-banner__action" onClick={workspace.openConflicts}>立即處理</button>}
      {workspace.syncBlocked && !workspace.pendingConflicts.length && <ReplaceRemoteButton />}
      <button type="button" className="storage-banner__close" aria-label="關閉提示" onClick={workspace.dismissStorageError}><X size={16} /></button>
    </div>}
    {toast && <div className="toast" key={toast} role="status"><Check size={17} /><span>{toast}</span><button aria-label="關閉提示" onClick={() => setToast('')}><X size={16} /></button></div>}
    {helpOpen && <div ref={helpRef} id="demo-help" className="help-popover" role="region" aria-label="示範說明"><strong>這是一個外展流程示範</strong><p>大廈、住戶及記錄全部虛構。資料存放在登入的帳號：換一部裝置用同一帳號登入，會看到同一份；但這仍是示範資料，不是正式的機構業務資料庫。</p><h3>顏色</h3><ul className="help-legend">{OUTREACH_STATES.map(state => <li key={state}><i style={{ background: stateColors[state] }} /><b>{stateLabels[state]}</b>{stateLegendNotes[state]}</li>)}</ul><p>「沒有記錄」不等於「沒有發現」：先查看上次結果，再決定下一步。</p><p className="help-credit">地圖底圖由 OpenFreeMap / OpenStreetMap 提供。</p><button onClick={() => setHelpOpen(false)}>知道了</button></div>}
    <ImportDialog notice={toast.startsWith('Excel 已準備') ? toast : undefined} open={importOpen} review={importReview} loading={importLoading} error={importError} onClose={() => setImportOpen(false)} onFile={loadFile} onLoadDistrict={loadDistrict} onExport={() => void (snapshot ? exportExcel() : exportBlank())} exportLabel={snapshot ? undefined : '下載空白範本'} onPrint={snapshot?.buildings.length ? () => { setImportOpen(false); setPaperOpen(true); } : undefined} onRetry={openImport} onRemap={remapImport} onConfirmReplace={confirmImport} />
    {workspace.conflictsOpen && workspace.pendingConflicts.length > 0 && <SyncConflictDialog conflicts={workspace.pendingConflicts} onResolve={workspace.resolveConflicts} onDefer={workspace.deferConflicts} />}
    {paperOpen && snapshot && <PaperForm snapshot={snapshot} buildingId={selectedBuildingId} onClose={() => setPaperOpen(false)} />}
    {snapshot && photoIntake && workspace.operator && <PhotoIntake key={workspace.operator.accountId} onApplyProposal={features.structureEditing ? workspace.applyLocationProposal : undefined} open={photoOpen} snapshot={snapshot} operator={workspace.operator} onClose={() => setPhotoOpen(false)} onSave={workspace.savePhotoPages} onView={(buildingId, unitId) => { workspace.selectBuilding(buildingId); if (unitId) workspace.selectUnit(unitId); setFinderOpen(false); }} />}
    {editTarget && <ObservationEditor open targetLabel={editTarget.label} subjectId={editTarget.unitIds ? undefined : editTarget.unitId ?? editTarget.buildingId} subjectType={editTarget.unitId ? 'UNIT' : 'BUILDING'} batch={editTarget.unitIds ? { units: editTarget.unitIds.length } : undefined} optionPrefs={workspace.optionPrefs} defaultCoverage={editDefaults.coverage} defaultAssessment={editDefaults.assessment} onClose={() => setEditTarget(undefined)} onSubmit={saveObservation} />}
  </div>;
}
