import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile} from '../helpers/rf-passive-fixture-v12.mjs';
const tick=(s,input={})=>s.step(1/60,input,{snapshot:false});

test('production XCrash invokes the original burst once, follows four target diagonal bones and expires with original play-count mesh',async()=>{
  for(const facing of [-1,1])for(const hyper of [false,true]){
    const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');a.facing=facing;
    if(hyper)a.awakening.remaining=20;
    s.drainEvents();tick(s,{pressed:['A'],held:['A']});
    const events=[];let observed=false,creationStep,particleStep;
    for(let i=0;i<180;i++){
      tick(s);const packet=s.drainEvents();events.push(...packet);
      if(packet.some(e=>e.type==='originalSkillCommand'&&/^RRF_X_CRASH_NODAMAGE/.test(e.name)))creationStep=s.state.step;
      if(packet.some(e=>e.type==='effectTimedParticles'&&/^RRF_X_CRASH_NODAMAGE/.test(e.name)))particleStep=s.state.step;
      const e=s.state.effects.find(e=>/^RRF_X_CRASH_NODAMAGE/.test(e.name));
      if(creationStep===s.state.step)assert.equal(e.animationTime,Math.fround(.0001),'new Now mesh retains only original CreateInstance initialization');
      if(e&&e.animationTime>.24&&e.animationTime<.29){
        const points=['Dummy01_EX','Dummy02_EX','Dummy03_EX','Dummy04_EX'].map(b=>s.effectBoneSampler(e,a,b));
        const center=s.effectBoneSampler(e,a,'Dummy01_EX_C');assert.ok(points.every(Boolean));
        // Actual 2016 animation has four corner trajectories; no circle/glow substitute.
        const offsets=points.map(p=>p.map((n,i)=>n-center[i]));
        assert.equal(new Set(offsets.map(p=>`${Math.sign(p[0])},${Math.sign(p[1])}`)).size,4);
        assert.ok(offsets.every(p=>Math.abs(Math.abs(p[0])-Math.abs(p[1]))<8));observed=true;
      }
    }
    const expectedName=hyper?'RRF_X_CRASH_NODAMAGE_HYPER':'RRF_X_CRASH_NODAMAGE';
    const command=events.filter(e=>e.type==='originalSkillCommand'&&e.name===expectedName);assert.equal(command.length,1);
    assert.deepEqual(command[0].position,a.sourceXCrash.savedPosition);
    const particles=events.filter(e=>e.type==='effectTimedParticles'&&e.name===expectedName).flatMap(e=>e.entries);
    assert.equal(particles.length,12);assert.equal(new Set(particles.map(e=>e.entry.BONE_NAME)).size,4);
    assert.equal(particleStep-creationStep,2,'.03 skin threshold follows two subsequent60Hz mesh phases');
    assert.ok(particles.every(e=>e.entry.TRACE===1&&e.entry.APPLY_ROTATE===0&&e.entry.EVENT_TIME===.03));
    assert.ok(observed);assert.equal(events.filter(e=>e.type==='effectEnded'&&e.name===expectedName).length,1);
    assert.ok(!s.state.effects.some(e=>e.name===expectedName));
    assert.equal(profile.effectTemplates.Raven_RRF_SI_SA_X_Crash_Mesh03.fields.PlayCount,1);
  }
});

test('XCrash captured-position and pending mesh-end survive full JSON restoration without a second burst',async()=>{
  const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});
  tick(s,{pressed:['A'],held:['A']});
  for(let i=0;i<85;i++)tick(s);
  const frozen=JSON.parse(JSON.stringify(s.snapshot())),fresh=await make({skillId:24010,passives:[]});fresh.restore(frozen);
  s.restore(frozen);s.drainEvents();fresh.drainEvents();
  for(let i=0;i<120;i++){tick(s);tick(fresh);assert.deepEqual(JSON.parse(JSON.stringify(s.snapshot())),JSON.parse(JSON.stringify(fresh.snapshot())));}
});

test('XCrash keeps the registered Hyper skill state when awakening expires during the cast',async()=>{
 const s=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]}),a=s.actor('rf');
 a.awakening.remaining=.1;tick(s,{pressed:['A'],held:['A']});
 assert.equal(a.skillContext.hyperState,true);s.drainEvents();const events=[];
 for(let i=0;i<180;i++){tick(s);events.push(...s.drainEvents());}
 assert.equal(a.awakening.remaining,0);
 assert.equal(events.filter(e=>e.type==='originalSkillCommand'&&e.name==='RRF_X_CRASH_NODAMAGE_HYPER').length,1);
 assert.equal(events.filter(e=>e.type==='originalSkillCommand'&&e.name==='RRF_X_CRASH_NODAMAGE').length,0);
});
