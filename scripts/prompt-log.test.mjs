import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { appendPrompt, formatEntry, hongKongStamp, mask } from './prompt-log.mjs';

describe('prompt log hook', () => {
  it('stamps Hong Kong time regardless of the machine zone', () => {
    expect(hongKongStamp(new Date('2026-10-16T16:30:05Z'))).toEqual({ day: '2026-10-17', time: '00:30:05' });
  });
  it('quotes every line verbatim, keeping blank lines inside the quote', () => {
    expect(formatEntry('第一行\n\n第三行', { time: '09:00:00', author: 'lhjlol' }))
      .toBe('\n## 09:00:00 · lhjlol · Claude Code\n\n> 第一行\n>\n> 第三行\n');
  });
  it('masks one-time links and obvious secrets but leaves ordinary text alone', () => {
    expect(mask('打開 http://127.0.0.1:5173/#set-password=abc123 設定')).toBe('打開 http://127.0.0.1:5173/#set-password=[已遮蔽：一次性链接] 設定');
    expect(mask('key 是 sk-abcdefghijklmnopqrstuv')).toBe('key 是 [已遮蔽：key]');
    expect(mask('密码：hunter2 然後登入')).toBe('密码：[已遮蔽] 然後登入');
    expect(mask('token=ghp_abcdefghijklmnopqrstuvwxyz')).toBe('token=[已遮蔽：token]');
    expect(mask('把 password 欄位改成必填')).toBe('把 password 欄位改成必填');
  });
  it('starts a day file with a heading and appends after it', () => {
    const root = mkdtempSync(join(tmpdir(), 'prompt-log-'));
    try {
      const now = new Date('2026-10-16T03:00:00Z');
      appendPrompt({ prompt: '第一條', root, author: 'Oscar', now });
      appendPrompt({ prompt: '  ', root, author: 'Oscar', now });
      appendPrompt({ prompt: '第二條', root, author: 'Oscar', now: new Date('2026-10-16T03:05:00Z') });
      expect(readFileSync(join(root, 'log/2026-10-16.md'), 'utf8'))
        .toBe('# 2026-10-16\n\n## 11:00:00 · Oscar · Claude Code\n\n> 第一條\n\n## 11:05:00 · Oscar · Claude Code\n\n> 第二條\n');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('runs as a hook: reads the prompt from stdin and never fails the prompt', () => {
    const root = mkdtempSync(join(tmpdir(), 'prompt-log-'));
    const script = join(import.meta.dirname, 'prompt-log.mjs');
    try {
      const env = { ...process.env, CLAUDE_PROJECT_DIR: root, PROMPT_LOG_AUTHOR: '小刘' };
      execFileSync(process.execPath, [script], { input: JSON.stringify({ prompt: '跑一下測試', cwd: root }), env });
      const [file] = execFileSync('ls', [join(root, 'log')], { encoding: 'utf8' }).trim().split('\n');
      expect(readFileSync(join(root, 'log', file), 'utf8')).toMatch(/· 小刘 · Claude Code\n\n> 跑一下測試\n$/);
      // Malformed input is swallowed: exit code 0, nothing thrown.
      expect(() => execFileSync(process.execPath, [script], { input: 'not json', env })).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
