import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionAssetCache,loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {getProfessionProfile} from '../../packages/professions/profiles.mjs';
import counterWait from '../../contracts/lk-counter-visual-v49.json' with {type:'json'};
import moonlight from '../../contracts/de-moonlight-visual-v45.json' with {type:'json'};

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const emptyPose=()=>({schemaVersion:1,frames:[],clips:[],helpers:[]});
const emptyIndex=()=>({schemaVersion:1,referenceVersion:moonlight.referenceVersion,templates:{}});
function fixture({gate=()=>null,manifest={},read=null}={}){
 const calls=[],released=[];
 return {calls,released,options:{
  async data(url){
   calls.push(['json',url]);await gate('json',url)?.promise;
   if(read){const value=read(url);if(value!==undefined)return value;}
   if(url.endsWith('/lk/counter-v49/index.json'))return counterWait;
   if(url.endsWith('catalog.json'))return {skills:[{id:1,icon:'shared.png'}]};
   if(url.endsWith('manifest.json'))return {runtimeGlb:'body.glb',runtimePose:'body.pose.json',effectAssetIndex:'effect.json',visualEffectIndexes:['fx/index.json'],...manifest};
   if(url.endsWith('.pose.json'))return emptyPose();
   return emptyIndex();
  },
  async loadContainer(base,file){const url=base+file;calls.push(['glb',url]);await gate('glb',url)?.promise;
   return {transformNodes:[],meshes:[],animationGroups:[],dispose(){released.push(url);}};
  },
  async loadImage(url){calls.push(['image',url]);await gate('image',url)?.promise;return {src:url};},
 }};
}

test('body decoding does not serialize core models, shared poses, effect poses, audio or image preparation',async()=>{
 const body=deferred(),f=fixture({gate:(kind,url)=>kind==='glb'&&url.endsWith('body.glb')?body:null,
  manifest:{mechanismResources:{ravenNasodCore:{glb:'core.glb'}},audioManifest:'audio.json'},
  read:url=>url.endsWith('/body.pose.json')?{...emptyPose(),sharedPose:'shared.pose.json'}:
   url.endsWith('/fx/index.json')?{...emptyIndex(),templates:{probe:{kind:'mesh',poseData:'effect.pose.json',events:[]}}}:undefined});
 const cache=createProfessionAssetCache(f.options),pending=cache.load('RF');await tick();
 for(const [kind,suffix]of [['glb','core.glb'],['json','core.pose.json'],['json','shared.pose.json'],['json','effect.pose.json'],['json','audio.json'],['image','shared.png']]){
  assert.ok(f.calls.some(([actual,url])=>actual===kind&&url.endsWith(suffix)),kind+': '+suffix+' starts while body decoder is pending');
 }
 body.resolve();const assets=await pending;assert.equal(assets.id,'RF');assert.ok(assets.coreContainer);assert.ok(assets.effectPoses['effect.pose.json']);
 cache.dispose();assert.deepEqual(f.released.sort(),['/assets/rf/body.glb','/assets/rf/core.glb']);
});

test('roster loading overlaps two professions at a time and preserves requested order without loading unrelated choices',async()=>{
 const gates=new Map(['RF','LK','VC','RS'].map(id=>[id,deferred()]));
 const f=fixture({gate:(kind,url)=>kind==='glb'?gates.get(url.split('/')[2].toUpperCase()):null});
 const cache=createProfessionAssetCache(f.options),pending=cache.loadAll(['RF','LK','VC','RF','RS']);await tick();
 const decoded=()=>f.calls.filter(([kind])=>kind==='glb').map(([,url])=>url.split('/')[2].toUpperCase());
 assert.deepEqual(decoded(),['RF','LK']);
 gates.get('LK').resolve();await tick();assert.deepEqual(decoded(),['RF','LK','VC']);
 gates.get('VC').resolve();await tick();assert.deepEqual(decoded(),['RF','LK','VC','RS']);
 gates.get('RS').resolve();gates.get('RF').resolve();const result=await pending;
 assert.deepEqual([...result.keys()],['RF','LK','VC','RS']);assert.equal(cache.proof().professions,4);
 cache.dispose();assert.equal(f.released.length,4);
});

test('a rejected roster stops new professions and waits for the other owned in-flight load',async()=>{
 const rf=deferred(),lk=deferred(),f=fixture({gate:(kind,url)=>kind==='glb'?(url.includes('/rf/')?rf:lk):null});
 const cache=createProfessionAssetCache(f.options);let settled=false;
 const pending=cache.loadAll(['RF','LK','VC']).finally(()=>{settled=true;});const rejected=assert.rejects(pending,/controlled decode/);
 await tick();rf.reject(Error('controlled decode'));await tick();assert.equal(settled,false);
 assert.equal(f.calls.some(([,url])=>url.includes('/vc/')),false);
 lk.resolve();await rejected;assert.equal(cache.proof().professions,1);cache.dispose();assert.deepEqual(f.released,['/assets/lk/body.glb']);
});

test('a late MM summon manifest cannot allocate an unowned container after a sibling load failure',async()=>{
 const manifestGate=deferred(),summonGate=deferred();
 const source=getProfessionProfile('MM').summonDeclarations.apocalypse.source;
 const f=fixture({gate:(kind,url)=>url.endsWith('/summons/apocalypse/manifest.json')?manifestGate:
  kind==='glb'&&url.includes('/summons/')?summonGate:null,
  read:url=>url.endsWith('/summons/apocalypse/manifest.json')?{id:'apocalypse',npcId:1604,unitScale:1,rawSystem:{UNIT_SCALE:1},source,
   poseData:'summon.pose.json',fx:'fx.json',audio:'audio.json',runtimeGlb:'summon.glb'}:
   url.endsWith('/body.pose.json')?Promise.reject(Error('controlled pose')):
   url.endsWith('/summons/apocalypse/audio.json')?{schemaVersion:1,files:{}}:undefined});
 let settled=false;const pending=loadProfessionAssets({id:'MM',...f.options}).finally(()=>{settled=true;});
 const rejected=assert.rejects(pending,/controlled pose/);await tick();assert.equal(settled,false);assert.deepEqual(f.released,[]);
 manifestGate.resolve();await tick();assert.ok(f.calls.some(([kind,url])=>kind==='glb'&&url.endsWith('summon.glb')));assert.equal(settled,false);
 summonGate.resolve();await rejected;assert.deepEqual(f.released.sort(),['/assets/mm/body.glb','/assets/mm/summons/apocalypse/summon.glb']);
});

test('failed predecoded icons remain retryable without duplicating a successful body load',async()=>{
 const body=deferred(),image=deferred(),f=fixture({gate:(kind,url)=>kind==='glb'?body:kind==='image'&&url.endsWith('shared.png')?image:null});
 let imageAttempt=0;const firstImage=f.options.loadImage;f.options.loadImage=async url=>{
  if(url.endsWith('shared.png')&&imageAttempt++>0)return {src:url};return firstImage(url);
 };
 const cache=createProfessionAssetCache(f.options),failed=assert.rejects(cache.load('RF'),/controlled icon/);
 await tick();image.reject(Error('controlled icon'));await failed;body.resolve();await tick();
 const assets=await cache.load('RF');assert.equal(assets.id,'RF');assert.equal(f.calls.filter(([kind])=>kind==='glb').length,1);
 cache.dispose();assert.equal(f.released.length,1);
});

function sharedAnimationFixture(options={}){
 const f=fixture({...options,manifest:{sharedCharacterAnimations:{glb:'shared.glb',clips:['source-shared']}}});
 const load=f.options.loadContainer;let clones=0;const bodies=[];
 f.options.loadContainer=async(base,file)=>{const container=await load(base,file);
  if(file==='shared.glb')container.animationGroups.push({name:'source-shared',targetedAnimations:[],clone(name){clones++;return {name,stop(){}};}});
  else bodies.push(container);return container;
 };
 return {...f,bodies,get clones(){return clones;}};
}

test('BM and RS icon retry reuse completed shared animation assembly across concurrent requests',async()=>{
 for(const id of ['BM','RS']){
  const image=deferred(),f=sharedAnimationFixture();let attempts=0;
  const loadImage=f.options.loadImage;f.options.loadImage=url=>url.endsWith('shared.png')&&attempts++===0?image.promise:loadImage(url);
  const cache=createProfessionAssetCache(f.options),pending=cache.load(id),rejected=assert.rejects(pending,/controlled shared icon/);
  await tick();assert.equal(f.clones,1,'shared source animation was installed before icon failure');
  image.reject(Error('controlled shared icon'));await rejected;assert.equal(cache.proof().assetRecords,1);
  const first=cache.load(id),second=cache.load(id);assert.equal(first,second);
  const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(a.bodyContainer,f.bodies[0]);
  assert.equal(f.clones,1);assert.deepEqual(a.bodyContainer.animationGroups.map(group=>group.name),['source-shared']);
  assert.equal(f.calls.filter(([kind])=>kind==='glb').length,2,'one private body and one shared source container');
  cache.dispose();assert.equal(cache.proof().assetRecords,0);assert.equal(f.released.length,2);
 }
});

test('catalog failure and immediate retries share an in-flight shared GLB assembly rather than installing twice',async()=>{
 const shared=deferred(),f=sharedAnimationFixture({gate:(kind,url)=>kind==='glb'&&url.endsWith('shared.glb')?shared:null});
 const data=f.options.data;let failed=false;f.options.data=async url=>{
  if(url.endsWith('catalog.json')&&!failed){failed=true;throw Error('controlled catalog');}return data(url);
 };
 const cache=createProfessionAssetCache(f.options);await assert.rejects(cache.load('BM'),/controlled catalog/);
 const first=cache.load('BM'),second=cache.load('BM');assert.equal(first,second);await tick();
 assert.equal(f.clones,0);assert.equal(cache.proof().assetRecords,1);shared.resolve();
 const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(f.clones,1);
 assert.equal(f.calls.filter(([kind])=>kind==='glb').length,2);cache.dispose();assert.equal(cache.proof().assetRecords,0);assert.equal(f.released.length,2);
});

test('an asset-record failure evicts only that preparation and disposal clears an in-flight retry',async()=>{
 const f=sharedAnimationFixture(),data=f.options.data;let fail=true;
 f.options.data=async url=>{if(url.endsWith('body.pose.json')&&fail){fail=false;throw Error('controlled asset pose');}return data(url);};
 const cache=createProfessionAssetCache(f.options);await assert.rejects(cache.load('RS'),/controlled asset pose/);
 assert.equal(cache.proof().assetRecords,0);assert.equal(f.clones,0);
 const assets=await cache.load('RS');assert.equal(assets.id,'RS');assert.equal(cache.proof().assetRecords,1);assert.equal(f.clones,1);
 cache.dispose();assert.equal(cache.proof().assetRecords,0);assert.equal(f.released.length,2);
 const gate=deferred(),late=sharedAnimationFixture({gate:kind=>kind==='glb'?gate:null}),lateCache=createProfessionAssetCache(late.options);
 const pending=lateCache.load('BM'),rejected=assert.rejects(pending,/disposed/);await tick();lateCache.dispose();gate.resolve();await rejected;
 assert.equal(lateCache.proof().assetRecords,0);assert.equal(lateCache.proof().professions,0);assert.equal(late.released.length,2);assert.equal(late.clones,0);
});

test('a failed shared animation installation rolls back completed clones before its asset-record retry',async()=>{
 const f=fixture({manifest:{sharedCharacterAnimations:{glb:'shared.glb',clips:['first','second']}}});
 const load=f.options.loadContainer,clones=[],disposed=[];let fail=true,body;
 f.options.loadContainer=async(base,file)=>{const value=await load(base,file);
  if(file==='shared.glb')value.animationGroups=['first','second'].map(name=>({name,targetedAnimations:[],clone(){
   if(name==='second'&&fail){fail=false;throw Error('controlled shared group');}
   clones.push(name);return {name,stop(){},dispose(){disposed.push(name);}};
  }}));else body=value;return value;
 };
 const cache=createProfessionAssetCache(f.options);await assert.rejects(cache.load('BM'),/controlled shared group/);
 assert.equal(cache.proof().assetRecords,0);assert.deepEqual(body.animationGroups,[]);assert.deepEqual(disposed,['first']);
 const assets=await cache.load('BM');assert.equal(assets.bodyContainer,body);assert.deepEqual(body.animationGroups.map(group=>group.name),['first','second']);
 assert.deepEqual(clones,['first','first','second']);assert.equal(f.calls.filter(([kind])=>kind==='glb').length,2);
 cache.dispose();assert.equal(cache.proof().assetRecords,0);assert.equal(f.released.length,2);
});
