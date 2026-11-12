import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';

export class SkillPreferencesValidationError extends RangeError {
  constructor(message) {
    super(message);
    this.name = 'SkillPreferencesValidationError';
  }
}

const isRecord = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const skillId = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  ? value : typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const describe = value => value === null ? 'null' : ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
  ? String(value) : `<${typeof value}>`;
const renameRetryDelays = [10, 20, 40, 80, 160];
const transientRenameCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function renameWithRetry(fileSystem, temporary, destination) {
  for (let attempt = 0; ; attempt++) {
    try { await fileSystem.rename(temporary, destination); return; }
    catch (error) {
      // Windows may temporarily deny replacement while another store closes a file handle.
      // Every attempt remains an atomic rename; exhaustion exposes the original filesystem error.
      if (!transientRenameCodes.has(error.code) || attempt === renameRetryDelays.length) throw error;
      await delay(renameRetryDelays[attempt]);
    }
  }
}

function catalogRules(profile, preset) {
  if (!Array.isArray(profile?.skillCatalog)) throw new TypeError('Invalid skill catalog');
  const unitClass = profile.target?.unitClass ?? 107;
  if (!Number.isSafeInteger(unitClass) || unitClass <= 0) throw new TypeError('Invalid profession unit class');
  const rows = new Map(), successor = new Map();
  for (const row of profile.skillCatalog) {
    const id = skillId(row?.skillId);
    if (id === null || rows.has(id)) throw new TypeError('Invalid or duplicate catalog skill ID');
    rows.set(id, row);
    if (row.replacesSkillId != null) {
      const previous = skillId(row.replacesSkillId);
      if (previous === null || successor.has(previous)) throw new TypeError('Invalid or ambiguous skill replacement');
      successor.set(previous, id);
    }
  }
  // Missing old rows can still be migrated using a current node's explicit replacesSkillId.
  const finalIds = new Map();
  for (const id of new Set([...rows.keys(), ...successor.keys()])) {
    let current = id;
    const visited = new Set();
    while (successor.has(current)) {
      if (visited.has(current)) throw new TypeError('Invalid skill replacement cycle');
      visited.add(current);
      current = successor.get(current);
    }
    finalIds.set(id, current);
  }
  const banned = preset?.bannedSkillIds ?? [];
  if (!Array.isArray(banned) || banned.some(id => skillId(id) === null)) throw new TypeError('Invalid banned skill IDs');
  const bannedFamilies = new Set(banned.map(id => finalIds.get(skillId(id)) ?? skillId(id)));
  return id => {
    const finalId = finalIds.get(id), row = rows.get(finalId), source = rows.get(id);
    if (!row || row.unitClass !== unitClass || row.passive || row.supported !== true
      || row.slotEligible === false || row.selectable === false || row.topTier === false
      || source && (source.unitClass !== unitClass || source.passive) || bannedFamilies.has(finalId)) return null;
    const branches = new Set(['none']);
    if (row.branches != null && !Array.isArray(row.branches)) throw new TypeError('Invalid catalog branches');
    for (const branch of row.branches ?? []) {
      const id = branch.id ?? branch.branchId;
      if (typeof id !== 'string' || !id.length || id === 'none') throw new TypeError('Invalid catalog branch ID');
      // A selectable branch may have effects whose native consumers remain unsupported.
      if (branch.selectable !== false) branches.add(id);
    }
    return { id: finalId, branches };
  };
}

/** Pure profession preference validation. Restore retains valid skills in their original slots. */
export function normalize(config, profile, preset, { mode = 'strict' } = {}) {
  if (mode !== 'strict' && mode !== 'restore') throw new TypeError('Unknown skill preference normalization mode');
  const strict = mode === 'strict', resolve = catalogRules(profile, preset);
  const invalid = message => { if (strict) throw new SkillPreferencesValidationError(message); };
  if (!isRecord(config)) { invalid('Skill preferences must be an object'); config = {}; }
  let slots = config.loadout;
  if (!Array.isArray(slots) || slots.length !== 8) {
    invalid('Exactly 8 skill slots required');
    slots = Array.isArray(slots) ? slots : [];
  }
  let choices = config.branchChoices === undefined ? {} : config.branchChoices;
  if (!isRecord(choices)) { invalid('Branch choices must be an object'); choices = {}; }
  const branchChoices = {}, loadout = Array(8).fill(null), seen = new Set();
  // A current canonical key wins over its old aliases when restoring contradictory data.
  const entries = Object.entries(choices).map(([key, branch]) => ({ key, branch, rule: resolve(skillId(key)) }))
    .sort((a, b) => Number(b.key === String(b.rule?.id)) - Number(a.key === String(a.rule?.id)));
  for (const { key, branch, rule } of entries) {
    if (!rule) { invalid(`Skill ${key} is not an available profession active skill`); continue; }
    if (!rule.branches.has(branch)) { invalid(`Unknown trait ${describe(branch)} for skill ${rule.id}`); continue; }
    if (Object.hasOwn(branchChoices, rule.id) && branchChoices[rule.id] !== branch) {
      invalid(`Conflicting branch choices for skill ${rule.id}`); continue;
    }
    branchChoices[rule.id] = branch;
  }
  for (let index = 0; index < 8; index++) {
    const slot = slots[index];
    if (slot === null || !strict && slot === undefined) continue;
    if (!isRecord(slot)) { invalid(`Invalid skill slot ${index}`); continue; }
    const rule = resolve(skillId(slot.skillId));
    if (!rule) { invalid(`Skill ${describe(slot.skillId)} is not an available profession active skill`); continue; }
    if (seen.has(rule.id)) { invalid(`Duplicate skill ${rule.id}`); continue; }
    let branch = slot.branchId === undefined ? branchChoices[rule.id] ?? 'none' : slot.branchId;
    if (!rule.branches.has(branch)) { invalid(`Unknown trait ${describe(branch)} for skill ${rule.id}`); branch = 'none'; }
    if (Object.hasOwn(branchChoices, rule.id) && branchChoices[rule.id] !== branch) {
      if (slot.branchId !== undefined) invalid(`Slot and tree branch choices conflict for skill ${rule.id}`);
      branch = branchChoices[rule.id];
    }
    branchChoices[rule.id] = branch;
    seen.add(rule.id);
    loadout[index] = { skillId: rule.id, branchId: branch };
  }
  return { loadout, branchChoices };
}

/** Store owns only accountRoot/skill-preferences; authentication remains with its caller. */
export function createSkillPreferencesStore({ accountRoot, profile, preset, professionId = 'RF', fileSystem = fs }) {
  if (typeof accountRoot !== 'string' || !accountRoot.length) throw new TypeError('Account root required');
  if (!PROFESSION_IDS.includes(professionId)) throw new TypeError('Invalid profession ID');
  catalogRules(profile, preset);
  // Existing RF records retain their path and bytes. Other professions have
  // independent archives, so opening an LK tree cannot migrate an RF loadout.
  const directory = path.join(accountRoot, 'skill-preferences', ...(professionId === 'RF' ? [] : [professionId])), pending = new Map();
  const version = profile.profileVersion ?? createHash('sha256').update(JSON.stringify(profile.skillCatalog)).digest('hex');
  const identity = username => {
    if (typeof username !== 'string' || !username.length) throw new TypeError('Username required');
    return createHash('sha256').update(username, 'utf8').digest('hex');
  };
  const filename = key => path.join(directory, `${key}.json`);
  return {
    async load(username) {
      const key = identity(username);
      await pending.get(key);
      let text;
      try { text = await fileSystem.readFile(filename(key), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      // Corruption must stay visible to the API; it is never treated as a first login.
      const stored = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (!isRecord(stored) || stored.schemaVersion !== 1 || !Array.isArray(stored.loadout)
        || stored.professionId !== undefined && stored.professionId !== professionId
        || stored.branchChoices !== undefined && !isRecord(stored.branchChoices)) {
        throw new TypeError('Invalid skill preferences schema');
      }
      return normalize(stored, profile, preset, { mode: 'restore' });
    },
    async save(username, config) {
      const key = identity(username), normalized = normalize(config, profile, preset, { mode: 'strict' });
      const previous = pending.get(key) ?? Promise.resolve();
      const write = previous.then(async () => {
        const record = { schemaVersion: 1, ...(professionId === 'RF' ? {} : {professionId}), profileId: profile.profileId ?? null, profileVersion: version,
          presetVersion: preset?.presetVersion ?? null, ...normalized };
        await fileSystem.mkdir(directory, { recursive: true });
        const temporary = path.join(directory, `.${key}.${process.pid}.${randomUUID()}.tmp`);
        let handle, owned = false;
        try {
          handle = await fileSystem.open(temporary, 'wx', 0o600); owned = true;
          await handle.writeFile(JSON.stringify(record, null, 2) + '\n', 'utf8');
          await handle.sync();
          await handle.close(); handle = null;
          await renameWithRetry(fileSystem, temporary, filename(key));
        } finally {
          if (handle) await handle.close().catch(() => {});
          if (owned) await fileSystem.rm(temporary, { force: true }).catch(() => {});
        }
        return normalized;
      });
      // Same-account writes keep invocation order; other accounts have independent queues.
      const settled = write.then(() => undefined, () => undefined);
      pending.set(key, settled);
      settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
      return write;
    },
  };
}
