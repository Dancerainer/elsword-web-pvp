import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {make as makeNativeFixture} from '../helpers/rf-passive-fixture-v12.mjs';

// Real production Simulation / original compiled v11 callbacks and target map.
// Explicit actor placement and injected lethal contact isolate the death
// consumer; this is current-simulation evidence, not an original-client trace.
const reference=await makeNativeFixture({passives:[],targetPassives:[]});
// The shared helper may disable guilds for historical RF-only tests. This
// independent production fixture exercises the constructor's default policy.
const productionPreset={...reference.preset};delete productionPreset.guildPassives;
const nativeFields=['collisionSampler','defenderSampler','effectSampler','effectAnchorSampler','effectBoneSampler',
  'motionOffsetSampler','nasodAttackSampler','nativeGeometry','nativeCommands','nativeSkills','nativeSkillValues',
  'nativeNasod','nativeCritical','nativeManaBreak'];
const bridges=Object.fromEntries(nativeFields.map(name=>[name,reference[name]]));
const serialized=s=>JSON.parse(JSON.stringify(s.snapshot()));
const heroEvents=s=>s.state.events.filter(e=>e.type==='guildHeroSacrifice'&&e.actorId==='corpse');
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<.02,`${value} != ${expected}`);
function make({facing=-1,guildPassives,extra=[]}={}){
  const source=(id,team,x,hp,additional={})=>({id,team,position:[x,3080,0],lineId:2,facing:1,hp,
    passives:[],attributes:{hpMax:800000},...additional});
  return createSimulation({profile:reference.profile,map:reference.map,preset:productionPreset,...bridges,
    seed:2016,versions:reference.versions,actors:[
      source('attacker',1,-100,800000,{guildPassives:[]}),
      source('corpse',0,0,1,{facing,...(guildPassives===undefined?{}:{guildPassives})}),
      source('ally',0,300,200000),...extra.map(a=>source(a.id,a.team??0,a.x,a.hp??200000,a))]});
}
function kill(s){
  const result=s.injectHit({attackerId:'attacker',targetId:'corpse',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},
    REACT_TYPE:1,FORCE_DOWN:0,BACK_SPEED_X:0,BACK_SPEED_Y:0}});
  assert.equal(result.accepted,true);assert.equal(s.actor('corpse').hp,0);
  assert.equal(s.state.events.filter(e=>e.type==='death'&&e.actorId==='corpse').length,1);
  assert.equal(s.state.events.filter(e=>e.type==='deathAnimationStarted'&&e.actorId==='corpse').length,1);
}
function step(s,count=1){for(let i=0;i<count;i++)s.step(1/60,{}, {snapshot:false});}
function reachHero(s){
  let crossing=null;
  for(let i=0;i<240&&!heroEvents(s).length;i++){
    const before=s.actor('corpse').animationTime;step(s);
    if(heroEvents(s).length)crossing={before,after:s.actor('corpse').animationTime};
  }
  assert.equal(heroEvents(s).length,1,'death animation must reach the original 1.12 event');
  return crossing;
}

test('production front/back lethal hit fires Hero once at death animation1.12 and heals live ally15percent',()=>{
  for(const facing of [-1,1]){
    const s=make({facing});assert.equal(Object.keys(s.actor('corpse').guild.levels).length,12);
    kill(s);assert.equal(s.actor('corpse').state,facing<0?'RSI_DIE_FRONT':'RSI_DIE_BACK');
    assert.equal(s.actor('corpse').animationTargetSpeed,.5);
    step(s,60);assert.equal(heroEvents(s).length,0,'animation time, not wall time1.12, owns the trigger');
    assert.equal(s.actor('ally').hp,200000);
    const crossing=reachHero(s);assert.ok(crossing.before<Math.fround(1.12));assert.ok(crossing.after>=Math.fround(1.12));
    const event=heroEvents(s)[0];assert.deepEqual(event.heals.map(h=>h.targetId),['ally']);
    near(event.heals[0].requestedHp,120000);near(s.actor('ally').hp,320000);
    const hpEvent=s.state.events.filter(e=>e.type==='guildHpRecovered'&&e.skillId===510);
    assert.equal(hpEvent.length,1);assert.equal(hpEvent[0].actorId,'ally');assert.equal(hpEvent[0].sourceId,'corpse');
    assert.equal(s.actor('corpse').hp,0);assert.equal(s.actor('corpse').death,true);
    step(s,400);assert.equal(heroEvents(s).length,1);near(s.actor('ally').hp,320000);
    assert.equal(s.state.events.filter(e=>e.type==='sound'&&e.name==='GS_Sacrifice_of_Hero.ogg').length,1,'one original guild sound per fatal trigger');
    assert.equal(s.actor('corpse').deathComplete,true);assert.equal(s.actor('corpse').hidden,true);
  }
});

test('production Hero excludes enemies, dead teammates, self and exact1500 range and clamps living ally',()=>{
  const s=make({extra:[{id:'inside',x:1499,hp:790000},{id:'edge',x:1500},{id:'outside',x:1501},
    {id:'enemy',team:1,x:600},{id:'dead-ally',x:900,hp:0,guildPassives:[]}]});
  kill(s);
  // Explicit range fixture locks only this corpse's root displacement. Its
  // native death animation and event still advance through production code;
  // the other tests retain actual death movement. No original displacement
  // expectation is inferred from this fixed-position range test.
  s.actor('corpse').applyMotionOffset=false;
  reachHero(s);assert.equal(s.actor('corpse').x,0);
  const event=heroEvents(s)[0];assert.deepEqual(event.heals.map(h=>h.targetId),['ally','inside'],
    JSON.stringify(s.state.actors.map(a=>({id:a.id,position:[a.x,a.y,a.z],distance:Math.hypot(a.x-s.actor('corpse').x,a.y-s.actor('corpse').y,a.z-s.actor('corpse').z)}))));
  assert.equal(s.actor('inside').hp,800000);assert.equal(event.heals[1].restoredHp,10000);
  for(const id of ['edge','outside','enemy'])assert.equal(s.actor(id).hp,200000,id);
  assert.equal(s.actor('dead-ally').hp,0);assert.equal(s.actor('corpse').hp,0);
  assert.equal(s.state.events.filter(e=>e.type==='guildHpRecovered'&&e.skillId===510).length,2);
});

test('JSON restore before death event reproduces production state and restore after event never heals twice',()=>{
  const s=make();kill(s);step(s,100);assert.equal(heroEvents(s).length,0);
  const restored=make();restored.restore(serialized(s));
  for(let i=0;i<180;i++){step(s);step(restored);assert.deepEqual(serialized(restored),serialized(s));}
  assert.equal(heroEvents(s).length,1);near(s.actor('ally').hp,320000);
  const afterEvent=make();afterEvent.restore(serialized(s));assert.equal(afterEvent.actor('corpse').guild.heroSacrificeFired,true);
  step(afterEvent,400);assert.equal(heroEvents(afterEvent).length,1);near(afterEvent.actor('ally').hp,320000);
});

test('explicit internal guild-disabled fixture follows the same death path without Hero heal',()=>{
  const s=make({guildPassives:[]});kill(s);step(s,480);
  assert.equal(heroEvents(s).length,0);assert.equal(s.actor('ally').hp,200000);
  assert.equal(s.actor('corpse').hp,0);assert.equal(s.actor('corpse').deathComplete,true);
});
