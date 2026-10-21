import { openAuth, emailValue } from './auth.mjs';
import { createOrg, listOrgs, moveUser, renameOrg } from './orgs.mjs';
import { config } from './config.mjs';
process.umask(0o077);
const settings = config();
const [command, email, ...name] = process.argv.slice(2);
const auth = openAuth(settings.path);
try {
  let token;
  if (command === 'bootstrap') {
    if (auth.get('SELECT COUNT(*) AS n FROM users').n) throw new Error('账号库已有用户；首次初始化不能重复。需要恢复时使用 recover-admin。');
    const created = auth.createUser({ email, name: name.join(' '), role: 'ADMIN' });
    // The first account is the person running the site.
    auth.run('UPDATE users SET platform_admin=1 WHERE id=?', created.user.id);
    token = created.token;
  } else if (command === 'platform-admin') {
    const user = auth.get('SELECT * FROM users WHERE email=?', emailValue(email));
    if (!user) throw new Error('帐号不存在。');
    if (!['on', 'off'].includes(name[0])) throw new Error('用法: node server/manage.mjs platform-admin EMAIL on|off');
    auth.setPlatformAdmin(user.id, name[0] === 'on');
    process.stdout.write(`${user.email} 已${name[0] === 'on' ? '设为' : '取消'}平台管理员；该帐号需要重新登录。\n`);
  } else if (command === 'list-orgs') {
    for (const org of listOrgs(auth)) process.stdout.write(`${org.id}\t${org.name}\t机构管理员 ${org.admins}\t员工 ${org.members}\t帐号共 ${org.accounts}\n`);
  } else if (command === 'create-org') {
    // Here the second argument is the institution id, not an email.
    const org = createOrg(auth, email, name.join(' '));
    process.stdout.write(`已建立机构 ${org.id}（${org.name}）。\n`);
  } else if (command === 'rename-org') {
    const org = renameOrg(auth, email, name.join(' '));
    process.stdout.write(`机构 ${org.id} 已改名为「${org.name}」。\n`);
  } else if (command === 'move-user') {
    const moved = moveUser(auth, emailValue(email), name[0]);
    process.stdout.write(`${moved.email} 已从 ${moved.from} 移到 ${moved.to}；该帐号需要重新登录，看到的是新机构的工作区。\n`);
  } else if (command === 'recover-admin') {
    const user = auth.get('SELECT * FROM users WHERE email=?', emailValue(email));
    if (!user || user.role !== 'ADMIN') throw new Error('管理员不存在。');
    token = auth.transaction(() => {
      auth.run('UPDATE users SET disabled=0,version=version+1 WHERE id=?', user.id);
      auth.run('DELETE FROM sessions WHERE user_id=?', user.id);
      auth.audit(null, 'operator_recovery', user.id);
      return auth.grant(user.id, null);
    });
  } else throw new Error('用法: node server/manage.mjs bootstrap EMAIL NAME | recover-admin EMAIL | platform-admin EMAIL on|off | list-orgs | create-org ORG_ID NAME | rename-org ORG_ID NAME | move-user EMAIL ORG_ID');
  if (token) process.stdout.write(`一次性设置密码链接（1 小时有效，请私下交付）：\n${settings.origin}/#set-password=${token}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
finally { auth.close(); }
