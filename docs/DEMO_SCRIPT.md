# Demo script

Target duration: about two minutes. Use only synthetic workbooks and notes.

## Prepare

```bash
npm ci
npm run dev
```

Open the Vite URL on a laptop with network access. Use a separate fresh browser profile when demonstrating an empty workspace; preserve existing stored work. All three demo workbooks are checked into `public/demo`. Keep the building list available as the fallback if map resources fail.

## Main path

1. Point out the **示範資料** badge in the header (the **?** help panel explains the four colours). Ground footprints come from the basemap; building identities, residents, heights, floors and outreach events are fictional.
2. In an empty workspace select **載入示範資料**: the bundled district (20 buildings, 56 people, 362 units, 256 observations) loads directly. To show the Excel review instead, open **紙本與 Excel** → **重新載入示範資料**, then **確認合併資料**; existing history is preserved and a repeat import adds zero records.
3. Explore the tilted district overview. Background heights are compressed for legibility; every marked location remains selectable even when its name is collapsed to a dot. Use **框選全部大廈** to restore the view.
4. Select **晴川樓**. Its 14 declared floors expand automatically at the same ground footprint; each 3D floor label shows its unit composition. Drag to rotate, select the top floor and inspect the unvisited units. Contrast this with the lower floors that have dated records and a follow-up.
5. Open **1樓 A室** to inspect the original resident report, follow-up action, responsible worker and unconfirmed relative timing. Keep housing judgement separate from contact and support needs.
6. Return to the overview and select **青禾樓**, then **1樓 A室**. Show the original invitation and later information-reply completion. Finishing that task does not imply that all resident needs are resolved.
7. Open **紙本與 Excel**. Preview an A4 building paper form, then export the current Excel workbook. Explain the working sequence: paper outside, new Excel rows at the centre, review and merge, then a derived follow-up list.

## Optional append-and-close example

Choose a unit with an open task and press **標記完成** on the task in its history (or **取消跟進** with a reason). No visit is invented; the task leaves the open list and the history names who closed it and when. **撤銷** reopens it. Counts are derived from the actual workspace; do not promise fixed before/after numbers after previous demonstrations.

## Useful contrasts

- **青禾樓**: every declared unit has been checked, while historical findings remain visible.
- **和煦樓**: declared layout but no outreach yet.
- **知秋樓**: inaccessible entrance with unknown floor/unit totals.
- **微光樓**: no reliable record, not a negative finding.
- Download and re-import the workbook to show validation and duplicate detection. The complete JSON backup remains available.
- The list and records remain usable if map resources fail. Phone recording is deferred; the primary workflow is paper and centre-based Excel entry.

## Claims to avoid

Do not call the prototype an NGO deployment, adopted, approved, secure for real resident data, connected to government records, compatible with unavailable NGO Excel originals, multi-user, or offline-first. Do not present synthetic counts, layouts, households or membership outcomes as real.

## Questions for staff

- Which fields or statuses do not match the paper form?
- What counts as checking a unit, floor or building?
- When should no answer lead to a revisit, discussion or no further action?
- Which history must the next worker see before going out?
- Who reviews the centre's Excel updates, and how should conflicts be resolved?
