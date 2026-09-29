/**
 * Switches for features that exist in the data model but are hidden in the v1 demo.
 *
 * nodeTags — the manual FOLLOW_UP mark on a building or floor. Hidden because a
 * building-level follow-up already says what needs doing and can be closed; the bare
 * flag overlapped with it. Stored tags are kept and come back if this is turned on.
 */
export const features = { nodeTags: false } as const;
