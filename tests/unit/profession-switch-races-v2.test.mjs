/** Web lifecycle requirements, independent of the native-client combat contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProfessionSwitch} from '../../apps/web/profession-switch.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('async resource preparation keeps old profession frozen, serializes newer status and blocks queue selection',async()=>{
  let current='RF';const jobs=new Map([['LK',deferred()],['MM',deferred()]]),prepared=[],published=[];
  const switcher=createProfessionSwitch({current:()=>current,canCommit:()=>true,prepare:async id=>{prepared.push(id);await jobs.get(id).promise;},commit:id=>{current=id;published.push(id);}});
  switcher.observe('LK');await Promise.resolve();assert.equal(switcher.busy,true);assert.equal(current,'RF');
  switcher.observe('MM');assert.deepEqual(prepared,['LK']);
  await assert.rejects(switcher.select('RF',async()=>({professionId:'RF'})),/switching classes/);
  jobs.get('LK').resolve();await new Promise(setImmediate);assert.equal(current,'RF');assert.deepEqual(prepared,['LK','MM']);
  jobs.get('MM').resolve();await switcher.settled();assert.deepEqual(published,['MM']);assert.equal(switcher.busy,false);
});

test('a failed or disposed resource preparation never publishes a half-ready profession and permits retry',async()=>{
  let current='RF',fail=true;const errors=[];
  const switcher=createProfessionSwitch({current:()=>current,canCommit:()=>true,prepare:async()=>{if(fail)throw Error('fixture shader failure');},onError:e=>errors.push(e.message),commit:id=>current=id});
  switcher.observe('LK');await switcher.settled();assert.equal(current,'RF');assert.equal(switcher.busy,false);assert.deepEqual(errors,['fixture shader failure']);
  fail=false;await switcher.select('LK',async()=>({professionId:'LK'}));assert.equal(current,'LK');
  const job=deferred(),other=createProfessionSwitch({current:()=>current,canCommit:()=>true,prepare:()=>job.promise,commit:id=>current=id});
  other.observe('MM');other.dispose();job.resolve();await other.settled();assert.equal(current,'LK');
});
function fixture(start='RF'){
  let current=start,locked=false;
  const published=[],busy=[];
  const switcher=createProfessionSwitch({current:()=>current,canCommit:()=>!locked,
    commit(id){published.push(id);current=id;},onBusy:value=>busy.push(value)});
  return {switcher,published,busy,get current(){return current;},lock(value=true){locked=value;}};
}

test('six alternating selections publish each successful profession once; repeated server status does not rebuild it',async()=>{
  const f=fixture(),saved=[];
  for(const id of ['LK','RF','LK','RF','LK','RF']){
    await f.switcher.select(id,async next=>{saved.push(next);return {professionId:next};});
    assert.equal(f.current,id);f.switcher.observe(id);f.switcher.observe(id);
  }
  assert.deepEqual(saved,['LK','RF','LK','RF','LK','RF']);assert.deepEqual(f.published,saved);
  assert.deepEqual(f.busy,Array.from({length:6},()=>[true,false]).flat());assert.equal(f.switcher.busy,false);
});

test('new GM fallback status wins over a delayed successful profession save',async()=>{
  const f=fixture(),reply=deferred();const saving=f.switcher.select('LK',()=>reply.promise);
  assert.equal(f.current,'RF');f.switcher.observe('LK');assert.equal(f.current,'LK');
  f.switcher.observe('RF');assert.equal(f.current,'RF');reply.resolve({professionId:'LK'});await saving;
  assert.equal(f.current,'RF');assert.deepEqual(f.published,['LK','RF']);assert.equal(f.switcher.busy,false);
  assert.equal(f.switcher.flush(),false);
});

test('an old rejected save cannot roll back newer server status and always releases the UI busy flag',async()=>{
  const f=fixture(),reply=deferred();const saving=f.switcher.select('LK',()=>reply.promise);
  const rejected=assert.rejects(saving,/fixture offline/);f.switcher.observe('LK');
  reply.reject(Error('fixture offline'));await rejected;
  assert.equal(f.current,'LK');assert.deepEqual(f.published,['LK']);assert.deepEqual(f.busy,[true,false]);
  await f.switcher.select('RF',async()=>({professionId:'RF'}));assert.equal(f.current,'RF');
});

test('a failed save with no new status keeps the current profession and permits a later retry',async()=>{
  const f=fixture();await assert.rejects(f.switcher.select('LK',async()=>{throw Error('fixture offline');}),/fixture offline/);
  assert.equal(f.current,'RF');assert.deepEqual(f.published,[]);assert.equal(f.switcher.busy,false);
  f.switcher.flush();assert.deepEqual(f.published,[]);
  await f.switcher.select('LK',async()=>({professionId:'LK'}));assert.equal(f.current,'LK');
});

test('a second selection while its predecessor is pending cannot dispatch another HTTP save',async()=>{
  const f=fixture(),reply=deferred();let writes=0;
  const first=f.switcher.select('LK',()=>{writes++;return reply.promise;});
  await assert.rejects(f.switcher.select('RF',async()=>{writes++;return {professionId:'RF'};}),/switching classes/);
  assert.equal(writes,1);assert.equal(f.current,'RF');assert.equal(f.switcher.busy,true);
  reply.resolve({professionId:'LK'});await first;assert.equal(f.current,'LK');assert.equal(f.switcher.busy,false);
});

test('host configuration lock defers a forced server choice; returning idle publishes only the latest choice',async()=>{
  const f=fixture('LK');f.lock();
  assert.equal(f.switcher.observe('RF'),false);assert.equal(f.current,'LK');
  f.switcher.observe('LK');f.switcher.observe('RF');assert.deepEqual(f.published,[]);
  let saves=0;await assert.rejects(f.switcher.select('RF',async()=>{saves++;}),/switching classes/);
  assert.equal(saves,0);assert.equal(f.switcher.flush(),false);assert.equal(f.current,'LK');
  f.lock(false);assert.equal(f.switcher.flush(),true);assert.equal(f.current,'RF');
  assert.equal(f.switcher.flush(),false);assert.deepEqual(f.published,['RF']);
});

test('an HTTP result arriving after the host becomes busy stays pending until that operation finishes',async()=>{
  const f=fixture(),reply=deferred();const saving=f.switcher.select('LK',()=>reply.promise);f.lock();
  reply.resolve({professionId:'LK'});await saving;assert.equal(f.current,'RF');assert.deepEqual(f.published,[]);
  assert.equal(f.switcher.busy,false);f.lock(false);f.switcher.flush();assert.equal(f.current,'LK');
  assert.deepEqual(f.published,['LK']);
});

test('forced fallback received while locked supersedes an older selection even after the save replies',async()=>{
  const f=fixture(),reply=deferred();const saving=f.switcher.select('LK',()=>reply.promise);f.lock();
  f.switcher.observe('LK');f.switcher.observe('RF');reply.resolve({professionId:'LK'});await saving;
  f.lock(false);f.switcher.flush();assert.equal(f.current,'RF');assert.deepEqual(f.published,[]);
});

test('the server effective profession is authoritative when it differs from the requested profession',async()=>{
  const f=fixture('LK');await f.switcher.select('LK',async()=>({professionId:'RF'}));
  assert.equal(f.current,'RF');assert.deepEqual(f.published,['RF']);
});

test('disposing the page during an HTTP save prevents late status or save results from publishing',async()=>{
  const f=fixture(),reply=deferred();const saving=f.switcher.select('LK',()=>reply.promise);
  f.switcher.dispose();assert.equal(f.switcher.observe('LK'),false);reply.resolve({professionId:'LK'});await saving;
  assert.equal(f.current,'RF');assert.deepEqual(f.published,[]);assert.equal(f.switcher.flush(),false);
  let writes=0;await assert.rejects(f.switcher.select('LK',async()=>{writes++;}),/switching classes/);assert.equal(writes,0);
});
