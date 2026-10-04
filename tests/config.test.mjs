import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readConfig, saveConfig, validateConfig} from '../skills/bab/scripts/config.mjs';

test('地址默认为空；用户配置可迁移域名，损坏配置不静默替代', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bab-config-')); t.after(() => fs.rm(home, {recursive: true, force: true}));
  assert.equal((await readConfig(home)).config.website, null);
  await saveConfig(home, {schema: 1, website: 'https://example.test', feedbackEndpoint: null, resources: [], update: {sources: [], publicKey: null}});
  assert.equal((await readConfig(home)).config.website, 'https://example.test/');
  assert.throws(() => validateConfig({schema: 1, website: 'http://example.test'}), /HTTPS/u);
  assert.throws(() => validateConfig({schema: 1, website: 'https://secret:token@example.test'}), /凭据/u);
  await fs.writeFile(path.join(home, 'author.json'), '{bad');
  await assert.rejects(readConfig(home));
});
