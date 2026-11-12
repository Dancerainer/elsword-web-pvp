/** Execute the actual page transaction; GPU geometry is covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {costumeCharacter,normalizeCostumePreferences} from '../../packages/professions/costumes.mjs';

const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function selectCostume('),end=source.indexOf('function rebuildPracticeSimulation(',start);
assert.ok(start>=0&&end>start);
const transaction=source.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture(){
  const saved=deferred(),requested=deferred(),prepared=[],published=[],requests=[],warmed=[];
  const views=new Map(['RF','LK','VC','RS'].map(id=>[id,{id,current:'default'}]));
  const context={mode:'lobby',configurationLocked:false,slotPreparation:false,professionId:'RS',
    professionSwitch:{busy:false,flush(){}},updateModeControls(){},mapManifest:{},practiceActors:()=>[{id:'player'}],
    professionPracticeViews:new Map([...views].map(([id,view])=>[id,new Map([['player',view]])])),
    costumeCharacter,normalizeCostumePreferences,costumePreferences:{elsword:'default',raven:'royal'},
    simulation:{state:{actors:[{id:'player'}]}},hitLighting:{async prewarm(actors){assert.deepEqual(published,['LK','RS']);warmed.push(actors.map(a=>a.id));}},
    async prepareActorCostume(view,id,costumeId){const appearance={id:costumeId,disposed:false,dispose(){this.disposed=true;}};prepared.push({view,id,appearance});return appearance;},
    publishCostume(view,appearance){view.current=appearance.id;published.push(view.id);},
    online:{api(route,method,body){requests.push({route,method,body});requested.resolve();return saved.promise;}}};
  vm.createContext(context);vm.runInContext(transaction+'\nthis.select=selectCostume;',context);
  return {context,views,prepared,published,requests,saved,requested,warmed};
}

test('page prepares RS and LK offscreen, then publishes both only after the account save',async()=>{
  const f=fixture(),pending=f.context.select('nasod');await f.requested.promise;
  assert.deepEqual(f.prepared.map(row=>row.id),['LK','RS']);
  assert.equal(f.context.slotPreparation,true);assert.deepEqual(f.published,[]);
  assert.ok([...f.views.values()].every(view=>view.current==='default'));
  assert.equal(f.requests[0].route,'/api/preferences/costume');assert.equal(f.requests[0].method,'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].body)),{professionId:'RS',costumeId:'nasod'});
  f.saved.resolve({costumes:{elsword:'nasod',raven:'royal'}});await pending;
  assert.deepEqual(f.published,['LK','RS']);assert.equal(f.context.slotPreparation,false);
  assert.deepEqual(f.warmed,[['player']],'prepare the new material light variant after successful appearance publication');
  assert.deepEqual(f.context.costumePreferences,{elsword:'nasod',raven:'royal',add:'default'});
  assert.ok(f.prepared.every(row=>!row.appearance.disposed));
  assert.equal(f.views.get('RF').current,'default');assert.equal(f.views.get('VC').current,'default');
});

test('failed page costume save releases all pending RS/LK clones and retains the prior appearance',async()=>{
  const f=fixture(),pending=f.context.select('solace');await f.requested.promise;
  f.saved.reject(Error('fixture account save failure'));await assert.rejects(pending,/account save failure/);
  assert.deepEqual(f.published,[]);assert.ok(f.prepared.every(row=>row.appearance.disposed));
  assert.ok([...f.views.values()].every(view=>view.current==='default'));
  assert.deepEqual(f.context.costumePreferences,{elsword:'default',raven:'royal'});
  assert.equal(f.context.slotPreparation,false);
  f.context.configurationLocked=true;
  await assert.rejects(f.context.select('officer'),/Costumes cannot be changed/);
  assert.equal(f.requests.length,1,'locked queue cannot start another save');
});
