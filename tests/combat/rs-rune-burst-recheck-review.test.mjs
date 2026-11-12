import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import source from '../../contracts/rs-feedback-review-source.json' with {type:'json'};
import {observe} from '../../tools/combat/audit-rs-rune-burst-recheck-review.mjs';
import {fixture,cast,steps,profile} from '../helpers/rs-fixture.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
test('Splash independent direct set consumer has default animation timing and the user-corrected identity',()=>{
  assert.equal(source.target.splashSkill.args[1].m_eID,21018);
  assert.equal(source.target.splashIdentity.originalName,'Splash Explosive');
  assert.equal(source.target.splashSet.args[1].EVENT_TIMER_TYPE,undefined);
  const ref=source.references.find(r=>r.path.endsWith('X2EffectSet.cpp')),text=readFileSync(ref.cachePath,'latin1');
  assert.match(text,/"EVENT_TIMER_TYPE"[^\n]*ESTT_ANIM/);
  assert.match(text,/m_bUseAnimationTiming\( true \)/);
  const sword=readFileSync(source.references.find(r=>r.path.endsWith('X2GUElsword_SwordMan.cpp')).cachePath,'latin1');
  const start=sword.slice(sword.indexOf('void CX2GUElsword_SwordMan::ESSI_SA_ERS_SPLASH_EXPLOSION_StateStart()'),sword.indexOf('void CX2GUElsword_SwordMan::ESSI_SA_ERS_SPLASH_EXPLOSION_FrameMove()'));
  assert.match(start,/PlayEffectSet\( L"EffectSet_ELSWORD_SPLASH_EXPLOSION"/);assert.doesNotMatch(start,/SetUseAnimationTiming/);
});
for(const facing of [-1,1])for(const awake of [false,true])for(const speed of [1,1.25,1.8])
  test(`Splash declared animation birth and independent global mesh life ${facing}/${awake}/${speed}`,()=>{
    const row=observe({facing,awake,speed});assert.equal(row.markClock,'animation');assert.ok(row.mark&&row.launch);
    assert.equal(row.mark.react,2);assert.equal(row.launch.react,5);assert.equal(row.launch.vy,1000);assert.equal(row.launch.flyCount,0);
    const limit=source.independentExpectations.splashLaunch.markBirthAnimationTime;
    assert.ok(row.mark.ownerAnimationTime>=limit&&row.mark.ownerAnimationTime<limit+speed*2/60);
    // Bounds derive from authored .8 and the60Hz adapter's birth/death update
    // quantization. No current trace is saved as an original expected answer.
    const lifetime=source.independentExpectations.splashLaunch.markMeshLifeGlobalSeconds;
    assert.ok(row.launch.time-row.mark.time>=lifetime&&row.launch.time-row.mark.time<lifetime+4/60);
  });
for(const facing of [-1,1])for(const awake of [false,true])for(const followup of ['Z','66Z'])
  test(`Splash immediate legal ${followup} has an original-helper accepted ground pickup ${facing}/${awake}`,()=>{
    const row=observe({facing,awake,followup});assert.ok(row.followupHit,'actual collision and hit acceptance required');
    assert.equal(row.followupHit.kind,'character');assert.equal(row.followupHit.react,followup==='Z'?1:2);
    assert.ok(row.followupHit.y>2840);assert.equal(row.followupHit.vy,0);assert.match(row.followupHit.state,/RSI_DAMAGE_(?:SMALL|BIG)_/);
    if(followup==='66Z')assert.ok(row.states.some(s=>s.state==='RSI_DASH_COMBO_Z'),'two physical direction taps enter dashZ');
  });
for(const facing of [-1,1])for(const awake of [false,true])
  test(`Repeated owned reports deliver exactly one marking and one explosion ${facing}/${awake}`,()=>{
    const owner=fixture({skillId:21018,facing,networkOwnerId:'rs'}),peer=fixture({skillId:21018,facing,networkOwnerId:'target'});
    if(awake)owner.a.awakening.remaining=60;
    cast(owner);
    for(let frame=0;frame<150;frame++){
      steps(owner.sim,1,{held:['Z']});const packet=encodeOwnedState(owner.sim,'rs',{frameSeq:frame,epoch:0});
      validateOwnedReferences(packet,peer.a,profile,peer.map);applyOwnedState(peer.sim,'rs',packet);steps(peer.sim,1);
    }
    const hits=peer.sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='rs'&&e.origin.skillId===21018);
    assert.equal(hits.filter(e=>e.data.REACT_TYPE===2).length,1);assert.equal(hits.filter(e=>e.data.REACT_TYPE===5).length,1);
    assert.ok(peer.sim.state.events.some(e=>e.type==='stateChanged'&&e.actorId==='rs'&&e.state==='RSI_WAIT'));
    assert.equal(peer.sim.state.effects.filter(e=>e.ownerId==='rs'&&!e.dead&&e.skillId===21018).length,0);
  });
