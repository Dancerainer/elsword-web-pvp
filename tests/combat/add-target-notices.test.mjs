import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emitAddForceFingerNotice,receiveAddTargetNotice,flushAddTargetNotices,validateAddTargetNotice} from '../../packages/combat-core/add-target-notices.mjs';
import {addTargetSkillEvents} from '../../packages/combat-core/add-target-skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/de-profile.json',import.meta.url)));
function fixture(networkOwnerId=null){
 const a={id:'de',professionId:'DE',team:0,hp:100,mp:0,mpMax:330,x:0,y:0,z:0,lineId:0,facing:1,
  state:'ANSI_A_ADE_FORCE_FINGER',skillId:29215,loadout:[{skillId:29215}],sourceAdd:{formation:false,dp:100}};
 const b={id:'enemy',professionId:'LK',team:1,hp:100,mp:50,x:100,y:0,z:0};
 const c={...b,id:'enemy2',x:200};
 const sim={networkOwnerId,networkEpochFor:id=>id==='de'?2:3,state:{actors:[a,b,c]},profileFor:()=>profile,
  map:{lines:[{lineId:0,start:[0,0,0],end:[1000,0,0]}]},notes:[],events:[],effects:[],
  fire:(a,k,t,b,e,fn)=>{if(b<t&&e>=t)fn();},note:(...args)=>sim.notes.push(args),
  createEffect:(a,definition)=>sim.effects.push(definition.NAME),emit:(...args)=>sim.events.push(args)};
 return {sim,a,b,c};
}
const notice=(serial=1,epoch=3)=>({serial,kind:'force-finger',skillId:29215,targets:[{id:'enemy',epoch}]});

test('target2016 Force Finger caller handles one candidate, drains15 and restores45 independently',()=>{
 const {sim,a,b,c}=fixture();addTargetSkillEvents(sim,a,0,.270);assert.equal(b.mp,50);
 addTargetSkillEvents(sim,a,.270,.271);
 assert.equal(b.mp,35);assert.equal(c.mp,50);assert.equal(a.mp,45);assert.equal(sim.effects.length,1);
 assert.deepEqual(a.sourceAddTargetNotice.targets,[{id:'enemy',epoch:3}]);
 a.sourceAdd.formation=true;a.sourceAdd.dp=100;b.mp=4;
 addTargetSkillEvents(sim,a,0,.271);assert.equal(b.mp,0);assert.equal(a.sourceAdd.dp,1000);
 assert.equal(a.sourceAddTargetNotice.serial,2);
});

test('caster-owned cast emits transfer but neither caster nor remote animation writes peer MP',()=>{
 const {sim,a,b}=fixture('de');addTargetSkillEvents(sim,a,0,.271);
 assert.equal(b.mp,50);assert.equal(a.mp,45);assert.equal(a.sourceAddTargetNotice.serial,1);
 sim.networkOwnerId='enemy';addTargetSkillEvents(sim,a,0,.271);
 assert.equal(b.mp,50);assert.equal(a.mp,45);assert.equal(a.sourceAddTargetNotice.serial,1);
 assert.equal(receiveAddTargetNotice(sim,a,2,a.sourceAddTargetNotice),true);assert.equal(b.mp,35);
});

test('same identity, older sender epochs and restored snapshots cannot repeat a drain',()=>{
 const {sim,a,b}=fixture('enemy');
 assert.equal(receiveAddTargetNotice(sim,a,2,notice()),true);assert.equal(b.mp,35);
 const snapshot=structuredClone(sim.state);
 assert.equal(receiveAddTargetNotice(sim,a,2,notice()),false);
 assert.equal(receiveAddTargetNotice(sim,a,1,notice(500)),false);
 sim.state=structuredClone(snapshot);
 assert.equal(receiveAddTargetNotice(sim,sim.state.actors[0],2,notice()),false);
 assert.equal(sim.state.actors[1].mp,35);
 assert.equal(receiveAddTargetNotice(sim,sim.state.actors[0],3,notice()),true);
 assert.equal(sim.state.actors[1].mp,20);
});

test('target life, dead target and non-recipient failures are consumed before later resurrection',()=>{
 for(const mode of ['life','dead','other']){
  const {sim,a,b}=fixture('enemy');const n=notice();
  if(mode==='life')n.targets[0].epoch=2;
  if(mode==='dead')b.hp=0;
  if(mode==='other')n.targets[0].id='enemy2';
  assert.equal(receiveAddTargetNotice(sim,a,2,n),false,mode);assert.equal(b.mp,50);
  b.hp=100;sim.networkEpochFor=()=>2;
  assert.equal(receiveAddTargetNotice(sim,a,2,n),false,mode);assert.equal(b.mp,50);
 }
});

test('roster baseline defers target life sampling and failed reconciliation discards queued deliveries',()=>{
 const {sim,a,b}=fixture('enemy');sim.deferAddTimeRingNotices=true;
 receiveAddTargetNotice(sim,a,2,notice());assert.equal(b.mp,50);
 sim.deferAddTimeRingNotices=false;flushAddTargetNotices(sim);assert.equal(b.mp,35);
 sim.deferAddTimeRingNotices=true;receiveAddTargetNotice(sim,a,2,notice(2));
 sim.deferAddTimeRingNotices=false;flushAddTargetNotices(sim,{discard:true});assert.equal(b.mp,35);
 assert.equal(receiveAddTargetNotice(sim,a,2,notice(2)),true);assert.equal(b.mp,20);
});

test('notice rejects arbitrary amount, duplicate recipient, unknown identity, ally and foreign profession',()=>{
 const {sim,a}=fixture();const context={owner:a,profile,actors:sim.state.actors};
 validateAddTargetNotice(notice(),context);
 for(const n of [{...notice(),amount:1000},{...notice(),serial:0},{...notice(),skillId:29025},
  {...notice(),targets:[{id:'enemy',epoch:-1}]},{...notice(),targets:[...notice().targets,...notice().targets]},
  {...notice(),targets:[{id:'missing',epoch:3}]},{...notice(),targets:[{id:'de',epoch:2}]}])
  assert.throws(()=>validateAddTargetNotice(n,context));
 assert.throws(()=>validateAddTargetNotice(notice(),{...context,owner:{...a,professionId:'MM'}}));
 assert.throws(()=>validateAddTargetNotice(notice(),{...context,owner:{...a,loadout:[]}}));
 assert.throws(()=>validateAddTargetNotice(notice(),{...context,actors:sim.state.actors.map(x=>({...x,team:0}))}));
 assert.throws(()=>receiveAddTargetNotice({...sim,networkOwnerId:'enemy'},a,-1,notice()));
});

test('missing online recipient epoch omits a notice instead of addressing the next life as zero',()=>{
 const {sim,a,b}=fixture('de');delete sim.networkEpochFor;
 assert.equal(emitAddForceFingerNotice(sim,a,[b]),false);assert.equal(a.sourceAddTargetNotice,undefined);
 assert.equal(b.mp,50);assert.equal(sim.notes[0][0],'add-force-finger-recipient-epoch');
});
