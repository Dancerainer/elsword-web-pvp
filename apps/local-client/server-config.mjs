import {readFile} from 'node:fs/promises';

// Sessions, updates and sockets all use root-relative paths on this origin.
export function parseServerOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value)) {
    throw Error('Set serverUrl to an HTTP or HTTPS origin without credentials, a path, a query or a fragment.');
  }
  return new URL(value).origin;
}

export async function resolveServerOrigin({remoteOrigin, configPath, manifest, env = process.env}) {
  if (remoteOrigin !== undefined) return parseServerOrigin(remoteOrigin);
  if (env.WEB_PVP_SERVER_URL !== undefined) return parseServerOrigin(env.WEB_PVP_SERVER_URL);
  let contents;
  try {
    contents = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Older packages stored the default endpoint in the content manifest.
    if (manifest.remoteOrigin) return parseServerOrigin(manifest.remoteOrigin);
    throw Error('Set serverUrl in server-config.json or set WEB_PVP_SERVER_URL.');
  }
  return parseServerOrigin(JSON.parse(contents.replace(/^\uFEFF/, '')).serverUrl);
}
