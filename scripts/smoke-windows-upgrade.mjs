// Exercise the documented recovery path with the immutable, released 0.1.6 EXE.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'win32') throw new Error('This check requires Windows.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-old-upgrade-'));
const home = path.join(temp, 'data'), skillsDir = path.join(temp, 'host/skills'), rulesFile = path.join(temp, 'host/AGENTS.md');
const current = path.join(root, 'dist/win32-x64/skills');
const version = JSON.parse(await fs.readFile(path.join(current, 'bab/assets/version.json'))).version;
async function input(value) {const file = path.join(temp, `input-${Math.random().toString(16).slice(2)}.json`); await fs.writeFile(file, JSON.stringify(value)); return file;}
function run(skills, ...args) {
  const result = spawnSync(path.join(skills, 'bab/bin/bab.exe'), args, {encoding: 'utf8', env: {...process.env, BAB_HOME: home}});
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
try {
  const response = await fetch('https://github.com/BobbyCats/borrow-a-brain/releases/download/v0.1.6/borrow-a-brain-windows-x64.zip', {signal: AbortSignal.timeout(120000)});
  assert.ok(response.ok, `Archive HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '83d483b6dd3fba9021d3afc60ecbb12eb3c0e5481446d174eb54f0ba404d405c');
  const zip = path.join(temp, 'old.zip'), old = path.join(temp, 'old');
  await fs.writeFile(zip, bytes); await fs.mkdir(old);
  const extraction = spawnSync('tar', ['-xf', zip, '-C', old], {encoding: 'utf8'});
  assert.equal(extraction.status, 0, extraction.stderr);
  const oldSkills = path.join(old, 'skills');
  assert.equal(run(oldSkills, 'help').version, '0.1.6');
  await fs.mkdir(path.dirname(rulesFile), {recursive: true});
  await fs.writeFile(rulesFile, '# Synthetic host rule\n');
  run(oldSkills, 'install', await input({source: oldSkills, skillsDir, rulesFile, apply: true}));
  const rule = run(skillsDir, 'memory-add', await input({kind: 'preference', status: 'confirmed', userConfirmed: true,
    statement: '合成测试保留我的规则', conditions: '测试报告', sources: [{role: 'user', ref: 'synthetic://upgrade', excerpt: '保留我的规则'}]}));
  const before = JSON.parse(await fs.readFile(path.join(home, 'state.json'))); delete before.installations;
  const options = {source: current, skillsDir, rulesFile, apply: false};
  assert.equal(run(current, 'install', await input(options)).preflight, 'passed');
  run(current, 'install', await input({...options, apply: true}));
  assert.equal(run(skillsDir, 'help').version, version);
  assert.ok(run(skillsDir, 'help').commands.includes('profile-intake'));
  assert.equal(run(skillsDir, 'memory-query', '保留')[0].id, rule.id);
  const after = JSON.parse(await fs.readFile(path.join(home, 'state.json'))); delete after.installations;
  assert.deepEqual(after, before);
  assert.ok((await fs.readFile(rulesFile, 'utf8')).startsWith('# Synthetic host rule\n'));
  console.log(JSON.stringify({from: '0.1.6', to: version, platform: 'win32-x64', path: 'new-package-installer', personalDataPreserved: true, originalRulesPreserved: true}));
} finally {await fs.rm(temp, {recursive: true, force: true});}
