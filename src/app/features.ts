/**
 * Switches for features that exist in the data model but are hidden in the v1 demo.
 *
 * nodeTags — the manual FOLLOW_UP mark on a building or floor. Hidden because a
 * building-level follow-up already says what needs doing and can be closed; the bare
 * flag overlapped with it. Stored tags are kept and come back if this is turned on.
 *
 * structureEditing — EXPERIMENTAL (2026-10-10, on-site with Samson): add floors and
 * units, split a unit into 劏房 rooms and batch-confirm "no subdivision" in the building
 * panel, instead of declaring the layout in Excel. Turn off to hide the editor; data stays.
 */
export const features = { nodeTags: false, structureEditing: true } as const;
