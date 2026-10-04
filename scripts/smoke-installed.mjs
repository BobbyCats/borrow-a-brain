import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {fileMap} from '../skills/bab/scripts/install.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = process.argv.includes('--native');
const base = native ? path.join(root, 'dist', `${process.platform}-${process.arch}`) : root;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-installed-'));
const home = path.join(temp, 'data'), skillsDir = path.join(temp, 'host', 'skills'), rulesFile = path.join(temp, 'host', 'AGENTS.md');
const env = {...process.env, BAB_HOME: home};
const binName = process.platform === 'win32' ? 'bab.exe' : 'bab';
let installed = false;
async function argsFile(value) {const file = path.join(temp, `input-${Math.random().toString(16).slice(2)}.json`); await fs.writeFile(file, JSON.stringify(value)); return file;}
function run(...args) {
  const entry = installed ? path.join(skillsDir, 'bab') : path.join(base, 'skills', 'bab');
  const executable = native ? path.join(entry, 'bin', binName) : process.execPath;
  const commandArgs = native ? args : [path.join(entry, 'scripts', 'run.mjs'), ...args];
  const result = spawnSync(executable, commandArgs, {encoding: 'utf8', env});
  if (result.status !== 0) throw new Error(`CLI ${args[0]} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
try {
  const config = {source: path.join(base, 'skills'), skillsDir, rulesFile, apply: false, version: '0.1.0'};
  assert.equal(run('install', await argsFile(config)).apply, false);
  await assert.rejects(fs.stat(skillsDir));
  config.apply = true; assert.equal(run('install', await argsFile(config)).skills.length, 5); installed = true;
  assert.equal(run('help').version, '0.1.0');
  const rule = run('memory-add', await argsFile({kind: 'preference', status: 'confirmed', userConfirmed: true, statement: '合成测试喜欢先给结论', conditions: '测试报告', sources: [{role: 'user', ref: 'synthetic://smoke', excerpt: '测试要求'}]}));
  assert.equal(run('memory-query', '结论')[0].id, rule.id);
  const before = await fs.readFile(rulesFile, 'utf8');
  assert.ok(before.includes('borrow-a-brain:start'));
  const keys = generateKeyPairSync('ed25519');
  const files = [];
  for (const file of Object.keys(await fileMap(path.join(root, 'skills')))) {
    let content = await fs.readFile(path.join(root, 'skills', file));
    if (file === 'bab/assets/version.json') content = Buffer.from('{"version":"0.1.1","channel":"synthetic-test"}');
    files.push({path: `skills/${file}`, content: content.toString('base64'), sha256: createHash('sha256').update(content).digest('hex')});
  }
  const bytes = Buffer.from(JSON.stringify({schema: 1, version: '0.1.1', notes: '合成升级包：只用于隔离安装验证。', files}));
  const envelope = {payload: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64')};
  const update = {envelope, publicKey: keys.publicKey.export({format: 'pem', type: 'spki'}), currentVersion: '0.1.0', approvedVersion: '0.1.1', skillsDir, rulesFile};
  assert.equal(run('update-apply', await argsFile(update)).updated, '0.1.1');
  assert.equal(run('help').version, '0.1.1');
  assert.equal(run('memory-query', '结论')[0].id, rule.id);
  // Use the downloaded launcher: Windows cannot remove the executable that is currently running.
  installed = false;
  assert.equal(run('uninstall', skillsDir).uninstalled.length, 5);
  assert.ok(!(await fs.readFile(rulesFile, 'utf8')).includes('borrow-a-brain:start'));
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'state.json'), 'utf8')).rules[0].id, rule.id);
  console.log(JSON.stringify({mode: native ? 'standalone' : 'node', platform: `${process.platform}-${process.arch}`, installedSkills: 5, separateProcessRecall: 'passed', signedSourceUpdate: 'passed', launcherAfterUpdate: 'passed', uninstall: 'passed', personalDataPreserved: true}));
} finally {await fs.rm(temp, {recursive: true, force: true});}
