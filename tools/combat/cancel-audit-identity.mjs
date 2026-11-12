/** Freeze the program and each profession's data/preset separately. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
const root=resolve(import.meta.dirname,'../..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function captureCancelAuditIdentity(){
  const files=Object.fromEntries(readdirSync(resolve(root,'packages/combat-core')).filter(n=>n.endsWith('.mjs')).sort()
    .map(n=>['packages/combat-core/'+n,sha(readFileSync(resolve(root,'packages/combat-core',n)))]));
  return {version:CORE_VERSION,coreSha256:files['packages/combat-core/index.mjs'],
    combatModulesSha256:sha(Buffer.from(JSON.stringify(files))),files,
    professions:Object.fromEntries(['RF','LK','VC','RS','BM','IS'].map(id=>[id,{
      profileSha256:sha(readFileSync(resolve(root,'packages/combat-core/'+id.toLowerCase()+'-profile.json'))),
      presetSha256:sha(readFileSync(resolve(root,'config/'+id.toLowerCase()+'-preset.json')))}])),
    nativeManifestSha256:sha(readFileSync(resolve(root,'artifacts/native/manifest.json')))};
}
