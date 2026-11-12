import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PROFESSIONS,PROFESSION_IDS,isRavenProfession} from '../../packages/professions/catalog.mjs';
import {mergeAddSummonAudio} from '../../packages/combat-assets/add-summon-assets.mjs';
import {loadRosterAudio,composeRosterAudio,AUDIO_SOURCE_CONFIG} from '../../apps/web/roster-audio-v61.mjs';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';

const root=resolve(import.meta.dirname,'../..'),assetRoot=resolve(process.env.PROFESSION_ASSET_ROOT??resolve(root,'artifacts'));
const overlay=process.env.AUDIO_V61_ASSET_OVERLAY?resolve(process.env.AUDIO_V61_ASSET_OVERLAY):null;
const resourcePath=relative=>overlay&&existsSync(resolve(overlay,relative))?resolve(overlay,relative):resolve(assetRoot,relative);
const read=relative=>JSON.parse(readFileSync(resourcePath(relative),'utf8'));
const criticalIndex=read('rf/critical-fx/index.json'),shield=read('rf/core-shield-audio/manifest.json');
const criticalName='Critical_Hit.wav',shieldNames=['Raven_NasodCore_Guard.ogg','Raven_NasodCore_Trans_Parry.ogg'];
const attackNames=['Raven_NasodCore_Attack.ogg','Raven_NasodCore_Trans_Attack.ogg'];
const prism=JSON.parse(readFileSync(resolve(root,'contracts/add-prism-endpoints-2016.json'),'utf8')).audio;
function common(){
  const base=read('audio/manifest.json');
  return {...base,files:{...base.files,...read('audio/pose-v25/manifest.json').files,
    ...read('audio/feedback-v26/manifest.json').files,...read('audio/pvp/manifest.json').files}};
}
function asset(id){
  const prefix=id.toLowerCase()+'/',manifest=read(prefix+'manifest.json');
  let audio=manifest.audioManifest?read(prefix+manifest.audioManifest):null;
  // Match the real asset loader's two audio-only extensions without loading a
  // character, renderer, collision runtime or Native helper for this test.
  if(id==='MM'){
    const directory=prefix+'summons/apocalypse/',summon=read(directory+'manifest.json');
    audio=mergeAddSummonAudio(audio,read(directory+summon.audio));
  }
  if(['LP','MM','DE'].includes(id))audio=mergeAddSummonAudio(audio,prism);
  return {id,base:PROFESSIONS[id].assetBase,manifest,audio};
}
const assets=new Map(PROFESSION_IDS.map(id=>[id,asset(id)]));
async function assemble(ids){
  const requested=[],manifest=common(),before=structuredClone(manifest);
  const professionAssets=new Map(ids.map(id=>[id,assets.get(id)]));
  const result=await loadRosterAudio({manifest,professionAssets,data:async url=>{
    requested.push(url);assert.ok(url.startsWith('/assets/'));return read(url.slice('/assets/'.length));
  }});
  assert.deepEqual(manifest,before,'cached common records remain unchanged');
  return {...result,requested};
}
function verifyResource(record,relative){
  assert.equal(new URL('/assets/audio/'+record.file,'http://fixture').pathname,'/assets/'+relative);
  const bytes=readFileSync(resourcePath(relative));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
  assert.equal(bytes.length,record.bytes);
}
function verifyPlayback(manifest,names){
  const calls=[],errors=[],actor={id:'local',x:0,y:0,z:0};
  const player=createBattleAudio({storage:null,localActorId:()=>actor.id,onError:error=>errors.push(error),
    createAudio:url=>({volume:0,currentTime:0,play(){calls.push({url,volume:this.volume});return Promise.resolve();},pause(){},removeAttribute(){},load(){}})});
  player.configure({manifest});player.setListenerPosition([0,0,0]);
  try{
    for(const name of names)assert.equal(player.play(name,{actorId:actor.id,...sourceSoundEventMetadata(actor)}),true,name);
    assert.equal(calls.length,names.length);assert.deepEqual(errors,[]);
    assert.ok(calls.every(call=>call.volume>0),'valid original spatial metadata gives nearby requests a positive mixer gain');
  }finally{player.dispose();}
  // Mock routing/volume verification only; this does not prove browser decoding
  // or human audibility, and does not grant a browser gesture in production.
}

for(const id of PROFESSION_IDS)test(`${id} actual single-profession audio binds shared critical without RF actor assets`,async()=>{
  const result=await assemble([id]);
  verifyResource(result.manifest.files[criticalName],'rf/critical-fx/Critical_Hit.wav');
  assert.equal(result.criticalSoundFile,criticalIndex.audio.file,'legacy fallback option remains compatible');
  assert.deepEqual(result.requested,[
    '/assets/rf/critical-fx/index.json',...(isRavenProfession(id)?['/assets/rf/core-shield-audio/manifest.json']:[]),
  ]);
  const names=[criticalName];
  if(isRavenProfession(id))for(const name of shieldNames){
    verifyResource(result.manifest.files[name],'rf/core-shield-audio/'+name);names.push(name);
  }
  // Every supplied shared record, including V61's two core attack additions,
  // must survive composition even when a profession has a same-byte alias.
  if(isRavenProfession(id))for(const [name,record]of Object.entries(shield.files)){
    assert.equal(result.manifest.files[name].sha256,record.sha256);
    const relative=new URL(record.file,'http://fixture/assets/rf/core-shield-audio/').pathname.slice('/assets/'.length);
    verifyResource(result.manifest.files[name],relative);
  }
  verifyPlayback(result.manifest,names);
});

test('no-RF mixed rosters and all twelve professions resolve identically in reversed order',async()=>{
  for(const ids of [['BM','VC'],['VC','LK','BM','MM'],['LP','DE','CA','BH'],PROFESSION_IDS]){
    const forward=await assemble(ids),backward=await assemble([...ids].reverse());
    assert.deepEqual(forward.manifest,backward.manifest);
    verifyPlayback(forward.manifest,[criticalName,...(ids.some(isRavenProfession)?shieldNames:[])]);
  }
});

test('all profession audio records retain their original source identity during composition',async()=>{
  const before=new Map([...assets].map(([id,value])=>[id,structuredClone(value.audio)]));
  for(const id of PROFESSION_IDS){
    const result=await assemble([id]);
    for(const [name,record]of Object.entries(assets.get(id).audio?.files??{}))
      assert.equal(result.manifest.files[name].sha256,record.sha256,id+'/'+name);
    assert.deepEqual(assets.get(id).audio,before.get(id));
  }
});

test('a missing shared JSON rejects boot composition without partially changing cached manifests',async()=>{
  const manifest=common(),before=structuredClone(manifest),professionAssets=new Map([['BM',assets.get('BM')]]);
  await assert.rejects(loadRosterAudio({manifest,professionAssets,data:async url=>{
    if(url.endsWith('/core-shield-audio/manifest.json'))throw Error('fixture shared JSON unavailable');
    return criticalIndex;
  }}),/shared JSON unavailable/);
  assert.deepEqual(manifest,before);
  assert.throws(()=>composeRosterAudio({manifest,professionAssets,criticalIndex,ravenShield:null}),/Raven core/);
});

test('explicit V61 overlay binds both additional Raven core attack sounds for RF, BM and VC',
  {skip:!overlay&&'V60 has no shared core attack records; run with AUDIO_V61_ASSET_OVERLAY to validate V61 additions'},async()=>{
    for(const name of attackNames)assert.ok(shield.files[name],'V61 shared manifest missing '+name);
    for(const id of ['RF','BM','VC'])verifyPlayback((await assemble([id])).manifest,attackNames);
  });

test('boot calls the same roster composer before player configuration',()=>{
  const game=readFileSync(resolve(root,'apps/web/game.mjs'),'utf8');
  const composer=game.indexOf('await loadRosterAudio({manifest:audioManifest,professionAssets,data:bootData})');
  assert.ok(composer>=0);assert.ok(game.indexOf('battleAudio.configure({manifest:audioManifest,criticalSoundFile})',composer)>composer);
  assert.equal(AUDIO_SOURCE_CONFIG.commonCritical.index,'rf/critical-fx/index.json');
});
