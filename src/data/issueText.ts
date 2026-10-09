import { ZodError } from 'zod';
import type { OutreachSnapshot } from '../domain/types';
import type { WorkbookImportIssue } from './workbookImport';

/**
 * Every import issue has two audiences. `message` is for the centre staff member fixing
 * the sheet: what is wrong and what to do, in their words. `detail` is for us: codes,
 * ids and raw values, shown folded. Never put internal ids or English in `message`.
 */
export type IssueInput = Omit<WorkbookImportIssue, 'severity' | 'code'> & { severity?: WorkbookImportIssue['severity']; code: string };
export const issue = (input: IssueInput): WorkbookImportIssue => ({ severity: 'error', ...input });

/** Where a record sits, in the words of the sheet: 「裕安樓 5F B室」. */
export function placeLabel(snapshot: OutreachSnapshot, at: { buildingId: string; floorId?: string; unitId?: string }) {
  const building = snapshot.buildings.find(b => b.id === at.buildingId)?.name ?? at.buildingId;
  const unit = snapshot.units.find(u => u.id === at.unitId)?.label;
  const floor = snapshot.floors.find(f => f.id === at.floorId)?.label;
  return `${building} ${unit ?? floor ?? '整幢'}`;
}

/**
 * The schema check is the last line of defence; a reachable problem should have been
 * explained before it. When one still gets here, say so plainly and keep the raw
 * validator output for us instead of showing it to staff.
 */
export function schemaIssues(error: unknown, snapshot: OutreachSnapshot, fallbackSheet = '資料關聯'): WorkbookImportIssue[] {
  const raw = error instanceof ZodError ? error.issues : [{ path: [] as PropertyKey[], message: error instanceof Error ? error.message : String(error) }];
  return raw.map(entry => {
    const [collection, index] = entry.path;
    const record = typeof collection === 'string' && typeof index === 'number' ? (snapshot as unknown as Record<string, Array<Record<string, unknown>>>)[collection]?.[index] : undefined;
    const source = record?.importSource as { sheet?: string; row?: number } | undefined;
    return issue({
      code: 'DATA_RELATION', sheet: source?.sheet ?? fallbackSheet, row: source?.row,
      message: source?.row ? '這一行和其他記錄的關係對不上，暫時不能合併。請先檢查這一行的大廈、位置和編號；如仍未解決，請把下方技術資料交給我們。' : '資料之間的關係對不上，暫時不能合併。請把下方技術資料交給我們處理。',
      detail: `${entry.path.join('.') || '(root)'}: ${entry.message}${record?.id ? ` · id=${String(record.id)}` : ''}`,
    });
  });
}
