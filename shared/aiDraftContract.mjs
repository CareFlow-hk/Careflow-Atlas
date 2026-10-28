/** One JSON contract owned by the server and checked again by the browser. */
export const AI_COVERAGE_STATUSES = Object.freeze(['UNVISITED', 'ATTEMPTED', 'VISITED_NO_FINDING']);
const text = (maxLength = 120) => ({ type: ['string', 'null'], maxLength });
const option = values => ({ enum: [...values, null] });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const lines = { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 120 } };
export const draftItemSchema = object({
  buildingId: text(), floorLabel: text(), unitLabel: text(),
  occurredDate: { ...text(10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  occurredTime: { ...text(5), pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
  workerName: text(), coverage: option(AI_COVERAGE_STATUSES),
  contactOutcome: option(['NOT_ATTEMPTED', 'NO_ANSWER', 'DECLINED', 'CONTACTED', 'UNKNOWN']),
  assessment: option(['NOT_UPDATED', 'UNKNOWN', 'SUSPECTED', 'NO_INDICATION', 'STAFF_VERIFIED']),
  sourceType: option(['STAFF_OBSERVATION', 'RESIDENT_REPORT', 'UNKNOWN']),
  note: text(2000),
  followUp: { anyOf: [{ type: 'null' }, object({ action: { type: 'string', minLength: 1, maxLength: 120 },
    category: option(['HOUSING_CHANGE', 'HEALTH_SUPPORT', 'SERVICE_INVITATION', 'GENERAL']),
    assignee: text(), dueDate: { ...text(10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, timingNote: text(),
  })] },
  missing: lines, warnings: lines,
});
export const draftReplySchema = object({
  status: { enum: ['DRAFT', 'REFUSE'] },
  drafts: { type: 'array', maxItems: 40, items: draftItemSchema },
});
/** Deliberately small schema vocabulary, shared instead of divergent server/client guards. */
function matches(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(candidate => matches(value, candidate));
  if (schema.enum) return schema.enum.includes(value);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).includes(type)) return false;
  if (type === 'null') return true;
  if (type === 'string') return (schema.maxLength === undefined || value.length <= schema.maxLength)
    && (schema.minLength === undefined || value.trim().length >= schema.minLength)
    && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (type === 'array') return value.length <= schema.maxItems && value.every(item => matches(item, schema.items));
  if (type === 'object') return Object.keys(value).every(key => Object.hasOwn(schema.properties, key))
    && schema.required.every(key => Object.hasOwn(value, key))
    && Object.entries(schema.properties).every(([key, rule]) => matches(value[key], rule));
  return true;
}
export function validDraftReply(value) {
  return matches(value, draftReplySchema) && (value.status === 'REFUSE' ? value.drafts.length === 0 : value.drafts.length > 0);
}
