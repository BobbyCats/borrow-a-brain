import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setup} from '../skills/bab/scripts/setup.mjs';
import {uninstall} from '../skills/bab/scripts/install.mjs';
import {HOSTS} from '../skills/bab/scripts/hosts.mjs';
import {usageFor} from '../skills/bab/scripts/arguments.mjs';

test('项目安装预览可审阅且不写入；发现冲突不等到执行', async t => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bab-setup-'))); t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const home = path.join(temp, 'data'), project = path.join(temp, '我的项目'); await fs.mkdir(project);
  const plan = await setup(home, {host: 'codex', project});
  assert.equal(plan.skillsDir, path.join(project, '.agents', 'skills'));
  assert.equal(plan.rulesFile, path.join(project, 'AGENTS.md'));
  assert.ok(plan.ruleBlock.includes('route-list')); assert.equal(plan.preflight, 'passed');
  assert.equal(plan.skills.length, 5); assert.equal(plan.dataHome, home);
  assert.deepEqual(await fs.readdir(project), []); await assert.rejects(fs.stat(home));
  await fs.writeFile(plan.rulesFile, '# Existing rule\n');
  const applied = await setup(home, {host: 'codex', project, apply: true}); assert.equal(applied.installed, true);
  assert.ok((await fs.readFile(plan.rulesFile, 'utf8')).startsWith('# Existing rule\n'));
  await fs.appendFile(path.join(plan.skillsDir, 'bab/SKILL.md'), '\nlocal edit');
  await assert.rejects(setup(home, {host: 'codex', project}), /有修改/u);
  await assert.rejects(setup(home, {host: 'codex', project, apply: true}), /有修改/u);
});

test('Claude 规则文件、全局显式范围和移除互不混淆', async t => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bab-host-'))); t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const home = path.join(temp, 'data');
  const claude = await setup(home, {host: 'claude', project: temp});
  assert.equal(claude.rulesFile, path.join(temp, 'CLAUDE.md'));
  assert.equal(claude.skillsDir, path.join(temp, '.claude/skills'));
  await assert.rejects(setup(home, {host: 'codex'}), /项目目录/u);
  await assert.rejects(setup(home, {host: 'unknown', project: temp}), /安装宿主/u);
  await assert.rejects(setup(home, {host: 'codex', project: temp, global: true}), /只能选一个/u);
  const userPlan = await setup(home, {host: 'codex', global: true}, temp);
  assert.equal(userPlan.rulesFile, path.join(temp, '.codex/AGENTS.md')); assert.equal(userPlan.scope, 'user');
  await setup(home, {host: 'claude', project: temp, apply: true});
  await uninstall(home, claude.skillsDir);
  assert.equal(await fs.readFile(claude.rulesFile, 'utf8'), '\n\n');
});

test('宿主表覆盖项目和用户六种组合；WorkBuddy 安装不冒充加载验收', async t => {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bab-workbuddy-'))); t.after(() => fs.rm(temp, {recursive: true, force: true}));
  for (const host of Object.keys(HOSTS)) for (const global of [false, true]) {
    const root = path.join(temp, `${host}-${global}`); await fs.mkdir(root);
    const data = path.join(temp, `data-${host}-${global}`);
    const plan = await setup(data, {host, ...(global ? {global} : {project: root})}, root);
    assert.equal(plan.skillsDir, path.join(root, HOSTS[host].skills));
    assert.equal(plan.rulesFile, path.join(root, HOSTS[host].rules[global ? 'user' : 'project']));
    assert.equal(plan.hostLoaded, 'unverified');
    assert.deepEqual(await fs.readdir(root), []);
    if (host === 'workbuddy') {
      assert.equal(plan.historyAdapter, 'export');
      const applied = await setup(data, {host, ...(global ? {global} : {project: root}), apply: true}, root);
      assert.equal(applied.installed, true);
      assert.ok((await fs.readFile(plan.rulesFile, 'utf8')).includes(path.join(plan.skillsDir, 'bab', 'SKILL.md')));
      await setup(data, {host, ...(global ? {global} : {project: root}), apply: true}, root);
      await uninstall(data, plan.skillsDir);
      assert.equal(await fs.readFile(plan.rulesFile, 'utf8'), '\n\n');
    }
  }
  assert.ok(usageFor('setup').includes('codex|claude|workbuddy'));
});
