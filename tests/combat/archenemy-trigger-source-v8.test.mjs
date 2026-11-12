import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArc} from '../helpers/archenemy-v17-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {canTriggerArchenemy} from '../../packages/combat-core/nasod-attack.mjs';

const json=value=>JSON.parse(JSON.stringify(value));
const count=s=>s.actor('rf').sourceArcEnemy?.data.length??0;
const releases=s=>s.state.events.filter(e=>e.type==='sound'&&e.field==='original-arc-release');
const spearHits=s=>s.state.events.filter(e=>e.type==='hit'&&e.origin.skillId===24008);

// These tests execute sampled keyboard levels, the sealed production native
// callbacks, original character/effect poses and native Garpai geometry. The
// forwarding observers below record accepted collisions without changing them.
// The three target2016 weapon-dummy positives are bounded adapter regressions;
// they are not proof that all target2016 effect consumers match the V5 source.
function observe(s){
  const contacts=[],states=[];
  let winningShape;
  const hitPoint=s.hitPoint.bind(s);
  s.hitPoint=(shape,defender)=>{
    const point=hitPoint(shape,defender);
    if(point)winningShape=json(shape.source??{});
    return point;
  };
  const accepted=s.acceptedSkillHit.bind(s);
  s.acceptedSkillHit=(actor,defender,data,origin,impactPoint)=>{
    const effect=origin.kind==='effect'?s.state.effects.find(e=>e.id===origin.id):null;
    const contact={time:s.state.time,state:actor.state,animationTime:actor.animationTime,
      origin:json(origin),data:json(data),helper:winningShape,
      effect:effect?{name:effect.name,setName:effect.setName,mainEffectName:effect.mainEffectName,
        traceMore:effect.definition?.TRACE_MORE,skillId:effect.skillId}:null,
      targetHeight:defender.y-defender.landPosition[1],before:count(s)};
    const result=accepted(actor,defender,data,origin,impactPoint);
    contact.after=count(s);contacts.push(contact);
    return result;
  };
  return {contacts,states};
}

function keyboardFrames(s,observed,{facing=1,action=null,targetAir=false,start=1,end=360}={}){
  const forward=facing===1?'RIGHT':'LEFT';
  const rf=createInputBuffer({sampledLevels:true}),target=createInputBuffer({sampledLevels:true});
  const schedule=new Map([[1,[[rf,'down','A']]],[3,[[rf,'up','A']]]]);
  if(action){
    if(action==='66Z'||action==='668X'){
      schedule.set(191,[[rf,'down',forward]]);
      schedule.set(192,[[rf,'up',forward]]);
      schedule.set(193,[[rf,'down',forward]]);
      schedule.set(202,[[rf,'up',forward]]);
    }
    if(action==='668X'){
      schedule.set(195,[[rf,'down','UP'],...(targetAir?[[target,'down','UP']]:[])]);
      schedule.set(197,[[rf,'up','UP'],...(targetAir?[[target,'up','UP']]:[])]);
    }
    const key=typeof action==='number'?'S':action==='66Z'?'Z':action==='668X'?'X':action;
    schedule.set(199,[[rf,'down',key]]);
    schedule.set(201,[[rf,'up',key]]);
  }
  for(let frame=start;frame<=end;frame++){
    for(const [device,op,key] of schedule.get(frame)??[])device[op](key,(frame-.5)/60);
    s.step(1/60,{rf:rf.consume(frame/60),target:target.consume(frame/60)},{snapshot:false});
    observed.states.push({frame,rf:s.actor('rf').state,target:s.actor('target').state});
    if(frame===180){
      assert.equal(count(s),4,'the actual native cast creates four waiting spears before the trigger input');
      assert.equal(releases(s).length,0);
      assert.equal(s.state.events.filter(e=>e.type==='effectStarted'&&e.sourceArcStartMesh).length,4);
    }
  }
}

async function run({facing=1,action,targetAir=false,end=360,randomSample}={}){
  const s=await makeArc(facing);
  if(randomSample!==undefined)s.rng=()=>randomSample;
  if(typeof action==='number')s.configureLoadout([{skillId:24008},{skillId:action},null,null,null,null,null,null],'rf');
  const observed=observe(s);
  keyboardFrames(s,observed,{facing,action,targetAir,end});
  return {s,...observed};
}

function assertDashJumpEffectOnly(result,{targetAir=false}={}){
  const {s,contacts,states}=result;
  assert.ok(states.some(row=>row.rf==='RSI_DASH'),'two forward presses reach the native dash');
  assert.ok(states.some(row=>row.rf==='RSI_DASH_JUMP'),'UP reaches the native dash jump');
  assert.ok(states.some(row=>row.rf==='RRF_DASH_JUMP_COMBO_X'),'X reaches the native 668X state');
  if(targetAir)assert.ok(states.some(row=>row.target==='RSI_JUMP_UP'),'the defender jumps through its own sampled UP input');
  const hits=contacts.filter(c=>c.effect?.name==='RRF_DASH_JUMP_X');
  assert.ok(hits.length>=2,'the negative has repeated accepted native collisions, not a missed attack');
  for(const hit of hits){
    assert.equal(hit.origin.kind,'effect');
    assert.equal(hit.origin.skillId,null);
    assert.equal(hit.effect.mainEffectName,'RRF_DASHJUMP_X');
    assert.equal(hit.helper.helper,'ATTACK_SPHERE1');
    assert.equal(hit.data.ATTACK_TYPE,2);
    assert.equal(hit.data.DAMAGE.MAGIC,.66);
    assert.equal(hit.before,4);assert.equal(hit.after,4);
  }
  if(targetAir)assert.ok(hits.some(hit=>hit.targetHeight>0),'the effect really contacts the airborne defender');
  assert.ok(hits.some(hit=>hit.state!=='RRF_DASH_JUMP_COMBO_X'),'flight continues after the owner leaves the birth state');
  const acceptedIds=new Set(hits.map(hit=>hit.origin.id));
  assert.ok(s.state.events.some(e=>e.type==='hit'&&acceptedIds.has(e.origin.id)&&e.amount>0),'real damage is applied');
  assert.equal(count(s),4);
  assert.equal(releases(s).length,0);
  assert.equal(spearHits(s).length,0);
}

for(const facing of [-1,1])for(const targetAir of [false,true])
test(`sampled 668X ${facing}/${targetAir?'air':'ground'} hits with original sphere but never releases Archenemy`,async()=>{
  assertDashJumpEffectOnly(await run({facing,action:'668X',targetAir}),{targetAir});
});

for(const facing of [-1,1])for(const [action,state,name,setName] of [
  ['Z','RSI_COMBO_Z','DamageEffect_RF_COMBO_Z','EffectSet_RF_COMBO_Z'],
  ['X','RSI_COMBO_X','DamageEffect_RF_COMBO_X','EffectSet_RF_COMBO_X'],
  ['66Z','RSI_DASH_COMBO_Z','DamageEffect_RF_DASH_COMBO_Z','EffectSet_RF_DASH_COMBO_Z'],
])test(`sampled body melee ${action} ${facing} retains the exact target weapon-dummy compatibility path`,async()=>{
  const {s,contacts,states}=await run({facing,action});
  assert.ok(states.some(row=>row.rf===state));
  const melee=contacts.filter(hit=>hit.effect?.name===name);
  assert.equal(melee.length,1);
  assert.equal(melee[0].origin.kind,'effect');assert.equal(melee[0].origin.skillId,null);
  assert.equal(melee[0].effect.setName,setName);
  assert.equal(melee[0].effect.mainEffectName,'Raven_WeaponDummy01');assert.equal(melee[0].effect.traceMore,1);
  assert.equal(melee[0].helper.helper,'ATTACK_SPHERE1');
  assert.equal(melee[0].before,4);assert.equal(melee[0].after,3);
  assert.equal(count(s),3);assert.equal(releases(s).length,1);
  assert.ok(spearHits(s).some(hit=>hit.amount>0),'the released native spear actually hits');
});

for(const facing of [-1,1])test(`sampled Weapon Crash ${facing} is an effect hit and keeps all waiting spears`,async()=>{
  const {s,contacts,states}=await run({facing,action:24204});
  assert.ok(states.some(row=>row.rf==='RSI_A_ROT_WEAPON_BREAK'));
  const hits=contacts.filter(hit=>hit.origin.skillId===24204);
  assert.ok(hits.length>0,'the active actually hits');
  for(const hit of hits){
    assert.equal(hit.origin.kind,'effect');assert.equal(hit.effect.name,'DamageEffect_Raven_Weapon_Break');
    assert.equal(hit.helper.helper,'ATTACK_SPHERE1');assert.equal(hit.data.DAMAGE.MAGIC,7.77);
    assert.equal(hit.before,4);assert.equal(hit.after,4);
  }
  assert.ok(s.state.events.some(e=>e.type==='hit'&&e.origin.skillId===24204&&e.amount>0));
  assert.equal(count(s),4);assert.equal(releases(s).length,0);assert.equal(spearHits(s).length,0);
});

for(const facing of [-1,1])test(`sampled Mega Drill ${facing} retains original unit melee and the native release cooldown`,async()=>{
  const {s,contacts}=await run({facing,action:24203});
  const melee=contacts.filter(hit=>hit.origin.skillId===24203);
  assert.ok(melee.some(hit=>hit.data.DAMAGE.PHYSIC===1.26),'original early physical unit attack really hits');
  assert.ok(melee.some(hit=>hit.data.DAMAGE.MAGIC===2.92),'original later magic unit attack really hits');
  assert.ok(melee.every(hit=>hit.origin.kind==='character'&&hit.state==='RSI_A_RF_MEGADRILL_BREAK'));
  const released=melee.filter(hit=>hit.after<hit.before);
  assert.equal(released.length,3);assert.equal(count(s),1);assert.equal(releases(s).length,3);
  for(const event of releases(s))assert.ok(released.some(hit=>hit.time===event.time),'each release comes from accepted unit melee');
  for(let i=1;i<released.length;i++)assert.ok(released[i].time-released[i-1].time>=.3,'unchanged native .3s cooldown');
  assert.ok(spearHits(s).some(hit=>hit.amount>0));
});

for(const facing of [-1,1])test(`sampled Hell Dive ${facing} excludes real projectile/derived explosion hits then accepts body melee`,async()=>{
  // Isolate the source-routing assertion from unrelated guild rolls. The
  // explicit Web harness sample .05 is inside24402's original .10 gate; this
  // is neither an original seed trajectory nor a probability-distribution test.
  const {s,contacts}=await run({facing,action:24219,randomSample:.05});
  for(const name of ['DAMAGE_EFFECT_RRF_HELL_DIVE_FIRST_PUNCH','DAMAGE_EFFECT_RRF_HELL_DIVE_SECOND_PUNCH',
    'DamageEffect_RRF_ExplosiveHand_Impact_NEW']){
    const hits=contacts.filter(hit=>hit.effect?.name===name);
    assert.ok(hits.length>0,`${name} has an actual accepted collision`);
    // A derived explosion can arrive after the unit hit has released a spear.
    // The source callback boundary forbids this effect consuming another one;
    // it does not require the pre-unit-hit waiting count at every later hit.
    assert.ok(hits.every(hit=>hit.origin.kind==='effect'&&hit.before===hit.after),
      'each projectile/derived explosion retains the waiting count at its own collision');
  }
  const body=contacts.filter(hit=>hit.origin.skillId===24219&&hit.origin.kind==='character');
  assert.equal(body.length,1);assert.equal(body[0].state,'RSI_A_RRF_HELL_DIVE_UPGRADE');
  assert.equal(body[0].data.DAMAGE.MAGIC,2.84);assert.equal(body[0].before,4);assert.equal(body[0].after,3);
  assert.equal(releases(s).length,1);assert.equal(releases(s)[0].time,body[0].time);assert.equal(count(s),3);
  assert.ok(spearHits(s).some(hit=>hit.amount>0));
});

for(const facing of [-1,1])test(`JSON restored waiting Archenemy ${facing} repeats actual 668X collisions without release`,async()=>{
  const original=await makeArc(facing),first=observe(original);
  keyboardFrames(original,first,{facing,end:180});
  const restored=await makeArc(facing);restored.restore(json(original.snapshot()));
  const second=observe(restored);
  keyboardFrames(original,first,{facing,action:'668X',start:181});
  keyboardFrames(restored,second,{facing,action:'668X',start:181});
  assertDashJumpEffectOnly({s:original,...first});assertDashJumpEffectOnly({s:restored,...second});
  assert.deepEqual(second.contacts,first.contacts);
  assert.deepEqual(json(restored.snapshot()),json(original.snapshot()));
});

for(const [reactType,name] of [[0,'RT_NO_DAMAGE'],[7,'RT_DUMMY_DAMAGE'],[10,'RT_SENSOR']])
test(`source boundary injection ${name}: actual native unit collision cannot release Archenemy`,async()=>{
  const s=await makeArc();
  s.configureLoadout([{skillId:24008},{skillId:24203},null,null,null,null,null,null],'rf');
  // Simulation owns a cloned profile. This intentionally changes only the
  // reaction type of its real Mega Drill collision, not native commands,
  // poses, attack windows, damage values or map. It checks source callback
  // exclusions; it is not a recording of a target2016 skill with this type.
  const raw=s.profile.states.RSI_A_RF_MEGADRILL_BREAK.raw;
  raw.DAMAGE_DATA.REACT_TYPE=reactType;raw.DAMAGE_DATA_NEXT.REACT_TYPE=reactType;
  assert.equal(canTriggerArchenemy(raw.DAMAGE_DATA,{kind:'character',skillId:24203}),false);
  const observed=observe(s);keyboardFrames(s,observed,{action:24203});
  const contacts=observed.contacts.filter(hit=>hit.origin.skillId===24203);
  assert.ok(contacts.length>0,'the unchanged native attack shape really collides');
  assert.ok(contacts.every(hit=>hit.origin.kind==='character'&&hit.data.REACT_TYPE===reactType));
  assert.ok(contacts.every(hit=>hit.before===4&&hit.after===4),'the actual acceptedSkillHit path retains four spears');
  assert.ok(s.state.events.some(e=>e.type==='hit'&&e.origin.kind==='character'&&e.origin.skillId===24203&&e.data.REACT_TYPE===reactType));
  assert.equal(count(s),4);assert.equal(releases(s).length,0);assert.equal(spearHits(s).length,0);
});
