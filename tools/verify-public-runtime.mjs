import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNativeRuntime} from '../packages/native-source/runtime.mjs';

// Use the same loader and real map as the webpage, rather than a HEAD readiness check.
export async function verifyRuntime(load) {
  const json = async file => JSON.parse((await load(file)).toString('utf8'));
  const scene = await json('scene/sander-garpai-rock-pvp/manifest.json');
  if (!/^[a-z0-9-]+\.json$/.test(scene.collision?.url)) throw Error('Invalid collision asset path');
  const collision = await json('scene/sander-garpai-rock-pvp/' + scene.collision.url);
  const runtime = await createNativeRuntime({manifest:await json('native/manifest.json'),
    map:{...scene,...collision},loadBinary:file=>load('native/' + file)});
  return {runtimeVersion:runtime.manifest.runtimeVersion, modules:Object.keys(runtime.manifest.modules), versions:runtime.versions};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [assetRoot, publicUrl, accountRoot] = process.argv.slice(2);
  if (!assetRoot) throw Error('Usage: node tools/verify-public-runtime.mjs ASSET_ROOT [PUBLIC_URL ACCOUNT_ROOT]');
  let result;
  if (!publicUrl) result = await verifyRuntime(file=>readFile(path.join(assetRoot,file)));
  else {
    const account = JSON.parse(await readFile(path.join(accountRoot,'dev-account.json'),'utf8'));
    const login = await fetch(publicUrl + '/api/login',{method:'POST',headers:{Origin:publicUrl,'Content-Type':'application/json'},body:JSON.stringify(account)});
    if (!login.ok) throw Error('Public verification login failed: ' + login.status);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    try {
      result = await verifyRuntime(async file=>{
        const response = await fetch(publicUrl + '/assets/' + file,{headers:{Cookie:cookie},signal:AbortSignal.timeout(60000)});
        if (!response.ok) throw Error(file + ': HTTP ' + response.status);
        return Buffer.from(await response.arrayBuffer());
      });
    } finally { await fetch(publicUrl + '/api/logout',{method:'POST',headers:{Origin:publicUrl,Cookie:cookie}}); }
  }
  console.log(JSON.stringify(result,null,2));
}
