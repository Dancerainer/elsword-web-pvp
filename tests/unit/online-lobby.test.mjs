import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineLobby} from '../../apps/web/online-lobby.mjs';

// Minimal DOM surface for the actual lobby event handlers. No network or combat
// behavior is mocked as original-client evidence in these presentation tests.
class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.className='';this.hidden=false;this.disabled=false;this.textContent='';}
  append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(x=>x!==node);node.parent=this;this.children.push(node);}}
  setAttribute(key,value){this[key]=value;}
  querySelector(selector){
    const matches=node=>selector==='input'?node.tagName==='input':selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.dataset.action===selector.match(/\[data-action="([^"]+)"\]/)?.[1];
    for(const node of this.children){if(matches(node))return node;const match=node.querySelector(selector);if(match)return match;}return null;
  }
}
class FakeClock{
  constructor(){this.time=4000000;this.nextId=0;this.timers=new Map();}
  now(){return this.time;}
  setTimeout(callback,delay){const id=++this.nextId;this.timers.set(id,{callback,at:this.time+delay});return id;}
  clearTimeout(id){this.timers.delete(id);}
  advance(milliseconds){
    const target=this.time+milliseconds;
    for(;;){
      const pending=[...this.timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!pending)break;
      this.time=pending[1].at;this.timers.delete(pending[0]);pending[1].callback();
    }
    this.time=target;
  }
}
function fixture(options={}){
  const document={defaultView:options.browser,createElement(tag){return new Element(tag,document);}},host=new Element('div',document);
  const calls=[],clock=options.clock??new FakeClock();
  const lobby=createOnlineLobby({host,username:'private-account',role:'gm',nickname:'Original Nickname',
    clock:options.browser?undefined:clock,
    onNicknameSave:async nickname=>{calls.push(['save',nickname]);return {nickname};},
    onQueue:async()=>calls.push('queue'),onCancel:async()=>calls.push('cancel'),
    onPractice:()=>calls.push('practice'),onPractice2v2:()=>{calls.push('practice2v2');lobby.show(false);},...options});
  const find=action=>lobby.root.querySelector('[data-action="'+action+'"]');
  const join=mode=>{const chosen=find({'1v1':'queue1v1','2v2':'queue','3v3':'queue3v3'}[mode]).onclick();return chosen===false?false:find('match-start').onclick();};
  return {join,lobby,calls,clock,queueTime:lobby.root.querySelector('.lobby-queue-time'),input:lobby.root.querySelector('input'),button:action=>lobby.root.querySelector(`[data-action="${action}"]`)};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('idle server queue default does not overwrite last choice when the actual lobby is recreated',()=>{
  const values=new Map(),browser={localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}};
  const options={browser,clock:new FakeClock()};
  const first=fixture(options);first.button('queue1v1').onclick();first.lobby.dispose();
  const idle=fixture({...options,initialStatus:{queued:false,queue:{mode:'2v2'}}});
  assert.equal(idle.button('queue1v1')['aria-checked'],'true');idle.lobby.dispose();
  const queued=fixture({...options,initialStatus:{queued:true,queue:{mode:'3v3'}}});
  assert.equal(queued.button('queue3v3')['aria-checked'],'true');queued.lobby.dispose();
  const match=fixture({...options,initialStatus:{queued:false,queue:{mode:'2v2'},match:{mode:'1v1'}}});
  assert.equal(match.button('queue1v1')['aria-checked'],'true');match.lobby.dispose();
  const disabled=fixture({...options,modes:{'1v1':false}});
  assert.equal(disabled.button('queue')['aria-checked'],'true');disabled.lobby.dispose();
});

test('each Elesis portrait selects its own profession and administrator switch',async()=>{
  const calls=[],flags={RF:true,LK:true,VC:true,RS:true,BM:true,IS:true,GM:true,BH:true,CA:true};
  const f=fixture({professions:flags,professionFlags:flags,onProfessionChange:async id=>{calls.push(id);return {professionId:id};}});
  for(const id of ['GM','BH','CA']){
    const card=f.button('choose-profession-'+id),toggle=f.button('profession-'+id);
    assert.ok(card);assert.ok(toggle);assert.equal(card.disabled,false);
    await card.onclick();assert.equal(calls.at(-1),id);
    assert.equal(card['aria-checked'],'true');
    assert.equal(card.children[0].src,'/assets/ui/lobby/portraits/'+id.toLowerCase()+'.png');
    assert.equal(toggle['aria-checked'],'true');
  }
  f.lobby.dispose();
});

test('GM resource download toggle publishes durable state and rejects a late older response',async()=>{
  const wait=deferred(),calls=[];
  const f=fixture({resourceDelivery:{revision:0,enabled:false},onResourceDeliverySave:enabled=>{calls.push(enabled);return wait.promise;}});
  const button=f.button('resource-delivery');assert.equal(button['aria-checked'],'false');
  const saving=button.onclick();assert.equal(button.disabled,true);assert.deepEqual(calls,[true]);
  f.lobby.resourceDelivery({revision:2,enabled:false});wait.resolve({revision:1,enabled:true});await saving;
  assert.equal(button['aria-checked'],'false');assert.equal(button.disabled,false);
  f.lobby.resourceDelivery({revision:3,enabled:true});assert.equal(button['aria-checked'],'true');f.lobby.dispose();
});
test('ordinary player has no resource toggle; failed GM save keeps the previous setting',async()=>{
  const player=fixture({role:'player',resourceDelivery:{revision:0,enabled:false}});assert.equal(player.button('resource-delivery'),null);player.lobby.dispose();
  const gm=fixture({resourceDelivery:{revision:0,enabled:false},onResourceDeliverySave:async()=>{throw Error('save failed');}});
  await gm.button('resource-delivery').onclick();assert.equal(gm.button('resource-delivery')['aria-checked'],'false');assert.equal(gm.button('resource-delivery').disabled,false);gm.lobby.dispose();
});

test('IS appears as the independent GM choice and remains frozen during its queue',async()=>{
  const flags={RF:true,LK:true,VC:true,IS:true},saved=[],toggles=[];
  const f=fixture({professions:flags,professionFlags:flags,onProfessionChange:async id=>{saved.push(id);return {professionId:id};},
    onProfessionToggle:async(id,enabled)=>{toggles.push([id,enabled]);flags[id]=enabled;return {professionId:'RF',professions:{...flags},professionFlags:{...flags}};}});
  const select=f.button('choose-profession-RF');assert.ok(f.button('choose-profession-IS')['aria-label'].includes('Infinity Sword'));
  await f.button('choose-profession-IS').onclick();assert.equal(f.lobby.professionId,'IS');assert.deepEqual(saved,['IS']);
  f.lobby.status({queued:true,professionId:'IS'});assert.equal(await f.button('choose-profession-LK').onclick(),false);assert.equal(f.lobby.professionId,'IS');
  f.lobby.status({queued:false,professionId:'IS'});await f.button('profession-IS').onclick();
  assert.deepEqual(toggles,[['IS',false]]);assert.equal(f.lobby.professionId,'RF');assert.equal(f.button('profession-IS')['aria-checked'],'false');
  f.lobby.dispose();
});


test('capacity waiting replaces a zero countdown and clears when a room is released without rejoining',()=>{
  const f=fixture({role:'player'}),status=()=>f.lobby.root.querySelector('.lobby-status').textContent;
  f.lobby.status({queued:true,queue:{mode:'3v3',size:6,remainingSeconds:0,joinedAt:100,elapsedSeconds:40},
    roomCapacity:{activeRoomsByMode:{'1v1':0,'2v2':0,'3v3':2},maxRoomsByMode:{'1v1':3,'2v2':3,'3v3':2},waitingForCapacity:true}});
  assert.match(status(),/Waiting for a free 3v3 room/);assert.match(status(),/2\/2 rooms/);assert.doesNotMatch(status(),/· 0 s/);
  assert.equal(f.button('cancel').hidden,false);assert.match(f.queueTime.textContent,/40 s/);
  f.lobby.status({queued:true,queue:{mode:'3v3',size:6,remainingSeconds:0,joinedAt:100,elapsedSeconds:45},
    roomCapacity:{activeRoomsByMode:{'1v1':0,'2v2':0,'3v3':1},maxRoomsByMode:{'1v1':3,'2v2':3,'3v3':2},waitingForCapacity:false}});
  assert.doesNotMatch(status(),/free .* room/);assert.match(f.queueTime.textContent,/45 s/);
  f.lobby.status({queued:false,matchId:'room-next'});assert.doesNotMatch(status(),/free .* room/);
  f.lobby.dispose();
});

const capacityStatus=(maxRoomsByMode={'1v1':3,'2v2':3,'3v3':2},activeRoomsByMode={'1v1':1,'2v2':2,'3v3':0},revision=0)=>({maxRoomsByMode,activeRoomsByMode,revision});
test('GM saves all three room limits once while live occupancy preserves the unsaved draft',async()=>{
  const pending=deferred(),calls=[],f=fixture({initialStatus:{roomCapacity:capacityStatus()},onCapacitySave:value=>{calls.push(value);return pending.promise;}});
  const form=f.lobby.root.querySelector('.lobby-capacity-controls'),limit=f.button('capacity-3v3');
  assert.equal(limit.value,'2');limit.value='0';limit.oninput();
  f.lobby.status({roomCapacity:capacityStatus(undefined,{'1v1':2,'2v2':3,'3v3':1})});
  assert.equal(limit.value,'0');assert.equal(f.button('capacity-usage-3v3').textContent,'Occupied: 1 / 2 rooms');
  const save=form.onsubmit({preventDefault(){}});assert.equal(f.button('capacity-save').disabled,true);
  assert.equal(await form.onsubmit(),false);assert.deepEqual(calls,[{'1v1':3,'2v2':3,'3v3':0}]);
  f.lobby.status({roomCapacity:capacityStatus({'1v1':3,'2v2':3,'3v3':0},{'1v1':2,'2v2':3,'3v3':1},1)});
  pending.resolve(capacityStatus({'1v1':3,'2v2':3,'3v3':0},{'1v1':1,'2v2':1,'3v3':0},1));await save;
  assert.equal(limit.value,'0');assert.equal(f.button('capacity-usage-3v3').textContent,'Occupied: 1 / 0 rooms · New rooms paused');
  assert.match(f.lobby.root.querySelector('.lobby-capacity-feedback').textContent,/saved/);f.lobby.dispose();
});

test('GM room limits reject invalid drafts and failed persistence retains the draft for retry',async()=>{
  const calls=[],f=fixture({initialStatus:{roomCapacity:capacityStatus()},onCapacitySave:async value=>{calls.push(value);throw Error('storage failure');}});
  const form=f.lobby.root.querySelector('.lobby-capacity-controls'),limit=f.button('capacity-1v1');
  for(const invalid of ['', '-1', '1.5', '21', 'abc']){limit.value=invalid;limit.oninput();assert.equal(await form.onsubmit(),false);}
  assert.equal(calls.length,0);limit.value='20';limit.oninput();assert.equal(await form.onsubmit(),false);
  assert.equal(calls.length,1);assert.equal(limit.value,'20');assert.match(f.lobby.root.querySelector('.lobby-capacity-feedback').textContent,/Could not save/);
  assert.equal(f.button('capacity-save').disabled,false);f.lobby.dispose();
});

test('an older GM save response cannot overwrite newer limits and ordinary players have no capacity controls',async()=>{
  const pending=deferred(),f=fixture({initialStatus:{roomCapacity:capacityStatus()},onCapacitySave:()=>pending.promise});
  f.button('capacity-2v2').value='4';f.button('capacity-2v2').oninput();const save=f.lobby.root.querySelector('.lobby-capacity-controls').onsubmit();
  f.lobby.status({roomCapacity:capacityStatus({'1v1':5,'2v2':6,'3v3':7},undefined,2)});
  pending.resolve(capacityStatus({'1v1':3,'2v2':4,'3v3':2},undefined,1));await save;
  assert.equal(f.button('capacity-2v2').value,'6');assert.match(f.lobby.root.querySelector('.lobby-capacity-feedback').textContent,/latest limits/);f.lobby.dispose();
  const player=fixture({role:'player'});assert.equal(player.lobby.root.querySelector('.lobby-capacity-controls'),null);assert.equal(player.button('capacity-save'),null);
  player.lobby.status({queued:true,queue:{mode:'2v2',size:4,remainingSeconds:0},roomCapacity:{...capacityStatus({'1v1':3,'2v2':0,'3v3':2}),waitingForCapacity:true}});
  assert.match(player.lobby.root.querySelector('.lobby-status').textContent,/Waiting for a free 2v2 room.*2\/0 rooms.*New rooms paused/);
  assert.equal(player.button('cancel').hidden,false);player.lobby.dispose();
});

test('a delayed older SSE before a newer save response cannot reject the saved configuration',async()=>{
  const pending=deferred(),f=fixture({initialStatus:{roomCapacity:capacityStatus()},onCapacitySave:()=>pending.promise});
  const limit=f.button('capacity-2v2');limit.value='7';limit.oninput();
  const save=f.lobby.root.querySelector('.lobby-capacity-controls').onsubmit();
  // Another earlier GM save was queued in SSE while this HTTP save completed.
  f.lobby.status({roomCapacity:capacityStatus({'1v1':3,'2v2':4,'3v3':2},{'1v1':1,'2v2':3,'3v3':0},1)});
  assert.equal(limit.value,'7');
  pending.resolve(capacityStatus({'1v1':3,'2v2':7,'3v3':2},{'1v1':1,'2v2':1,'3v3':0},2));await save;
  assert.equal(limit.value,'7');assert.equal(f.button('capacity-usage-2v2').textContent,'Occupied: 3 / 7 rooms');
  assert.match(f.lobby.root.querySelector('.lobby-capacity-feedback').textContent,/saved/);f.lobby.dispose();
});

test('a delayed old or unversioned SSE after a save cannot roll configuration back but occupancy still refreshes',async()=>{
  const f=fixture({initialStatus:{roomCapacity:capacityStatus()},onCapacitySave:async()=>capacityStatus({'1v1':3,'2v2':7,'3v3':2},undefined,2)});
  const limit=f.button('capacity-2v2');limit.value='7';limit.oninput();await f.lobby.root.querySelector('.lobby-capacity-controls').onsubmit();
  f.lobby.status({roomCapacity:capacityStatus({'1v1':3,'2v2':4,'3v3':2},{'1v1':1,'2v2':3,'3v3':0},1)});
  assert.equal(limit.value,'7');assert.equal(f.button('capacity-usage-2v2').textContent,'Occupied: 3 / 7 rooms');
  const unversioned=capacityStatus(undefined,{'1v1':1,'2v2':4,'3v3':0});delete unversioned.revision;
  f.lobby.status({roomCapacity:unversioned});assert.equal(limit.value,'7');assert.equal(f.button('capacity-usage-2v2').textContent,'Occupied: 4 / 7 rooms');
  // Equal configuration revision is normal for subsequent room occupancy updates.
  f.lobby.status({roomCapacity:capacityStatus({'1v1':3,'2v2':7,'3v3':2},{'1v1':1,'2v2':2,'3v3':0},2)});
  assert.equal(limit.value,'7');assert.equal(f.button('capacity-usage-2v2').textContent,'Occupied: 2 / 7 rooms');f.lobby.dispose();
});

test('a cancelled room keeps its recovery notice while unlocking the next match',()=>{
  const f=fixture({role:'player'}),status=()=>f.lobby.root.querySelector('.lobby-status').textContent;
  f.lobby.status({queued:false,matchId:'room-failed'});
  f.lobby.status({queued:false,available:true,queueNotice:{reason:'room-worker-unavailable'}});
  assert.equal(status(),'The room was interrupted. You can queue again from the lobby.');assert.equal(f.button('queue3v3').disabled,false);
  f.lobby.status({queued:true,queue:{mode:'2v2',size:1},queueNotice:null});
  assert.match(status(),/Searching for 2v2/);assert.doesNotMatch(status(),/interrupted/);f.lobby.dispose();
});

test('profession selection persists before success, follows server choice and locks during queue',async()=>{
  const save=deferred(),calls=[],f=fixture({professionId:'RF',onProfessionChange:id=>{calls.push(id);return save.promise;}});
  const select=f.button('choose-profession-RF');const pending=f.button('choose-profession-LK').onclick();assert.equal(select.disabled,false);assert.equal(f.lobby.professionId,'RF');
  assert.equal(f.button('choose-profession-LK')['aria-checked'],'true');assert.equal(f.button('choose-profession-LK')['aria-busy'],'true');
  assert.equal(f.button('match-start').disabled,true);assert.equal(f.button('skills').disabled,true);
  save.resolve({professionId:'LK'});await pending;assert.deepEqual(calls,['LK']);assert.equal(f.lobby.professionId,'LK');assert.equal(f.lobby.professionId,'LK');
  f.lobby.status({queued:true,professionId:'LK'});assert.equal(await f.button('choose-profession-RF').onclick(),false);assert.equal(f.lobby.professionId,'LK');assert.equal(calls.length,1);f.lobby.dispose();
});

test('rapid profession choices update the highlight immediately and save only the last queued choice',async()=>{
  const first=deferred(),last=deferred(),calls=[],flags={RF:true,LK:true,VC:true,RS:true};
  const f=fixture({professions:flags,professionFlags:flags,onProfessionChange:id=>{calls.push(id);return calls.length===1?first.promise:last.promise;}});
  const pending=f.button('choose-profession-LK').onclick();
  f.button('choose-profession-VC').onclick();f.button('choose-profession-RS').onclick();
  assert.deepEqual(calls,['LK']);assert.equal(f.button('choose-profession-RS')['aria-checked'],'true');assert.equal(f.lobby.professionId,'RF');
  assert.equal(f.button('skills').disabled,true);assert.equal(f.button('match-start').disabled,true);
  // The first save's authoritative stream event must not erase a newer local
  // choice that has not been submitted yet.
  f.lobby.status({queued:false,professionId:'LK',professions:flags,professionFlags:flags});
  assert.equal(f.button('choose-profession-RS')['aria-checked'],'true');
  first.resolve({professionId:'LK'});await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['LK','RS']);
  last.resolve({professionId:'RS'});await pending;
  assert.equal(f.lobby.professionId,'RS');assert.equal(f.button('choose-profession-RS')['aria-busy'],'false');
  assert.equal(f.button('skills').disabled,false);assert.equal(f.button('match-start').disabled,false);f.lobby.dispose();
});

test('failed profession save rolls visual selection back and clicking the confirmed choice makes no request',async()=>{
  const save=deferred(),calls=[],f=fixture({professionId:'RF',onProfessionChange:id=>{calls.push(id);return save.promise;}});
  assert.equal(await f.button('choose-profession-RF').onclick(),true);assert.deepEqual(calls,[]);
  const pending=f.button('choose-profession-LK').onclick();assert.equal(f.button('choose-profession-LK')['aria-checked'],'true');
  save.reject(Error('controlled preference failure'));assert.equal(await pending,false);
  assert.equal(f.lobby.professionId,'RF');assert.equal(f.button('choose-profession-RF')['aria-checked'],'true');
  assert.equal(f.button('choose-profession-LK')['aria-busy'],'false');assert.match(f.lobby.root.querySelector('.lobby-status').textContent,/controlled preference failure/);f.lobby.dispose();
});

test('queue admission and page retirement discard unsent profession choices and never publish a late result',async()=>{
  for(const retire of [false,true]){
    const save=deferred(),calls=[],changes=[],flags={RF:true,LK:true,VC:true};
    const f=fixture({professions:flags,professionFlags:flags,onProfessionChange:id=>{calls.push(id);return save.promise;},onEffectiveProfessionChange:id=>changes.push(id)});
    const pending=f.button('choose-profession-LK').onclick();f.button('choose-profession-VC').onclick();
    if(retire)f.lobby.dispose();else f.lobby.status({queued:true,professionId:'RF',queue:{mode:'1v1',size:1}});
    save.resolve({professionId:'LK'});await pending;assert.deepEqual(calls,['LK']);assert.deepEqual(changes,[]);assert.equal(f.lobby.professionId,'RF');
    if(!retire){assert.equal(f.button('choose-profession-VC')['aria-checked'],'false');assert.equal(f.button('skills').disabled,true);f.lobby.dispose();}
  }
});

test('unchanged RF status with a capacity or map broadcast does not discard an in-flight LK acknowledgement',async()=>{
  const save=deferred(),changes=[],f=fixture({professionId:'RF',onProfessionChange:()=>save.promise,onEffectiveProfessionChange:id=>changes.push(id)});
  const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'RF',maps:[],roomCapacity:capacityStatus(undefined,{'1v1':2,'2v2':1,'3v3':0})});
  assert.equal(f.button('choose-profession-LK')['aria-checked'],'true');assert.equal(f.button('skills').disabled,true);
  save.resolve({professionId:'LK'});await pending;
  assert.equal(f.lobby.professionId,'LK');assert.equal(f.button('choose-profession-LK')['aria-checked'],'true');assert.deepEqual(changes,['LK']);f.lobby.dispose();
});

test('queued return to RF persists after the earlier LK request even when unrelated status still reports RF',async()=>{
  const first=deferred(),last=deferred(),calls=[],f=fixture({professionId:'RF',onProfessionChange:id=>{calls.push(id);return calls.length===1?first.promise:last.promise;}});
  const pending=f.button('choose-profession-LK').onclick();f.button('choose-profession-RF').onclick();
  f.lobby.status({queued:false,professionId:'RF',roomCapacity:capacityStatus()});assert.equal(f.button('choose-profession-RF')['aria-checked'],'true');
  first.resolve({professionId:'LK'});await Promise.resolve();await Promise.resolve();
  assert.deepEqual(calls,['LK','RF'],'the queued original choice is a real write after LK was persisted');
  assert.equal(f.lobby.professionId,'LK');assert.equal(f.button('choose-profession-RF')['aria-checked'],'true');assert.equal(f.button('skills').disabled,true);
  last.resolve({professionId:'RF'});await pending;assert.equal(f.lobby.professionId,'RF');assert.equal(f.button('skills').disabled,false);f.lobby.dispose();
});

test('unrelated profession flags remain authoritative while the still-legal requested profession is acknowledged',async()=>{
  const save=deferred(),flags={RF:true,LK:true,VC:true},f=fixture({professionId:'RF',professions:flags,professionFlags:flags,onProfessionChange:()=>save.promise});
  const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'RF',professions:{...flags,VC:false},professionFlags:{...flags,VC:false}});
  save.resolve({professionId:'LK',professions:flags,professionFlags:flags});await pending;
  assert.equal(f.lobby.professionId,'LK');assert.equal(f.button('profession-VC')['aria-checked'],'false');assert.equal(f.button('choose-profession-VC').disabled,true);f.lobby.dispose();
});

test('a profession-only acknowledgement keeps server resource availability separate from GM switches',async()=>{
  const save=deferred(),flags={RF:true,LK:true,VC:true},f=fixture({professionId:'RF',professions:flags,professionFlags:flags,onProfessionChange:()=>save.promise});
  const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'RF',professions:{...flags,VC:false},professionFlags:flags});
  save.resolve({professionId:'LK',professions:flags,professionFlags:flags});await pending;
  assert.equal(f.lobby.professionId,'LK');assert.equal(f.button('profession-VC')['aria-checked'],'true');
  assert.equal(f.button('choose-profession-VC').disabled,true);assert.match(f.button('choose-profession-VC').title,/Assets unavailable/);f.lobby.dispose();
});

test('disabling then reopening an in-flight target does not revive its retired save',async()=>{
  const save=deferred(),flags={RF:true,LK:true},f=fixture({professionId:'RF',professions:flags,professionFlags:flags,onProfessionChange:()=>save.promise});
  const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'RF',professions:{...flags,LK:false},professionFlags:{...flags,LK:false}});
  f.lobby.status({queued:false,professionId:'RF',professions:flags,professionFlags:flags});
  save.resolve({professionId:'LK',professions:flags,professionFlags:flags});await pending;
  assert.equal(f.lobby.professionId,'RF');assert.equal(f.button('choose-profession-RF')['aria-checked'],'true');assert.equal(f.button('choose-profession-LK').disabled,false);f.lobby.dispose();
});
test('failed selection restores prior profession; ordinary accounts never receive GM profession controls',async()=>{
  const f=fixture({role:'player',professionId:'LK',onProfessionChange:async()=>{throw Error('Classsave failed');}}),select=f.button('choose-profession-RF');
  assert.equal(f.button('profession-RF'),null);assert.equal(await f.button('choose-profession-RF').onclick(),false);assert.equal(f.lobby.professionId,'LK');assert.equal(f.lobby.professionId,'LK');f.lobby.dispose();
});

test('late profession POST cannot reopen flags or replace the newer all-off RF fallback',async()=>{
  const save=deferred(),changes=[],f=fixture({professionId:'RF',onProfessionChange:()=>save.promise,onEffectiveProfessionChange:id=>changes.push(id)});
  const select=f.button('choose-profession-RF');const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'LK',professions:{RF:true,LK:true},professionFlags:{RF:true,LK:true}});
  f.lobby.status({queued:false,professionId:'RF',professions:{RF:true,LK:false},professionFlags:{RF:false,LK:false}});
  const message=f.lobby.root.querySelector('.lobby-status').textContent;
  save.resolve({professionId:'LK',professions:{RF:true,LK:true},professionFlags:{RF:true,LK:true}});await pending;
  assert.equal(f.lobby.professionId,'RF');assert.equal(f.lobby.professionId,'RF');assert.equal(select.disabled,false);
  assert.equal(f.button('profession-RF')['aria-checked'],'false');assert.equal(f.button('profession-LK')['aria-checked'],'false');
  assert.equal(f.button('choose-profession-LK').disabled,true);assert.deepEqual(changes,['LK','RF']);
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,message);f.lobby.dispose();
});

test('late profession POST after a queued status cannot overwrite locked queue feedback or saved flags',async()=>{
  const save=deferred(),f=fixture({professionId:'RF',onProfessionChange:()=>save.promise}),select=f.button('choose-profession-RF');
  const pending=f.button('choose-profession-LK').onclick();
  f.lobby.status({queued:false,professionId:'LK'});
  f.lobby.status({queued:true,professionId:'LK',queue:{mode:'1v1',size:1},professionFlags:{RF:false,LK:true}});
  const message=f.lobby.root.querySelector('.lobby-status').textContent;
  save.resolve({professionId:'RF',professionFlags:{RF:true,LK:true}});await pending;
  assert.equal(f.lobby.professionId,'LK');assert.equal(f.lobby.professionId,'LK');assert.equal(select.disabled,true);
  assert.equal(f.button('profession-RF')['aria-checked'],'false');assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,message);
  assert.equal(await f.button('skills').onclick(),false);f.lobby.dispose();
});

test('failed older profession save does not erase the newer server fallback message',async()=>{
  const save=deferred(),f=fixture({professionId:'LK',onProfessionChange:()=>save.promise}),select=f.button('choose-profession-RF');
  const pending=f.button('choose-profession-RF').onclick();
  f.lobby.status({queued:false,professionId:'RF',professions:{RF:true,LK:false},professionFlags:{RF:false,LK:false},
    queueNotice:{reason:'profession-disabled'}});
  const message=f.lobby.root.querySelector('.lobby-status').textContent;save.reject(Error('Obsolete request failed'));
  assert.equal(await pending,false);assert.equal(f.lobby.professionId,'RF');assert.equal(f.lobby.professionId,'RF');
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,message);f.lobby.dispose();
});

test('repeated RF LK choices use one lobby and preserve the live controls after every successful save',async()=>{
  const choices=[],f=fixture({onProfessionChange:async professionId=>{choices.push(professionId);return {professionId};}}),root=f.lobby.root,select=f.button('choose-profession-RF');
  for(const id of ['LK','RF','LK','RF','LK','RF']){await f.button('choose-profession-'+id).onclick();
    assert.equal(f.lobby.root,root);assert.equal(f.button('choose-profession-RF'),select);assert.equal(f.lobby.professionId,id);assert.equal(select.disabled,false);}
  assert.deepEqual(choices,['LK','RF','LK','RF','LK','RF']);f.lobby.dispose();
});
test('all GM professions off keeps raw switches off, enables RF fallback and announces a server-forced selection',async()=>{
  const changes=[],f=fixture({professionId:'LK',onEffectiveProfessionChange:id=>changes.push(id),onProfessionToggle:async()=>({professionFlags:{RF:false,LK:false},professionId:'RF'})});
  await f.button('profession-LK').onclick();assert.equal(f.lobby.professionId,'RF');assert.deepEqual(changes,['RF']);
  assert.equal(f.button('profession-RF')['aria-checked'],'false');assert.equal(f.button('profession-LK')['aria-checked'],'false');
  assert.equal(f.button('choose-profession-RF').disabled,false);assert.equal(f.button('choose-profession-LK').disabled,true);f.lobby.dispose();
});

test('asset availability diagnostics preserve GM switch intent and explain the unavailable profession',()=>{
  const f=fixture({professionId:'RF',professions:{RF:true,LK:false},professionFlags:{RF:true,LK:true},professionDiagnostics:[{professionId:'LK',reason:'missing-profession-asset',file:'lk/character.glb'}]});
  const unavailable=f.button('choose-profession-LK');
  assert.match(unavailable.title,/Assets unavailable/);assert.equal(unavailable.disabled,true);
  assert.equal(f.button('profession-LK')['aria-checked'],'true');
  f.lobby.status({professionId:'RF',professions:{RF:true,LK:false},professionFlags:{RF:true,LK:true},professionDiagnostics:[]});
  assert.match(f.button('choose-profession-LK').title,/Assets unavailable/);
  f.lobby.status({professionId:'RF',professions:{RF:true,LK:false},professionFlags:{RF:true,LK:false},professionDiagnostics:[]});
  assert.match(f.button('choose-profession-LK').title,/Disabled by GM/);f.lobby.dispose();
});

test('reopening a saved profession cannot change an already frozen queue or battle choice',()=>{
  const changes=[],f=fixture({professionId:'RF',professionFlags:{RF:true,LK:false},onEffectiveProfessionChange:id=>changes.push(id)});
  f.lobby.status({queued:true,professionId:'LK',professionFlags:{RF:true,LK:true}});
  assert.equal(f.lobby.professionId,'RF');assert.equal(f.lobby.professionId,'RF');assert.deepEqual(changes,[]);
  f.lobby.setLocked(true);f.lobby.status({queued:false,professionId:'LK',professionFlags:{RF:true,LK:true}});
  assert.equal(f.lobby.professionId,'RF');assert.deepEqual(changes,[]);
  f.lobby.setLocked(false);f.lobby.status({queued:false,professionId:'LK',professionFlags:{RF:true,LK:true}});
  assert.equal(f.lobby.professionId,'LK');assert.deepEqual(changes,['LK']);f.lobby.dispose();
});

test('initial active room keeps frozen RF even after GM closes RF and locks configuration before events arrive',async()=>{
  const changes=[],initialStatus={queued:false,professionId:'RF',professions:{RF:false,LK:true},professionFlags:{RF:false,LK:true},
    match:{id:'active-rf-room',status:'playing'}};
  const f=fixture({professionId:'RF',professions:initialStatus.professions,professionFlags:initialStatus.professionFlags,initialStatus,
    onEffectiveProfessionChange:id=>changes.push(id)});
  const select=f.button('choose-profession-RF');assert.equal(f.lobby.professionId,'RF');assert.equal(f.lobby.professionId,'RF');assert.equal(select.disabled,true);
  assert.ok(f.button('choose-profession-RF'));
  for(const action of ['nickname','skills','keys','practice','practice2v2'])assert.equal(f.button(action).disabled,true);
  assert.equal(f.input.disabled,true);assert.equal(f.button('queue').disabled,true);assert.equal(f.button('cancel').hidden,true);
  for(const action of ['skills','keys','practice','practice2v2'])assert.equal(await (['queue1v1','queue','queue3v3'].includes(action)?f.join({'queue1v1':'1v1','queue':'2v2','queue3v3':'3v3'}[action]):f.button(action).onclick()),false);
  assert.equal(await f.button('choose-profession-LK').onclick(),false);assert.equal(f.lobby.professionId,'RF');assert.deepEqual(f.calls,[]);assert.deepEqual(changes,[]);
  f.lobby.status(initialStatus);assert.equal(f.lobby.professionId,'RF');assert.deepEqual(changes,[]);f.lobby.dispose();
});

test('initial queued RF keeps its saved LK choice deferred and seeds queue controls and elapsed time immediately',async()=>{
  const changes=[],initialStatus={queued:true,professionId:'RF',selectedProfessionId:'LK',professions:{RF:true,LK:true},professionFlags:{RF:true,LK:true},
    queue:{mode:'1v1',size:1,joinedAt:1000,elapsedSeconds:8,remainingSeconds:null}};
  const f=fixture({professionId:'RF',initialStatus,onEffectiveProfessionChange:id=>changes.push(id)});
  assert.equal(f.lobby.professionId,'RF');assert.equal(f.button('choose-profession-RF').disabled,true);
  assert.equal(f.button('skills').disabled,true);assert.equal(f.button('keys').disabled,true);
  assert.equal(f.button('queue1v1').disabled,true);assert.equal(f.button('cancel').hidden,false);
  assert.equal(f.queueTime.hidden,false);assert.equal(f.queueTime.textContent,'Wait time: 8 s');
  f.clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 9 s');assert.deepEqual(changes,[]);
  assert.equal(await f.button('practice').onclick(),false);assert.deepEqual(f.calls,[]);
  await f.button('cancel').onclick();assert.equal(f.button('skills').disabled,false);assert.equal(f.queueTime.hidden,true);
  f.lobby.status({queued:false,professionId:'LK',professions:initialStatus.professions,professionFlags:initialStatus.professionFlags});
  assert.equal(f.lobby.professionId,'LK');assert.deepEqual(changes,['LK']);f.lobby.dispose();
});

test('practice map selection is separate from random matchmaking, locks while queued and all-map BAN explains disabled queues',async()=>{
  const maps=[{id:'sander-garpai-rock-pvp',name:'Garpai Rock',enabled:true,modes:['1v1','2v2','3v3']},{id:'eltreedown',name:'Lower El Tree',enabled:false,modes:['1v1','2v2','3v3']}];
  const calls=[],f=fixture({maps,onPractice:map=>calls.push(map)}),select=f.lobby.root.querySelector('.lobby-map-select').children[0].children[0];
  select.value='eltreedown';select.onchange();await f.button('practice').onclick();assert.deepEqual(calls,['eltreedown'],'bans apply only to random matches');
  f.lobby.status({queued:true,maps});assert.equal(select.disabled,true);
  f.lobby.status({queued:false,maps:maps.map(m=>({...m,enabled:false})),queueNotice:{reason:'maps-disabled'}});
  assert.equal(select.disabled,false);for(const action of ['queue1v1','queue','queue3v3'])assert.equal(f.button(action).disabled,true);
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'Left queue: the GM disabled all maps');f.lobby.dispose();
});
test('only GM receives map switches and a successful response updates the requested map state',async()=>{
  const maps=[{id:'eltreedown',name:'Lower El Tree',enabled:true,modes:['1v1','2v2','3v3']}],calls=[];
  const gm=fixture({maps,onMapChange:async(id,enabled)=>{calls.push([id,enabled]);return {maps:[{...maps[0],enabled}]};}});
  await gm.button('map-eltreedown').onclick();assert.deepEqual(calls,[['eltreedown',false]]);
  assert.equal(gm.button('map-eltreedown')['aria-checked'],'false');
  const player=fixture({role:'player',maps});assert.equal(player.lobby.root.querySelector('.lobby-map-controls').hidden,true);assert.equal(player.button('map-eltreedown'),null);gm.lobby.dispose();player.lobby.dispose();
});

test('edited nickname saves before queue; queue locks nickname and configuration; cancel unlocks',async()=>{
  const f=fixture();f.input.value='  New Nickname  ';f.input.oninput();
  await f.join('2v2');assert.deepEqual(f.calls,[['save','New Nickname'],'queue']);
  assert.equal(f.lobby.nickname,'New Nickname');assert.equal(f.input.value,'New Nickname');
  assert.equal(f.lobby.root.querySelector('.lobby-account').textContent,'New Nickname · GM');
  f.lobby.status({queued:true,queue:{size:3,remainingSeconds:10.2}});
  for(const action of ['nickname','skills','keys','practice','practice2v2'])assert.equal(f.button(action).disabled,true);
  assert.equal(f.input.disabled,true);assert.equal(await f.button('practice2v2').onclick(),false);
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'Searching for 2v2 · 3 players · 11 s');
  await f.button('cancel').onclick();assert.equal(f.input.disabled,false);assert.equal(f.button('practice2v2').disabled,false);
});
test('pending save prevents repeated queue/practice calls and failed save never enters a battle',async()=>{
  const save=deferred(),f=fixture({onNicknameSave:()=>save.promise});f.input.value='New Nickname';
  const pending=f.join('2v2');assert.equal(f.input.disabled,true);
  assert.equal(await f.join('2v2'),false);assert.equal(await f.button('practice2v2').onclick(),false);
  save.reject(Error('save failed'));assert.equal(await pending,false);assert.deepEqual(f.calls,[]);
  assert.equal(f.input.disabled,false);assert.equal(f.lobby.nickname,'Original Nickname');
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'save failed');
});
test('new 2v2 practice saves edits, remains separate from old practice and renders markup as literal text',async()=>{
  const f=fixture();f.input.value='<b>Nickname';await f.button('practice2v2').onclick();
  assert.deepEqual(f.calls,[['save','<b>Nickname'],'practice2v2']);assert.equal(f.input.disabled,true);
  assert.equal(f.lobby.root.querySelector('.lobby-account').textContent,'<b>Nickname · GM');
  f.lobby.setLocked(false);await f.button('practice').onclick();assert.equal(f.calls.at(-1),'practice');
  f.lobby.setNickname({nickname:'Server Nickname'});assert.equal(f.input.value,'Server Nickname');
  f.input.value='   ';await f.join('2v2');assert.equal(f.calls.filter(call=>call==='queue').length,0);
});
test('explicit practice lock survives periodic lobby status, while a canceled asynchronous load cannot relock the lobby',async()=>{
  const loading=deferred();let f;
  f=fixture({onPractice2v2:async()=>{f.lobby.show(false);f.lobby.setLocked(true);await loading.promise;}});
  const pending=f.button('practice2v2').onclick();await Promise.resolve();
  f.lobby.status({queued:false,available:true});assert.equal(f.input.disabled,true);
  f.lobby.setLocked(false);f.lobby.show(true);loading.resolve();await pending;
  assert.equal(f.input.disabled,false);assert.equal(f.button('queue').disabled,false);
});

test('personal queue time begins after successful entry and uses a separate seconds/minutes display',async()=>{
  const joining=deferred(),f=fixture({onQueue:()=>joining.promise});
  const pending=f.join('2v2');await Promise.resolve();f.clock.advance(5000);
  assert.equal(f.queueTime.hidden,true,'pending request time is not counted as accepted queue time');
  joining.resolve({queued:true,queue:{joinedAt:1789000000000,elapsedSeconds:0,size:4,remainingSeconds:11}});await pending;
  assert.equal(f.queueTime.hidden,false);assert.equal(f.queueTime.textContent,'Wait time: 0 s');
  assert.equal(f.queueTime['aria-label'],'Time spent in this queue');
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'Searching for 2v2 · 4 players · 11 s');
  f.clock.advance(65000);assert.equal(f.queueTime.textContent,'Wait time: 1 m 5 s');
  assert.equal(f.clock.timers.size,1,'exactly one local clock update is pending');f.lobby.dispose();
});

test('refresh seeds authoritative elapsed without subtracting the browser clock from server joinedAt',()=>{
  const f=fixture();f.lobby.status({queued:true,queue:{joinedAt:1789000000000,elapsedSeconds:62.5,size:2,remainingSeconds:null}});
  assert.equal(f.queueTime.textContent,'Wait time: 1 m 2 s');
  f.clock.advance(4500);assert.equal(f.queueTime.textContent,'Wait time: 1 m 7 s');
  // A pool update can arrive later than its server sample; it must not make
  // the currently visible cumulative wait count backwards or restart at zero.
  f.lobby.status({queued:true,queue:{joinedAt:1789000000000,elapsedSeconds:65,size:5,remainingSeconds:10}});
  assert.equal(f.queueTime.textContent,'Wait time: 1 m 7 s');
  f.clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 1 m 8 s');
  f.lobby.status({queued:true,queue:{joinedAt:1789000000000,elapsedSeconds:68,size:3,paused:true,remainingSeconds:null}});
  f.clock.advance(3000);assert.equal(f.queueTime.textContent,'Wait time: 1 m 11 s','personal wait continues while the match-start countdown is paused');
  assert.equal(f.clock.timers.size,1);f.lobby.dispose();
});

test('pool-only status updates retain elapsed even when queue timestamps are omitted',()=>{
  const f=fixture();f.lobby.status({queued:true,queue:{joinedAt:100,elapsedSeconds:17,size:2}});
  f.clock.advance(3000);f.lobby.status({queued:true,queue:{size:3,remainingSeconds:null}});
  assert.equal(f.queueTime.textContent,'Wait time: 20 s');f.clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 21 s');f.lobby.dispose();
});

test('successful cancel stops the clock and a new queue entry starts from zero',async()=>{
  let joinedAt=100;
  const f=fixture({onQueue:async()=>({queued:true,queue:{joinedAt:joinedAt++,elapsedSeconds:0,size:1}}),onCancel:async()=>({queued:false,queue:{joinedAt:null,elapsedSeconds:null,size:0}})});
  await f.join('2v2');f.clock.advance(20000);assert.equal(f.queueTime.textContent,'Wait time: 20 s');
  await f.button('cancel').onclick();assert.equal(f.queueTime.hidden,true);assert.equal(f.clock.timers.size,0);
  const stopped=f.queueTime.textContent;f.clock.advance(30000);assert.equal(f.queueTime.textContent,stopped);
  await f.join('2v2');assert.equal(f.queueTime.textContent,'Wait time: 0 s');f.clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 1 s');f.lobby.dispose();
});

test('a match status stops personal waiting and a delayed successful queue response cannot revive it',async()=>{
  const joining=deferred(),f=fixture({onQueue:()=>joining.promise});
  const pending=f.join('2v2');await Promise.resolve();
  f.lobby.status({queued:true,queue:{joinedAt:100,elapsedSeconds:4,size:4}});f.clock.advance(1000);
  f.lobby.status({queued:false,queue:{joinedAt:null,elapsedSeconds:null,size:0},match:{id:'match-1'}});
  const stopped=f.queueTime.textContent;assert.equal(f.queueTime.hidden,true);assert.equal(f.clock.timers.size,0);
  joining.resolve({queued:true,queue:{joinedAt:100,elapsedSeconds:0,size:4}});await pending;f.clock.advance(10000);
  assert.equal(f.queueTime.hidden,true);assert.equal(f.queueTime.textContent,stopped);assert.equal(f.clock.timers.size,0);
  assert.equal(f.button('queue').disabled,true,'authoritative matched state remains locked');
});

test('failed entry never starts a timer and a failed cancel retains the current wait',async()=>{
  const rejected=fixture({onQueue:async()=>{throw Error('Not queued');}});
  await rejected.button('queue').onclick();assert.equal(rejected.queueTime.hidden,true);assert.equal(rejected.clock.timers.size,0);
  const f=fixture({onCancel:async()=>{throw Error('CancelDefeat');}});f.lobby.status({queued:true,queue:{joinedAt:100,elapsedSeconds:9,size:1}});
  await f.button('cancel').onclick();f.clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 10 s');assert.equal(f.queueTime.hidden,false);f.lobby.dispose();
});

test('new authoritative queue identity resets elapsed, while dispose cancels even a pending successful entry',async()=>{
  const f=fixture();f.lobby.status({queued:true,queue:{joinedAt:100,elapsedSeconds:100,size:1}});
  f.lobby.status({queued:true,queue:{joinedAt:200,elapsedSeconds:0,size:1}});assert.equal(f.queueTime.textContent,'Wait time: 0 s');
  f.lobby.dispose();assert.equal(f.clock.timers.size,0);f.clock.advance(5000);assert.equal(f.lobby.root.hidden,true);
  const joining=deferred(),late=fixture({onQueue:()=>joining.promise}),pending=late.button('queue').onclick();await Promise.resolve();
  late.lobby.dispose();joining.resolve({queued:true,queue:{joinedAt:300,elapsedSeconds:0,size:1}});await pending;
  assert.equal(late.clock.timers.size,0);assert.equal(late.queueTime.hidden,true);
});

test('default browser clock keeps the native receiver when scheduling and canceling timers',()=>{
  const clock=new FakeClock(),browser={performance:{now(){assert.equal(this,browser.performance);return clock.now();}},
    setTimeout(callback,delay){assert.equal(this,browser);return clock.setTimeout(callback,delay);},
    clearTimeout(timer){assert.equal(this,browser);clock.clearTimeout(timer);}};
  const f=fixture({browser});f.lobby.status({queued:true,queue:{joinedAt:100,elapsedSeconds:0,size:1}});
  clock.advance(1000);assert.equal(f.queueTime.textContent,'Wait time: 1 s');f.lobby.dispose();assert.equal(clock.timers.size,0);
});

test('three buttons select independent queue modes and freeze the same nickname/configuration',async()=>{
  for(const [action,mode]of [['queue1v1','1v1'],['queue','2v2'],['queue3v3','3v3']]){
    const modes=[],f=fixture({onQueue:async value=>{modes.push(value);return {queued:true,queue:{mode:value,size:1,joinedAt:123,elapsedSeconds:0}};}});
    f.input.value='New Nickname';await (['queue1v1','queue','queue3v3'].includes(action)?f.join({'queue1v1':'1v1','queue':'2v2','queue3v3':'3v3'}[action]):f.button(action).onclick());assert.deepEqual(modes,[mode]);assert.deepEqual(f.calls,[['save','New Nickname']]);
    assert.equal(f.input.disabled,true);assert.equal(f.button('skills').disabled,true);assert.equal(f.button('keys').disabled,true);
    assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'Searching for '+mode+' · 1 players');
    assert.equal(f.queueTime.textContent,'Wait time: 0 s');f.lobby.dispose();
  }
});

test('ordinary players see disabled modes but never see GM controls or send a closed queue request',async()=>{
  const f=fixture({role:'player',modes:{'1v1':false,'2v2':true,'3v3':false}});
  assert.equal(f.lobby.root.querySelector('.lobby-mode-controls').hidden,true);assert.equal(f.button('mode-1v1'),null);
  for(const action of ['queue1v1','queue3v3']){assert.equal(f.button(action).disabled,true);assert.match(f.button(action).textContent,/Unavailable/);assert.equal(await (['queue1v1','queue','queue3v3'].includes(action)?f.join({'queue1v1':'1v1','queue':'2v2','queue3v3':'3v3'}[action]):f.button(action).onclick()),false);}
  assert.equal(f.button('queue').disabled,false);assert.deepEqual(f.calls,[]);
  f.lobby.status({queued:false,modes:{'1v1':true,'2v2':true,'3v3':false}});assert.equal(f.button('queue1v1').disabled,false);f.lobby.dispose();
});

test('GM toggles update only the requested mode; closed queue notice unlocks every configuration and stops waiting',async()=>{
  const calls=[],f=fixture({onModeChange:async(mode,enabled)=>{calls.push([mode,enabled]);return {modes:{[mode]:enabled}};}});
  assert.equal(f.lobby.root.querySelector('.lobby-mode-controls').hidden,false);
  await f.button('mode-3v3').onclick();assert.deepEqual(calls,[['3v3',false]]);assert.equal(f.button('queue3v3').disabled,true);assert.equal(f.button('queue').disabled,false);
  await f.button('mode-3v3').onclick();assert.deepEqual(calls.at(-1),['3v3',true]);assert.equal(f.button('queue3v3').disabled,false);
  f.lobby.status({queued:true,queue:{mode:'1v1',joinedAt:100,elapsedSeconds:3,size:2,remainingSeconds:5}});f.clock.advance(1000);
  f.lobby.status({queued:false,modes:{'1v1':false,'2v2':true,'3v3':true},queueNotice:{mode:'1v1',reason:'mode-disabled',message:'mode disabled by GM'}});
  assert.equal(f.input.disabled,false);for(const action of ['nickname','skills','keys','practice','practice2v2'])assert.equal(f.button(action).disabled,action==='nickname');
  assert.equal(f.button('queue1v1').disabled,true);assert.equal(f.button('queue').disabled,false);assert.equal(f.button('queue3v3').disabled,false);
  assert.equal(f.queueTime.hidden,true);assert.equal(f.clock.timers.size,0);assert.match(f.lobby.root.querySelector('.lobby-status').textContent,/mode disabled by GM/);f.lobby.dispose();
});

test('closing another pool does not unlock or reset a queued player and a delayed join cannot revive a kicked pool',async()=>{
  const joining=deferred(),f=fixture({onQueue:()=>joining.promise});const pending=f.join('1v1');await Promise.resolve();
  f.lobby.status({queued:true,modes:{'1v1':true,'2v2':true,'3v3':false},queue:{mode:'1v1',joinedAt:100,elapsedSeconds:7,size:2}});
  f.clock.advance(2000);assert.equal(f.queueTime.textContent,'Wait time: 9 s');assert.equal(f.input.disabled,true);
  f.lobby.status({queued:false,modes:{'1v1':false,'2v2':true,'3v3':false},queueNotice:{mode:'1v1',reason:'mode-disabled'}});
  joining.resolve({queued:true,modes:{'1v1':true},queue:{mode:'1v1',joinedAt:100,elapsedSeconds:0,size:2}});await pending;
  assert.equal(f.input.disabled,false);assert.equal(f.button('queue1v1').disabled,true);assert.equal(f.queueTime.hidden,true);f.lobby.dispose();
});

test('a mode closed between rendering and POST reports GM closure without starting the wait timer',async()=>{
  const f=fixture({onQueue:async()=>{throw Object.assign(Error('mode-disabled'),{code:'mode-disabled',status:409});}});
  await f.join('3v3');assert.equal(f.input.disabled,false);assert.equal(f.button('queue3v3').disabled,true);
  assert.equal(f.button('queue').disabled,false);assert.equal(f.queueTime.hidden,true);assert.equal(f.clock.timers.size,0);
  assert.equal(f.lobby.root.querySelector('.lobby-status').textContent,'3v3 · Disabled by GM');f.lobby.dispose();
});

test('a new lobby restores the server nickname and only successful confirmation replaces it',async()=>{
  const f=fixture({nickname:'Saved Nickname',onNicknameSave:async()=>{throw Error('Write failed');}});
  assert.equal(f.input.value,'Saved Nickname');assert.equal(f.lobby.nickname,'Saved Nickname');assert.match(f.lobby.root.querySelector('.lobby-account').textContent,/Saved Nickname/);
  f.input.value='Unsaved';await f.button('nickname').onclick();assert.equal(f.lobby.nickname,'Saved Nickname');
  f.lobby.dispose();const reloaded=fixture({nickname:'Saved Nickname'});assert.equal(reloaded.input.value,'Saved Nickname');
  reloaded.input.value='  Confirmed  ';await reloaded.button('nickname').onclick();assert.equal(reloaded.lobby.nickname,'Confirmed');assert.deepEqual(reloaded.calls,[['save','Confirmed']]);reloaded.lobby.dispose();
});

function accountFields(f){return {form:f.lobby.root.querySelector('.lobby-account-create'),name:f.lobby.root.querySelector('.lobby-new-account'),password:f.lobby.root.querySelector('.lobby-new-password'),feedback:f.lobby.root.querySelector('.lobby-account-feedback'),button:f.button('account-create')};}

test('GM creates an ordinary account with a trimmed username and an exact password; success clears credentials',async()=>{
  const calls=[],f=fixture({onAccountCreate:async(username,password)=>{calls.push({username,password});return {ok:true,username,role:'player'};}}),a=accountFields(f);
  assert.equal(a.form['aria-label'],'GM player accounts');assert.equal(a.password.type,'password');assert.equal(a.password.autocomplete,'new-password');
  a.name.value='  New account  ';a.password.value=' 123456 ';let prevented=0;
  await a.form.onsubmit({preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.deepEqual(calls,[{username:'New account',password:' 123456 '}]);
  assert.equal(a.name.value,'');assert.equal(a.password.value,'');assert.equal(a.feedback.textContent,'Player account New account created.');
  f.lobby.status({queued:false,available:true});assert.equal(a.feedback.textContent,'Player account New account created.','regular status polls cannot erase account feedback');
  assert.equal(a.button.disabled,false);f.lobby.dispose();
});

test('ordinary players have no account creation form, password input or submit handler',()=>{
  const f=fixture({role:'player',onAccountCreate:()=>{throw Error('must not call');}}),a=accountFields(f);
  for(const value of Object.values(a))assert.equal(value,null);f.lobby.dispose();
});

test('pending account creation rejects duplicates and queue entry; failures retain input and allow retry',async()=>{
  const pending=deferred(),calls=[],f=fixture({onAccountCreate:async(...args)=>{calls.push(args);return pending.promise;}}),a=accountFields(f);
  a.name.value='existing';a.password.value='secret1';const request=a.form.onsubmit();
  assert.equal(a.name.disabled,true);assert.equal(a.password.disabled,true);assert.equal(a.button.disabled,true);
  assert.equal(await a.form.onsubmit(),false);assert.equal(await f.join('2v2'),false);assert.equal(calls.length,1);
  pending.reject(Object.assign(Error('account-exists'),{code:'account-exists'}));assert.equal(await request,false);
  assert.equal(a.feedback.textContent,'Username taken. Choose another name.');assert.equal(a.name.value,'existing');assert.equal(a.password.value,'secret1');
  assert.equal(a.name.disabled,false);assert.equal(a.password.disabled,false);assert.equal(a.button.disabled,false);
  await a.form.onsubmit();assert.equal(calls.length,2);f.lobby.dispose();
});

test('GM account creation validates length/control characters before calling the server without trimming passwords',async()=>{
  const calls=[],f=fixture({onAccountCreate:async(...args)=>{calls.push(args);return {ok:true,username:args[0],role:'player'};}}),a=accountFields(f);
  for(const value of ['', '   ', 'x'.repeat(65), 'a\u0000b', 'a\u007fb']){a.name.value=value;a.password.value='secret1';assert.equal(await a.form.onsubmit(),false);assert.match(a.feedback.textContent,/Usernames must/);}
  for(const value of ['', '12345', 'x'.repeat(129)]){a.name.value='new';a.password.value=value;assert.equal(await a.form.onsubmit(),false);assert.match(a.feedback.textContent,/Passwords must/);}
  assert.equal(calls.length,0);
  for(const length of [6,128]){a.name.value='x'.repeat(64);a.password.value=' '.repeat(length);await a.form.onsubmit();assert.equal(calls.at(-1)[1].length,length);}
  assert.equal(calls.length,2);f.lobby.dispose();
});

test('queued GM cannot create an account and server failures show a safe message without exposing passwords',async()=>{
  const codes=new Map([['invalid-account','Enter a valid username and password.'],['invalid-username','Usernames must have 1–64 characters and cannot contain control characters.'],['invalid-password','Passwords must have 6–128 characters, including spaces.'],['account-save-failed','Could not save account. Try again later.'],['login-required','Session expired. Sign in again.'],['gm-required','Only GMs can add accounts.'],['origin-denied','Request origin verification failed. Reload the page and try again.'],[undefined,'Could not create account. Try again later.']]);
  let code,calls=0;const f=fixture({onAccountCreate:async()=>{calls++;throw Object.assign(Error('secret1'),{code});}}),a=accountFields(f);
  a.name.value='new';a.password.value='secret1';f.lobby.status({queued:true});assert.equal(a.button.disabled,true);assert.equal(await a.form.onsubmit(),false);assert.equal(calls,0);
  f.lobby.status({queued:false});
  for(const [value,message]of codes){code=value;await a.form.onsubmit();assert.equal(a.feedback.textContent,message);assert.equal(a.password.value,'secret1');assert.equal(a.button.disabled,false);}
  f.lobby.dispose();
});

test('disposing a GM lobby clears its password and late account responses cannot update the detached UI',async()=>{
  const pending=deferred(),f=fixture({onAccountCreate:()=>pending.promise}),a=accountFields(f);a.name.value='new';a.password.value='secret1';
  const request=a.form.onsubmit(),feedback=a.feedback.textContent;f.lobby.dispose();assert.equal(a.password.value,'');
  pending.resolve({ok:true,username:'new',role:'player'});assert.equal(await request,false);assert.equal(a.password.value,'');assert.equal(a.feedback.textContent,feedback);
});
test('costume dropdown publishes after save, restores on failure and locks with queue',async()=>{
  let save=deferred();const requested=[];const f=fixture({costumes:{raven:'officer'},onCostumeChange:choice=>{requested.push(choice);return save.promise;}}),select=f.button('costume');
  assert.equal(select.value,'officer');select.value='nasod';
  const pending=select.onchange();assert.equal(select.disabled,true);assert.equal(select.value,'officer');assert.deepEqual(requested,['nasod']);
  save.resolve({costumes:{raven:'nasod',elsword:'default'}});await pending;assert.equal(select.value,'nasod');
  save=deferred();select.value='royal';const failed=select.onchange();save.reject(Error('save-failed'));await failed;
  assert.equal(select.value,'nasod');assert.deepEqual(requested,['nasod','royal']);f.lobby.status({queued:true,professionId:'RF',costumes:{raven:'nasod',elsword:'default'}});
  assert.equal(select.disabled,true);assert.equal(await select.onchange(),false);f.lobby.dispose();
});
test('shared costumes follow portrait career selection and freeze in a queue',async()=>{
  const f=fixture({professionId:'RS',professions:{RF:true,LK:true,VC:true,RS:true},costumes:{elsword:'officer',raven:'royal'},onProfessionChange:async professionId=>({professionId})});
  assert.equal(f.lobby.professionId,'RS');assert.equal(f.button('costume').value,'officer');
  for(const [id,costume]of [['LK','officer'],['RF','royal'],['VC','royal'],['RS','officer']]){
    await f.button('choose-profession-'+id).onclick();assert.equal(f.button('costume').value,costume);
  }
  f.lobby.status({queued:true,professionId:'RS'});assert.equal(f.button('costume').disabled,true);f.lobby.dispose();
});
test('mode choice is separate from starting a queue; GM settings live in a closed secondary dialog',async()=>{
  const f=fixture(),overlay=f.lobby.root.querySelector('.lobby-gm-overlay');
  assert.equal(overlay.hidden,true);await f.button('queue1v1').onclick();assert.deepEqual(f.calls,[]);
  f.button('gm-open').onclick();assert.equal(overlay.hidden,false);f.button('gm-close').onclick();assert.equal(overlay.hidden,true);
  await f.button('match-start').onclick();assert.deepEqual(f.calls,['queue']);assert.equal(overlay.hidden,true);f.lobby.dispose();
});

test('last selected match mode survives a new lobby and follows GM availability without starting a queue',()=>{
  const values=new Map(),browser={localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}};
  let f=fixture({browser,clock:new FakeClock()});f.button('queue1v1').onclick();f.lobby.dispose();
  f=fixture({browser,clock:new FakeClock()});assert.equal(f.button('queue1v1')['aria-checked'],'true');assert.deepEqual(f.calls,[]);
  f.lobby.status({queued:false,modes:{'1v1':false,'2v2':false,'3v3':true}});
  assert.equal(f.button('queue3v3')['aria-checked'],'true');assert.deepEqual(f.calls,[]);f.lobby.dispose();
  f=fixture({browser,clock:new FakeClock()});assert.equal(f.button('queue3v3')['aria-checked'],'true');f.lobby.dispose();
});
