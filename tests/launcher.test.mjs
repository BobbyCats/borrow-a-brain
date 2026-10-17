import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const unix = process.platform !== 'win32';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bab launcher 中文 '));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, 'scripts')); await fs.mkdir(path.join(root, 'tools'));
  await fs.copyFile(new URL('../skills/bab/scripts/run.sh', import.meta.url), path.join(root, 'scripts/run.sh'));
  await fs.symlink('/usr/bin/dirname', path.join(root, 'tools/dirname'));
  return {root, run: (...args) => spawnSync('/bin/sh', [path.join(root, 'scripts/run.sh'), ...args], {encoding: 'utf8', env: {...process.env, PATH: path.join(root, 'tools')}})};
}
test('自动入口在没有 Node 时优先执行独立程序，保留空格参数和退出码', {skip: !unix}, async t => {
  const {root, run} = await fixture(t);
  await fs.mkdir(path.join(root, 'bin'));
  await fs.writeFile(path.join(root, 'bin/bab'), '#!/bin/sh\nprintf "%s\\n" "$1" "$2"\nexit 7\n', {mode: 0o755});
  // A poisoned Node must never be executed when the standalone runner exists.
  await fs.writeFile(path.join(root, 'tools/node'), '#!/bin/sh\necho WRONG_NODE >&2\nexit 99\n', {mode: 0o755});
  const result = run('route-context', '项目 path with spaces');
  assert.equal(result.status, 7); assert.equal(result.stdout, 'route-context\n项目 path with spaces\n');
  assert.equal(result.stderr, '');
});
test('源码包缺少 Node 时给出依赖修复错误，不执行应用或写入数据', {skip: !unix}, async t => {
  const {run} = await fixture(t); const result = run('help');
  assert.equal(result.status, 78); assert.match(result.stderr, /安装 Agent/u); assert.equal(result.stdout, '');
});
test('源码包拒绝旧 Node，不继续调用 CLI', {skip: !unix}, async t => {
  const {root, run} = await fixture(t);
  await fs.writeFile(path.join(root, 'tools/node'), '#!/bin/sh\nexit 1\n', {mode: 0o755});
  const result = run('help'); assert.equal(result.status, 78); assert.match(result.stderr, /22\+/u);
});
