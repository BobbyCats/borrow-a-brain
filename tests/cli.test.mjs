import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArguments} from '../skills/bab/scripts/arguments.mjs';

const runner = fileURLToPath(new URL('../skills/bab/scripts/run.mjs', import.meta.url));
async function sandbox(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-cli-'));
  t.after(() => fs.rm(home, {recursive: true, force: true}));
  return home;
}
function run(home, ...args) {
  const result = spawnSync(process.execPath, [runner, ...args], {env: {...process.env, BAB_HOME: home}, encoding: 'utf8'});
  return {code: result.status, data: result.stdout.trim() ? JSON.parse(result.stdout) : undefined,
    error: result.stderr.trim() ? JSON.parse(result.stderr).error : undefined};
}

test('路由入口一次返回真实项目范围及可用目录，个人事务不读取项目方法', async t => {
  const temp = await sandbox(t), home = path.join(temp, 'data'), project = path.join(temp, 'project');
  await fs.mkdir(home); await fs.mkdir(project);
  const canonical = await fs.realpath(project), scope = `project:${canonical}`;
  const profile = (id, scope, extra = {}) => ({id, name: id, kind: 'method', scope,
    purpose: '合成目录测试', aliases: [], versions: [{version: 'v0001'}], activeVersion: 'v0001', ...extra});
  const state = JSON.stringify({schema: 1, rules: [], grants: [], profiles: [profile('personal', 'personal'), profile('project', scope),
    profile('other', `project:${canonical}-other`), profile('draft', scope, {activeVersion: null})]});
  await fs.writeFile(path.join(home, 'state.json'), state);
  const current = spawnSync(process.execPath, [runner, 'route-context'], {cwd: project, env: {...process.env, BAB_HOME: home}, encoding: 'utf8'});
  assert.equal(current.status, 0, current.stderr);
  const result = JSON.parse(current.stdout);
  assert.equal(result.scope, scope); assert.equal(result.project, canonical); assert.equal(result.dataHome, home);
  assert.deepEqual(result.catalog.map(p => p.id).sort(), ['personal', 'project']);
  assert.deepEqual(run(home, 'route-context', project).data, result);
  const link = path.join(temp, 'alias'); await fs.symlink(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(run(home, 'route-context', link).data, result);
  assert.deepEqual(run(home, 'context', link).data, {project: canonical, scope, dataHome: home});
  const personal = run(home, 'route-context', '--personal'); assert.equal(personal.code, 0);
  assert.equal(personal.data.scope, 'personal'); assert.equal(personal.data.project, null);
  assert.deepEqual(personal.data.catalog.map(p => p.id), ['personal']);
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), state);
});

test('路由入口不创建资料库，错误路径和冲突选项不回退个人范围', async t => {
  const temp = await sandbox(t), home = path.join(temp, 'absent');
  const empty = run(home, 'route-context', temp); assert.equal(empty.code, 0); assert.deepEqual(empty.data.catalog, []);
  const file = path.join(temp, 'file'); await fs.writeFile(file, 'not a directory');
  for (const args of [[home], [file], [temp, '--personal'], ['--personal', temp], ['--personal', '--personal'], ['--scope', 'personal']]) {
    const failed = run(home, 'route-context', ...args); assert.equal(failed.code, 1, JSON.stringify(args));
    assert.equal(failed.data, undefined); assert.ok(failed.error);
  }
  const personal = run(home, 'route-context', '--personal'); assert.equal(personal.code, 0); assert.deepEqual(personal.data.catalog, []);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  await fs.mkdir(home); await fs.writeFile(path.join(home, 'state.json'), '{broken');
  const corrupt = run(home, 'route-context', temp); assert.equal(corrupt.code, 1); assert.equal(corrupt.data, undefined);
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), '{broken');
});

test('错误范围与旗标不能伪装成空方法目录，失败不改动状态', async t => {
  const home = await sandbox(t);
  // Only a synthetic catalog index; this is not a method-quality evaluation.
  const state = {schema: 1, rules: [], grants: [], profiles: [{id: 'fixture', name: '合成方法', kind: 'method',
    scope: 'project:fixture', purpose: '验证范围解析', aliases: [], versions: [{version: 'v0001'}], activeVersion: 'v0001'}]};
  const before = JSON.stringify(state); await fs.writeFile(path.join(home, 'state.json'), before);
  assert.equal(run(home, 'route-catalog', 'project:fixture').data[0].id, 'fixture');
  assert.deepEqual(run(home, 'route-catalog', 'personal').data, []);
  for (const args of [['--scope', 'project:fixture'], ['project:fixture', 'extra'], ['nonsense'], ['project:'], ['']]) {
    const r = run(home, 'route-catalog', ...args); assert.equal(r.code, 1); assert.equal(r.data, undefined);
    assert.match(r.error, /用法/u);
  }
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), before);
});

test('相关目录命令一致拒绝无效范围，合法空目录仍成功', async t => {
  const home = await sandbox(t);
  for (const command of ['profile-list', 'route-list', 'material-list', 'memory-list']) {
    assert.equal(run(home, command, '--scope', 'personal').code, 1);
    assert.equal(run(home, command, 'unknown').code, 1);
    const valid = run(home, command, 'personal'); assert.equal(valid.code, 0); assert.deepEqual(valid.data, []);
  }
});

test('命令帮助给出位置参数用法；未知选项在任何副作用前失败', async t => {
  const home = await sandbox(t);
  const help = run(home, 'help'); assert.equal(help.code, 0);
  assert.match(run(home, 'help', 'route-catalog').data.usage, /route-catalog.*范围/u);
  const contextHelp = run(home, 'help', 'route-context').data;
  assert.match(contextHelp.usage, /项目路径/u);
  assert.match(contextHelp.scope, /位置参数是项目目录/u);
  assert.match(contextHelp.scope, /--personal/u);
  for (const command of help.data.commands) {
    const r = run(home, command, '--unknown-option'); assert.equal(r.code, 1, command); assert.match(r.error, /不支持选项/u);
  }
  assert.deepEqual(await fs.readdir(home), []);
});

test('可选旗标规范化，保留合法版本与范围位置，拒绝多余参数', () => {
  assert.deepEqual(parseArguments('update-check', ['--force', 'config.json', '0.1.5']), ['config.json', '0.1.5', '--force']);
  assert.deepEqual(parseArguments('setup', ['codex', '--user', '--apply']), ['codex', '--user', '--apply']);
  assert.deepEqual(parseArguments('data-clear', ['--confirmed']), ['--confirmed']);
  assert.deepEqual(parseArguments('profile-get', ['id', 'v0001', 'project:legacy']), ['id', 'v0001', 'project:legacy']);
  assert.throws(() => parseArguments('profile-activate', ['id', 'v0001', 'hash', 'wrong']), /范围/u);
  assert.throws(() => parseArguments('install', ['one.json', 'ignored.json']), /参数数量/u);
  assert.throws(() => parseArguments('update-check', ['config.json', '0.1.5', '--force', '--force']), /重复/u);
});

test('收录帮助的示例可直接预览，帮助与预览不创建资料库', async t => {
  const temp = await sandbox(t), home = path.join(temp, 'data');
  const help = run(home, 'help', 'profile-intake'); assert.equal(help.code, 0);
  const exampleVersion = JSON.parse(await fs.readFile(new URL('../skills/bab/assets/examples/profile-version.json', import.meta.url), 'utf8'));
  assert.deepEqual(help.data.example.version, exampleVersion);
  assert.equal(help.data.example.userApproved, undefined);
  assert.equal(help.data.example.approvalHash, undefined);
  const file = path.join(temp, 'intake.json');
  await fs.writeFile(file, JSON.stringify(help.data.example));
  const preview = run(home, 'profile-intake', file); assert.equal(preview.code, 0, preview.error);
  assert.equal(preview.data.status, 'preview'); assert.equal(preview.data.readiness.readyToActivate, false);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  // Missing dates and an array boundary were observed model errors; the help must not weaken validation.
  for (const modify of [x => {delete x.version.sources[0].date;}, x => {x.version.boundaries = [x.version.boundaries];}]) {
    const invalid = structuredClone(help.data.example); modify(invalid);
    await fs.writeFile(file, JSON.stringify(invalid));
    assert.equal(run(home, 'profile-intake', file).code, 1);
  }
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
});

test('沿帮助完成收录仍需明确确认，保存草稿不能直接启用', async t => {
  const temp = await sandbox(t), home = path.join(temp, 'data'), file = path.join(temp, 'intake.json');
  const input = run(home, 'help', 'profile-intake').data.example;
  await fs.writeFile(file, JSON.stringify(input));
  const preview = run(home, 'profile-intake', file).data;
  await fs.writeFile(file, JSON.stringify({...input, approvalHash: preview.approvalHash}));
  assert.equal(run(home, 'profile-intake', file).code, 1);
  await assert.rejects(fs.stat(home), {code: 'ENOENT'});
  await fs.writeFile(file, JSON.stringify({...input, approvalHash: preview.approvalHash, userApproved: true}));
  const saved = run(home, 'profile-intake', file); assert.equal(saved.code, 0, saved.error);
  assert.equal(saved.data.status, 'draft');
  assert.equal(run(home, 'profile-activate', saved.data.id, saved.data.version, saved.data.approvalHash, input.scope).code, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'state.json'), 'utf8')).profiles[0].activeVersion, null);
});
