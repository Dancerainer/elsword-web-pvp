/** Real native skill/state traffic must survive the owner protocol. These are
 * web transport regressions, not original-client packet or runtime goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')});
const skillIds=assets.profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.supported&&s.skillId!==900).map(s=>s.skillId);

async function simulation(skillId,owner){
  const {native,samplers}=await assets.createRuntime();
  return createSimulation({profile:assets.profile,map:assets.map,seed:2016,networkOwnerId:owner,
    preset:{...assets.preset,onlineMatch:true,loadout:[{skillId},null,null,null,null,null,null,null]},
    actors:[{id:'sender',team:0,position:[2022.98,2840,0],lineId:6,facing:-1},
      {id:'receiver',team:1,position:[1858.11,2840,0],lineId:6,facing:1}],...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:assets.versions});
}
for(const awakened of [false,true])for(const skillId of skillIds)test(`owner protocol carries native skill ${skillId}${awakened?' awakened':''} and reconstructs its live effects`,async()=>{
  const sender=await simulation(skillId,'sender'),receiver=await simulation(skillId,'receiver');
  if(awakened){const actor=sender.actor('sender');actor.awakening.pendingOrbs=3;actor.awakening.pendingAvailableOrbs=3;sender.activateAwakening(actor);}
  sender.drainEvents();let observedSkill=false,effects=0;
  for(let frame=1;frame<=420;frame++){
    sender.step(1/60,frame===1?{sender:{held:['A'],pressed:['A']}}:{},{snapshot:false});
    const events=sender.drainEvents();if(sender.actor('sender').skillId===skillId)observedSkill=true;
    if(frame%3!==0&&frame!==1)continue;
    const report=encodeOwnedState(sender,'sender',{epoch:0,frameSeq:frame,events});
    validateOwnedState(report);validateOwnedReferences(report,receiver.actor('sender'),receiver.profile,receiver.map);
    const before=structuredClone(receiver.actor('receiver'));
    applyOwnedState(receiver,'sender',report);
    assert.deepEqual(receiver.actor('receiver'),before,'remote sync must never rewrite the receiving player');
    assert.equal(receiver.actor('sender').state,sender.actor('sender').state);
    assert.equal(receiver.actor('sender').mp,sender.actor('sender').mp);
    assert.equal(receiver.state.effects.filter(e=>e.ownerId==='sender').length,report.effects.length);
    for(const effect of receiver.state.effects){assert.ok(effect.definition);if(effect.mainEffectName)assert.ok(receiver.profile.effectTemplates[effect.mainEffectName]);}
    effects+=report.effects.length;
  }
  assert.ok(observedSkill,`skill ${skillId} actually executed`);
  assert.ok(Number.isFinite(effects));
});

test('repeated sender samples retain the victim collision history within a single attack',async()=>{
  const sender=await simulation(24025,'sender'),receiver=await simulation(24025,'receiver');
  sender.step(1/60,{sender:{held:['Z'],pressed:['Z']}},{snapshot:false});
  const report=encodeOwnedState(sender,'sender',{frameSeq:1});applyOwnedState(receiver,'sender',report);
  receiver.actor('sender').hits.receiver=12.5;receiver.actor('sender').hitGaps.receiver=13;
  applyOwnedState(receiver,'sender',{...report,frameSeq:2});
  assert.equal(receiver.actor('sender').hits.receiver,12.5);assert.equal(receiver.actor('sender').hitGaps.receiver,13);
});

test('two independent owners exchange native Z frames and the victim receives a real hit once',async()=>{
  const sender=await simulation(24025,'sender'),receiver=await simulation(24025,'receiver');
  for(const sim of [sender,receiver]){const a=sim.actor('receiver');a.x=1920;a.landPosition[0]=1920;}
  const localHp=sender.actor('receiver').hp,events=[];
  for(let frame=1;frame<=150;frame++){
    sender.step(1/60,frame===1?{sender:{held:['Z'],pressed:['Z']}}:{},{snapshot:false});
    sender.drainEvents();
    if(frame%3===0)applyOwnedState(receiver,'sender',encodeOwnedState(sender,'sender',{frameSeq:frame}));
    receiver.step(1/60,{}, {snapshot:false});events.push(...receiver.drainEvents());
  }
  const hits=events.filter(e=>e.type==='hit'&&e.targetId==='receiver');
  assert.equal(hits.length,1,'single Z active window must hit the victim exactly once');
  // Guild508 may legitimately heal the receiver before frame150; inspect
  // the actual accepted-hit HP write instead of assuming it remains injured.
  assert.ok(hits[0].amount>0&&hits[0].hp<localHp);
  assert.equal(sender.actor('receiver').hp,localHp,'attacker does not own target HP');
});
