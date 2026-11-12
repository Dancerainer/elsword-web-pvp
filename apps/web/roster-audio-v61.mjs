import {isRavenProfession} from '../../packages/professions/catalog.mjs';

// These small shared records do not depend on loading an RF body or effects.
// The critical index's audio.file is relative to the RF asset root; shield
// manifest files are relative to their own directory.
export const AUDIO_SOURCE_CONFIG=Object.freeze({
  commonCritical:Object.freeze({index:'rf/critical-fx/index.json',prefix:'rf/'}),
  ravenShield:Object.freeze({manifest:'rf/core-shield-audio/manifest.json',prefix:'rf/core-shield-audio/'}),
});
const origin='http://roster-audio.local';
function audioFile(file,prefix){
  if(typeof file!=='string'||!file)throw new TypeError('Audio resource file required');
  const url=new URL(file,origin+'/assets/'+prefix);
  if(url.origin!==origin||!url.pathname.startsWith('/assets/'))throw new TypeError('Audio resource outside asset root');
  return '../'+url.pathname.slice('/assets/'.length);
}
const roster=professionAssets=>[...professionAssets.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

/** Compose records without mutating cached manifests. Stable profession order
 * makes equivalent shared aliases independent of player/roster order. */
export function composeRosterAudio({manifest,professionAssets,criticalIndex,ravenShield=null}){
  const assets=roster(professionAssets),critical=criticalIndex?.audio;
  if(critical?.name!=='Critical_Hit.wav'||!critical.file)throw new TypeError('Original critical audio record required');
  if(assets.some(asset=>isRavenProfession(asset.id))&&!ravenShield?.files)throw new TypeError('Original Raven core audio manifest required');
  const files={...manifest.files};
  for(const asset of assets)for(const [name,record]of Object.entries(asset.audio?.files??{}))
    files[name]={...record,file:audioFile(record.file,record.file.startsWith('../')?'audio/':asset.id.toLowerCase()+'/')};
  if(assets.some(asset=>isRavenProfession(asset.id)))for(const [name,record]of Object.entries(ravenShield.files))
    files[name]={...record,file:audioFile(record.file,AUDIO_SOURCE_CONFIG.ravenShield.prefix)};
  files[critical.name]={...critical,file:audioFile(critical.file,AUDIO_SOURCE_CONFIG.commonCritical.prefix)};
  // Keep the old player option usable, although the common manifest now owns
  // this binding for every profession and takes precedence over that fallback.
  return {manifest:{...manifest,files},criticalSoundFile:critical.file};
}

export async function loadRosterAudio({manifest,professionAssets,data}){
  const assets=roster(professionAssets);
  const [criticalIndex,ravenShield]=await Promise.all([
    data('/assets/'+AUDIO_SOURCE_CONFIG.commonCritical.index),
    assets.some(asset=>isRavenProfession(asset.id))?data('/assets/'+AUDIO_SOURCE_CONFIG.ravenShield.manifest):null,
  ]);
  return composeRosterAudio({manifest,professionAssets:assets,criticalIndex,ravenShield});
}
