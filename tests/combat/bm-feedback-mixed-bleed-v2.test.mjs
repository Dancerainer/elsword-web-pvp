import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bmFixture,bmProfile,bmPreset} from '../helpers/bm-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {encodeOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const {native,map}=bmFixture({passives:[]});

for(const professionId of ['RF','LK','VC'])test(`BM Fatal Wound displays one-to-three bleeding stacks on a real ${professionId} recipient`,()=>{
  const donor=bmFixture({skillId:24208,passives:[]}),id=professionId.toLowerCase();
  const victimProfile=read(`packages/combat-core/${id}-profile.json`),victimPreset=read(`config/${id}-preset.json`);
  const pose=read(`artifacts/${id}/runtime-pose.json`);
  const samplers=createNativeSamplers({profile:victimProfile,
    characterPose:composeCharacterPose(pose,pose.sharedPose?read(`artifacts/${id}/`+pose.sharedPose):null),effectIndex:{templates:{}},effectPoses:{}});
  const routed=Object.fromEntries(['collisionSampler','defenderSampler','effectSampler','effectAnchorSampler','effectBoneSampler','motionOffsetSampler','nasodAttackSampler']
    .filter(key=>donor.sim[key]&&samplers[key])
    .map(key=>[key,(...args)=>(args.find(a=>a?.professionId)?.professionId===professionId?samplers[key]:donor.sim[key])(...args)]));
  const common=read('contracts/common-buff-catalog.json'),icons=read('artifacts/ui/buffs/manifest.json');
  assert.ok(common.buffTemplates[99]);assert.ok(icons.buffIcons[99]);
  const sim=createSimulation({profile:bmProfile,profiles:{[professionId]:victimProfile},commonBuffs:common,map,
    preset:{...bmPreset,guildPassives:[],passives:[],loadout:[{skillId:24208},...Array(7).fill(null)]},
    presets:{[professionId]:{...victimPreset,guildPassives:[],passives:[]}},seed:2016,
    actors:[{id:'bm',professionId:'BM',team:0,position:[0,3080,0],lineId:2,facing:1},
      {id:'victim',professionId,team:1,position:[165,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[]}],
    ...routed,nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,
    nativeSkillValues:native.skillValues,nativeCritical:native.critical,nativeNasod:native.nasod,nativeManaBreak:native.manaBreak});
  sim.rng=()=>.99;const a=sim.actor('bm'),b=sim.actor('victim');
  for(let cast=1;cast<=4;cast++){
    for(const [actor,x]of [[a,0],[b,165]]){
      actor.x=x;actor.y=3080;actor.z=0;actor.vx=actor.vy=0;actor.grounded=true;actor.lineId=2;actor.landPosition=[x,3080,0];
      sim.enter(actor,'RSI_WAIT','independent-fatal-wound-cast');
    }
    a.mp=a.mpMax;a.cooldowns[24208]=0;sim.drainEvents();sim.step(1/60,{bm:{pressed:['A']}});
    for(let i=0;i<180&&a.skillId;i++)sim.step(1/60,{});
    const events=sim.drainEvents(),count=Math.min(cast,3),buff=b.buffs.find(row=>row.templateId===99);
    assert.equal(events.filter(e=>e.type==='buffApplied'&&e.targetId===b.id&&e.templateId===99).length,1);
    assert.equal(buff.accumulationCount,count);
    const sets=[...new Set(sim.state.effects.filter(e=>e.ownerId===b.id&&e.buffTemplateId===99&&!e.dead).map(e=>e.setName))];
    assert.deepEqual(sets,[`EffectSet_DEBUFF_BLEEDING_0${count}`]);
    const packet=encodeOwnedState(sim,b.id,{epoch:1,frameSeq:cast});
    assert.doesNotThrow(()=>validateOwnedReferences(packet,b,sim.profileFor(b),map,{profiles:sim.profiles,actors:sim.state.actors}));
  }
  assert.deepEqual(sim.state.unsupported.filter(row=>row.id!=='fidelity-unverified'),[]);
  assert.deepEqual(victimProfile.damageEffects,read(`packages/combat-core/${id}-profile.json`).damageEffects);
});
