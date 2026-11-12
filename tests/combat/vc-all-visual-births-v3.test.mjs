/** Network adapter regression over real source-driven inputs. This compares
 * local and remote simulation births, not an original-client movie/trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {isFiniteVisualBirth} from '../../packages/combat-core/finite-visual-birth.mjs';
import {validateOwnedState,validateOwnedReferences,MAX_OWNER_BYTES} from '../../packages/online/owned-state.mjs';
const heatSkills=new Set([24034,24020,24021,24024]);
for(const skill of vcProfile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900))for(const heat of heatSkills.has(skill.skillId)?[false,true]:[false])
test(`VC ${skill.skillId}${heat?' overheat':''} delivers each finite visual birth once within owner limits`,t=>{
  const source=vcFixture({skillId:skill.skillId,gap:2500}),target=vcFixture({skillId:skill.skillId,gap:2500});
  source.sim.networkOwnerId='vc';target.sim.networkOwnerId='target';
  if(skill.skillId===24031){source.a.y+=450;source.a.grounded=false;source.a.lineId=null;source.sim.enter(source.a,'RSI_JUMP_DOWN','air-skill-fixture');}
  const sync=createLocalOwnershipSync(),consumer=createRemoteActionConsumer({clock:()=>1}),local=new Map(),remote=new Map();let started=false,maxBytes=0,maxEffects=0;
  const count=(map,events)=>{for(const e of events){const birth=map===local?e.visualBirth:e;
    if(e.type==='effectStarted'&&birth&&isFiniteVisualBirth(vcProfile,birth))map.set(e.name,(map.get(e.name)??0)+1);}};
  for(let frame=0;frame<780;frame++){
    sync.beforeStep(source.sim,'vc');source.sim.step(1/60,{vc:{pressed:frame===0||heat&&frame<190&&frame%2===0?['A']:[]}},{snapshot:false});
    if(skill.skillId===24021)for(const effect of source.sim.state.effects)
      if(effect.setName==='EffectSet_Raven_Giga_Prominence_Flame'&&!effect.active)
        assert.ok(effect.setElapsed<.22,'source absolute START_TIME must not strand old .24 Giga sets after LOOP restarts');
    const events=source.sim.drainEvents();started ||= events.some(e=>e.type==='skillStarted');count(local,events);
    const report=sync.afterStep(source.sim,'vc',events);if(!report)continue;
    report.actions=report.actions.map(({ageFrames,...a})=>({...a,frameSeq:report.frameSeq-ageFrames}));
    validateOwnedState(report);validateOwnedReferences(report,target.a,vcProfile,target.map);
    const bytes=Buffer.byteLength(JSON.stringify(report));maxBytes=Math.max(maxBytes,bytes);assert.ok(bytes<=MAX_OWNER_BYTES,`${skill.skillId} owner packet ${bytes} bytes`);
    for(const action of report.actions)maxEffects=Math.max(maxEffects,action.effects.length);
    consumer.receive('vc',report.actions,report.epoch,report.frameSeq);consumer.consume(target.sim,'target',()=>0);count(remote,target.sim.drainEvents());
  }
  assert.ok(started,'real input enters the original skill');assert.deepEqual([...remote].sort(),[...local].sort(),'every accepted local finite birth reaches the receiver exactly once');
  assert.ok(maxEffects<=96);assert.ok(maxBytes>0);assert.equal(target.sim.state.effects.length,0,'historical visuals leave no live combat state');consumer.clear();
  t.diagnostic(`max owner bytes=${maxBytes}, max action effects=${maxEffects}, finite births=${[...local.values()].reduce((a,b)=>a+b,0)}`);
});
