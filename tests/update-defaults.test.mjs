import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {main} from '../skills/bab/scripts/cli.mjs';
import {emptyState, readState} from '../skills/bab/scripts/store.mjs';

const installedVersion = JSON.parse(await fs.readFile(new URL('../skills/bab/assets/version.json', import.meta.url), 'utf8')).version;

async function sandbox(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-update-defaults-'));
  const previousHome = process.env.BAB_HOME, previousFetch = globalThis.fetch;
  process.env.BAB_HOME = home;
  globalThis.fetch = async () => {throw new Error('unexpected network request');};
  t.after(async () => {
    if (previousHome === undefined) delete process.env.BAB_HOME; else process.env.BAB_HOME = previousHome;
    globalThis.fetch = previousFetch;
    await fs.rm(home, {recursive: true, force: true});
  });
  return home;
}

function fixture() {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const files = [['skills/bab/SKILL.md', '# Synthetic'], ['skills/bab/assets/version.json', JSON.stringify({version: '99.0.0'})]]
    .map(([path, text]) => ({path, content: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex')}));
  const payload = Buffer.from(JSON.stringify({schema: 1, version: '99.0.0', notes: 'Synthetic only', files}));
  return {config: {sources: ['https://updates.example.test/local.json'], publicKey: publicKey.export({format: 'pem', type: 'spki'})},
    envelope: {payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64')}};
}

test('零参数更新检查使用包内默认配置，未配置时不创建资料库或猜测地址', async t => {
  const home = await sandbox(t);
  const config = await main(['config-get']);
  assert.equal(config.source, 'bundled');
  assert.deepEqual(config.config.update.sources, []);
  const result = await main(['update-check']);
  assert.equal(result.status, 'unconfigured');
  assert.equal(result.feedback.status, 'empty');
  assert.deepEqual(await fs.readdir(home), []);
});

test('零参数使用本地覆盖和实际安装版本，沿用间隔与验签，不自动安装或改用户数据', async t => {
  const home = await sandbox(t), {config, envelope} = fixture();
  const author = JSON.stringify({schema: 1, update: config});
  await fs.writeFile(path.join(home, 'author.json'), author);
  const before = {...emptyState(), profiles: [{id: 'synthetic', activeVersion: 'v0002'}],
    rules: [{synthetic: true}], grants: [{synthetic: true}], installations: [{version: '0.0.1', skillsDir: '/synthetic/other-install'}]};
  await fs.writeFile(path.join(home, 'state.json'), JSON.stringify(before));
  let requests = 0, signatureValid = true;
  globalThis.fetch = async url => {
    requests++; assert.equal(url.href, config.sources[0]);
    return new Response(JSON.stringify(signatureValid ? envelope : {...envelope, signature: 'invalid'}));
  };
  const result = await main(['update-check']);
  assert.equal(result.status, 'available');
  assert.equal(result.currentVersion, installedVersion);
  assert.equal(result.version, '99.0.0'); assert.equal(requests, 1);
  assert.equal((await main(['update-check'])).status, 'not-due'); assert.equal(requests, 1);
  signatureValid = false;
  const invalid = await main(['update-check', '--force']);
  assert.equal(invalid.status, 'offline-or-invalid'); assert.equal(requests, 2);
  assert.equal(invalid.verifiedVersion, undefined);
  const after = await readState(home);
  for (const [key, value] of Object.entries(before)) if (key !== 'maintenance') assert.deepEqual(after[key], value, key);
  assert.equal(await fs.readFile(path.join(home, 'author.json'), 'utf8'), author);
  assert.deepEqual((await fs.readdir(home)).sort(), ['author.json', 'state.json']);
});

test('旧显式配置和版本用法保持独立，不读取本地覆盖，也不静默补一个缺失参数', async t => {
  const home = await sandbox(t), {config, envelope} = fixture();
  await fs.writeFile(path.join(home, 'author.json'), '{broken');
  const file = path.join(home, 'explicit.json'); await fs.writeFile(file, JSON.stringify(config));
  globalThis.fetch = async () => new Response(JSON.stringify(envelope));
  const result = await main(['update-check', '--force', file, '0.0.1']);
  assert.equal(result.status, 'available'); assert.equal(result.currentVersion, '0.0.1');
  const state = await fs.readFile(path.join(home, 'state.json'), 'utf8');
  for (const args of [[file], [file, '--force'], ['--unknown'], ['--force', '--force']]) {
    await assert.rejects(main(['update-check', ...args]));
  }
  assert.equal(await fs.readFile(path.join(home, 'state.json'), 'utf8'), state);
});

test('默认检查遇损坏配置明确报错，不回退包内配置或写入状态', async t => {
  const home = await sandbox(t);
  for (const content of ['{broken', JSON.stringify({schema: 0}), JSON.stringify({schema: 1, update: {sources: ['http://invalid.example.test']}})]) {
    await fs.writeFile(path.join(home, 'author.json'), content);
    await assert.rejects(main(['update-check']));
    assert.equal(await fs.readFile(path.join(home, 'author.json'), 'utf8'), content);
    assert.deepEqual(await fs.readdir(home), ['author.json']);
  }
});
