# UI refinement · 2026-09-11

Preserve the spatial field-work interface; strengthen its hierarchy and interaction details. This is a targeted refinement, not a new visual identity.

## Research applied

- [NN/g: AI Prototyping in Real Design Contexts](https://www.nngroup.com/articles/ai-prototyping/) identifies generic patterns, weak grouping, poor contrast, inconsistent spacing, and missed contextual details. Here that led to stronger type contrast, a persistent location header and record action, explicit unit follow-ups, and a quieter historical timeline.
- [NN/g: Animation Duration](https://www.nngroup.com/articles/animation-duration/) recommends choosing timing by distance, complexity, and frequency. Controls use 160–240ms; panel/selection reveals use 280–360ms; the spatial camera uses 680–1350ms and floors 760ms. CSS uses a decelerating cubic Bézier for entering content and indicators; the camera uses a symmetric cubic curve.
- [W3C: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) supports disabling nonessential motion. Both CSS and map camera/floor controls respect the system reduced-motion preference. This is not a claim of full WCAG conformance.

## Consequential details

The selected floor is teal unless it has follow-up work; amber continues to mean follow-up/uncertainty. Completed follow-up events no longer retain an active amber treatment. Date-only follow-up deadlines show dates without fabricated times; observation time comes from the observation itself. Search has a functional clear button; Escape clears search and dismisses help; active controls expose pressed state.

> **Superseded 2026-09-28 by [COLOR_PIPELINE_DESIGN.md](../COLOR_PIPELINE_DESIGN.md).** Two sentences above no longer describe the code. Colour is now the four-state model (GREEN / YELLOW / RED / GRAY) and nothing else: a follow-up never repaints a node, so "amber means follow-up" is wrong — amber means a task is outstanding **or** the levels below disagree, and the task itself carries a category badge. Selection deepens a state's own hue instead of switching to teal. This section is kept as the record of the earlier refinement, not as current guidance.

The timeline scrolls between a fixed building header and a contextual record action. On phones, the action stays at the bottom while the document scrolls. Camera framing adjusts when crossing the mobile breakpoint. Adjacent map markers are hidden during building focus so they do not obscure the selected stack.

Floor gaps accumulate from the base upward. Each slab therefore carries the gaps below it; geometry and labels share the same elevation function. A regression test checks non-intersection through the supported 100-floor count and interrupted/reversing progress values.

No dependency, import contract, persistence format, or underlying business record is changed by this refinement.

## Verification

TypeScript, lint, 24 tests, and the production build pass. Interactive checks covered desktop and 390px mobile layouts, camera re-framing, floor selection, the fixed record action and modal, import review without replacing stored data, empty search/clear with focus restoration, and Escape dismissal of help. The mobile document width stayed at 390px. Reduced-motion behavior was checked in source; it was not separately emulated on a physical mobile device.

## Desktop focus and rotation follow-up

Phone recording is deferred. Selecting a building with declared floors now expands them by default; unknown layouts retain the single schematic building. Short desktop windows use a wider stack framing, and short buildings sit above the floating controls.

Focused context uses a camera-relative viewing corridor. Foreground footprints intersecting that corridor are lowered to a 2m visual base, with a blended edge; side and rear buildings retain their context height. This cutaway only changes presentation, never imported geometry or records. The selected building has its own unmasked layer. Bearing updates use MapLibre global state and do not reconstruct GeoJSON on every rotation frame.

Left/right controls rotate 45 degrees around the selected building over a 650ms cubic easing curve. North resets bearing; right-button dragging supports free rotation and pitch. Floor labels remain on the screen-right side as the camera rotates. Motion respects reduced-motion preferences.

Follow-up verification: TypeScript, lint, 29 tests and the production build pass. Expression tests cover every 15 degrees through a full rotation, wide footprints, blended edges and short structures; selection tests cover default expansion and unknown layouts. Desktop browser checks covered An Wo at multiple bearings, automatic floor expansion, rotated floor selection, north reset and short-window framing. No browser rendering errors were reported. No outreach records were changed during these checks.

## Building registration correction

The previous uniform 26 × 20m rectangles and arbitrary point offsets did not register with the basemap. All four demo buildings now use exact selected ground rings from the [OpenFreeMap tile dated 2026-09-06](https://tiles.openfreemap.org/planet/20260906_080001_pt/14/13386/7151.pbf), including Hoi King's irregular shape. Source coordinates, feature identifiers and attribution are retained in `demoGeometry.json`. OSM feature IDs may cover multiple polygons, so geometry is matched per polygon rather than hiding all features with the same ID. This is a synthetic scenario binding, not identification of the actual buildings by the demo names.

Map shells, floor slabs, ground outlines and camera anchors use this geometry. Basemap shells overlapping the interiors of the target footprint bounds are removed from context in both overview and focus, and label spacing accounts for footprint size. Legacy demo storage is upgraded on read without resetting history; custom imported coordinates and footprints are preserved. The downloadable Excel now round-trips optional footprint JSON.

Validation includes source-ring equality through closed/expanded geometry, legacy migration with history preservation and no writes on read, custom-location protection, footprint bounds and workbook round-trip. Desktop checks compare overhead and tilted views, rotation and expanded floors.

TypeScript, lint, all 33 tests and production build pass. Browser checks covered the four aligned demo buildings, Hoi King's overhead contour and Yu An's expanded stack. Existing browser records remained at 17/32 completed units for Yu An and one open follow-up elsewhere.
