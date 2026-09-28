import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Map as LibreMap, Marker, MercatorCoordinate, NavigationControl, ScaleControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Compass, Layers3, Minus, Plus, RotateCcw, RotateCw, Scan, WifiOff } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Polygon } from 'geojson';
import { buildingFeatures, districtBounds, visibleDistrictLabels, DISTRICT_CAMERA, floorFeatures, floorBase, footprintOf, markerLabel, FLOOR_HEIGHT, type MapBuilding } from './mapModel';
import { easeInOutCubic, motionDuration, spatialMotion } from '../app/motion';
import { contextPosition, focusHeight } from './focusContext';
import { mapSceneColors, stateColors, stateLabels, stateLegendNotes } from '../domain/presentation';
import { OUTREACH_STATES } from '../domain/types';
import './map.css';

// MapLibre 6 ships a separate worker. Let Vite bundle and resolve it in both modes.
setWorkerUrl(mapWorkerUrl);

// The overview is a readable district model: real footprints, compressed context heights.
// Focused context keeps its existing camera-relative cutaway and source heights.
const overviewContextHeight: ExpressionSpecification = ['min', 24, ['*', ['get', 'height'], .35]];
const overviewContextBase: ExpressionSpecification = ['min', overviewContextHeight, ['*', ['get', 'base'], .35]];

interface MapSceneProps {
  buildings: MapBuilding[];
  selectedBuildingId?: string;
  selectedFloorId?: string;
  expanded: boolean;
  onSelectBuilding: (id: string) => void;
  onSelectFloor: (id: string) => void;
  onToggleExpanded: () => void;
  onOverview: () => void;
}

export default function MapScene(props: MapSceneProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const current = useRef(props);
  const separation = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [hover, setHover] = useState<{ x: number; y: number; title: string; subtitle: string }>();
  const [is3D, setIs3D] = useState(DISTRICT_CAMERA.pitch > 10);
  const [bearing, setBearing] = useState(DISTRICT_CAMERA.bearing);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const markers = useRef<Marker[]>([]);
  const floorLabelElements = useRef(new Map<string, HTMLButtonElement>());
  const active = props.buildings.find(b => b.id === props.selectedBuildingId);
  // Observation edits should refresh colours without moving the user's camera.
  const extentKey = JSON.stringify(props.buildings.map(b => [b.id, b.longitude, b.latitude, b.footprint]));
  const recordedUnits = props.buildings.reduce((sum, b) => sum + b.floors.reduce((n, f) => n + f.recorded, 0), 0);
  const knownUnits = props.buildings.reduce((sum, b) => sum + b.floors.reduce((n, f) => n + f.total, 0), 0);

  const frameDistrict = (map: LibreMap) => {
    const bounds = districtBounds(current.current.buildings);
    const width = map.getCanvas().clientWidth, height = map.getCanvas().clientHeight;
    const camera = bounds ? map.cameraForBounds(bounds, {
      bearing: DISTRICT_CAMERA.bearing, maxZoom: 17.3,
      padding: { top: Math.min(145, height * .23), bottom: Math.min(120, height * .2), left: Math.min(65, width * .1), right: Math.min(95, width * .14) },
    }) : undefined;
    map.flyTo({ ...(camera ?? DISTRICT_CAMERA), zoom: camera ? (camera.zoom ?? DISTRICT_CAMERA.zoom) + .25 : DISTRICT_CAMERA.zoom,
      pitch: DISTRICT_CAMERA.pitch, offset: [0, 0], padding: 0,
      duration: motionDuration(spatialMotion.overview), easing: easeInOutCubic, essential: false });
  };

  useEffect(() => { current.current = props; });
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!container.current) return;
    let map: LibreMap;
    let disposed = false;
    let loaded = false;
    const timeout = window.setTimeout(() => { if (!loaded) setFailed(true); }, 18000);
    try {
      map = new LibreMap({
        container: container.current,
        style: import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
        ...DISTRICT_CAMERA, maxPitch: 68,
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
      map.addControl(new NavigationControl({ showCompass: false, showZoom: false }), 'bottom-right');
      map.on('error', () => { if (!loaded) setNotice('正在連接底圖；可先從大廈清單查看及記錄。'); });
      map.on('webglcontextlost', () => setFailed(true));
      map.on('webglcontextrestored', () => { setFailed(false); map.triggerRepaint(); });
      map.on('load', () => {
        if (disposed) return;
        loaded = true;
        window.clearTimeout(timeout);
        setFailed(false);
        setNotice('');
        map.setGlobalStateProperty('focusBearing', map.getBearing());
        const firstLabel = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
        map.addSource('outreach-buildings', { type: 'geojson', data: buildingFeatures(current.current.buildings) });
        map.addSource('focused-city', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'focused-city', source: 'focused-city', type: 'fill-extrusion', paint: {
          'fill-extrusion-color': mapSceneColors.contextBuilding, 'fill-extrusion-height': overviewContextHeight,
          'fill-extrusion-base': overviewContextBase, 'fill-extrusion-opacity': .72,
        } }, firstLabel);
        map.addLayer({ id: 'outreach-footprints', source: 'outreach-buildings', type: 'fill', paint: {
          'fill-color': ['get', 'color'], 'fill-opacity': .2,
        } });
        map.addLayer({ id: 'outreach-footprint-edges', source: 'outreach-buildings', type: 'line', paint: {
          'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 2], 'line-opacity': .85,
        } });
        map.addLayer({ id: 'outreach-buildings', source: 'outreach-buildings', type: 'fill-extrusion', paint: {
          'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': .96, 'fill-extrusion-vertical-gradient': true,
        } });
        map.addSource('outreach-selected', { type: 'geojson', data: buildingFeatures([]) });
        map.addLayer({ id: 'outreach-selected', source: 'outreach-selected', type: 'fill-extrusion', paint: {
          'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 1,
        } });
        map.addLayer({ id: 'outreach-selection-outline', source: 'outreach-selected', type: 'line', paint: {
          'line-color': mapSceneColors.selectionOutline, 'line-width': 2, 'line-opacity': .8,
        } });
        map.addSource('outreach-floors', { type: 'geojson', data: floorFeatures(undefined, 0) });
        map.addLayer({ id: 'outreach-floors', source: 'outreach-floors', type: 'fill-extrusion', paint: {
          'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.97, 'fill-extrusion-vertical-gradient': true,
        } });
        map.addLayer({
          id: 'floor-label-projection', type: 'custom', renderingMode: '3d',
          render: (_gl, options) => {
            const p = current.current;
            const building = p.buildings.find(b => b.id === p.selectedBuildingId);
            if (!building) return;
            const matrix = options.defaultProjectionData.mainMatrix;
            const canvas = map.getCanvas();
            building.floors.forEach((floor, index) => {
              const element = floorLabelElements.current.get(floor.id);
              if (!element) return;
              const altitude = floorBase(separation.current, index, building.floors.length) + FLOOR_HEIGHT / 2;
              const angle = map.getBearing() * Math.PI / 180;
              const bounds = contextPosition(footprintOf(building), building);
              const labelOffset = bounds.radius + 5;
              const point = MercatorCoordinate.fromLngLat([building.longitude + Math.cos(angle) * labelOffset / (111320 * Math.cos(building.latitude * Math.PI / 180)), building.latitude - Math.sin(angle) * labelOffset / 111320], altitude);
              const x = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12];
              const y = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13];
              const w = matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15];
              element.style.transform = `translate(${(x / w + 1) * canvas.clientWidth / 2}px,${(1 - y / w) * canvas.clientHeight / 2}px) translateY(-50%)`;
              const visible = p.expanded && separation.current > .65 && map.getPitch() > 25 && w > 0;
              element.style.opacity = visible ? '1' : '0';
              element.style.pointerEvents = visible ? 'auto' : 'none';
            });
          },
        });
        map.setLight({ anchor: 'viewport', color: mapSceneColors.light, intensity: 0.48, position: [1.5, 195, 35] });
        setReady(true);
      });
      const onClick = (e: MapMouseEvent) => {
        if (!loaded) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: ['outreach-floors', 'outreach-selected', 'outreach-buildings'] });
        if (hits[0]?.layer.id === 'outreach-floors') {
          current.current.onSelectFloor(String(hits[0].properties.id));
          return;
        }
        if (hits[0]) { current.current.onSelectBuilding(String(hits[0].properties.id)); return; }
        if (map.getLayer('building') && map.queryRenderedFeatures(e.point, { layers: ['building'] }).length) {
          setNotice('這幢大廈暫無示範記錄。請選擇有標記的大廈。');
        }
      };
      map.on('click', onClick);
      map.on('mousemove', e => {
        if (!loaded) return;
        const hit = map.queryRenderedFeatures(e.point, { layers: ['outreach-floors', 'outreach-selected', 'outreach-buildings'] })[0];
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
        if (!hit) { setHover(undefined); return; }
        const p = current.current;
        const selected = p.buildings.find(b => b.id === p.selectedBuildingId);
        const floor = selected?.floors.find(f => f.id === hit.properties.id);
        const building = p.buildings.find(b => b.id === hit.properties.id);
        setHover({ x: e.point.x, y: e.point.y, title: floor ? `${selected?.name} · ${floor.label}` : building?.name ?? '', subtitle: floor ? `${stateLabels[floor.state]} · ${floor.recorded}/${floor.total} 個單位有記錄${floor.hasFollowUp ? ' · 有待跟進' : ''}` : building ? stateLabels[building.state] : '' });
      });
      map.on('mouseout', () => setHover(undefined));
      map.on('pitchend', () => setIs3D(map.getPitch() > 10));
      map.on('rotate', () => {
        if (!loaded) return;
        map.setGlobalStateProperty('focusBearing', map.getBearing());
        setBearing(Math.round(map.getBearing()));
      });
      map.on('pitch', () => { if (map.getLayer('focused-city')) map.setPaintProperty('focused-city', 'fill-extrusion-opacity', (current.current.selectedBuildingId ? .4 : .72) * Math.min(1, map.getPitch() / 45)); });
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
      return () => {
        disposed = true; observer.disconnect(); window.clearTimeout(timeout);
        markers.current.forEach(m => m.remove()); markers.current = [];
        map.remove(); mapRef.current = null;
      };
    } catch {
      window.clearTimeout(timeout); setFailed(true);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const others = buildingFeatures(props.buildings, props.selectedBuildingId);
    if (active) others.features.forEach(feature => Object.assign(feature.properties!, contextPosition(feature.geometry.coordinates[0], active)));
    (map.getSource('outreach-buildings') as GeoJSONSource).setData(others);
    map.setPaintProperty('outreach-buildings', 'fill-extrusion-height', active ? focusHeight : ['get', 'height']);
    (map.getSource('outreach-selected') as GeoJSONSource).setData(buildingFeatures(active ? [active] : []));
    map.setLayoutProperty('outreach-selected', 'visibility', active?.floors.length ? 'none' : 'visible');
    markers.current.forEach(m => m.remove());
    /*
     * In focus mode the stylesheet hides every marker, this one included: the building's
     * name and task tag would otherwise sit over the floor stack that focusing is meant
     * to show. The building's own state and count stay readable in the detail panel.
     */
    markers.current = props.buildings.map(building => {
      // The wording and the class names come from `markerLabel`, so what a marker says
      // can be asserted without a browser; only the assembly happens here.
      const label = markerLabel(building, building.id === props.selectedBuildingId);
      const button = document.createElement('button');
      button.className = label.className;
      button.setAttribute('aria-label', label.ariaLabel);
      button.title = label.title;
      button.dataset.buildingId = building.id;
      button.dataset.labelWidth = String(label.labelWidth);
      const dot = document.createElement('span'); dot.style.background = stateColors[building.state];
      const name = document.createElement('strong'); name.textContent = building.name;
      button.append(dot, name);
      if (label.task) {
        const task = document.createElement('em'); task.className = 'building-map-marker__task';
        task.textContent = label.task;
        button.append(task);
      }
      button.addEventListener('click', e => { e.stopPropagation(); current.current.onSelectBuilding(building.id); });
      return new Marker({ element: button, anchor: 'bottom', offset: [0, -6] }).setLngLat([building.longitude, building.latitude]).addTo(map);
    });
    map.setPaintProperty('focused-city', 'fill-extrusion-height', active ? focusHeight : overviewContextHeight);
    map.setPaintProperty('focused-city', 'fill-extrusion-opacity', (active ? .4 : .72) * Math.min(1, map.getPitch() / 45));
    map.setPaintProperty('focused-city', 'fill-extrusion-base', active ? ['min', ['get', 'base'], focusHeight] : overviewContextBase);
  }, [props.buildings, props.selectedBuildingId, active, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.resize();
    setHover(undefined);
    setNotice('');
    if (active) {
      const stackZoom = 18.7 + Math.log2(8 / Math.max(8, active.floors.length)) + Math.min(0, Math.log2(map.getCanvas().clientHeight / 700), Math.log2(map.getCanvas().clientWidth / 720));
      map.flyTo({ center: [active.longitude, active.latitude], zoom: compact ? 17.8 : active.floors.length > 3 ? stackZoom : 18.7, pitch: 58, bearing: -24,
        // Reserve space above the floating controls, including on short desktops.
        offset: [0, compact ? 20 : active.floors.length > 3 ? Math.min(110, Math.max(0, map.getCanvas().clientHeight / 2 - 225)) : 0],
        duration: motionDuration(spatialMotion.focus), easing: easeInOutCubic, essential: false });
    } else {
      frameDistrict(map);
    }
  // Camera changes follow selection, not observation edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedBuildingId, ready, compact, extentKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource('openmaptiles')) return;
    let previous = '';
    const refresh = () => {
      const collection: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] };
      // Replace the basemap shells at every outreach footprint, in both views.
      // Use actual footprint bounds; a fixed exclusion square removes neighbours.
      const envelopes = props.buildings.map(building => footprintOf(building, .01));
      const seen = new Set<string>();
      for (const feature of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
        const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : [];
        for (const polygon of polygons) {
          const ring = polygon[0];
          const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          // Some tiles contain a building shell and overlapping building parts.
          // Remove interior overlaps as well as exact matches; shared edges stay.
          if (envelopes.some(envelope => Math.min(maxX, envelope[2][0]) - Math.max(minX, envelope[0][0]) > 1e-6 && Math.min(maxY, envelope[2][1]) - Math.max(minY, envelope[0][1]) > 1e-6)) continue;
          const key = `${feature.id}:${JSON.stringify(ring)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collection.features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: polygon }, properties: { ...(active ? contextPosition(ring, active) : { east: 0, north: 0, radius: 0 }), height: Number(feature.properties.render_height) || 6, base: Number(feature.properties.render_min_height) || 0 } });
        }
      }
      const signature = JSON.stringify(collection);
      if (signature !== previous) { previous = signature; (map.getSource('focused-city') as GeoJSONSource).setData(collection); }
    };
    map.on('idle', refresh);
    refresh();
    return () => { map.off('idle', refresh); };
  }, [active, props.buildings, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('outreach-floors') as GeoJSONSource;
    const duration = motionDuration(spatialMotion.floors);
    const from = separation.current;
    const to = props.expanded ? 1 : 0;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = easeInOutCubic(t);
      separation.current = from + (to - from) * eased;
      source.setData(floorFeatures(active, separation.current, props.selectedFloorId));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, props.expanded, props.selectedFloorId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const arrange = () => {
      const labels = markers.current.map(marker => {
        const element = marker.getElement();
        const point = map.project(marker.getLngLat());
        return { id: element.dataset.buildingId!, x: point.x, y: point.y, width: Number(element.dataset.labelWidth) };
      });
      const canvas = map.getCanvas();
      const names = visibleDistrictLabels(labels, canvas.clientWidth, canvas.clientHeight);
      markers.current.forEach(marker => {
        const element = marker.getElement();
        element.classList.toggle('is-compact', !names.has(element.dataset.buildingId!));
      });
    };
    arrange();
    map.on('move', arrange);
    map.on('resize', arrange);
    return () => { map.off('move', arrange); map.off('resize', arrange); };
  }, [props.buildings, props.selectedBuildingId, ready]);

  const toggle3D = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: is3D ? 0 : 58, around: active ? [active.longitude, active.latitude] : undefined, duration: motionDuration(spatialMotion.pitch), easing: easeInOutCubic });
  };

  const rotateCamera = (targetBearing: number) => {
    mapRef.current?.easeTo({ bearing: targetBearing, around: active ? [active.longitude, active.latitude] : undefined,
      duration: motionDuration(650), easing: easeInOutCubic });
  };

  return <div className={`map-scene ${active ? 'is-focused' : ''}`} aria-label="西營盤外展地圖">
    <div ref={container} className="map-canvas" data-testid="map-canvas" />
    <div className="floor-map-labels" aria-hidden={!props.expanded || !is3D}>{active?.floors.map(floor => <button key={floor.id} ref={element => { if (element) floorLabelElements.current.set(floor.id, element); else floorLabelElements.current.delete(floor.id); }}
      className={`floor-map-label ${floor.hasFollowUp ? 'needs-followup' : ''} ${props.selectedFloorId === floor.id ? 'selected' : ''}`}
      style={{ '--cf-state': stateColors[floor.state] } as CSSProperties}
      aria-label={`在立體地圖選擇 ${floor.label} · ${stateLabels[floor.state]}${floor.hasFollowUp ? ' 待跟進' : ''}`} tabIndex={props.expanded && is3D ? 0 : -1}
      onClick={() => props.onSelectFloor(floor.id)}><strong>{floor.label}</strong>{floor.hasFollowUp && <span>待跟進</span>}</button>)}</div>
    {!ready && !failed && <div className="map-loading"><span className="loading-orbit" />正在載入西營盤地圖</div>}
    {failed && <div className="map-failure" role="status"><WifiOff size={22} /><strong>底圖暫時無法顯示</strong><span>你仍可從大廈清單查看樓層、記錄結果。</span></div>}
    <div className="map-location"><span>香港 · 中西區 / 外展街區</span><strong>西營盤 <small>Sai Ying Pun</small></strong>
      <div className="district-map-summary"><b>{props.buildings.length.toString().padStart(2, '0')}</b><span>個業務地點<small>{knownUnits ? `${recordedUnits} / ${knownUnits} 個已知單位有記錄` : '樓層與單位待確認'}</small></span></div>
    </div>
    <div className="map-tools" role="group" aria-label="相機控制" title="右鍵拖曳可自由旋轉及調整傾角">
      <button className="map-tool" aria-label="框選全部大廈" title="框選全部大廈" disabled={!ready} onClick={() => { if (active) props.onOverview(); else if (mapRef.current) frameDistrict(mapRef.current); }}><Scan size={19} /></button>
      <button className="map-tool" onClick={toggle3D} aria-label={is3D ? '切換平面地圖' : '切換立體地圖'} disabled={!ready}>{is3D ? '2D' : '3D'}</button>
      <button className="map-tool" aria-label="放大地圖" onClick={() => mapRef.current?.zoomIn({ duration: motionDuration(300), easing: easeInOutCubic })} disabled={!ready}><Plus size={19} /></button>
      <button className="map-tool" aria-label="縮小地圖" onClick={() => mapRef.current?.zoomOut({ duration: motionDuration(300), easing: easeInOutCubic })} disabled={!ready}><Minus size={19} /></button>
      <button className="map-tool rotation-tool" aria-label="向左旋轉視角 45 度" title="向左旋轉 45°" onClick={() => rotateCamera((mapRef.current?.getBearing() ?? 0) - 45)} disabled={!ready}><RotateCcw size={19} /></button>
      <button className="map-tool" aria-label="向右旋轉視角 45 度" title="向右旋轉 45°" onClick={() => rotateCamera((mapRef.current?.getBearing() ?? 0) + 45)} disabled={!ready}><RotateCw size={19} /></button>
      <button className="map-tool compass" aria-label="地圖朝北" title="回正北方" onClick={() => rotateCamera(0)} disabled={!ready}><Compass size={20} style={{ transform: `rotate(${-bearing}deg)` }} /><span>N</span></button>
      <output className="camera-bearing" aria-label="相機方位角">{(bearing + 360) % 360}°</output>
    </div>
    {active && <div className="building-focus-bar">
      <div><span className="eyebrow">正在查看 · 示意結構</span><strong>{active.name}<small>{active.floors.length ? `${active.floors.length} 層` : '樓層待確認'}</small></strong></div>
      <button className={`primary-button ${props.expanded ? 'is-active' : ''}`} onClick={props.onToggleExpanded} disabled={!active.floors.length}><Layers3 size={17} />{props.expanded ? '合攏樓層' : '展開樓層'}</button>
      <button className="icon-button" aria-label="返回街區總覽" onClick={props.onOverview}><RotateCcw size={18} /></button>
    </div>}
    {hover && <div className="map-hover" style={{ left: hover.x, top: hover.y }}><strong>{hover.title}</strong><span>{hover.subtitle}</span></div>}
    {notice && <button className="map-notice" onClick={() => setNotice('')} role="status">{notice}<span>×</span></button>}
    {/* Yellow is not "待跟進": a task shows as a badge, and a yellow without one means the levels disagree. */}
    <div className="map-legend">{OUTREACH_STATES.map(state => <span key={state} title={stateLegendNotes[state]}><i className="legend-swatch" style={{ background: stateColors[state] }} />{stateLabels[state]}<small>{stateLegendNotes[state]}</small></span>)}</div>
    <div className="geometry-note">{active ? '聚焦視圖 · 前景遮擋已壓低' : '背景高度已壓縮 · 業務地點及樓層為合成示意'}</div>
  </div>;
}
