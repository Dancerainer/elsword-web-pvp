import test from 'node:test';
import assert from 'node:assert/strict';
import {passiveFixture,frames,preset} from '../helpers/passive-v20-fixture.mjs';
import {applyTargetPassiveAttributes,applyEquipmentDamageReduction,awakeningChargeMultiplier,receivedMpGain,explodingHandSelfBuff,passiveBuffHitCount,synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
const f=Math.fround;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} != ${expected}`);
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.01},REACT_TYPE:1,FORCE_DOWN:0,HIT_ADD_MP:0};
function hit(s){return s.injectHit({attackerId:'rf',targetId:'target',damageData:data});}
function counter(a){return a.buffs.find(b=>b.templateId===408)?.finalizers.find(v=>v.kind==='hit')?.remaining;}

test('requested equipment options execute and Focus/24405 apply once, including stored Buff base',async()=>{
 const s=await passiveFixture(),a=s.actor('rf');
 assert.equal(preset.attributes.animationSpeedMultiplier,1.4);assert.equal(preset.attributes.moveSpeedMultiplier,1.23);assert.equal(preset.attributes.jumpSpeedMultiplier,1.23);
 assert.equal(a.formulaRules.combatLevel,85);
 assert.equal(a.equipmentAttributes.mpMax,300);assert.equal(a.mpMax,600,'source base MP300 plus user equipment MP300');
 assert.equal(a.stats.animationSpeedMultiplier,f(1.4),'source additional-stat consumer stores float32; equipment remains1.4');
 const move=f(f(f(f(1+f(1.23-1))-1)*f(.5))+1);
 assert.equal(a.stats.moveSpeedMultiplier,move);assert.equal(a.stats.jumpSpeedMultiplier,move);
 assert.equal(a.stats.physicalAttack,2000);assert.equal(a.stats.magicAttack,2150.10009765625,'original24405 adds float32(SA-1+epsilon) to the post-Focus magic base');
 assert.equal(a.buffBaseStats.magicAttack,a.stats.magicAttack);
 const first=structuredClone(a.stats);synchronizeBuffStats(a);synchronizeBuffStats(a);assert.deepEqual(a.stats,first);
 frames(s,30);assert.equal(a.stats.magicAttack,first.magicAttack,'ordinary ticks never reapply passive factors');
 const restored=await passiveFixture();restored.restore(JSON.parse(JSON.stringify(s.snapshot())));frames(s,30);frames(restored,30);
 assert.deepEqual(s.snapshot(),restored.snapshot());
});

test('equipment30% and Refined24% reduce once; shared MP gate and independent natural recovery compose',async()=>{
 const s=await passiveFixture({passives:[24400],targetPassives:[24404]});const a=s.actor('rf'),b=s.actor('target');
 a.mp=0; // Explicit empty-MP boundary so a swallowed receive gain is observable.
 const before=b.hp;const first=hit(s);
 // No guild/base defense in this fixture: D=2000*.01=20; final stage
 // 20+20*(.76-1)=15.2; independent equipment reduction leaves10.64.
 close(first.amount,10.64);
 assert.equal(before-b.hp,first.amount);assert.equal(b.mp,f(f(3)*f(1+f(.1))));
 hit(s);assert.equal(b.mp,f(f(3)*f(1+f(.1))));
 // An attack in the same source frame shares the receiver's recovery gate.
 s.applyHit(b,a,{...data,HIT_ADD_MP:5},{kind:'character'});
 assert.equal(b.mp,f(f(3)*f(1+f(.1))));
 assert.equal(a.mp,0,'the first zero-MP attack already consumed its shared gate');
 // Next frame adds source MP_CHANGE_RATE1*1/60 independently, then another
 // receiver recovery3*(1+.1). Expected value is hand-computed, not sampled.
 frames(s,1);hit(s);close(b.mp,6.6+1/60);
 assert.equal(a.stats.physicalAttack,2000);
});

test('equipment, RF passive and guild charge compose additions before equipment multiplier',async()=>{
 const s=await passiveFixture({targetPassives:[24404,24405]}),a=s.actor('rf'),b=s.actor('target');
 const rf=f(f(f(1.12)-1)+f(.00005));
 assert.equal(awakeningChargeMultiplier(a,'hit'),f(f(1.5)*f(1+rf)));
 assert.equal(awakeningChargeMultiplier(b,'received'),f(f(f(1.5)*f(1+rf))*f(1+f(.09))));
 const guild={receivedMpMultiplier:1.5,onHitSoulAdd:.07,receivedSoulAdd:.5};
 assert.equal(awakeningChargeMultiplier(a,'hit',guild),f(f(1.5)*f(1+f(rf+.07))));
 assert.equal(awakeningChargeMultiplier(b,'received',guild),f(f(f(1.5)*f(1+f(rf+.5)))*f(1+f(.09))));
 assert.notEqual(awakeningChargeMultiplier(b,'received',guild),f(f(1.5)*f(1+f(f(rf+f(.09))+.5))),'24404 is a separate final received multiplier after additive24405/guild');
 b.lastReceivedMpStep=undefined;assert.equal(receivedMpGain(b,data,123,guild),f(f(f(3)*f(1+f(.1)))*1.5));
 assert.equal(receivedMpGain(b,data,123,guild),0);
});

test('real X passive proc grants SELF408; explosion dummy does not consume its7-hit counter',async()=>{
 // The critical evaluator consumes the first xorshift32 sample even at 0%
 // critical rate. Seed1's second sample is .015747428173199296, inside the
 // unchanged native10% proc branch. Seed30's .47082330961711705 is outside.
 const s=await passiveFixture({seed:1}),a=s.actor('rf');s.drainEvents();
 assert.equal(a.passivePolicy.explosive.chance,f(.1),'source passive probability stays10%');
 s.step(1/60,{pressed:['X'],held:['X']},{snapshot:false});
 let proc=null;
 for(let i=0;i<80&&!proc;i++){frames(s,1);proc=s.state.events.find(e=>e.type==='additionalHitEffectCreated'&&e.passiveSkillId===24402);}
 assert.ok(proc,'actual X collision and deterministic source probability create explosion');
 assert.equal(counter(a),6,'the current accepted feedback advances the newly created original byte threshold');assert.equal(a.stats.criticalRate,100);assert.equal(a.stats.criticalAttack,f(1.5*f(1.1)));
 frames(s,15);assert.ok(s.state.events.some(e=>e.type==='hit'&&e.origin.skillId===24402),'additional explosion has real damage');
 assert.equal(counter(a),6,'original RT_DUMMY_DAMAGE explosion is excluded from GetHitCount');
 assert.equal(s.actor('target').buffs.some(b=>b.templateId===408),false,'buff belongs to attacker');
 for(let i=0;i<6;i++){frames(s,1);s.drainEvents();assert.equal(hit(s).accepted,true);
  const event=s.state.events.find(e=>e.type==='hit'&&e.origin.kind==='fixture');assert.equal(event.critical,true,'six remaining accepted callbacks retain critical stat until the next buff poll');assert.equal(counter(a),5-i);}
 frames(s,1);assert.equal(counter(a),undefined);assert.equal(a.stats.criticalRate,0);assert.equal(a.stats.criticalAttack,1.5);
 assert.equal(a.stats.magicAttack,2150.10009765625,'expiration restores already-passive base without multiplying again');
});

test('real X hit with historical seed30 stays outside the unchanged10% passive proc branch',async()=>{
 const s=await passiveFixture({seed:30}),a=s.actor('rf');s.drainEvents();
 assert.equal(a.passivePolicy.explosive.chance,f(.1),'source passive probability stays10%');
 s.step(1/60,{pressed:['X'],held:['X']},{snapshot:false});frames(s,80);
 assert.ok(s.state.events.some(event=>event.type==='hit'&&event.actorId==='rf'&&event.amount>0),'the negative branch still requires an actual X collision');
 assert.equal(s.state.events.some(event=>event.type==='additionalHitEffectCreated'&&event.passiveSkillId===24402),false);
 assert.equal(counter(a),undefined);assert.equal(a.stats.criticalRate,0);assert.equal(a.stats.criticalAttack,1.5);
});

test('408 stat grant is immediate; reapply does not compound;6seconds expiration and JSON restore agree',async()=>{
 const s=await passiveFixture(),a=s.actor('rf');
 const buff=s.grantBuff(a,a,437,3,null);assert.ok(buff);assert.equal(a.stats.criticalRate,100);assert.equal(counter(a),7);
 s.grantBuff(a,a,437,3,null);assert.equal(a.stats.criticalAttack,f(1.5*f(1.1)));assert.equal(counter(a),7);
 frames(s,120);const copy=await passiveFixture();copy.restore(JSON.parse(JSON.stringify(s.snapshot())));
 frames(s,245);frames(copy,245);assert.deepEqual(s.snapshot(),copy.snapshot());assert.equal(a.buffs.some(b=>b.templateId===408),false);
 assert.equal(a.stats.criticalRate,0);assert.equal(a.stats.magicAttack,2150.10009765625);
});

test('raw damage-rate proc cannot grant passive408; no proc, no passive and malformed stats fail safely',async()=>{
 const s=await passiveFixture(),policy=s.actor('rf').passivePolicy;
 assert.equal(explodingHandSelfBuff(policy,{additionalDamageEffect:{trigger:'damage-data-rate',skillId:null}}),null);
 assert.equal(explodingHandSelfBuff(policy,{}),null);
 const off=await passiveFixture({passives:[]});assert.equal(off.actor('rf').stats.physicalAttack,1000);assert.equal(off.actor('rf').stats.magicAttack,1000);
 assert.equal(explodingHandSelfBuff(off.actor('rf').passivePolicy,{additionalDamageEffect:{trigger:'passive24402',skillId:24402}}),null);
 assert.equal(passiveBuffHitCount({REACT_TYPE:7}),0);assert.equal(passiveBuffHitCount({REACT_TYPE:1}),1);
 assert.throws(()=>applyTargetPassiveAttributes({magicAttack:1000,damageReduction:1.1},null),/\[0,1\]/);
 assert.throws(()=>applyEquipmentDamageReduction(NaN,{}),/finite/);
 assert.equal(receivedMpGain(off.actor('target'),{DAMAGE_TYPE:6},2),0);
});
