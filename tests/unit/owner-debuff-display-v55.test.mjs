/** Current receiver delivery regression; frozen factors with explicit JS numeric
 * bridge, not native/WAN evidence. No skill or collider data is modified. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createBuffFromFactor,buffDisplaySets} from '../../packages/combat-core/buffs.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';
import {encodeOwnedState,encodeEffectState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {createOwnerBuffSender,decodeOwnerBuffProtection} from '../../packages/online/owner-buff-sync.mjs';

const profiles=Object.fromEntries(['RF','BM','LK'].map(id=>[id,JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const commonBuffs=JSON.parse(readFileSync(new URL('../fixtures/v55-buff-particle-closure.json',import.meta.url)));
const map={sceneId:'v55-owner-debuff',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},f=Math.fround;
const nativeValues={buffFixed:(v,r)=>f(f(v)*f(1-r)),buffRelation:(a,v,r)=>f(f(f(a)*f(v))*f(1-r)),buffPercent:(v,r)=>f(f(v)*f(1-r)),
  buffInterval(sum,interval,elapsed){const next=f(f(sum)+f(elapsed));return next>=f(interval)?{sum:0,triggered:true}:{sum:next,triggered:false};}};
function fixture(profession='RF'){
  const make=owner=>createSimulation({profile:profiles[profession],profiles,commonBuffs,map,networkOwnerId:owner,seed:2016,
    preset:{passives:[],guildPassives:[],buffResistances:{0:0,1:0,2:0,3:0,4:0,5:0,6:0},debuffDurationMultiplier:1},
    actors:['a','b'].map((id,i)=>({id,professionId:profession,team:i,position:[i*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
  const source=make('b'),sim=make('a'),sync=createLocalOwnershipSync({ownerStatusVersion:1,combatPlaybackVersion:1,clock:()=>0});
  sync.reconcile(sim,{snapshot:sim.snapshot(),ownership:{mode:'local-owner-v1',ownerStatusVersion:1,combatPlaybackVersion:1,
    actors:{a:{epoch:3,frameSeq:0},b:{epoch:3,frameSeq:0}}},owners:{}},'a');
  // Non-equipment fixtures have no defence base. Supply an explicit test base
  // so a real factor multiplier can be checked numerically, including zero.
  for(const instance of [source,sim])for(const actor of instance.state.actors){actor.stats.physicalDefence=1000;actor.buffBaseStats.physicalDefence=1000;}
  source.nativeSkillValues=sim.nativeSkillValues=nativeValues;
  const clock=createOwnerStatusClock(),sender=createOwnerBuffSender();
  function sample(frame){const report=encodeOwnedState(source,'b',{epoch:3,frameSeq:frame});Object.assign(report.actor,clock.encode(report.actor,3,frame).actor);
    const status=encodeOwnedStatus(report);sender.capture(status);return {status,snapshot:sender.snapshot(),compact:sender.compact()};}
  function grant(factor){const result=createBuffFromFactor(source.profileFor(source.actor('a')),{factor,sourceActor:source.actor('a'),targetActor:source.actor('b'),roll:0,nativeValues});
    assert.equal(result.supported,true,JSON.stringify(result.unsupported));assert.equal(result.accepted,true);source.actor('b').buffs=[result.buff];return result.buff;}
  const rows=()=>buildBuffRows(sim.actor('b'),{profile:sim.profileFor(sim.actor('b')),profileForBuff:buff=>sim.profileFor(sim.actor(buff.sourceActorId))});
  return {source,sim,sync,sender,sample,grant,rows};
}
for(const [profession,factor,template,stat,multiplier]of [['RF',42,48,'physicalAttack',.57],['BM',250,78,'physicalDefence',.46],['LK',70,78,'physicalDefence',.6]])
test(`${profession} factor ${factor} repair updates debuff row and actual ${stat}, refresh/end reject stale resurrection`,()=>{
  const q=fixture(profession),actor=q.sim.actor('b'),base=actor.stats[stat],hp=actor.hp,localHp=q.sim.actor('a').hp;
  q.sample(1);q.grant(factor);const active=q.sample(10);
  assert.equal(q.sync.receiveProtection(q.sim,'b',decodeOwnerBuffProtection(active.compact),'a',active.compact.buffRevision),true);
  assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),true);
  assert.equal(actor.buffs[0].factorId,factor);assert.equal(actor.buffs[0].sourceActorId,'a');assert.equal(q.rows()[0].templateId,template);
  assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===template&&!e.dead).length,1);
  const expected=f(base*f(1-f(1-f(multiplier))));
  assert.equal(actor.stats[stat],expected);assert.equal(actor.hp,hp);assert.equal(q.sim.actor('a').hp,localHp);
  if(template===48)assert.equal(actor.stats.magicAttack,f(actor.buffBaseStats.magicAttack*f(1-f(1-f(.57)))));
  actor.buffs[0].finalizers[0].remaining=1;q.grant(factor);const refreshed=q.sample(20);
  assert.equal(q.sync.receiveBuffs(q.sim,'b',refreshed.snapshot,'a'),true);assert.ok(q.rows()[0].remaining>1);
  assert.equal(actor.stats[stat],expected,'refresh recomposes from base rather than multiplying twice');
  q.source.actor('b').buffs=[];const end=q.sample(30);assert.equal(q.sync.receiveBuffs(q.sim,'b',end.snapshot,'a'),true);
  assert.equal(actor.stats[stat],base);assert.deepEqual(q.rows(),[]);
  assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===template&&!e.dead).length,0);
  assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),false);q.sync.receiveStatus(q.sim,'b',active.status,'a');
  assert.equal(actor.stats[stat],base);assert.deepEqual(q.rows(),[]);assert.equal(actor.hp,hp);assert.equal(q.sim.actor('a').hp,localHp);q.sync.clear();
});

test('a Buff display born before its identity recovers when a valid independent repair arrives',()=>{
  const q=fixture('BM'),buff=q.grant(250),active=q.sample(10),actor=q.sim.actor('b'),set=buffDisplaySets(buff)[0];
  const first=q.sim.state.nextEffectId;q.sim.spawnSet(actor,set);
  const early=q.sim.state.effects.filter(e=>e.id>=first);assert.equal(early.length,1);for(const e of early)e.buffTemplateId=78;
  q.sim.step(1/60,{}, {snapshot:false});
  assert.ok(early.every(e=>e.dead),'the current production lifetime guard removes a display with no Buff identity');
  assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),true);assert.equal(q.rows()[0].templateId,78);
  const live=q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead);
  assert.equal(live.length,1,'accepted live Buff must recover its purely visual display after cross-channel reordering');
  assert.equal(live[0].damage,null);assert.equal(live[0].name,'StateError_Armor_Break01');
  q.sync.clear();
});

test('Weapon Break accepted status changes the next current local collision damage without receipt-side damage',()=>{
  function damage(debuff){const q=fixture('RF'),victim=q.sim.actor('a'),attacker=q.sim.actor('b'),hp=victim.hp;
    if(debuff){q.grant(42);const active=q.sample(10);assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),true);}
    assert.equal(victim.hp,hp,'receiving a Buff never executes a past hit');
    const data=profiles.RF.damageEffects.DamageEffect_RF_COMBO_Z.raw.DAMAGE_DATA;
    q.sim.defenderSampler=a=>[{kind:'sphere',center:[a.x,a.y+50,a.z],radius:20}];
    const count=q.sim.checkHits(attacker,[{kind:'sphere',center:[victim.x,victim.y+50,victim.z],radius:30}],data,{}, {kind:'actor',id:'current-z'});
    assert.equal(count,1);const hit=q.sim.state.events.find(e=>e.type==='hit'&&e.targetId==='a');assert.ok(hit);
    const amount=hp-victim.hp;q.sync.clear();return amount;}
  const ordinary=damage(false),broken=damage(true);assert.ok(ordinary>0);assert.ok(broken>0);
  assert.ok(Math.abs(broken/ordinary-.57)<1e-6,`${ordinary} -> ${broken}`);
});

test('zero defence remains zero through real Armor Break receipt and removal',()=>{
  const q=fixture('BM'),actor=q.sim.actor('b');actor.stats.physicalDefence=actor.buffBaseStats.physicalDefence=0;
  q.grant(250);assert.equal(q.sync.receiveBuffs(q.sim,'b',q.sample(10).snapshot,'a'),true);assert.equal(actor.stats.physicalDefence,0);
  q.source.actor('b').buffs=[];assert.equal(q.sync.receiveBuffs(q.sim,'b',q.sample(20).snapshot,'a'),true);assert.equal(actor.stats.physicalDefence,0);q.sync.clear();
});

test('status-first display is adopted by canonical birth once, remains stable across checkpoints, and ends with the Buff',()=>{
  const q=fixture('BM'),buff=q.grant(250),active=q.sample(10),source=q.source.actor('b'),actor=q.sim.actor('b'),set=buffDisplaySets(buff)[0];
  q.source.spawnSet(source,set);const original=q.source.state.effects.at(-1);original.buffTemplateId=78;
  const sync=q.sync;
  assert.equal(sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),true);
  const restored=q.sim.state.effects.find(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead);assert.ok(restored);
  const wire=encodeEffectState(original,q.source.profileFor(source),source);wire.id=400;
  const action=encodeCriticalAction(encodeOwnedState(q.source,'b',{epoch:3,frameSeq:10}),{id:1});action.effects=[wire];action.playback={version:1,start:false,held:[]};
  const oldTerminal=structuredClone(action);oldTerminal.id=2;oldTerminal.effects[0].id=399;
  Object.assign(oldTerminal.effects[0],{dead:true,endEmitted:true,active:false});
  assert.ok(sync.receiveTerminals(q.sim,'b',[oldTerminal],3,10,'a'));
  assert.equal(restored.dead,undefined,'an unknown old display terminal cannot kill the current Buff status display');
  assert.ok(sync.receiveActions('b',[action],3,10));sync.beforeStep(q.sim,'a');
  assert.equal(restored.networkId,400);assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead).length,1);
  q.sim.step(1/60,{}, {snapshot:false});const elapsed=restored.elapsed;
  assert.equal(sync.receiveStatus(q.sim,'b',q.sample(11).status,'a'),true);assert.equal(restored.elapsed,elapsed);
  assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead).length,1);
  const currentTerminal=structuredClone(oldTerminal);currentTerminal.id=3;currentTerminal.effects[0].id=400;
  assert.ok(sync.receiveTerminals(q.sim,'b',[currentTerminal],3,11,'a'));
  assert.equal(restored.dead,undefined,'a canonical display terminal cannot outrun its still active authoritative Buff');
  const replacement=structuredClone(action);replacement.id=4;replacement.frameSeq=12;replacement.effects[0].id=401;
  assert.ok(sync.receiveActions('b',[replacement],3,12));sync.beforeStep(q.sim,'a');sync.beforeStep(q.sim,'a');
  assert.equal(restored.networkId,401,'a new canonical identity can reclaim the status-owned display after the old terminal');
  assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead).length,1);
  q.source.actor('b').buffs=[];const end=q.sample(20);assert.equal(sync.receiveBuffs(q.sim,'b',end.snapshot,'a'),true);
  assert.equal(restored.dead,true);assert.equal(sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),false);
  assert.equal(q.sim.state.effects.filter(e=>e.ownerId==='b'&&e.buffTemplateId===78&&!e.dead).length,0);sync.clear();
});

test('a new owner life removes restored displays and rejects delayed old-life repair',()=>{
  const q=fixture('RF');q.grant(42);const active=q.sample(10);assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),true);
  const next=q.sim.snapshot();next.actors.find(a=>a.id==='b').buffs=[];
  q.sync.reconcile(q.sim,{snapshot:next,ownership:{mode:'local-owner-v1',ownerStatusVersion:1,combatPlaybackVersion:1,
    actors:{a:{epoch:3,frameSeq:0},b:{epoch:4,frameSeq:0}}},owners:{}},'a');
  assert.equal(q.sim.state.effects.some(e=>e.ownerId==='b'),false);
  assert.equal(q.sync.receiveBuffs(q.sim,'b',active.snapshot,'a'),false);assert.deepEqual(q.rows(),[]);q.sync.clear();
});

test('Buff recovery never creates an unknown template, mesh/controller, or damage display member',()=>{
  for(const unsupported of ['unknown','mesh','damage']){
    const q=fixture('BM'),profile=q.sim.profileFor(q.sim.actor('b')),def=profile.effectSets.EffectSet_ARMOR_BREAK.raw.EFFECT0;
    if(unsupported==='unknown')delete profile.effectTemplates[def.NAME];
    if(unsupported==='mesh')def.EFFECT_TYPE=2;
    if(unsupported==='damage')profile.damageEffects[def.NAME]={raw:{DAMAGE_DATA:{DAMAGE:{PHYSIC:1}}}};
    q.grant(250);assert.equal(q.sync.receiveBuffs(q.sim,'b',q.sample(10).snapshot,'a'),true);
    assert.equal(q.rows()[0].templateId,78);assert.equal(q.sim.state.effects.length,0,unsupported);q.sync.clear();
  }
});
