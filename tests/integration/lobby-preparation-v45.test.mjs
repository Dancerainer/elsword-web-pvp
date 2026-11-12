/** Execute the production readiness boundary with controlled async work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createProfessionEffects} from '../../apps/web/profession-effects.mjs';
const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function startFreePractice('),end=source.indexOf('async function startPvpPractice(',start);
assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
async function fixture({summonGate=null}={}){
 const gate=deferred(),calls=[],actors=[{id:'a',professionId:'LP',loadout:[{skillId:29002}]}];
 const c={configurationLocked:false,slotPreparation:false,professionSwitch:{busy:false},practiceGeneration:0,mapLoading:false,paused:true,mode:'lobby',
  currentSession:{username:'fixture-user'},professionId:'LP',bootLoading:null,
  matchEntry:{waiting(){return false;},begin(){calls.push('entry-begin');return 'entry';},progress(_key,_id,percent){calls.push('progress:'+percent);},stage(){},clear(){calls.push('entry-clear');}},DEFAULT_SCENE_ID:'original-map',selectedPracticeMap:null,simulation:{state:{actors}},
  updateModeControls(){calls.push('controls');},async loadBattleMap(){calls.push('map');return true;},
  async preparePracticeTargetView(){calls.push('mirror');},
  rebuildPracticeSimulation(){calls.push('simulation');},effectsView:{async prewarmActors(a){assert.equal(a,actors);calls.push('prewarm-start');await gate.promise;calls.push('prewarm-end');}},
  addSummonView:summonGate?{async prewarmActors(a){assert.equal(a,actors);calls.push('summon-start');await summonGate.promise;calls.push('summon-end');}}:null,
  hitLighting:{async prewarm(a){assert.equal(a,actors);calls.push('lighting');}},closeDiagnostics(){calls.push('diagnostics');},
  lobby:{show(v){calls.push('lobby:'+v);},error(v){calls.push('error:'+v);}},say(){},MAP_NAMES:{},canvas:{focus(){calls.push('focus');}}};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 const ready=c.startFreePractice();for(let i=0;i<10;i++)await Promise.resolve();return {c,calls,gate,ready};
}
test('lobby profession publication does not allocate combat burst pools',async()=>{
 const calls=[],views=Object.fromEntries(['RF','LP'].map(id=>[id,{clear(){},async releaseBurstPoolsAsync(){calls.push(id+':retire');},async prewarmActors(){calls.push(id+':burst');}}]));
 await createProfessionEffects(views).prepareProfession('LP',[],{prepareCombat:false});
 assert.deepEqual(calls,['RF:retire','LP:retire']);
});
test('actual practice startup remains locked until its real roster burst preparation completes',async()=>{
 const f=await fixture();assert.equal(f.c.mode,'loading');assert.equal(f.c.paused,true);assert.equal(f.c.configurationLocked,true);
 assert.ok(f.calls.includes('lobby:false'));assert.ok(f.calls.includes('entry-begin'));f.gate.resolve();await f.ready;
 assert.equal(f.c.mode,'practice');assert.equal(f.c.paused,false);assert.equal(f.c.configurationLocked,false);
 assert.ok(f.calls.indexOf('prewarm-end')<f.calls.indexOf('lighting'));
 assert.ok(f.calls.indexOf('map')<f.calls.indexOf('mirror'));assert.ok(f.calls.indexOf('mirror')<f.calls.indexOf('simulation'));
 assert.ok(f.calls.indexOf('lobby:false')<f.calls.indexOf('map'));assert.ok(f.calls.indexOf('lighting')<f.calls.indexOf('entry-clear'));
 const progress=f.calls.filter(v=>v.startsWith('progress:')).map(v=>Number(v.slice(9)));
 assert.equal(progress.at(-1),100);assert.ok(progress.some(n=>n>0&&n<100));
 assert.deepEqual(progress,[...progress].sort((a,b)=>a-b),'reported preparation never moves backwards');
});
test('a superseding practice generation cannot publish stale prepared resources',async()=>{
 const f=await fixture();f.c.practiceGeneration++;f.c.mode='lobby';f.gate.resolve();await f.ready;
 assert.equal(f.c.mode,'lobby');assert.equal(f.c.paused,true);assert.ok(!f.calls.includes('entry-clear'));assert.ok(!f.calls.includes('lighting'));
});

test('summon preparation remains inside the actual practice readiness lock before hit lighting and admission',async()=>{
 const summonGate=deferred(),f=await fixture({summonGate});f.gate.resolve();for(let i=0;i<10;i++)await Promise.resolve();
 assert.ok(f.calls.includes('summon-start'));assert.equal(f.c.mode,'loading');assert.equal(f.c.paused,true);assert.equal(f.c.configurationLocked,true);
 assert.ok(!f.calls.includes('lighting'));assert.ok(!f.calls.includes('entry-clear'));
 summonGate.resolve();await f.ready;assert.equal(f.c.mode,'practice');assert.equal(f.c.configurationLocked,false);
 assert.ok(f.calls.indexOf('prewarm-end')<f.calls.indexOf('summon-start'));assert.ok(f.calls.indexOf('summon-end')<f.calls.indexOf('lighting'));
});

test('a superseding generation during summon preparation cannot light or admit the retired practice',async()=>{
 const summonGate=deferred(),f=await fixture({summonGate});f.gate.resolve();for(let i=0;i<10;i++)await Promise.resolve();
 assert.ok(f.calls.includes('summon-start'));f.c.practiceGeneration++;f.c.mode='lobby';summonGate.resolve();await f.ready;
 assert.equal(f.c.mode,'lobby');assert.equal(f.c.paused,true);assert.ok(!f.calls.includes('lighting'));assert.ok(!f.calls.includes('entry-clear'));
 assert.equal(f.c.configurationLocked,true,'the retired generation cannot clear a later preparation lock');
});
test('failed preparation never starts gameplay and releases the current configuration lock',async()=>{
 const f=await fixture(),rejected=assert.rejects(f.ready,/controlled failure/);f.gate.reject(Error('controlled failure'));await rejected;
 assert.equal(f.c.mode,'lobby');assert.equal(f.c.paused,true);assert.equal(f.c.configurationLocked,false);assert.equal(f.c.mapLoading,false);
 assert.ok(f.calls.includes('lobby:true'));assert.ok(f.calls.some(v=>v.startsWith('error:')));
});
