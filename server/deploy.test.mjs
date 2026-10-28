import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKSPACE_BODY_LIMIT } from './workspace.mjs';
import { AI_BODY_LIMIT, AI_TIMEOUT_MS } from './aiProxy.mjs';

const conf = readFileSync(new URL('../deploy/nginx.conf', import.meta.url), 'utf8');
const bytes = value => { const [, n, unit] = value.match(/^(\d+)([km]?)$/i); return Number(n) * ({ '': 1, k: 1024, m: 1024 ** 2 })[unit.toLowerCase()]; };
const limitOf = location => {
  const block = conf.split(`location ${location} {`)[1];
  assert.ok(block, `nginx.conf has no "location ${location}" block`);
  return bytes(block.slice(0, block.indexOf('}')).match(/client_max_body_size\s+(\w+);/)[1]);
};

// 2026-10-21: the workspace write fell under /api/'s 8k limit, so nginx answered 413 itself and
// the account service never saw it. Development goes through Vite's proxy, which has no limit.
test('the proxy lets a whole workspace through to the account service', () => {
  assert.ok(limitOf('= /api/workspace') >= WORKSPACE_BODY_LIMIT);
  assert.ok(limitOf('/api/') < WORKSPACE_BODY_LIMIT, 'other account requests stay small');
});

test('AI proxy allows the server body and both upstream timeout windows', () => {
  assert.ok(limitOf('= /api/ai/assist') >= AI_BODY_LIMIT);
  assert.ok(limitOf('= /api/ai/assist') >= 1024 * 1024);
  const block = conf.split('location = /api/ai/assist {')[1].split('}')[0];
  const seconds = Number(block.match(/proxy_read_timeout\s+(\d+)s;/)[1]);
  assert.ok(seconds >= 130);
  assert.ok(seconds * 1000 >= AI_TIMEOUT_MS * 2);
  for (const header of ['Cache-Control "no-store"', 'X-Content-Type-Options nosniff', 'Referrer-Policy no-referrer', 'X-Frame-Options SAMEORIGIN']) {
    assert.ok(block.includes(`add_header ${header} always;`));
  }
  assert.ok(!conf.includes('https://api.deepseek.com'));
});

// 2026-10-28: #21 moved the AI draft contract into shared/, but neither image copied that folder,
// so the web build failed on the VPS and the auth image would not have started. Local builds see
// the whole checkout, so only the Dockerfiles show it.
test('both images copy every top-level folder their code imports from', () => {
  const web = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
  for (const folder of ['src', 'public', 'scripts', 'shared']) assert.match(web, new RegExp(`^COPY ${folder} \\./${folder}$`, 'm'));
  for (const folder of ['server', 'shared']) assert.match(auth, new RegExp(`^COPY --chown=node:node ${folder} \\./${folder}$`, 'm'));
});
