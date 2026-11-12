/** Execute the unchanged, sealed V5 charge callbacks directly. Production v26
 * deliberately maps target2016 .75/1.5 into that ABI; it is not the V5 ten-second
 * counter or its HP-loss acceleration. Neither is original-client measured. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const wild=profile.skillCatalog.find(skill=>skill.skillId===24009);
const sourcePath=new URL('../../.cache/native-reference/X2Lib/X2GURaven.cpp',import.meta.url),
  metadataPath=new URL('../../.cache/native-skills-generated/source-contract.json',import.meta.url);
const retained=JSON.parse(readFileSync(new URL('../../contracts/rf-awakened-skills-source-v17.json',import.meta.url))),
  frozenWasm=retained.compiledFiles.find(row=>row.path==='.cache/native-awakened-skills-v17/skills.wasm'),
  frozenMetadata=retained.compiledFiles.find(row=>row.path==='.cache/native-awakened-skills-v17/source-contract.json');
const wasm=readFileSync(new URL('../../.cache/native-skills-generated/skills.wasm',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compiled=await WebAssembly.compile(wasm);
test('retained charge WASM bytes match the independent v17 artifact seal',()=>{
  assert.equal(wasm.length,frozenWasm.bytes);assert.equal(sha(wasm),frozenWasm.sha256);
});
test('fixed Raven source pins the ten-second charge and HP-loss equations',{
  skip:existsSync(sourcePath)?false:'Fixed Raven source unavailable: .cache/native-reference/X2Lib/X2GURaven.cpp',
},()=>{
  const source=readFileSync(sourcePath);assert.equal(sha(source),wild.referenceBinding.functions[0].sourceFileSha256);
  const text=source.toString('latin1'),now=text.slice(text.indexOf('void CX2GURaven::RSI_SA_RRF_WILD_CHARGING_FrameMove()'),text.indexOf('void CX2GURaven::RSI_SA_RRF_WILD_CHARGING_StateEnd()'));
  assert.match(now,/const float MAX_CHARGE_POWER_RATE = 10\.0f/);
  assert.match(now,/fHpDecresed \/ GetMaxHp\(\) \* 100/);assert.match(now,/MAX_TIME_AFTER_FULL_CHARGING = 3\.0f/);
  assert.doesNotMatch(now,/SA_EFFECTIVE_TIME|SA_ATK_REL/,'fixed V5 literal timing cannot be silently called target compatible');
});
test('historical charge metadata pairs the frozen source and WASM identities',{
  skip:existsSync(metadataPath)?false:'Historical source metadata unavailable: .cache/native-skills-generated/source-contract.json',
},()=>{
  const bytes=readFileSync(metadataPath);assert.equal(bytes.length,frozenMetadata.bytes);assert.equal(sha(bytes),frozenMetadata.sha256);
  const contract=JSON.parse(bytes);assert.equal(contract.wasm.sha256,sha(wasm));
  assert.equal(contract.sourceFileSha256,wild.referenceBinding.functions[0].sourceFileSha256);
});
const motion={nowSpeedX:0,nowSpeedY:0,passiveSpeedX:0,passiveSpeedY:0,disableGravity:false,
  downAccel:0,gravityAccel:-980,damageReducePercent:0};
async function charging({hp=800000,hpMax=800000}={}){
  const native=await instantiateNativeSkills(compiled);
  assert.equal(native.contract.wildChargeTargetCompatible,false);
  assert.equal(native.contract.extraGroups.wildChargeNow,68);assert.equal(native.contract.extraGroups.wildChargeEvent,67);
  let elapsed=0,charge=0,afterFull=0,previousHp=hp,frames=0,stateChange=0;
  const base={time:0,before:0,dt:0,hp,hpMax,held:true,position:[0,0,0],rotation:[0,0,0],direction:[1,0,0],landY:0,isRight:true,memo:false};
  const start=native.evaluate({...base,kind:65,skillExtra:motion});assert.equal(start.skillExtra.damageReducePercent,30);
  return {native,start,results:[],get elapsed(){return elapsed;},get charge(){return charge;},get afterFull(){return afterFull;},get stateChange(){return stateChange;},
    step({dt=1/60,nextHp=hp,held=true}={}){
      hp=nextHp;frames++;elapsed+=dt;
      const input={...base,time:elapsed,before:elapsed-dt,dt,hp,charge,afterFull,previousHp,held};
      const result=native.evaluate({...input,kind:68});
      ({charge,afterFull,previousHp}=result);
      const event=native.evaluate({...input,kind:67,dt:0,charge,afterFull,previousHp});
      assert.equal(event.charge,charge);assert.equal(event.afterFull,afterFull,'Event67 does not advance Now68 counters');
      assert.equal(result.commonBoundaryCalls+event.commonBoundaryCalls,2);
      stateChange=event.stateChange;this.results.push({...result,stateChange,elapsed,frames});return result;
    },
    end(){return native.evaluate({...base,kind:66,hp,charge,afterFull,previousHp,skillExtra:start.skillExtra});},
  };
}
const strike={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:80},REACT_TYPE:3,HIT_TYPE:1,BACK_SPEED_X:500,BACK_SPEED_Y:1000,STOP_TIME_DEF:.1};

test('direct V5 Now68 holds for ten-second charge and Event67 strictly releases after three full seconds; End66 stops the original group',async()=>{
  const s=await charging();let fullTime=null,previousAfterFull=0;
  for(let i=0;i<900&&s.stateChange===0;i++){
    previousAfterFull=s.afterFull;s.step();
    if(fullTime===null&&s.charge>=10)fullTime=s.elapsed;
    if(s.stateChange===0)assert.ok(s.afterFull<=3.0001);
  }
  assert.ok(fullTime!==null);assert.ok(fullTime>=9.99&&fullTime<=10.02);
  assert.equal(s.stateChange,2);assert.ok(previousAfterFull<=3.0001);assert.ok(s.afterFull>3);
  assert.equal(s.results.filter(result=>result.effectMask&1).length,1);assert.equal(s.results.reduce((sum,result)=>sum+result.sounds,0),1);
  const end=s.end();assert.equal(end.effectMask&32,32);assert.equal(end.skillExtra.damageReducePercent,0);
});

test('direct V5 Now68 adds independently supplied seven-percent HP loss exactly once',async()=>{
  const s=await charging();s.step();const before=s.charge;s.step({nextHp:744000});const after=s.charge;
  assert.ok(Math.abs(after-(before+7+1/60))<.00001);
  s.step();assert.ok(Math.abs(s.charge-after-1/60)<.00001,'unchanged HP is not counted twice');
});

test('two V5 HP snapshots reach full sooner, but held-key release still waits for the source three-second full window',async()=>{
  const s=await charging();s.step();const began=s.elapsed;s.step({nextHp:744000});s.step({nextHp:688000});
  assert.ok(s.charge>=10);const full=s.elapsed;
  for(let i=0;i<190&&s.stateChange===0;i++)s.step();
  assert.equal(s.stateChange,2);assert.ok(full-began<.05);assert.ok(s.elapsed-full>3&&s.elapsed-full<3.05);
});

test('Event67 strict source boundary does not release at exactly3 seconds and a key release needs no counter advancement',async()=>{
  const s=await charging(),base={time:1,before:1,dt:0,hp:800000,hpMax:800000,charge:10,afterFull:3,previousHp:800000,
    held:true,position:[0,0,0],rotation:[0,0,0],direction:[1,0,0],landY:0,isRight:true,memo:false,kind:67};
  assert.equal(s.native.evaluate(base).stateChange,0);
  assert.equal(s.native.evaluate({...base,afterFull:3+1/60}).stateChange,2);
  assert.equal(s.native.evaluate({...base,afterFull:0,held:false}).stateChange,2);
});

test('a real current armored hit supplies its HP observation to the independent V5 counter without asserting v26 has V5 charge timing',async()=>{
  const {make}=await import('../helpers/rf-passive-fixture-v12.mjs');
  const sim=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});sim.rng=()=>.5;
  sim.step(1/60,{pressed:['A'],held:['A']},{snapshot:false});
  for(let i=0;i<180&&sim.actor('rf').state!=='RSI_SA_RRF_WILD_CHARGING';i++)sim.step(1/60,{held:['A']},{snapshot:false});
  const actor=sim.actor('rf');assert.equal(actor.state,'RSI_SA_RRF_WILD_CHARGING');
  const reference=await charging({hp:actor.hp,hpMax:actor.hpMax});reference.step();const before=reference.charge;
  const hit=sim.applyHit(sim.actor('target'),actor,strike,{kind:'controlled-source-charge-hit'});
  assert.equal(hit.accepted,true);assert.equal(hit.amount,56000);assert.equal(actor.state,'RSI_SA_RRF_WILD_CHARGING');assert.equal(actor.hitStop,0);
  reference.step({nextHp:actor.hp});const after=reference.charge;
  assert.ok(Math.abs(after-(before+hit.amount/actor.hpMax*100+1/60))<.00001);
  reference.step({nextHp:actor.hp});assert.ok(Math.abs(reference.charge-after-1/60)<.00001);
});

test('target2016 declares .75 and 1.5 while the retained V5 charge consumer remains explicitly unverified',()=>{
  assert.equal(wild.raw.SA_EFFECTIVE_TIME['1'],.75);assert.equal(wild.raw.SA_ATK_REL['1'],1.5);
  assert.match(wild.referenceBinding.targetConflict,/10s/);assert.equal(wild.fidelityVerified,false);
});
