import {createHash, randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {normalizeKeyBindings, DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';

export function createKeyPreferencesStore({accountRoot}) {
  const directory = path.join(accountRoot, 'key-preferences'), pending = new Map();
  const key = username => createHash('sha256').update(username).digest('hex');
  return {
    async load(username) {
      const id = key(username); await pending.get(id);
      try { return normalizeKeyBindings(JSON.parse((await fs.readFile(path.join(directory, `${id}.json`), 'utf8')).replace(/^\uFEFF/, ''))); }
      catch (error) { if (error.code === 'ENOENT') return structuredClone(DEFAULT_KEY_BINDINGS); throw error; }
    },
    async save(username, config) {
      const normalized = normalizeKeyBindings(config), id = key(username);
      const write = (pending.get(id) ?? Promise.resolve()).then(async () => {
        await fs.mkdir(directory, {recursive: true});
        const temporary = path.join(directory, `.${id}.${process.pid}.${randomUUID()}.tmp`);
        let handle;
        try {
          handle = await fs.open(temporary, 'wx', 0o600);
          await handle.writeFile(JSON.stringify(normalized, null, 2) + '\n'); await handle.sync();
          await handle.close(); handle = null;
          for (let attempt = 0; ; attempt++) {
            try { await fs.rename(temporary, path.join(directory, `${id}.json`)); break; }
            catch (error) {
              if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
              await delay(10 * 2 ** attempt);
            }
          }
        } finally {
          if (handle) await handle.close().catch(() => {});
          await fs.rm(temporary, {force: true}).catch(() => {});
        }
        return normalized;
      });
      const settled = write.then(() => undefined, () => undefined); pending.set(id, settled);
      settled.then(() => { if (pending.get(id) === settled) pending.delete(id); }); return write;
    },
  };
}
