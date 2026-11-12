import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {ION_BLACK_HOLE_NAME,loadBlackHoleData,updateIonBlackHole,retireIonBlackHole,
  consumeBlackHoleDisplacement,hasEffectiveBlackHole,correctBlackHoleWall} from '../../packages/combat-core/black-hole.mjs';
import {skillInputBlockReason} from '../../packages/combat-core/skill-availability.mjs';
import {createNativeGeometry} from '../../packages/native-source/geometry.mjs';

const owner={id:'owner',team:0},enemy=(x=0,y=0,z=0)=>({id:'target',team:1,hp:800000,state:'RSI_WAIT',x,y,z,grounded:true,lineId:1});
const effect=(id=1,center=[0,0,0])=>({id,skillId:24007,name:ION_BLACK_HOLE_NAME,active:true,dead:false,
  damage:{BLACKHOLE_DATA:{DRAGGING_SPEED:500,DRAGGING_RANGE:750,CAN_PASS_UNIT:1}},currentAnchor:{position:center}});
const near=(actual,expected,epsilon=1e-4)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} expected ${expected}`);

test('target2016 Ion declarations: hidden .7 mesh, .8 custom spawn, 500 speed / 750 full-3D range, no hit prerequisite',()=>{
  const raw=profile.damageEffects[ION_BLACK_HOLE_NAME].raw;
  assert.deepEqual(raw.BLACKHOLE_DATA,{DRAGGING_SPEED:500,DRAGGING_RANGE:750,CAN_PASS_UNIT:1});
  assert.equal(raw.DAMAGE_DATA.REACT_TYPE,undefined);assert.equal(raw.DAMAGE_DATA.APPLIED_SKILL_ID,24007);
  const set=profile.effectSets.Effectset_SA_ROT_NUCLEAR_NEW_MEMO.raw;
  assert.equal(set.EVENT_TIMER_TYPE,1);assert.equal(set.EFFECT1.START_TIME,.8);assert.equal(set.EFFECT1.NAME,ION_BLACK_HOLE_NAME);
  assert.equal(set.EFFECT1.TRACE,undefined);assert.equal(set.EFFECT1.POSITION_OFFSET_X,270);
  const mesh=profile.effectTemplates.ROT_NUCLEAR_NEW_Missile_BLACK_HOLE.fields;
  assert.equal(mesh.LifeTime,.7);assert.equal(mesh.DrawCount,0);
});

test('loader uses literal table defaults and refuses nonfinite/zero range instead of guessing',()=>{
  assert.equal(loadBlackHoleData(null),null);
  assert.deepEqual(loadBlackHoleData({}),{speed:1,range:1,onlyHit:false,canPass:false});
  for(const bad of [{DRAGGING_RANGE:0},{DRAGGING_RANGE:Infinity},{DRAGGING_SPEED:NaN}])assert.equal(loadBlackHoleData(bad),null);
});

// Expectations are source equations with chosen analytic inputs, never a cast
// recorded from this executor or a target-client fidelity acceptance claim.
test('source distance/rate and closed 750 boundary operate on feet in three dimensions',()=>{
  for(const [point,expected] of [[[250,0,0],[-50,0,0]],[[750,0,0],[-25,0,0]],[[0,450,600],[0,-15,-20]]]){
    const a=enemy(...point);assert.equal(updateIonBlackHole(effect(),owner,[a],.1),true);
    a.blackHoleDisplacement.forEach((n,i)=>near(n,expected[i]));assert.equal(hasEffectiveBlackHole(a),true);
  }
  const outside=enemy(0,450,601);outside.effectiveBlackHoleIds=[1,2];
  updateIonBlackHole(effect(),owner,[outside],.1);assert.deepEqual(outside.effectiveBlackHoleIds,[2]);
});

test('queue overwrite, unit filters, mutable canPass and zero-distance identity follow the source branches',()=>{
  const a=enemy(250);a.invincible=true;a.superArmor=true;
  updateIonBlackHole(effect(1),owner,[a],.1);updateIonBlackHole(effect(2,[500,0,0]),owner,[a],.1);
  near(a.blackHoleDisplacement[0],50);assert.deepEqual(a.effectiveBlackHoleIds,[1,2]);assert.equal(a.sourceBlackHoleCanPass,true);
  for(const state of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_LANDING']){
    a.state=state;const queued=[...a.blackHoleDisplacement];updateIonBlackHole(effect(),owner,[a],.1);
    assert.deepEqual(a.blackHoleDisplacement,queued);assert.deepEqual(a.effectiveBlackHoleIds,[1,2]);
  }
  for(const b of [{...enemy(250),team:0},{...enemy(250),hp:0}]){
    updateIonBlackHole(effect(),owner,[b],.1);assert.equal(b.blackHoleDisplacement,undefined);
  }
  const zero=enemy();updateIonBlackHole(effect(),owner,[zero],.1);
  assert.deepEqual(zero.blackHoleDisplacement,[0,0,0]);assert.deepEqual(zero.effectiveBlackHoleIds,[1]);
  assert.equal(skillInputBlockReason(zero),'black-hole-held');
  const other=effect();other.skillId=24006;assert.equal(updateIonBlackHole(other,owner,[enemy()],.1),false);
});

test('only-hit flag requires the same effective identity; Ion itself has no such requirement',()=>{
  const e=effect(),a=enemy(250);e.damage.BLACKHOLE_DATA.DRAG_ONLY_HITTED_UNIT=1;
  updateIonBlackHole(e,owner,[a],.1);assert.equal(a.blackHoleDisplacement,undefined);
  a.effectiveBlackHoleIds=[1];updateIonBlackHole(e,owner,[a],.1);near(a.blackHoleDisplacement[0],-50);
});

test('next physics packet resets only future support and clears once, with <=81 squared pass restore',()=>{
  const a=enemy();a.blackHoleDisplacement=[3,0,0];a.sourceBlackHoleCanPass=true;a.vy=-999;a.state='RSI_WAIT';
  const result=consumeBlackHoleDisplacement(a,{CAN_PASS_UNIT:0});
  assert.deepEqual(result,{pending:true,apply:true,vector:[3,0,0]});assert.equal(a.grounded,false);assert.equal(a.lineId,null);
  assert.equal(a.vy,-999);assert.equal(a.state,'RSI_WAIT');assert.equal(a.sourceBlackHoleCanPass,false);
  assert.equal(consumeBlackHoleDisplacement(a,{}).pending,false);
  a.sourceBlackHoleCanPass=true;a.blackHoleDisplacement=[9.01,0,0];consumeBlackHoleDisplacement(a,{});assert.equal(a.sourceBlackHoleCanPass,true);
  a.blackHoleDisplacement=[9,0,0];consumeBlackHoleDisplacement(a,{CAN_PASS_UNIT:1});assert.equal(a.sourceBlackHoleCanPass,false,'enabled adaptive macro restores V5 future cache false, not raw state flag');
  const hidden={...enemy(),hidden:true,blackHoleDisplacement:[3,0,0]};
  assert.equal(consumeBlackHoleDisplacement(hidden,{}).apply,false);assert.deepEqual(hidden.blackHoleDisplacement,[0,0,0]);assert.equal(hidden.grounded,true);
});

test('effect destruction revokes only its identity and preserves a pending displacement',()=>{
  const a=enemy(250);updateIonBlackHole(effect(1),owner,[a],.1);updateIonBlackHole(effect(2),owner,[a],.1);
  const pending=[...a.blackHoleDisplacement];retireIonBlackHole(effect(1),[a]);
  assert.deepEqual(a.effectiveBlackHoleIds,[2]);assert.deepEqual(a.blackHoleDisplacement,pending);
  retireIonBlackHole(effect(2),[a]);assert.equal(hasEffectiveBlackHole(a),false);assert.deepEqual(a.blackHoleDisplacement,pending);
});

test('literal CrossedWall host loop delegates to compiled original 3D LineToLine and resets X/Z only',async()=>{
  const map={lines:[{lineId:0,type:'LINE_TYPE.LT_WALL',start:[5,-100,0],end:[5,100,0],nativeFields:{ENABLE:true}}]};
  const bytes=readFileSync(new URL('../../artifacts/native/geometry.wasm',import.meta.url));
  const geometry=await createNativeGeometry({bytes,map});
  const a={x:10,y:5,z:0};assert.deepEqual(correctBlackHoleWall(a,[0,0,0],map,geometry),{supported:true,blocked:true});
  assert.deepEqual(a,{x:0,y:5,z:0});
  const depth={x:10,y:5,z:10};assert.equal(correctBlackHoleWall(depth,[0,0,10],map,geometry).blocked,false);
});

test('real keyboard Ion creates a finite hidden suction independently of its zero REACT_TYPE damage',async()=>{
  const s=await make({skillId:24007,passives:[],positions:[[2022.98,2840,0],[1450,2840,0]]}),a=s.actor('rf'),b=s.actor('target');
  s.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
  assert.equal(a.skillId,24007);let queued=false,moved=false,blackHoleId=null,birthX=null;
  for(let i=0;i<240;i++){
    const beforeX=b.x;s.step(1/60,{}, {snapshot:false});
    const e=s.state.effects.find(e=>e.name===ION_BLACK_HOLE_NAME&&e.active);
    if(e){blackHoleId=e.id;birthX??=e.birthAnchor.position[0];assert.equal(e.hitCount,0);
      assert.deepEqual(e.currentAnchor.position,e.birthAnchor.position,'no hand TRACE after birth');
      if(b.effectiveBlackHoleIds.includes(e.id)){queued=true;assert.equal(s.skillAvailability('target','A').available,false);
        if(b.hitStop<=0&&b.worldStop<=0)assert.equal(s.skillAvailability('target','A').reason,'black-hole-held');}
    }
    if(queued&&b.x!==beforeX)moved=true;
  }
  assert.ok(queued);assert.ok(moved);assert.ok(Number.isFinite(birthX));assert.ok(blackHoleId);
  assert.ok(!b.effectiveBlackHoleIds.includes(blackHoleId));assert.ok(!s.state.effects.some(e=>e.name===ION_BLACK_HOLE_NAME));
  assert.ok(s.state.events.some(e=>e.type==='effectEnded'&&e.effectId===blackHoleId&&e.reason==='template-life-time'));
});

test('host consumes after push/pass, replaces one Y translation, keeps the normal next packet and does not sweep through source walls',async()=>{
  const s=await make({passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
  a.grounded=false;a.lineId=null;a.y=3000;a.vy=-100;a.skillDisableGravity=true;
  a.blackHoleDisplacement=[0,5,0];
  const def=profile.states.RSI_WAIT,keys={held:new Set(),pressed:new Set(),released:new Set()};
  s.integrate(a,.1,keys,def,0);near(a.y,3005);near(a.vy,-100);assert.deepEqual(a.blackHoleDisplacement,[0,0,0]);
  s.integrate(a,.1,keys,def,0);near(a.y,2995);
});

test('explicitly stopped effect revokes its identity even if its visual end event was already emitted',async()=>{
  const s=await make({skillId:24007,passives:[]}),a=s.actor('rf'),b=s.actor('target');
  const e=s.createEffect(a,{NAME:ION_BLACK_HOLE_NAME},{birthAnchor:{position:[b.x-200,b.y,b.z],facing:-1}});
  e.skillId=24007;s.tickEffects(1/60);assert.ok(b.effectiveBlackHoleIds.includes(e.id));
  const pending=[...b.blackHoleDisplacement];e.dead=true;e.endEmitted=true;s.tickEffects(1/60);
  assert.ok(!b.effectiveBlackHoleIds.includes(e.id));assert.deepEqual(b.blackHoleDisplacement,pending);
});

test('source LAND_CONNECT defaults true for WAIT/WALK before the queued support reset; no spurious fall velocity',async()=>{
  for(const state of ['RSI_WAIT','RSI_WALK']){
    assert.equal(profile.states[state].raw.LAND_CONNECT,undefined);
    const s=await make({passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
    s.enter(a,state,'source-default-test');a.vy=200;a.blackHoleDisplacement=[1,0,0];
    s.integrate(a,.1,{held:new Set(),pressed:new Set(),released:new Set()},profile.states[state],0);
    assert.equal(a.vy,0,'GUUser13657 default true; GUUser20104 zeroes vertical speed');
  }
});

test('D3DX queued-position addition rounds each axis to float32 before the original map query',async()=>{
  const s=await make({passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
  a.grounded=false;a.lineId=null;a.y=3000;a.vy=0;a.skillDisableGravity=true;
  const origin=[a.x,a.y,a.z],vector=[Math.fround(.1),Math.fround(.3),Math.fround(.125)];a.blackHoleDisplacement=[...vector];
  const geometry=s.nativeGeometry,queried=[];
  s.nativeGeometry={...geometry,support(options){queried.push([...options.position]);return geometry.support(options);}};
  s.integrate(a,.1,{held:new Set(),pressed:new Set(),released:new Set()},profile.states.RSI_WAIT,0);
  assert.deepEqual(queried[0],origin.map((n,i)=>Math.fround(Math.fround(n)+vector[i])));
});

test('live blackhole identity blocks actual skill and awakening consumers without spending MP or orbs',async()=>{
  const s=await make({skillId:24007,passives:[]}),a=s.actor('rf');
  a.effectiveBlackHoleIds=[991];a.awakening.orbs=3;const mp=a.mp;
  s.step(1/60,{pressed:['A','AWAKEN'],held:['A']},{snapshot:false});
  assert.equal(a.mp,mp);assert.equal(a.skillId,null);assert.equal(a.awakening.orbs,3);assert.equal(a.state,'RSI_WAIT');
  assert.equal(s.tryAwakening(a),false);assert.equal(s.skillAvailability('rf','A').reason,'black-hole-held');
  a.effectiveBlackHoleIds=[];assert.equal(s.tryAwakening(a),true);assert.equal(a.awakening.orbs,0);
});

test('time-stopped actors retain only the latest queue; identities and pending packet survive JSON restore',async()=>{
  const s=await make({skillId:24007,passives:[]}),b=s.actor('target');
  const e=s.createEffect(s.actor('rf'),{NAME:ION_BLACK_HOLE_NAME},{birthAnchor:{position:[b.x-200,b.y,b.z],facing:-1}});e.skillId=24007;
  b.hitStop=.2;s.tickEffects(1/60);const queued=[...b.blackHoleDisplacement],x=b.x;
  s.step(1/60,{}, {snapshot:false});near(b.x,x);assert.deepEqual(b.blackHoleDisplacement,queued);
  const other=await make({skillId:24007,passives:[]});other.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<120;i++){s.step(1/60,{}, {snapshot:false});other.step(1/60,{}, {snapshot:false});}
  assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(other.snapshot())));
});

test('pinned black-hole contract verifies acquired source bytes and exact original spans when present',()=>{
  const contract=JSON.parse(readFileSync(new URL('../../contracts/rf-black-hole-source-v13.json',import.meta.url)));
  assert.equal(contract.originalClientMeasurementCount,0);assert.equal(contract.hostRuntime,'js-fixed-V5-user-consumer-candidate');
  for(const file of contract.sourceFiles){
    const path=new URL('../../'+file.path,import.meta.url);if(!existsSync(path))continue;
    const data=readFileSync(path);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256);
    const lines=data.toString('latin1').split(/(?<=\n)/);
    for(const span of file.spans)assert.equal(createHash('sha256').update(Buffer.from(lines.slice(span.startLine-1,span.endLine).join(''),'latin1')).digest('hex'),span.sha256);
  }
});
