/** Current production trajectories; source expectations are independently
 * sealed in source-sound-routes-native-v45, not original-client recordings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
const events=s=>s.state.events.filter(e=>e.type==='sound');
function spatial(e,point,source='unit'){
 assert.ok(e,'the actual production path emitted its sound');assert.equal(e.native3D,true);
 assert.equal(e.onlyIfLocal,false);assert.deepEqual(e.sourcePosition,point);assert.equal(e.soundPositionSource,source);
 assert.deepEqual(e.soundDistance,{min:80,max:4800,curve:'linear',listener:'camera-eye',units:'source-world'});
}

test('accepted hit and native critical use the defender world position, separate from attacker and core ball',async()=>{
 const s=await make({passives:[],targetPassives:[]}),a=s.actor('rf'),b=s.actor('target');
 b.z=37;a.stats.criticalRate=1;s.rng=()=>0;s.drainEvents();
 const point=[b.x,b.y,b.z],result=s.applyHit(a,b,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.5},HIT_TYPE:1,REACT_TYPE:1},{kind:'character'});
 assert.equal(result.accepted,true);
 spatial(events(s).find(e=>e.field==='original-damage-hit'),point);
 spatial(events(s).find(e=>e.field==='original-critical'),point);
 assert.notDeepEqual(point,[a.x,a.y,a.z]);b.x+=100;
 assert.deepEqual(events(s).find(e=>e.field==='original-damage-hit').sourcePosition,point,'the emitted position is a value snapshot');
});

test('actual native Nasod parry and guard sounds use defender, not the displaced guard helper',async()=>{
 const s=await make({passives:[],targetPassives:[]}),a=s.actor('rf'),b=s.actor('target');
 b.awakening.remaining=10;b.core.gauge=40;s.updateCoreLevel(b);s.canGuard=()=>true;s.drainEvents();
 const point=[b.x,b.y,b.z];assert.equal(s.applyHit(a,b,{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.5},HIT_TYPE:1,REACT_TYPE:1},{kind:'character'}).accepted,true);
 for(const name of ['Raven_NasodCore_Trans_Parry.ogg','Raven_NasodCore_Guard.ogg'])spatial(events(s).find(e=>e.name===name),point);
 assert.notDeepEqual([b.core.x,b.core.y,b.core.z],point);
});

test('native core growth, preparation, launch and aura disappearance use their owner even while its ball flies elsewhere',async()=>{
 const s=await make({passives:[]}),a=s.actor('rf'),b=s.actor('target');s.drainEvents();
 a.awakening.remaining=10;a.core.gauge=40;const point=[a.x,a.y,a.z];s.updateCoreLevel(a);
 spatial(events(s).find(e=>e.name==='Raven_NasodCore_Appear.ogg'),point);
 s.coreOnHit(a,b,{DAMAGE:{PHYSIC:1},ATTACK_TYPE:1,ATTACK_TRIGGER_TYPE:1});
 spatial(events(s).find(e=>e.name==='Raven_NasodCore_Trans_Attack.ogg'),point);
 s.tickCore(a,.31);spatial(events(s).find(e=>e.name==='Raven_NasodCore_Attack.ogg'),point);
 assert.notDeepEqual([a.core.x,a.core.y,a.core.z],point);
 a.awakening.full=true;s.spawnSet(a,'EffectSet_RAVEN_HYPER_AURA',1,[]);s.expireAwakening(a);
 spatial(events(s).find(e=>e.name==='Raven_ElectricAura_Disappear.ogg'),point);
});

test('original spine SOUND0 emits from the independent effect main mesh and retains one-shot clock consumption',async()=>{
 const s=await make({passives:[],positions:[[2022.98,2840,0],[-5000,2840,0]]}),a=s.actor('rf');s.drainEvents();
 const point=[1777,2900,35],e=s.createEffect(a,{NAME:'DamageEffect_RSI_OVER_TAKER_BIG_SPINE'},
  {birthAnchor:{position:[...point],facing:a.facing}});
 frames(s,1);const sound=events(s).find(event=>event.effectId===e.id&&event.field==='SOUND0');
 spatial(sound,point,'effect-main-mesh');assert.notDeepEqual(sound.sourcePosition,[a.x,a.y,a.z]);
 a.x+=100;frames(s,10);assert.equal(events(s).filter(event=>event.effectId===e.id&&event.field==='SOUND0').length,1);
 assert.deepEqual(sound.sourcePosition,point);
});

test('original jump-platform launch cue carries the triggering character world XYZ',()=>{
 const map={lines:[{lineId:8,start:[-1400,2000,0],end:[1400,2000,0],type:'LINE_TYPE.LT_JUMP_UP_REL',
  beforeLine:-1,nextLine:-1,nativeFields:{CAN_DOWN:{$symbol:'FALSE'},JUMP_SPEED_X:1500,JUMP_SPEED_Y:3800,JUMP_REL_UP_KEYSTOP_TIME:.1}}]};
 const s=createSimulation({profile,map,actors:[{id:'rf',team:0,position:[100,2001,0],lineId:8}]});
 s.step(1/60,{}, {snapshot:false});assert.equal(s.actor('rf').pendingPlatformJump.lineId,8);
 spatial(events(s).find(e=>e.name==='HighJump.ogg'),[100,2000,0]);
});
