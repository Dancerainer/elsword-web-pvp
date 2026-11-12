import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {createBuffFromFactor,mergeBuffs,tickBuffs,consumeBuffHit} from '../../packages/combat-core/buffs.mjs';
const evidence=JSON.parse(readFileSync(new URL('../../contracts/rf-buff-source.json',import.meta.url)));
const {profile,inlineFactors}=evidence;
const wasm=new URL('../../artifacts/native/skill-values-v1/skill-values-source.wasm',import.meta.url);
const skip=!existsSync(wasm)?'Build original skill-value/buff WASM in task artifacts first':false;
const nativeValues=skip?null:await instantiateNativeSkillValues(readFileSync(wasm));
const sourceActor={id:'a',stats:{physicalAttack:2000,magicAttack:1000}};
const targetActor={id:'b',hp:2000,hpMax:5000,buffResistances:{0:0,1:.5},debuffDurationMultiplier:1};
// Independent expectations from the published original three-factor formula
// and IEEE binary32 operation order, never obtained from the tested executor.
const woundExpected=Math.fround(1500*Math.fround(-.3));
const fireExpected=Math.fround(woundExpected*.5);
const make=(factor,extra={})=>createBuffFromFactor(profile,{factor,sourceActor,targetActor,roll:0,nativeValues,...extra});
const tick=(buffs,dt,actor=targetActor)=>tickBuffs(profile,buffs,dt,{targetActor:actor,nativeValues});

test('buff evidence records actual target and fixed reference independently',()=>{
  assert.equal(evidence.targetClientMeasured,false);
  assert.equal(evidence.sourceFiles['battle-buff'].sha256,'79bf16f5a905c895280ca02db11f4c83896bb4587432643615b5043145f5ccef');
  assert.equal(profile.buffTemplates[37].raw.BEHAVIOR.BBT_CHANGE_NOW_HP_PER_SECOND.TIME_INTERVAL,1);
  assert.ok(evidence.consumers.some(x=>x.rule.includes('OR')));
});
test('original C++ uses mean attack and actual resistance even when probability ignores resistance',{skip},()=>{
  const result=make(inlineFactors.fire,{roll:1});assert.equal(result.supported,true);assert.equal(result.accepted,true);
  const buff=result.buff;assert.equal(buff.behaviors[0].value,fireExpected);assert.equal(buff.finalizers[0].remaining,1.5);
  const before=tick([buff],.5);assert.equal(before.effects.length,0);
  const at=tick(before.buffs,.5);assert.equal(at.effects[0].delta,fireExpected);
  assert.equal(at.effects[0].damageReaction,null);assert.equal(at.effects[0].applyIfHpPositive,true);
  assert.deepEqual(buff.behaviors[0].sum,0);
});
test('native interval fires once per actor frame and drops its remainder, before expiry',{skip},()=>{
  const buff=make(inlineFactors.fire).buff;
  const result=tick([buff],2.5);
  assert.deepEqual(result.effects.map(x=>x.kind),['hpDelta','buffFinished']);
  assert.equal(result.effects[0].delta,fireExpected);assert.deepEqual(result.buffs,[]);
  const paused=tick([buff],0);assert.deepEqual(paused.buffs,[buff]);assert.deepEqual(paused.effects,[]);
  const dead=tick([buff],1,{...targetActor,hp:0});assert.equal(dead.effects.length,0);
});
test('wound applies original probability, HP interval and dash identity',{skip},()=>{
  const result=make(inlineFactors.wound,{roll:.05});assert.equal(result.accepted,true);
  assert.equal(make(inlineFactors.wound,{roll:.05001}).accepted,false);
  const active=tick([result.buff],0);assert.equal(active.dashBlock,true);assert.equal(active.inputBlock,false);
  assert.equal(result.buff.finalizers[0].remaining,4);assert.equal(result.buff.behaviors[0].value,woundExpected);
});
test('stun has time OR received-hit termination without fabricated reaction state',{skip},()=>{
  const buff=make(inlineFactors.stun,{roll:.5}).buff;
  assert.equal(make(inlineFactors.stun,{roll:.50001}).accepted,false);
  assert.equal(buff.behaviors[0].reactionState,null);assert.equal(tick([buff],0).inputBlock,true);
  assert.equal(consumeBuffHit(profile,[buff],{kind:'hit',count:99}).buffs.length,1);
  const one=consumeBuffHit(profile,[buff],{kind:'received'});
  assert.equal(one.buffs.length,1);assert.equal(one.inputBlock,true);
  const two=consumeBuffHit(profile,one.buffs,{kind:'received'});
  assert.equal(two.buffs.length,1);assert.equal(two.inputBlock,true);
  assert.equal(two.effects[0].kind,'buffFinishPending');
  const finished=tick(two.buffs,.01);assert.equal(finished.buffs.length,0);assert.equal(finished.inputBlock,false);
  assert.equal(tick([buff],1.5).buffs.length,0);
});
test('632 remains timer-only; explicitly requested 437 uses attack hit count, never autoactivates',{skip},()=>{
  const marker=make(632).buff;assert.deepEqual(marker.behaviors,[{type:55,kind:'empty'}]);
  const m=tick([marker],1);assert.equal(m.inputBlock,false);assert.equal(m.dashBlock,false);assert.equal(m.effects.length,0);
  assert.equal(tick(m.buffs,1).buffs.length,0);
  const missingByte=make(437,{skillLevel:3});assert.equal(missingByte.supported,false);
  assert.ok(missingByte.unsupported.some(row=>/hit counter byte/i.test(row.reason)),'original owner counter is an explicit input');
  const owner={...targetActor,sourceHitCountByte:0},created=make(437,{skillLevel:3,targetActor:owner});
  assert.equal(created.supported,true,JSON.stringify(created.unsupported));
  const crit=created.buff;assert.deepEqual(crit.behaviors.map(x=>x.value),[100,Math.fround(1.1)]);
  assert.equal(crit.finalizers.find(x=>x.kind==='hit').remaining,7);
  assert.equal(crit.finalizers.find(x=>x.kind==='hit').sourceByteEnd,7);
  assert.equal(consumeBuffHit(profile,[crit],{kind:'received',count:10,targetActor:owner}).buffs.length,1);
  // The accepted-feedback owner updates its byte; this function observes it.
  // It does not manufacture seven native callbacks from a generic count.
  owner.sourceHitCountByte=7;
  const used=consumeBuffHit(profile,[crit],{kind:'hit',count:7,targetActor:owner});
  assert.equal(used.buffs.length,1);assert.equal(used.buffs[0].finalizers.find(x=>x.kind==='hit').remaining,0);
  assert.equal(tick(used.buffs,0,owner).buffs.length,1,'completion is polled by an eligible manager tick');
  assert.equal(tick(used.buffs,.01,owner).buffs.length,0);
});
test('633 uses source detonation identity and immediate expiry, without borrowing 632 duration',{skip},()=>{
  // Target 2016 factor633/template544 explicitly declares behavior74 and
  // finalizer8. Fixed-reference BuffFinalizerTemplet.cpp:1245-1247 returns
  // true from Immediate::DidFinish; this is not a target-client measurement.
  const raw=profile.buffFactors[633].raw,template=profile.buffTemplates[544].raw;
  assert.equal(raw.BUFF_TEMPLET_ID,544);
  assert.deepEqual(raw.BEHAVIOR.COMBINATION,{'1':74});
  assert.deepEqual(template.BEHAVIOR.COMBINATION,{'1':74});
  assert.deepEqual(raw.FINALIZER.COMBINATION,{'1':8});
  assert.deepEqual(template.FINALIZER.COMBINATION,{'1':8});
  assert.equal(raw.FINALIZER.BFT_TIME,undefined);
  const result=make(633);assert.equal(result.supported,true);assert.equal(result.accepted,true);
  assert.deepEqual(result.buff.behaviors,[{type:74,kind:'manaBreakBlock'}]);
  assert.deepEqual(result.buff.finalizers,[{kind:'immediate',remaining:1}]);
  assert.equal(tick([result.buff],0).manaBreakBlock,true);
  const next=tick([result.buff],.001);
  assert.deepEqual(next.buffs,[]);assert.equal(next.manaBreakBlock,false);
});
test('same-template reapply keeps stronger value and existing interval clock; duration modifier follows original order',{skip},()=>{
  const old=tick([make(inlineFactors.fire).buff],.8).buffs;
  const weaker=structuredClone(inlineFactors.fire);weaker.raw.BEHAVIOR.BBT_CHANGE_NOW_HP_PER_SECOND.MULTIPLIER[1]=-.1;
  const merged=mergeBuffs(profile,old,make(weaker).buff);
  assert.equal(merged[0].behaviors[0].value,fireExpected);
  assert.equal(merged[0].behaviors[0].sum,Math.fround(.8));
  assert.equal(tick(merged,.2).effects[0].delta,fireExpected);
  const reducedTarget={...targetActor,debuffDurationMultiplier:.5};
  const initial=make(632,{targetActor:reducedTarget}).buff;
  assert.equal(initial.finalizers[0].remaining,1);
  const manual=structuredClone(initial);manual.finalizers[0].remaining=3;
  const refreshed=mergeBuffs(profile,[manual],initial);
  assert.equal(refreshed[0].finalizers[0].remaining,1.5); // max(3,2) * .5, not max(3,1)
  assert.equal(old[0].behaviors[0].sum,Math.fround(.8));
});
test('missing native math, explicit resistance, context or unsupported behavior fails closed',{skip},()=>{
  assert.equal(make(inlineFactors.fire,{nativeValues:null}).supported,false);
  assert.equal(make(inlineFactors.fire,{targetActor:{id:'b'}}).supported,false);
  // Unknown enum values stay unsupported even when template/factor agree.
  // 633 is no longer an unsupported sample: its original consumer is covered
  // above. This damaged input invents no behavior or expected combat result.
  const unknownProfile=structuredClone(profile),unknownFactor=structuredClone(inlineFactors.fire);
  unknownProfile.buffTemplates[unknownFactor.raw.BUFF_TEMPLET_ID].raw.BEHAVIOR={COMBINATION:{'1':2147483647}};
  unknownFactor.raw.BEHAVIOR={COMBINATION:{'1':2147483647}};
  assert.equal(createBuffFromFactor(unknownProfile,{factor:unknownFactor,sourceActor,targetActor,roll:0,nativeValues}).supported,false);
  const broken=structuredClone(inlineFactors.fire);delete broken.raw.BEHAVIOR.BBT_CHANGE_NOW_HP_PER_SECOND.MULTIPLIER[1];
  assert.equal(make(broken).supported,false);
  assert.throws(()=>tick([make(632).buff],-1),/nonnegative/);
  assert.throws(()=>consumeBuffHit(profile,[],{kind:'other'}),/kind/);
  assert.doesNotThrow(()=>JSON.stringify(make(632).buff));
});
