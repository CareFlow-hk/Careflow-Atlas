import { backup } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openAuth } from './auth.mjs';
import { config } from './config.mjs';
process.umask(0o077);
const target = process.argv[2];
if (!target || existsSync(target)) throw new Error('请指定一个尚不存在的备份路径。');
const auth = openAuth(config().path);
try { await backup(auth.db, resolve(target)); chmodSync(target, 0o600); process.stdout.write('账号数据库一致性备份完成。\n'); }
finally { auth.close(); }
