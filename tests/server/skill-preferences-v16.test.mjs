import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, createSkillPreferencesStore, SkillPreferencesValidationError } from '../../apps/server/skill-preferences.mjs';

const branch = (id, selectable = true) => ({ id, selectable, supported: false });
const active = (skillId, extra = {}) => ({ skillId, unitClass: 107, passive: false, supported: true,
  topTier: true, slotEligible: true, selectable: true, branches: [branch('heavy'), branch('light'), branch('closed', false)], ...extra });
const profile = { profileId: 'small-legal-rf', profileVersion: 'small-v1', skillCatalog: [
  active(1, { topTier: false, selectable: false }), active(2, { replacesSkillId: 1, topTier: false, selectable: false }),
  active(3, { replacesSkillId: 2 }), active(4, { branches: [] }), active(5, { passive: true }),
  active(6, { unitClass: 4 }), active(7, { supported: false }), active(8, { topTier: false }),
  active(9, { replacesSkillId: 8 }), active(10, { selectable: false }), active(11, { slotEligible: false }),
  active(12, { topTier: false }),
] };
const preset = { presetVersion: 'small-preset-v1', bannedSkillIds: [8] };
const config = (first = { skillId: 3, branchId: 'heavy' }, branchChoices = {}) => ({
  loadout: [first, null, null, null, null, null, null, null], branchChoices,
});
const accountFile = (root, username) => path.join(root, 'skill-preferences', createHash('sha256').update(username).digest('hex') + '.json');
async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-skill-prefs-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, store: createSkillPreferencesStore({ accountRoot: root, profile, preset, ...extra }) };
}

test('highest replacement, selectable unsupported-effect traits, independent tree choices and core extras', () => {
  const input = config({ skillId: 1, branchId: 'heavy', requestedSkillId: 1, level: 99, password: 'never-persist' }, { 4: 'none' });
  const before = structuredClone(input), result = normalize(input, profile, preset);
  assert.deepEqual(result, config({ skillId: 3, branchId: 'heavy' }, { 3: 'heavy', 4: 'none' }));
  assert.deepEqual(input, before);
  assert.deepEqual(normalize(result, profile, preset), result);
});

test('tree selection fills omitted slot branch and supports explicit none without an equipped slot', () => {
  assert.deepEqual(normalize(config({ skillId: 3 }, { 1: 'light', 4: 'none' }), profile, preset),
    config({ skillId: 3, branchId: 'light' }, { 3: 'light', 4: 'none' }));
  assert.deepEqual(normalize(config(null, { 1: 'none' }), profile, preset), config(null, { 3: 'none' }));
});

for (const [name, value] of [
  ['unknown', 999], ['passive', 5], ['other career', 6], ['unsupported', 7],
  ['banned base', 8], ['banned highest', 9], ['unselectable', 10], ['ineligible slot', 11],
  ['incomplete highest node', 12], ['fraction', 3.5], ['negative', -3], ['null', null],
  ['boolean', true], ['object ID', {}], ['exponent ID', '3e0'], ['infinite', Infinity],
]) test(`strict rejects ${name} skill in slots and independent choices`, () => {
  assert.throws(() => normalize(config({ skillId: value }), profile, preset), SkillPreferencesValidationError);
  if (typeof value === 'number' || typeof value === 'string') {
    assert.throws(() => normalize(config(null, { [value]: 'none' }), profile, preset), SkillPreferencesValidationError);
  }
});

test('banning any ancestor or highest blocks the entire replacement family', () => {
  for (const banned of [1, 2, 3, '2']) for (const requested of [1, 2, 3]) {
    assert.throws(() => normalize(config({ skillId: requested }), profile, { bannedSkillIds: [banned] }), SkillPreferencesValidationError);
  }
});

test('strict rejects malformed arrays, sparse slots, objects, duplicate families and illegal branches', () => {
  for (const input of [null, [], {}, { ...config(), loadout: [undefined, null, null, null, null, null, null, null] }, { ...config(), loadout: Array(8) },
    { ...config(), loadout: Array(7).fill(null) }, { ...config(), loadout: Array(9).fill(null) },
    { ...config(), branchChoices: [] }, { ...config(), branchChoices: null }, { ...config(), branchChoices: 'light' },
    config({ skillId: 3, branchId: 'closed' }), config({ skillId: 3, branchId: null }),
    config({ skillId: 3, branchId: 42 }), config({ skillId: 3, branchId: 'unknown' }),
    config(null, { 3: 'closed' }), config(null, { 3: null }),
    { ...config(), loadout: [{ skillId: 1 }, null, { skillId: 3 }, null, null, null, null, null] },
  ]) assert.throws(() => normalize(input, profile, preset), SkillPreferencesValidationError);
});

test('hostile JSON values stay validation errors without invoking supplied conversion properties', () => {
  for (const value of [{ toString: 1 }, { toString: {} }, Object.create(null), { valueOf: null }]) {
    assert.throws(() => normalize(config({ skillId: value }), profile, preset), SkillPreferencesValidationError);
    assert.throws(() => normalize(config({ skillId: 3, branchId: value }), profile, preset), SkillPreferencesValidationError);
    assert.throws(() => normalize(config(null, { 3: value }), profile, preset), SkillPreferencesValidationError);
  }
  assert.throws(() => normalize(config(null, JSON.parse('{"__proto__":"heavy"}')), profile, preset), SkillPreferencesValidationError);
});

test('strict rejects contradictory tree aliases or explicit slot and tree choices', () => {
  assert.throws(() => normalize(config(null, { 1: 'heavy', 3: 'light' }), profile, preset), SkillPreferencesValidationError);
  assert.throws(() => normalize(config({ skillId: 1, branchId: 'heavy' }, { 3: 'light' }), profile, preset), SkillPreferencesValidationError);
  assert.deepEqual(normalize(config({ skillId: 1, branchId: 'heavy' }, { 3: 'light' }), profile, preset, { mode: 'restore' }),
    config({ skillId: 3, branchId: 'light' }, { 3: 'light' }));
});

test('restore removes invalid skills without shifting slots; canonical tree key wins aliases', () => {
  const input = { loadout: [{ skillId: 999 }, { skillId: 1, branchId: 'closed' }, { skillId: 3 },
    { skillId: 5 }, { skillId: 7 }, { skillId: 9 }, { skillId: 6 }, { skillId: 4 }],
  branchChoices: { 1: 'heavy', 3: 'light', 4: 'none', 5: 'none', 7: 'heavy', 9: 'light', 999: 'none' } };
  const expected = { loadout: [null, { skillId: 3, branchId: 'light' }, null, null, null, null, null,
    { skillId: 4, branchId: 'none' }], branchChoices: { 3: 'light', 4: 'none' } };
  assert.deepEqual(normalize(input, profile, preset, { mode: 'restore' }), expected);
  assert.deepEqual(normalize(expected, profile, preset), expected);
});

test('restore defaults missing fields, pads or truncates slots and clears invalid branch only', () => {
  assert.deepEqual(normalize({}, profile, preset, { mode: 'restore' }), { loadout: Array(8).fill(null), branchChoices: {} });
  assert.deepEqual(normalize(null, profile, preset, { mode: 'restore' }), { loadout: Array(8).fill(null), branchChoices: {} });
  assert.deepEqual(normalize({ loadout: [{ skillId: 1, branchId: 'closed' }] }, profile, preset, { mode: 'restore' }),
    config({ skillId: 3, branchId: 'none' }, { 3: 'none' }));
  assert.deepEqual(normalize({ loadout: Array(9).fill(null), branchChoices: { 3: 'closed', 4: 'none' } }, profile, preset, { mode: 'restore' }),
    config(null, { 4: 'none' }));
});

test('replacement metadata errors cannot hang or silently choose a branch of the graph', () => {
  for (const rows of [
    [active(1, { replacesSkillId: 2 }), active(2, { replacesSkillId: 1 })],
    [active(2, { replacesSkillId: 1 }), active(3, { replacesSkillId: 1 })],
    [active(1), active(1)], [active(1, { replacesSkillId: 'bad' })],
  ]) assert.throws(() => normalize(config(), { skillCatalog: rows }, preset), TypeError);
  assert.throws(() => normalize(config(), profile, preset, { mode: 'guess' }), TypeError);
});

test('actual RF catalog supports all 36 selectable traits and rejects all six passive nodes and PvP900', () => {
  const actual = JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json', import.meta.url)));
  const actualPreset = JSON.parse(readFileSync(new URL('../../config/rf-preset.json', import.meta.url)));
  let total = 0;
  const top = actual.skillCatalog.filter(row => row.topTier && !row.passive && row.skillId !== 900);
  assert.equal(top.length, 19);
  for (const row of top) for (const trait of row.branches.filter(branch => branch.selectable !== false)) {
    const result = normalize(config({ skillId: row.skillId, branchId: trait.id }), actual, actualPreset);
    assert.equal(result.branchChoices[row.skillId], trait.id); total++;
  }
  assert.equal(total, 36);
  for (const row of actual.skillCatalog.filter(row => row.passive || row.skillId === 900)) {
    assert.throws(() => normalize(config({ skillId: row.skillId }), actual, actualPreset), SkillPreferencesValidationError);
  }
  assert.equal(normalize(config({ skillId: 24002, branchId: 'memo-14' }), actual, actualPreset).loadout[0].skillId, 24027);
});

test('new account is null; disk schema is complete and restart restores independent branches', async t => {
  const { root, store } = await fixture(t);
  assert.equal(await store.load('alice'), null);
  const input = config({ skillId: 1, branchId: 'heavy', level: 999, password: 'secret' }, { 4: 'none' });
  const saved = await store.save('alice', input);
  const disk = JSON.parse(await fs.readFile(accountFile(root, 'alice'), 'utf8'));
  assert.deepEqual(disk, { schemaVersion: 1, profileId: 'small-legal-rf', profileVersion: 'small-v1',
    presetVersion: 'small-preset-v1', ...saved });
  assert.equal(JSON.stringify(disk).includes('secret'), false);
  assert.equal(Object.hasOwn(disk, 'username'), false);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
  assert.deepEqual(await createSkillPreferencesStore({ accountRoot: root, profile, preset }).load('alice'), saved);
});

test('account files stay isolated, including case, Unicode and path characters; existing credentials stay intact', async t => {
  const { root, store } = await fixture(t);
  const credentials = '{"username":"original","password":"keep-existing-account"}\n';
  await fs.writeFile(path.join(root, 'dev-account.json'), credentials);
  const users = ['Alice', 'alice', '../alice', 'Player\uac31', 'Player\uac03', 'a\\b'];
  for (let i = 0; i < users.length; i++) await store.save(users[i], config(null, { 3: i % 2 ? 'light' : 'heavy' }));
  for (let i = 0; i < users.length; i++) assert.equal((await store.load(users[i])).branchChoices[3], i % 2 ? 'light' : 'heavy');
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, users.length);
  assert.equal(await fs.readFile(path.join(root, 'dev-account.json'), 'utf8'), credentials);
  assert.equal(await store.load('unknown-account'), null);
  await assert.rejects(store.load(''), TypeError);
  await assert.rejects(store.save({ username: 'alice', password: 'never' }, config()), TypeError);
});

test('corrupt JSON/schema and non-ENOENT IO fail visibly and do not change original bytes', async t => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'skill-preferences'));
  for (const text of ['{broken', '{"schemaVersion":2,"loadout":[]}', 'null', '{"schemaVersion":1}',
    '{"schemaVersion":1,"loadout":[],"branchChoices":[]}']) {
    await fs.writeFile(accountFile(root, 'bad'), text);
    await assert.rejects(store.load('bad'));
    assert.equal(await fs.readFile(accountFile(root, 'bad'), 'utf8'), text);
  }
  const denied = createSkillPreferencesStore({ accountRoot: root, profile, preset,
    fileSystem: { ...fs, readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } } });
  await assert.rejects(denied.load('alice'), { code: 'EACCES' });
});

test('schema1 version migration uses explicit replacement aliases, retaining positions and valid tree choices', async t => {
  const older = { profileId: 'old-rf', profileVersion: 'old-v1', skillCatalog: [active(1), active(4, { branches: [] }), active(5)] };
  const { root, store } = await fixture(t, { profile: older, preset: { presetVersion: 'old-preset', bannedSkillIds: [] } });
  const old = { loadout: [null, null, { skillId: 1, branchId: 'light' }, null, { skillId: 5 }, null, null, null],
    branchChoices: { 1: 'light', 4: 'none', 5: 'heavy' } };
  await store.save('alice', old);
  const before = await fs.readFile(accountFile(root, 'alice'), 'utf8');
  const current = { profileId: 'new-rf', profileVersion: 'new-v2', skillCatalog: [active(3, { replacesSkillId: 1 }),
    active(4, { branches: [] }), active(5, { passive: true })] };
  const reopened = createSkillPreferencesStore({ accountRoot: root, profile: current, preset });
  const expected = { loadout: [null, null, { skillId: 3, branchId: 'light' }, null, null, null, null, null], branchChoices: { 3: 'light', 4: 'none' } };
  assert.deepEqual(await reopened.load('alice'), expected);
  assert.equal(await fs.readFile(accountFile(root, 'alice'), 'utf8'), before, 'load does not rewrite history');
  await reopened.save('alice', expected);
  assert.equal(JSON.parse(await fs.readFile(accountFile(root, 'alice'), 'utf8')).profileVersion, 'new-v2');
});

test('historical omitted branchChoices and changed bans restore safely; unknown fields are not persisted', async t => {
  const { root, store } = await fixture(t);
  await fs.mkdir(path.join(root, 'skill-preferences'));
  await fs.writeFile(accountFile(root, 'alice'), '\uFEFF' + JSON.stringify({ schemaVersion: 1, profileVersion: 'old',
    loadout: [null, { skillId: 1, branchId: 'heavy' }, null, { skillId: 9 }, null, null, null, null] }));
  const restored = await store.load('alice');
  assert.deepEqual(restored, { loadout: [null, { skillId: 3, branchId: 'heavy' }, null, null, null, null, null, null], branchChoices: { 3: 'heavy' } });
  await store.save('alice', { ...restored, password: 'discard', schemaVersion: 999 });
  assert.equal((await fs.readFile(accountFile(root, 'alice'), 'utf8')).includes('discard'), false);
});

test('concurrent saves preserve same-account invocation order while other accounts can finish independently', async t => {
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  const slowKey = createHash('sha256').update('slow').digest('hex'), tempNames = [];
  const fileSystem = { ...fs, rename: async (temporary, destination) => {
    tempNames.push(temporary);
    if (destination.includes(slowKey) && first) { first = false; entered(); await barrier; }
    return fs.rename(temporary, destination);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  const one = store.save('slow', config({ skillId: 3, branchId: 'heavy' }));
  await started;
  const two = store.save('slow', config({ skillId: 3, branchId: 'light' }));
  const fast = await store.save('fast', config({ skillId: 4 }));
  assert.equal(fast.loadout[0].skillId, 4);
  release();
  await Promise.all([one, two]);
  assert.equal((await store.load('slow')).loadout[0].branchId, 'light');
  assert.equal(new Set(tempNames).size, 3);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).filter(name => name.endsWith('.tmp')).length, 0);
});

test('two store instances atomically write complete valid documents with unique temporary files', async t => {
  const temporaryNames = [];
  const fileSystem = { ...fs, open: async (filename, ...args) => {
    temporaryNames.push(filename); return fs.open(filename, ...args);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  const other = createSkillPreferencesStore({ accountRoot: root, profile, preset, fileSystem });
  await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? store : other)
    .save('alice', config({ skillId: 3, branchId: index % 3 ? 'heavy' : 'light' }, { 4: 'none' }))));
  assert.equal(new Set(temporaryNames).size, 24);
  const persisted = await store.load('alice');
  assert.deepEqual(normalize(persisted, profile, preset), persisted);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) test(`transient ${code} rename retries then atomically saves`, async t => {
  let failures = 0, attempts = 0;
  const temporaryNames = new Set();
  const fileSystem = { ...fs, rename: async (temporary, destination) => {
    attempts++; temporaryNames.add(temporary);
    if (failures > 0) { failures--; throw Object.assign(new Error(`temporary-${code}`), { code }); }
    return fs.rename(temporary, destination);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  await store.save('alice', config());
  failures = 2; attempts = 0; temporaryNames.clear();
  const updated = await store.save('alice', config({ skillId: 3, branchId: 'light' }));
  assert.equal(attempts, 3);
  assert.equal(temporaryNames.size, 1, 'retry reuses the same complete closed temporary file');
  assert.deepEqual(await store.load('alice'), updated);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) test(`permanent ${code} rename stops after bounded retries and preserves old file`, async t => {
  let failure = null, attempts = 0;
  const fileSystem = { ...fs, rename: async (...args) => {
    attempts++;
    if (failure) throw failure;
    return fs.rename(...args);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  const saved = await store.save('alice', config());
  const original = await fs.readFile(accountFile(root, 'alice'), 'utf8');
  failure = Object.assign(new Error(`permanent-${code}`), { code }); attempts = 0;
  await assert.rejects(store.save('alice', config({ skillId: 3, branchId: 'light' })), error => error === failure);
  assert.equal(attempts, 6, 'one initial attempt plus five retries');
  assert.equal(await fs.readFile(accountFile(root, 'alice'), 'utf8'), original);
  assert.deepEqual(await store.load('alice'), saved);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
  failure = null;
  assert.equal((await store.save('alice', config({ skillId: 3, branchId: 'light' }))).loadout[0].branchId, 'light');
});

test('non-transient rename errors fail on the first attempt and preserve old file', async t => {
  let failure = null, attempts = 0;
  const fileSystem = { ...fs, rename: async (...args) => {
    attempts++;
    if (failure) throw failure;
    return fs.rename(...args);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  await store.save('alice', config());
  const original = await fs.readFile(accountFile(root, 'alice'), 'utf8');
  for (const code of ['EIO', 'ENOENT', 'ENOSPC']) {
    failure = Object.assign(new Error(`permanent-${code}`), { code }); attempts = 0;
    await assert.rejects(store.save('alice', config({ skillId: 4 })), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(accountFile(root, 'alice'), 'utf8'), original);
  }
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
});

test('two stores survive mixed transient rename failures during 24 concurrent saves', async t => {
  const attempts = new Map(), codes = ['EPERM', 'EACCES', 'EBUSY'];
  const fileSystem = { ...fs, rename: async (temporary, destination) => {
    const count = (attempts.get(temporary) ?? 0) + 1; attempts.set(temporary, count);
    if (count < 4) throw Object.assign(new Error('temporary-shared-handle'), { code: codes[count - 1] });
    return fs.rename(temporary, destination);
  } };
  const { root, store } = await fixture(t, { fileSystem });
  const other = createSkillPreferencesStore({ accountRoot: root, profile, preset, fileSystem });
  await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? store : other)
    .save('alice', config({ skillId: 3, branchId: index % 3 ? 'heavy' : 'light' }, { 4: 'none' }))));
  assert.equal(attempts.size, 24);
  for (const count of attempts.values()) assert.ok(count >= 4 && count <= 6);
  const persisted = await store.load('alice');
  assert.deepEqual(normalize(persisted, profile, preset), persisted);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
});

for (const stage of ['writeFile', 'sync', 'rename']) test(`failed ${stage} preserves original file, removes own temp and allows later save`, async t => {
  let fail = false;
  const fileSystem = { ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      return { writeFile: async (...values) => {
        if (fail && stage === 'writeFile') { await handle.writeFile('{partial'); throw new Error('fixture-writeFile-failed'); }
        return handle.writeFile(...values);
      }, sync: async () => {
        if (fail && stage === 'sync') throw new Error('fixture-sync-failed');
        return handle.sync();
      }, close: () => handle.close() };
    },
    rename: async (...args) => {
      if (fail && stage === 'rename') throw new Error('fixture-rename-failed');
      return fs.rename(...args);
    },
  };
  const { root, store } = await fixture(t, { fileSystem });
  const old = await store.save('alice', config());
  const original = await fs.readFile(accountFile(root, 'alice'), 'utf8');
  fail = true;
  await assert.rejects(store.save('alice', config({ skillId: 3, branchId: 'light' })), new RegExp(`fixture-${stage}-failed`));
  assert.equal(await fs.readFile(accountFile(root, 'alice'), 'utf8'), original);
  assert.deepEqual(await store.load('alice'), old);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
  fail = false;
  assert.equal((await store.save('alice', config({ skillId: 3, branchId: 'light' }))).loadout[0].branchId, 'light');
});

test('invalid saves never open a temporary file and cannot replace existing preferences', async t => {
  const { root, store } = await fixture(t);
  await store.save('alice', config());
  const before = await fs.readFile(accountFile(root, 'alice'), 'utf8');
  await assert.rejects(store.save('alice', config({ skillId: 5 })), SkillPreferencesValidationError);
  assert.equal(await fs.readFile(accountFile(root, 'alice'), 'utf8'), before);
  assert.equal((await fs.readdir(path.join(root, 'skill-preferences'))).length, 1);
});
