/** Independent target-declaration / existing host-adapter regressions.
 * These are current simulation tests, not original-client motion traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {elesisEnd,elesisEvents} from '../../packages/combat-core/elesis-skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/gm-profile.json',import.meta.url)));
const native=JSON.parse(readFileSync(new URL('../../contracts/elesis-native-consumers-v37.json',import.meta.url)));
const empty=()=>Array(8).fill(null);
const jump='ESI_SI_A_EL_LEAP_CRASH_JUMP';
function fixture(facing=1){
  const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-20000,0,0],end:[20000,0,0]}]},
    preset:{passives:[],guildPassives:[],loadout:empty()},
    actors:[{id:'gm',professionId:'GM',team:0,x:0,y:0,lineId:0,facing,loadout:empty(),passives:[],guildPassives:[]}]});
  const a=sim.actor('gm');a.mp=a.mpMax;return {sim,a};
}
for(const facing of [-1,1])for(const dash of [false,true])test(`GM Leap ${facing} dash=${dash} uses recovered2016 launch until landing`,()=>{
  const {sim,a}=fixture(facing);a.skillId=28204;
  a.sourceElesisSkills={charge:0,loopTime:0,loops:0,hit:false,dodges:0,rushes:0,mpPaid:40,stigmaCooldown:0,chivalryTime:0,dashAccumulator:dash?1/60:0};
  sim.enter(a,jump,'independent-leap-friction-regression');
  // v45 recovered the registered2016 callback327ee790. It supersedes v37's
  // explicitly unverified WALK/RUN + full ordinary jump adapter.
  const speed=dash?2700:2200;
  assert.equal(profile.physics.RELOAD_ACCEL,2000);
  assert.equal(a.passiveSpeed.x,-1);assert.equal(a.vx,speed*facing);assert.equal(a.vy,1000);
  let lateX=null,landed=false;
  for(let i=0;i<100;i++){
    sim.step(1/60,{gm:{}},{snapshot:false});
    if(i===24)lateX=a.x;
    if(a.state==='ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING'){
      landed=true;assert.equal(a.passiveSpeed.x,-1,'CommonStateStart releases the temporary control');break;
    }
  }
  assert.ok(landed,'lands through the original skill phase');
  assert.ok((a.x-lateX)*facing>30,'forward travel continues after the old impulse friction expiry');
  assert.equal(profile.states[jump].raw.SPEED_TIME0['1'],0,'raw speed factor remains untouched');
});
for(const next of ['RSI_WAIT','RSI_DAMAGE_DOWN_FRONT'])test(`GM Drastic Charge releases retired visual handles on ${next}`,()=>{
  const {sim,a}=fixture();a.state='ESI_A_SGM_DRASTIC_CHARGE_LOOP';
  a.sourceElesisSkills={charge:0,loopTime:0,loops:0,hit:false,dodges:0,rushes:0,mpPaid:0,stigmaCooldown:0,chivalryTime:0,
    drasticEffects:[120,121]};
  // Handle120 has already retired from combat, while121 is still live.
  const live={id:121,name:'A_SGM_DRASTIC_CHARGE_LOOP_P04',setName:'EffectSet_A_SGM_DRASTIC_CHARGE_LOOP'};
  sim.state.effects=[live];sim.drainEvents();elesisEnd(sim,a,next);
  const ends=sim.drainEvents().filter(e=>e.type==='effectEnded');
  assert.deepEqual(ends.map(e=>e.effectId),[120,121]);assert.equal(live.dead,true);assert.equal(live.endEmitted,true);
  assert.deepEqual(a.sourceElesisSkills.drasticEffects,[]);
  elesisEnd(sim,a,next);assert.equal(sim.drainEvents().filter(e=>e.type==='effectEnded').length,0,'cleanup is idempotent');
});
test('GM Drastic Charge keeps both handles across its original loop and end phases',()=>{
  const {sim,a}=fixture();a.sourceElesisSkills={charge:0,loopTime:0,loops:0,hit:false,dodges:0,rushes:0,mpPaid:0,stigmaCooldown:0,chivalryTime:0,drasticEffects:[120,121]};
  sim.drainEvents();for(const next of ['ESI_A_SGM_DRASTIC_CHARGE_LOOP','ESI_A_SGM_DRASTIC_CHARGE_END'])elesisEnd(sim,a,next);
  assert.deepEqual(a.sourceElesisSkills.drasticEffects,[120,121]);assert.equal(sim.drainEvents().filter(e=>e.type==='effectEnded').length,0);
});
test('Wild Shock original native .55 callback is separate from the primary visual .93 cue',()=>{
  const calls=[],a={id:'gm',state:'ESI_SI_SA_EL_WILD_SHOCK',wayOfSword:{state:0}};
  const sim={profileFor:()=>profile,fire:(owner,key,time,before,after,callback)=>{calls.push({time});if(before<time&&after>=time)callback();},spawnSet:(owner,name)=>calls.push({name})};
  elesisEvents(sim,a,.54,.56);
  assert.equal(profile.effectSets.EffectSet_SA_EL_WILD_SHOCK.raw.EFFECT8.START_TIME,.93);
  assert.equal(calls[0].time,.55);
  assert.equal(native.source.sha256,'b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba');
  assert.equal(native.wildShock.time.hex,'cdcc0c3f');
  assert.equal(Buffer.from(native.wildShock.time.hex,'hex').readFloatLE(),Math.fround(.55));
  assert.deepEqual(calls.filter(c=>c.name).map(c=>c.name),['EffectSet_SA_EL_WILD_SHOCK_DAMAGE','EffectSet_SA_EL_WILD_SHOCK_DAMAGE_Sub']);
});
for(const swordState of [0,-2])test(`Wild Shock original native state ${swordState} selects exactly its original two roots at .55`,()=>{
  const emitted=[],a={id:'gm',state:'ESI_SI_SA_EL_WILD_SHOCK',wayOfSword:{state:swordState}};
  const sim={profileFor:()=>profile,fire:(owner,key,time,before,after,callback)=>{if(before<time&&after>=time)callback();},spawnSet:(owner,name)=>emitted.push(name)};
  elesisEvents(sim,a,.1,.54);assert.deepEqual(emitted,[]);
  elesisEvents(sim,a,.54,.56);
  const original=native.wildShock.sets.map(s=>s.value).filter(name=>name.endsWith('_MEMO')===(swordState===-2));
  assert.deepEqual(emitted,original);
});
