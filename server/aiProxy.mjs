import { AI_COVERAGE_STATUSES, draftReplySchema, validDraftReply } from '../shared/aiDraftContract.mjs';
import { randomUUID } from 'node:crypto';
import { HttpError, requireValue } from './auth.mjs';
import { AI_ASSIST_PROVIDER } from './aiAssist.mjs';
import { buildPrompt } from './aiPrompts.mjs';
import { azureSettings } from './azure.mjs';

/**
 * The server's one outbound path to Azure OpenAI (`docs/AI_ASSISTANT.md` 5.2).
 *
 * The browser sends what the person wants read; the server decides how it is asked. The
 * endpoint, the deployment, `store:false`, the system prompt and the timeout are all set
 * here, so a caller cannot widen them. A field that would change how the request is made
 * (`model`, `store`, `endpoint`, `system`, `schema`, timeouts) is refused with 400 rather
 * than ignored: silently dropping it would let someone believe their setting took effect.
 *
 * Nothing here writes the prompt or the answer anywhere. The caller gets the parsed
 * proposal plus the metadata it may disclose, and the audit row carries only that metadata.
 *
 * The topic gate is the model's, not a keyword list in this file (doc 7): plainly unrelated
 * content still reaches Azure before being refused, and the doc records that trade. What
 * the server does enforce is everything that does not depend on reading the content —
 * switch, size, rate, model and schema of the request itself.
 */

/** Big enough for a 300-row chunk, small enough that a snapshot cannot ride along. */
export const AI_BODY_LIMIT = 512 * 1024;
export const AI_TIMEOUT_MS = 60_000;
/** One request carries one chunk; the page loops (doc 5.2). */
export const AI_CHUNK_ROWS = 300;
export const AI_CHUNK_CHARS = 80_000;
export const AI_DRAFT_TEXT = 8_000;
export const AI_PATCH_ROWS = 500;
export const AI_MAX_COLUMNS = 64;
export const AI_MAX_OPTIONS = 200;
export const AI_MAX_LOCATIONS = 400;
/** Per institution, in flight at once. Two people reading a sheet each is already generous. */
export const AI_MAX_CONCURRENT = 2;

/**
 * Fields that decide how the request is made. The server owns all of them.
 *
 * `headers` is deliberately not one of them: in a mapping request it is the sheet's own
 * column headers (`headers: ['大廈', '日期']`, sent with the part that holds the header
 * row), and the outbound HTTP headers are assembled here, never from the body.
 */
const SERVER_OWNED = [
  'model', 'deployment', 'store', 'endpoint', 'endpointUrl', 'system', 'instructions', 'schema',
  'timeout', 'timeoutMs', 'retry', 'apiKey', 'key', 'provider',
];

export { AI_COVERAGE_STATUSES };
const coverageOptions = value => {
  const options = labelPairs(value, '覆蓋結果');
  requireValue(options.every(item => AI_COVERAGE_STATUSES.includes(item.key)), 400, '覆蓋結果不在可選範圍內。');
  return [
    { key: 'UNVISITED', label: '未到訪' },
    { key: 'ATTEMPTED', label: '未能完成探訪' },
    { key: 'VISITED_NO_FINDING', label: '已完成探訪' },
  ];
};

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const says = name => `「${name}」格式不正確，請重新整理頁面後再試。`;

const stringOf = (value, name, max) => {
  requireValue(typeof value === 'string' && value.length <= max, 400, says(name));
  return value;
};
const integerOf = (value, name, min, max) => {
  requireValue(Number.isInteger(value) && value >= min && value <= max, 400, says(name));
  return value;
};
const listOf = (value, name, max) => {
  requireValue(Array.isArray(value) && value.length <= max, 400, says(name));
  return value;
};
const labelPairs = (value, name) => {
  listOf(value, name, AI_MAX_OPTIONS);
  for (const item of value) {
    requireValue(isObject(item) && Object.keys(item).length === 2
      && typeof item.key === 'string' && item.key.length <= 80
      && typeof item.label === 'string' && item.label.length <= 200, 400, says(name));
  }
  return value;
};
const dayOf = (value, name) => {
  stringOf(value, name, 10);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)), 400, says(name));
  return value;
};

/** Refuses any field that would set the request up differently. */
function assertNoServerFields(body) {
  const named = SERVER_OWNED.filter(key => Object.hasOwn(body, key));
  requireValue(!named.length, 400, `這些欄位由伺服器決定，請求不可以自己設定：${named.join('、')}。`);
}

function mappingRequest(body) {
  const part = body.part;
  requireValue(isObject(part), 400, says('part'));
  const index = integerOf(part.index, 'part.index', 1, 200);
  const count = integerOf(part.count, 'part.count', 1, 200);
  requireValue(index <= count, 400, says('part'));
  const columnCount = integerOf(body.columnCount, 'columnCount', 1, AI_MAX_COLUMNS);
  const rows = listOf(body.rows, 'rows', AI_CHUNK_ROWS);
  for (const row of rows) {
    requireValue(Array.isArray(row) && row.length === columnCount && row.every(cell => typeof cell === 'string' && cell.length <= 4000), 400, says('rows'));
  }
  const withheldColumns = listOf(body.withheldColumns ?? [], 'withheldColumns', AI_MAX_COLUMNS);
  for (const column of withheldColumns) integerOf(column, 'withheldColumns', 0, columnCount - 1);
  const fields = listOf(body.fields ?? [], 'fields', AI_MAX_OPTIONS);
  for (const field of fields) {
    requireValue(isObject(field) && typeof field.key === 'string' && field.key.length <= 80
      && typeof field.label === 'string' && field.label.length <= 200, 400, says('fields'));
  }
  const headerRow = body.headerRow === null || body.headerRow === undefined
    ? null : integerOf(body.headerRow, 'headerRow', 0, AI_CHUNK_ROWS - 1);
  const headers = body.headers === undefined ? undefined : listOf(body.headers, 'headers', AI_MAX_COLUMNS).map((header, index) => stringOf(header, `headers[${index}]`, 400));
  requireValue(!headers || headers.length === columnCount, 400, says('headers'));
  listOf(body.profileIds ?? [], 'profileIds', 50).forEach((id, index) => stringOf(id, `profileIds[${index}]`, 80));
  // The whole point of "整份处理" is that nothing is quietly dropped; the cap is on one
  // request, and the page splits a longer sheet into more requests (doc 6.1).
  requireValue(JSON.stringify(rows).length <= AI_CHUNK_CHARS, 413, `這一段超過 ${AI_CHUNK_CHARS} 個字元，請把檔案拆成較小的部分再上傳。`);
  return {
    sheetName: stringOf(body.sheetName ?? '', 'sheetName', 200),
    part: { index, count },
    headerRow,
    headers,
    columnCount,
    withheldColumns,
    profileIds: body.profileIds ?? [],
    fields,
    rows,
    context: body.context === undefined ? undefined : stringOf(body.context, 'context', 4000),
  };
}

function draftRequest(body) {
  const text = stringOf(body.text, 'text', AI_DRAFT_TEXT);
  requireValue(text.trim().length > 0, 400, '請先輸入文字。');
  const buildings = listOf(body.buildings, 'buildings', 2000);
  for (const building of buildings) {
    requireValue(isObject(building) && typeof building.id === 'string' && building.id.length <= 120
      && typeof building.name === 'string' && building.name.length <= 200, 400, says('buildings'));
  }
  const locations = listOf(body.locations, 'locations', AI_MAX_LOCATIONS);
  for (const location of locations) {
    requireValue(isObject(location) && typeof location.buildingId === 'string'
      && typeof location.floorLabel === 'string' && location.floorLabel.length <= 200
      && typeof location.unitLabel === 'string' && location.unitLabel.length <= 200, 400, says('locations'));
  }
  return {
    text,
    today: dayOf(body.today, 'today'),
    buildings: buildings.map(({ id, name }) => ({ id, name })),
    locations: locations.map(({ buildingId, floorLabel, unitLabel }) => ({ buildingId, floorLabel, unitLabel })),
    coverage: coverageOptions(body.coverage),
    contacts: labelPairs(body.contacts, 'contacts'),
    assessments: labelPairs(body.assessments, 'assessments'),
    categories: labelPairs(body.categories, 'categories'),
  };
}

function patchRequest(body) {
  const text = stringOf(body.text, 'text', AI_DRAFT_TEXT);
  requireValue(text.trim().length > 0, 400, '請先輸入指示。');
  const columns = listOf(body.columns, 'columns', AI_MAX_COLUMNS);
  for (const column of columns) {
    requireValue(isObject(column) && Number.isInteger(column.columnIndex) && column.columnIndex >= 0
      && typeof column.header === 'string' && column.header.length <= 400
      && (column.field === null || typeof column.field === 'string')
      && (column.label === null || typeof column.label === 'string'), 400, says('columns'));
  }
  const rows = listOf(body.rows, 'rows', AI_PATCH_ROWS);
  for (const row of rows) {
    requireValue(isObject(row) && Number.isInteger(row.row) && row.row >= 1
      && Array.isArray(row.values) && row.values.length === columns.length
      && row.values.every(value => typeof value === 'string' && value.length <= 4000), 400, says('rows'));
  }
  return {
    text,
    today: dayOf(body.today, 'today'),
    sheetName: stringOf(body.sheetName ?? '', 'sheetName', 200),
    columns: columns.map(({ columnIndex, header, field, label }) => ({ columnIndex, header, field, label })),
    rows: rows.map(({ row, values }) => ({ row, values })),
    omitted: integerOf(body.omitted ?? 0, 'omitted', 0, 100_000),
    coverage: coverageOptions(body.coverage),
    contacts: labelPairs(body.contacts, 'contacts'),
    assessments: labelPairs(body.assessments, 'assessments'),
    categories: labelPairs(body.categories, 'categories'),
  };
}

const KINDS = Object.freeze({ mapping: mappingRequest, draft: draftRequest, patch: patchRequest });

/**
 * The request, checked for shape and bounded, or a 400/413 that names what to fix.
 * `rows` and `chunks` are what the audit row may say about this call: how much was read,
 * never what it said.
 */
export function readAiRequest(body) {
  requireValue(isObject(body), 400, '無效請求。');
  assertNoServerFields(body);
  requireValue(typeof body.kind === 'string' && Object.hasOwn(KINDS, body.kind), 400, '不支援這種 AI 請求。');
  const request = KINDS[body.kind](body);
  const rows = body.kind === 'mapping' ? request.rows.length : body.kind === 'patch' ? request.rows.length : 1;
  const chunks = body.kind === 'mapping' ? request.part.count : 1;
  return { kind: body.kind, request, rows, chunks };
}

class UpstreamFailure extends Error {
  constructor(status, retryable) { super(`upstream ${status}`); this.status = status; this.retryable = retryable; }
}
class UnreadableAnswer extends Error {}

function judge(answer, kind) {
  if (!isObject(answer)) throw new UnreadableAnswer();
  requireValue(typeof answer.status === 'string', 502, 'AI 回覆格式不完整，請重試或改用人手對應。');
  if (kind === 'draft' && !validDraftReply(answer)) throw new UnreadableAnswer();
  return answer;
}

export function createAiService({ settings = azureSettings(), fetchImpl = fetch, timeoutMs = AI_TIMEOUT_MS } = {}) {
  const active = new Map();
  const fallbackModel = settings.fallbackModel && settings.fallbackModel !== settings.model ? settings.fallbackModel : null;
  const status = () => ({ provider: AI_ASSIST_PROVIDER, configured: settings.configured, model: settings.model, fallbackModel });

  async function ask(prompt, model, signal, kind) {
    signal.throwIfAborted();
    const response = await fetchImpl(`${settings.endpoint}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': settings.key },
      signal,
      body: JSON.stringify({
        model,
        // The answer is read once and discarded; nothing about this person is stored upstream.
        store: false,
        instructions: prompt.system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt.user }] }],
        max_output_tokens: 8000,
        ...(kind === 'draft' ? { text: { format: { type: 'json_schema', name: 'outreach_drafts', strict: true, schema: draftReplySchema } } } : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retryable = response.status === 429 || response.status >= 500;
      throw new UpstreamFailure(response.status, retryable);
    }
    const parts = []; let length = 0;
    for await (const part of response.body) {
      length += part.length;
      if (length > 512 * 1024) throw new UnreadableAnswer();
      parts.push(Buffer.from(part));
    }
    let envelope;
    try { envelope = JSON.parse(Buffer.concat(parts).toString()); } catch { throw new UnreadableAnswer(); }
    if (!isObject(envelope) || !Array.isArray(envelope.output)) throw new UnreadableAnswer();
    const content = envelope.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
    requireValue(!content.some(item => item.type === 'refusal'), 422, '這次內容未獲 AI 服務接受，請改用人手對應。');
    requireValue(envelope.incomplete_details?.reason !== 'content_filter', 422, '這次內容未獲 AI 服務接受，請改用人手對應。');
    requireValue(envelope.status === 'completed', 502, 'AI 未完成回應，請再試一次或改用人手對應。');
    const raw = content.filter(item => item.type === 'output_text').map(item => item.text).join('');
    let answer;
    try { answer = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new UnreadableAnswer(); }
    judge(answer, kind);
    return {
      answer,
      // Azure's own id is the strongest trace there is; a generated one still lets the
      // server say later that it really issued this request (phase 5 PR5).
      requestId: typeof envelope.id === 'string' && /^[A-Za-z0-9][\w.:-]{0,119}$/.test(envelope.id) ? envelope.id : randomUUID(),
      usage: { inputTokens: envelope.usage?.input_tokens ?? null, outputTokens: envelope.usage?.output_tokens ?? null },
    };
  }

  function refusalFor(error) {
    if (error instanceof HttpError) return error;
    if (error instanceof UnreadableAnswer) return new HttpError(502, 'AI 回覆格式不完整，已作廢，未寫入任何資料。請再試一次或改用人手對應。');
    return new HttpError(502, '無法讀取 AI 回應，請稍後再試。');
  }

  return {
    status,
    /**
     * One request in, one proposal out. `signal` aborts when the browser goes away; the
     * abort is not retried, because nobody is waiting for the answer any more.
     */
    async assist(body, user, signal) {
      requireValue(settings.configured, 503, 'AI 助手尚未由平台管理員配置，請聯絡平台管理員。');
      const { kind, request, rows, chunks } = readAiRequest(body);
      const orgId = user.org_id;
      requireValue((active.get(orgId) ?? 0) < AI_MAX_CONCURRENT, 429, '這個機構已有 AI 請求正在處理，請稍後再試。');
      active.set(orgId, (active.get(orgId) ?? 0) + 1);
      const total = AbortSignal.any([AbortSignal.timeout(timeoutMs * 2), ...(signal ? [signal] : [])]);
      const attempt = model => ask(buildPrompt(kind, request), model, AbortSignal.any([total, AbortSignal.timeout(timeoutMs)]), kind);
      const started = Date.now();
      try {
        let result;
        let fallback = null;
        try {
          result = await attempt(settings.model);
        } catch (error) {
          // The whole budget is spent, or the browser went away: a second attempt would be
          // made against an already-aborted signal and could only fail.
          if (error?.name === 'AbortError') throw error;
          const retryable = error instanceof UpstreamFailure && error.retryable
            || error?.name === 'TimeoutError';
          if (!retryable || !fallbackModel) throw error;
          // A rate limit or a bad minute at the provider is worth one different deployment;
          // a rejected key, a content filter or an unreadable answer is not.
          fallback = { primaryModel: settings.model, model: fallbackModel, reason: error instanceof UpstreamFailure ? `HTTP ${error.status}` : 'TIMEOUT' };
          result = await attempt(fallbackModel);
        }
        return {
          kind,
          proposal: result.answer,
          aiAssist: { at: new Date().toISOString(), provider: AI_ASSIST_PROVIDER, model: fallback?.model ?? settings.model, requestId: result.requestId },
          fallback,
          usage: result.usage,
          durationMs: Date.now() - started,
          rows,
          chunks,
        };
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new HttpError(504, 'AI 回應逾時，請稍後再試或改用人手對應。');
        if (error instanceof UpstreamFailure && (error.status === 401 || error.status === 403)) {
          throw new HttpError(502, '伺服器設定有誤（金鑰被拒），請平台管理員核對 Azure 設定。');
        }
        if (error instanceof UpstreamFailure) throw new HttpError(502, error.status === 429 ? 'AI 服務暫時繁忙，請稍後再試。' : 'AI 服務未能完成請求，請稍後再試。');
        throw refusalFor(error);
      } finally {
        const left = (active.get(orgId) ?? 1) - 1;
        if (left > 0) active.set(orgId, left); else active.delete(orgId);
      }
    },
  };
}
