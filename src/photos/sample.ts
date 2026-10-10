import { photoPaperColors } from '../domain/presentation';
import type { OutreachSnapshot } from '../domain/types';
import { mapRow, type ExtractedRow, type PhotoPage } from './model';

export const blankRow: ExtractedRow = { building: null, address: null, floor: null, unit: null, scope: null, date: null, worker: null, coverage: null, contact: null, assessment: null, source: null, note: '', evidence: '', followUp: null, dueDate: null, timingNote: null, assignee: null, category: null, line: '', confidence: 0, uncertainties: [] };
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
/** `newRoom` adds a 劏房 row the building lacks, to show the semi-agent's structure proposal. */
export function samplePage(snapshot: OutreachSnapshot, { newRoom = false } = {}): PhotoPage {
  const building = snapshot.buildings.find(b => snapshot.units.filter(u => u.buildingId === b.id).length >= 2) ?? snapshot.buildings[0];
  const units = snapshot.units.filter(u => u.buildingId === building.id).slice(0, 2);
  const rows: ExtractedRow[] = (units.length ? units : [undefined]).map((unit, i) => ({ ...blankRow,
    building: building.name, address: building.address, floor: snapshot.floors.find(f => f.id === unit?.floorId)?.label ?? null, unit: unit?.label ?? null,
    scope: unit ? 'UNIT' : 'BUILDING', date: '2026-10-03', worker: '示範工作員', coverage: i ? 'VISITED_NO_FINDING' : 'ATTEMPTED', contact: i ? 'CONTACTED' : 'NO_ANSWER',
    note: i ? '已探訪，住戶想了解社區客廳活動。' : '拍門後無人應門，信箱已有宣傳單張。',
    followUp: i ? '致電介紹社區客廳活動' : null, timingNote: i ? '下星期再聯絡' : null, category: i ? 'SERVICE_INVITATION' : null,
    line: String(i + 1), confidence: i ? 0.64 : 0.96, uncertainties: i ? ['「下星期」沒有確定日期，請保留時間原話。'] : [],
  }));
  // A 劏房 room the building does not list yet, so the review shows a structure proposal.
  const first = units[0], floor = snapshot.floors.find(f => f.id === first?.floorId);
  const letter = first && /([A-Z])室?$/.exec(first.label)?.[1];
  if (newRoom && first && floor && letter) rows.push({ ...blankRow,
    building: building.name, address: building.address, floor: floor.label, unit: `${letter}1室`,
    scope: 'UNIT', date: '2026-10-03', worker: '示範工作員', coverage: 'VISITED_WITH_FINDING', contact: 'CONTACTED', assessment: 'SUSPECTED', source: 'STAFF_OBSERVATION',
    note: `${letter}室門口見多個電錶及門鈴，其中一間寫「${letter}1」。`, evidence: '多個電錶及門鈴', line: '3', confidence: 0.82, uncertainties: [`結構裡沒有「${letter}1室」，請確認是否劏房。`],
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="1280" viewBox="0 0 840 1280"><rect width="840" height="1280" fill="${photoPaperColors.paper}"/><g fill="${photoPaperColors.ink}" font-family="serif"><text x="60" y="80" font-size="16" letter-spacing="3">CAREFLOW · FIELD NOTES</text><text x="60" y="140" font-size="36">街區外展記錄</text><text x="60" y="192" font-size="18">示範紙本 · 所有內容均為虛構</text><path d="M60 218H780" stroke="${photoPaperColors.rule}"/><text x="60" y="270" font-size="23">${escape(building.name)}</text><text x="60" y="308" font-size="17">${escape(building.address)}</text><text x="60" y="352" font-size="19">日期：2026-10-03 工作員：示範工作員</text>${rows.map((r, i) => `<g transform="translate(60 ${412 + i * 218})"><rect width="720" height="195" fill="none" stroke="${photoPaperColors.grid}"/><text x="18" y="38" font-size="21">${i + 1} ${escape(r.unit ?? '整幢大廈')}</text><text x="18" y="85" font-size="21" fill="${photoPaperColors.handwriting}">${escape(r.note)}</text><text x="18" y="132" font-size="19" fill="${photoPaperColors.handwriting}">${escape(r.followUp ?? '暫無跟進記載')}</text><text x="18" y="168" font-size="19" fill="${photoPaperColors.annotation}">${escape(r.timingNote ?? '')}</text></g>`).join('')}<text x="60" y="1240" font-size="15" fill="${photoPaperColors.caption}">流程示範 · 非 AI 實際辨識結果</text></g></svg>`;
  const id = `demo-${building.id}`;
  return { id, name: '示範洗樓記錄.svg', image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, sample: true, status: 'done', model: '流程示範', warnings: [], rows: rows.map((r, i) => mapRow(r, id, i, snapshot)) };
}
