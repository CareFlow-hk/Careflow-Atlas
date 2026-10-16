// Claude Code `UserPromptSubmit` hook: append every prompt, verbatim, to log/YYYY-MM-DD.md
// (Hong Kong time), the format CLAUDE.md §9 asks for. It never blocks a prompt: any failure
// here is swallowed and the prompt goes through unlogged.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

/** Things that must not reach a public repository. Not exhaustive: people still must not paste secrets. */
const SECRETS = [
  [/(#?set-password=)[^\s)>\]]+/g, '$1[已遮蔽：一次性链接]'],
  [/\b(sk-[A-Za-z0-9_-]{16,})/g, '[已遮蔽：key]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[已遮蔽：token]'],
  [/((?:api[_-]?key|secret|token|password|passwd|密码|密碼)\s*[:=：]\s*)(?!\[已遮蔽)\S+/gi, '$1[已遮蔽]'],
];
export function mask(text) {
  return SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

/** Date and time in Hong Kong, whatever the machine's own zone is. */
export function hongKongStamp(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** One entry: a heading with time, author and tool, then the prompt as a block quote. */
export function formatEntry(prompt, { time, author, tool = 'Claude Code' }) {
  const quoted = mask(prompt).split(/\r?\n/).map(line => (line ? `> ${line}` : '>')).join('\n');
  return `\n## ${time} · ${author || '未知'} · ${tool}\n\n${quoted}\n`;
}

export function appendPrompt({ prompt, root, author, now = new Date() }) {
  const text = String(prompt ?? '').trim();
  if (!text) return undefined;
  const { day, time } = hongKongStamp(now);
  const dir = join(root, 'log');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${day}.md`);
  appendFileSync(file, `${existsSync(file) ? '' : `# ${day}\n`}${formatEntry(text, { time, author })}`);
  return file;
}

function gitAuthor(root) {
  try { return execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    appendPrompt({ prompt: input.prompt, root, author: process.env.PROMPT_LOG_AUTHOR || gitAuthor(root) });
  } catch { /* never block a prompt over its log */ }
  process.exit(0);
}
