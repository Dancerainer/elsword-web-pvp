import {createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export class PasswordChangeError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export class AccountCreationError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export function normalizeNewUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!username.length || username.length > 64 || /[\u0000-\u001f\u007f]/.test(username))
    throw new AccountCreationError('invalid-username', 400);
  return username;
}

export function validNewPassword(value) {
  // Passwords are exact strings, including leading/trailing spaces.
  return typeof value === 'string' && value.length >= 6 && value.length <= 128;
}

/** Bootstrap overrides and atomically created player identities; no plaintext password archive. */
export function createCredentialsStore({accountRoot, fileSystem = fs}) {
  const directory = path.join(accountRoot, 'credentials'), createdDirectory = path.join(accountRoot, 'created-accounts');
  const accounts = new Map(), pending = new Map(), created = new Set();
  const dummySalt = randomBytes(16), dummyHash = scryptSync(randomBytes(16), dummySalt, 32);
  const key = username => createHash('sha256').update(username).digest('hex');
  const filename = username => path.join(directory, `${key(username)}.json`);
  const encode = password => {
    const salt = randomBytes(16);
    return {salt, passwordHash: scryptSync(password, salt, 32)};
  };
  function matches(username, password) {
    const account = accounts.get(username);
    const candidate = scryptSync(typeof password === 'string' ? password : '', account?.salt ?? dummySalt, 32);
    return timingSafeEqual(candidate, account?.passwordHash ?? dummyHash) && Boolean(account) && typeof password === 'string';
  }
  function decode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || value.algorithm !== 'scrypt'
      || Object.keys(value).length !== 4 || typeof value.salt !== 'string' || typeof value.passwordHash !== 'string'
      || !/^[0-9a-f]{32}$/.test(value.salt) || !/^[0-9a-f]{64}$/.test(value.passwordHash))
      throw Error('invalid-credential-archive');
    return {salt: Buffer.from(value.salt, 'hex'), passwordHash: Buffer.from(value.passwordHash, 'hex')};
  }
  const archive = account => ({schemaVersion: 1, algorithm: 'scrypt', salt: account.salt.toString('hex'), passwordHash: account.passwordHash.toString('hex')});
  async function atomic(file, archived) {
    await fileSystem.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let handle, owned = false;
    try {
      handle = await fileSystem.open(temporary, 'wx', 0o600); owned = true;
      await handle.writeFile(JSON.stringify(archived, null, 2) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      for (let attempt = 0; ; attempt++) {
        try { await fileSystem.rename(temporary, file); break; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          await delay(10 * 2 ** attempt);
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (owned) await fileSystem.rm(temporary, {force: true}).catch(() => {});
    }
  }
  function transact(username, callback) {
    const result = (pending.get(username) ?? Promise.resolve()).then(callback);
    const settled = result.then(() => undefined, () => undefined);
    pending.set(username, settled);
    settled.then(() => { if (pending.get(username) === settled) pending.delete(username); });
    return result;
  }
  return {
    async initialize(bootstrap) {
      for (const entry of bootstrap) {
        if (typeof entry?.username !== 'string' || !entry.username.length || typeof entry.password !== 'string' || !entry.password.length)
          throw Error('invalid-test-account');
        if (accounts.has(entry.username)) throw Error('duplicate-test-account');
        accounts.set(entry.username, encode(entry.password));
      }
      let archivedPlayers;
      try { archivedPlayers = await fileSystem.readdir(createdDirectory, {withFileTypes: true}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; archivedPlayers = []; }
      for (const entry of archivedPlayers) {
        if (!entry.name.endsWith('.json')) continue; // An interrupted uncommitted .tmp is never an identity.
        const value = JSON.parse((await fileSystem.readFile(path.join(createdDirectory, entry.name), 'utf8')).replace(/^\uFEFF/, ''));
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6
          || value.role !== 'player' || normalizeNewUsername(value.username) !== value.username
          || entry.name !== `${key(value.username)}.json` || accounts.has(value.username)) throw Error('invalid-created-account-archive');
        const credential = decode({schemaVersion: value.schemaVersion, algorithm: value.algorithm, salt: value.salt, passwordHash: value.passwordHash});
        accounts.set(value.username, credential); created.add(value.username);
      }
      for (const username of accounts.keys()) {
        try { accounts.set(username, decode(JSON.parse((await fileSystem.readFile(filename(username), 'utf8')).replace(/^\uFEFF/, '')))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
    get size() { return accounts.size; },
    keys: () => accounts.keys(),
    playerIdentities: () => [...created].map(username => ({username, role: 'player'})),
    // Logins wait for creation or password changes already in flight, then use the committed value.
    async verify(username, password) { await pending.get(username); return matches(username, password); },
    changePassword(username, oldPassword, newPassword, onChanged = () => {}) {
      if (!validNewPassword(newPassword)) return Promise.reject(new PasswordChangeError('invalid-new-password', 400));
      return transact(username, async () => {
        if (!matches(username, oldPassword)) throw new PasswordChangeError('invalid-credentials', 401);
        const next = encode(newPassword);
        try { await atomic(filename(username), archive(next)); }
        catch { throw new PasswordChangeError('password-save-failed', 503); }
        accounts.set(username, next);
        // Session revocation happens before waiting logins can verify the new password.
        onChanged();
      });
    },
    createPlayer(value, password, onCreated = () => {}) {
      let username;
      try { username = normalizeNewUsername(value); }
      catch (error) { return Promise.reject(error); }
      if (!validNewPassword(password)) return Promise.reject(new AccountCreationError('invalid-password', 400));
      return transact(username, async () => {
        if (accounts.has(username)) throw new AccountCreationError('account-exists', 409);
        const next = encode(password);
        try { await atomic(path.join(createdDirectory, `${key(username)}.json`), {...archive(next), username, role: 'player'}); }
        catch { throw new AccountCreationError('account-save-failed', 503); }
        // The single archive commits identity and credentials together. Publish to
        // both in-memory consumers synchronously before waiting login requests.
        accounts.set(username, next); created.add(username); onCreated(username);
        return username;
      });
    },
  };
}
