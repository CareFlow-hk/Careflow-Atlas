import { useWorkspace } from './store';
import { buildingState, getCoverageSummary } from '../domain/types';

interface ModelTool {
  name: string; description: string; inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
}
interface ModelContext { registerTool: (tool: ModelTool, options: { signal: AbortSignal }) => void | Promise<void>; }

/** Optional navigation surface; imports/saves retain their visible review step. */
export function registerWorkspaceTools() {
  const context = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  const register = (tool: ModelTool) => {
    try { void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => undefined); }
    catch { /* Optional browser capability; the same workflow remains in the UI. */ }
  };
  register({
    name: 'read_outreach_workspace', description: 'Read synthetic building coverage summaries and current selection. Does not expose names of people or observation notes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => {
      const state = useWorkspace.getState();
      return { synthetic: true, selectedBuildingId: state.selectedBuildingId, selectedFloorId: state.selectedFloorId, selectedUnitId: state.selectedUnitId,
        // `state` is what the product shows; the summary counts and its older seven-value
        // status stay for the workbook and the W0 vocabulary that depend on them.
        buildings: state.snapshot?.buildings.map(b => ({ id: b.id, name: b.name, state: buildingState(state.snapshot!, b.id), ...getCoverageSummary(state.snapshot!, b.id) })) ?? [] };
    },
  });
  register({
    name: 'navigate_outreach_building', description: 'Select one imported synthetic building in the map and detail panel. Does not save or modify outreach records.',
    inputSchema: { type: 'object', properties: { buildingId: { type: 'string' } }, required: ['buildingId'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async input => {
      if (!input || typeof input !== 'object' || !('buildingId' in input) || typeof input.buildingId !== 'string') throw new Error('buildingId is required.');
      const state = useWorkspace.getState();
      if (!state.snapshot?.buildings.some(b => b.id === input.buildingId)) throw new Error('Unknown imported building.');
      state.selectBuilding(input.buildingId);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      return { selectedBuildingId: useWorkspace.getState().selectedBuildingId };
    },
  });
  return () => controller.abort();
}
