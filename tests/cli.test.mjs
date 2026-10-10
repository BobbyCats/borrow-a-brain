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
