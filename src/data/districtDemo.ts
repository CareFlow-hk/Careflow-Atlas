import { workflowDemo } from './workflowDemo';
import geometry from './districtGeometry.json';
import type { Building, Observation, OutreachSnapshot, Person } from '../domain/types';

/** A fictional district for demonstration, never a record of the buildings under these shapes. */
const synthetic = { isSynthetic: true, provisional: true } as const;
const scenarios = [
  { name: '晴里樓', floors: 10, units: 3, progress: 0.78, theme: 'HOUSING_CHANGE' },
  { name: '青禾樓', floors: 7, units: 4, progress: 1, theme: 'SERVICE_INVITATION' },
  { name: '映榕樓', floors: 12, units: 2, progress: 0.58, theme: 'HEALTH_SUPPORT' },
  { name: '小滿樓', floors: 5, units: 3, progress: 0.4, theme: 'GENERAL' },
  { name: '常悅樓', floors: 9, units: 4, progress: 0.72, theme: 'SERVICE_INVITATION' },
  { name: '知秋樓', floors: 0, units: 0, progress: 0, theme: 'GENERAL' },
  { name: '晴川樓', floors: 14, units: 2, progress: 0.64, theme: 'HOUSING_CHANGE' },
  { name: '穗安樓', floors: 6, units: 3, progress: 0.83, theme: 'HEALTH_SUPPORT' },
  { name: '棠和樓', floors: 8, units: 4, progress: 0.5, theme: 'GENERAL' },
  { name: '日和樓', floors: 4, units: 2, progress: 1, theme: 'SERVICE_INVITATION' },
  { name: '朗月樓', floors: 11, units: 3, progress: 0.7, theme: 'HOUSING_CHANGE' },
  { name: '杏林樓', floors: 0, units: 0, progress: 0, theme: 'HEALTH_SUPPORT' },
  { name: '拾光樓', floors: 13, units: 2, progress: 0.46, theme: 'GENERAL' },
  { name: '和煦樓', floors: 6, units: 4, progress: 0, theme: 'SERVICE_INVITATION' },
  { name: '榕溪樓', floors: 8, units: 3, progress: 0.67, theme: 'HOUSING_CHANGE' },
  { name: '微光樓', floors: 0, units: 0, progress: 0, theme: 'GENERAL' },
] as const;

const additions: Pick<OutreachSnapshot, 'buildings' | 'floors' | 'units' | 'households' | 'people' | 'householdMemberships' | 'householdResidences' | 'memberships' | 'visits' | 'observations'> = {
  buildings: [], floors: [], units: [], households: [], people: [], householdMemberships: [], householdResidences: [], memberships: [], visits: [], observations: [],
};
const rounds = [
  { date: '2026-08-27', worker: '演示工作員丙', note: '合成：首次外展，按大廈分紙記錄。' },
  { date: '2026-09-02', worker: '演示工作員丁', note: '合成：回訪未應門單位，保留上次結果。' },
  { date: '2026-09-08', worker: '演示工作員丙', note: '合成：補充住戶原話及服務邀約。' },
  { date: '2026-09-10', worker: '演示工作員戊', note: '合成：核對跟進狀態，紙本只提供日期。' },
];
rounds.forEach((round, index) => additions.visits.push({ ...synthetic, id: `district-visit-${index + 1}`, occurredAt: round.date, recordedAt: `${round.date}T18:30:00+08:00`, workerName: round.worker, note: round.note }));

function event(buildingId: string, roundIndex: number, line: number, details: Omit<Observation, 'id' | 'isSynthetic' | 'provisional' | 'buildingId' | 'visitId' | 'occurredAt' | 'recordedAt' | 'workerName' | 'paperRef' | 'paperLine'>): Observation {
  const round = rounds[roundIndex];
  return { ...synthetic, id: `${buildingId}-r${roundIndex + 1}-${line}`, buildingId, visitId: `district-visit-${roundIndex + 1}`, occurredAt: round.date, recordedAt: `${round.date}T18:30:00+08:00`, workerName: round.worker, paperRef: `MOCK-${round.date.replaceAll('-', '')}-${buildingId}`, paperLine: String(line), ...details };
}

const support = {
  HOUSING_CHANGE: { action: '再聯絡街坊，核對住屋變動及需要的支援', timingNote: '「下個月可能要搬」為合成原話，日期及安排待確認', note: '合成：街坊話「業主話可能收返，未有實日」。未見通知；保留原話，不推定搬遷期限。' },
  HEALTH_SUPPORT: { action: '向中心同事核對關懷安排，再回覆街坊', timingNote: '「下晝得閒先過嚟」為合成原話，未確認到場', note: '合成：街坊話「行得慢，腳有啲唔舒服」。只記錄表述及希望了解中心支援，未作健康判斷。' },
  SERVICE_INVITATION: { action: '確認中心活動時段及街坊到訪意願', timingNote: '「放工睇下趕唔趕得切」為合成原話，未確認時間', note: '合成：已介紹社區客廳及班組。街坊話「俾張單張我睇下先」，不視為報名或入會。' },
  GENERAL: { action: '按街坊意願再聯絡，核對需要的資訊', timingNote: '街坊未指定日期，待確認合適時段', note: '合成：街坊話「遲啲再傾，依家趕住出門」。已留下中心資料，沒有收集電話。' },
} as const;

scenarios.forEach((scenario, buildingIndex) => {
  const id = `district-${String(buildingIndex + 1).padStart(2, '0')}`;
  const shape = geometry.buildings.find(item => item.id === id);
  if (!shape) throw new Error(`Missing district demo geometry: ${id}`);
  const initialCoverage = buildingIndex === 15 ? 'UNKNOWN' : 'UNVISITED';
  const building: Building = { ...synthetic, id, name: scenario.name, address: `演示街區 ${String(buildingIndex + 1).padStart(2, '0')} 號 · 虛構地址`, coordinates: { ...shape.coordinates }, footprint: shape.footprint.map(point => [...point]), layoutDeclared: scenario.floors > 0, initialCoverage, ...(scenario.floors > 0 ? { floorCount: scenario.floors } : {}) };
  additions.buildings.push(building);
  for (let level = 1; level <= scenario.floors; level++) {
    const floorId = `${id}-f${level}`;
    additions.floors.push({ ...synthetic, id: floorId, buildingId: id, level, label: `${level} 樓` });
    for (let unitIndex = 0; unitIndex < scenario.units; unitIndex++) {
      const label = String.fromCharCode(65 + unitIndex);
      additions.units.push({ ...synthetic, id: `${floorId}-${label}`, buildingId: id, floorId, label: `${level}樓 ${label}室`, initialCoverage: 'UNVISITED' });
    }
  }
  const units = additions.units.filter(unit => unit.buildingId === id);
  const visitedCount = Math.floor(units.length * scenario.progress);
  units.slice(0, visitedCount).forEach((unit, unitIndex) => {
    const variant = (unitIndex + buildingIndex) % 7;
    const complete = scenario.progress === 1;
    const result: Pick<Observation, 'coverage' | 'contactOutcome' | 'assessment' | 'note' | 'sourceType' | 'evidence'> = variant === 0
      ? { coverage: 'VISITED_WITH_FINDING', contactOutcome: 'CONTACTED', assessment: 'STAFF_VERIFIED', sourceType: 'STAFF_OBSERVATION', evidence: ['合成演示：工作員在住戶同意下觀察到分間出入口'], note: '合成：工作員記下分間出入口及住戶口述；此示例判斷不代表法定認定。' }
      : variant === 1 && !complete
        ? { coverage: 'ATTEMPTED', contactOutcome: 'NO_ANSWER', assessment: 'NOT_UPDATED', sourceType: 'STAFF_OBSERVATION', evidence: [], note: '合成：敲門後未有人應門。沒有推定是否有人居住或是否劏房。' }
        : variant === 2 && !complete
          ? { coverage: 'ATTEMPTED', contactOutcome: 'DECLINED', assessment: 'NOT_UPDATED', sourceType: 'RESIDENT_REPORT', evidence: [], note: '合成：街坊話「今日唔方便，多謝」。尊重意願，未再追問。' }
          : variant === 3 && !complete
            ? { coverage: 'PARTIAL', contactOutcome: 'CONTACTED', assessment: 'SUSPECTED', sourceType: 'RESIDENT_REPORT', evidence: ['合成口述，內部格局未核實'], note: '合成：街坊提及房內另有住戶。沒有查看格局，暫列線索待核對。' }
            : { coverage: 'VISITED_NO_FINDING', contactOutcome: 'CONTACTED', assessment: 'NO_INDICATION', sourceType: 'STAFF_OBSERVATION', evidence: [], note: '合成：完成本次接觸，沒有記下劏房線索；不等於已排除其他情況。' };
    additions.observations.push(event(id, unitIndex % 2, unitIndex + 1, { floorId: unit.floorId, unitId: unit.id, ...result }));
  });

  // Each paper form belongs to one building. Follow-ups retain their original event.
  if (visitedCount > 0) {
    const unit = units[0];
    const task = support[scenario.theme];
    const priorCoverage = additions.observations.find(record => record.unitId === unit.id)!.coverage;
    const origin = event(id, 2, 1, { floorId: unit.floorId, unitId: unit.id, coverage: priorCoverage, contactOutcome: 'CONTACTED', assessment: 'NOT_UPDATED', sourceType: 'RESIDENT_REPORT', evidence: ['合成街坊口述'], note: task.note, followUp: { action: task.action, status: 'OPEN', category: scenario.theme, assignee: rounds[2].worker, timingNote: task.timingNote, ...(buildingIndex === 0 || buildingIndex === 10 ? { dueDate: '2026-09-14' } : {}) } });
    if (origin.followUp?.dueDate) origin.note += ' 工作員把 9 月 14 日訂為內部回覆日期，並非住戶搬遷期限。';
    additions.observations.push(origin);
    if (buildingIndex % 3 === 1) additions.observations.push(event(id, 3, 1, { floorId: unit.floorId, unitId: unit.id, coverage: priorCoverage, contactOutcome: 'CONTACTED', assessment: 'NOT_UPDATED', sourceType: 'STAFF_OBSERVATION', evidence: [], note: '合成：已向街坊回覆所問的中心資訊，這一項回覆工作結束；不代表住屋或健康需要已解決。', followUp: { action: '已完成本次資訊回覆', status: 'DONE', category: scenario.theme, assignee: rounds[3].worker }, resolvesObservationId: origin.id }));
    if (!completeBuilding(scenario.progress) && units.length > 3) {
      const revisitUnit = units[1];
      additions.observations.push(event(id, 3, 2, { floorId: revisitUnit.floorId, unitId: revisitUnit.id, coverage: 'VISITED_NO_FINDING', contactOutcome: 'CONTACTED', assessment: 'NO_INDICATION', sourceType: 'STAFF_OBSERVATION', evidence: [], note: '合成：本次回訪接觸到街坊，已介紹中心；上次未應門／接觸結果仍保留在歷史。' }));
    }
  } else if (buildingIndex === 5) {
    additions.observations.push(event(id, 2, 1, { coverage: 'INACCESSIBLE', contactOutcome: 'NOT_ATTEMPTED', assessment: 'NOT_UPDATED', sourceType: 'STAFF_OBSERVATION', evidence: [], note: '合成：大門未開放，未能進入。樓層及單位總數未核實，沒有建立虛構單位清單。', followUp: { action: '核對可進入時段，再安排外展', status: 'OPEN', category: 'GENERAL', assignee: rounds[2].worker, timingNote: '可進入時段待確認' } }));
  } else if (buildingIndex === 11) {
    additions.observations.push(event(id, 2, 1, { coverage: 'PARTIAL', contactOutcome: 'CONTACTED', assessment: 'UNKNOWN', sourceType: 'RESIDENT_REPORT', evidence: ['合成街坊口述，位置待核對'], note: '合成：在門口接觸一位街坊，話「上面轉角嗰邊」。具體樓層、單位未能核對，只按大廈記錄。', followUp: { action: '徵詢街坊意願，核對下次聯絡位置', status: 'OPEN', category: 'HEALTH_SUPPORT', assignee: rounds[2].worker, timingNote: '沒有約定日期' } }));
  }

  // No contact identities are fabricated for untouched buildings.
  if (buildingIndex === 13 || buildingIndex === 15) return;
  const householdCount = units.length ? 3 : 2;
  for (let householdIndex = 0; householdIndex < householdCount; householdIndex++) {
    const householdId = `${id}-hh${householdIndex + 1}`;
    const residenceUnit = units[householdIndex * 2];
    additions.households.push({ ...synthetic, id: householdId, label: `合成家庭 ${String(buildingIndex + 1).padStart(2, '0')}-${householdIndex + 1}` });
    additions.householdResidences.push({ ...synthetic, id: `${householdId}-home`, householdId, buildingId: id, ...(residenceUnit ? { unitId: residenceUnit.id } : { locationNote: '合成歷史名冊：樓層及單位未核對' }), startsOn: '2026-05-01' });
    for (let memberIndex = 0; memberIndex < (householdIndex === 0 ? 2 : 1); memberIndex++) {
      const personId = `${householdId}-p${memberIndex + 1}`;
      const person: Person = { ...synthetic, id: personId, displayName: `演示街坊 ${String(buildingIndex + 1).padStart(2, '0')}${String.fromCharCode(65 + householdIndex)}${memberIndex + 1}`, addressNote: `${building.name} · ${residenceUnit ? residenceUnit.label : '具體位置待核對'}（合成）`, contactNote: householdIndex === 1 ? '合成：只保留稱呼，未提供電話；聯絡意願待確認。' : '合成：演示名冊記錄，不含真實姓名、電話或個人資料。' };
      additions.people.push(person);
      additions.householdMemberships.push({ ...synthetic, id: `${personId}-household`, householdId, personId, relationship: memberIndex === 0 ? '合成主要聯絡人' : '合成同住成員' });
      const status = (['ACTIVE', 'PENDING', 'UNKNOWN', 'INACTIVE'] as const)[(buildingIndex + householdIndex + memberIndex) % 4];
      if (status === 'ACTIVE' && householdIndex === 0) additions.memberships.push({ ...synthetic, id: `${personId}-membership-history`, personId, status: 'INACTIVE', startsOn: '2025-09-01', endsOn: '2026-07-31' });
      additions.memberships.push({ ...synthetic, id: `${personId}-membership`, personId, status, ...(status === 'ACTIVE' ? { startsOn: '2026-08-01' } : status === 'INACTIVE' ? { startsOn: '2026-01-01', endsOn: '2026-07-31' } : {}) });
    }
  }
});

function completeBuilding(progress: number): boolean { return progress === 1; }

// One explicit move history: a closed earlier residence and a current residence,
// rather than overwriting the household's address or creating another person.
const movedHouseholdId = 'district-03-hh3';
additions.householdResidences.push({ ...synthetic, id: `${movedHouseholdId}-prior-home`, householdId: movedHouseholdId, buildingId: 'district-01', unitId: 'district-01-f2-C', startsOn: '2025-11-01', endsOn: '2026-04-30', locationNote: '合成搬遷歷史；新地址自 2026 年 5 月起生效。' });

export const districtAdditions = additions;
export const districtDemo: OutreachSnapshot = {
  ...workflowDemo,
  notice: '全區合成演示：20 個大廈位置用作介面測試；樓名、地址、樓層、單位、住戶及記錄均屬虛構，不代表地圖底圖中的真實建築或居民。依原紙本＋Excel 工作流設計，欄位仍待機構確認。',
  buildings: [...workflowDemo.buildings, ...additions.buildings],
  floors: [...workflowDemo.floors, ...additions.floors],
  units: [...workflowDemo.units, ...additions.units],
  households: [...workflowDemo.households, ...additions.households],
  people: [...workflowDemo.people, ...additions.people],
  householdMemberships: [...workflowDemo.householdMemberships, ...additions.householdMemberships],
  householdResidences: [...workflowDemo.householdResidences, ...additions.householdResidences],
  memberships: [...workflowDemo.memberships, ...additions.memberships],
  visits: [...workflowDemo.visits, ...additions.visits],
  observations: [...workflowDemo.observations, ...additions.observations],
};
