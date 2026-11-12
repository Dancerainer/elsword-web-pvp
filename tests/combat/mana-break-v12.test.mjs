import {authoredEquipmentPreset} from '../helpers/authored-equipment-v21.mjs';
/** Literal source expectations; web results are not target-client measurements. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {NATIVE_RUNTIME_VERSION} from '../../packages/native-source/runtime-version.mjs';
import {createBuffFromFactor,tickBuffs} from '../../packages/combat-core/buffs.mjs';
import {manaBreakDamageReact,reserveManaBreak} from '../../packages/combat-core/mana-break.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const fixtureRoot=process.env.RF_FULL_SKILLS_FIXTURE_ROOT??project;
// Historical republication proof is a test input, outside the final public
// asset inventory. An explicit private directory supplies only these frozen
// binaries; current production modules still load from artifacts/native.
const historicalNativeRoot=process.env.RF_HISTORICAL_NATIVE_ROOT??resolve(project,'artifacts/native/superseded');
const read=(file,root=project)=>JSON.parse(readFileSync(resolve(root,file)));
const profile=read('packages/combat-core/rf-profile.json'),preset=authoredEquipmentPreset(read('config/rf-preset.json'));
const map={...read('artifacts/scene/sander-garpai-rock-pvp/manifest.json',fixtureRoot),...read('artifacts/scene/sander-garpai-rock-pvp/collision.json',fixtureRoot)};
const manifest=read('artifacts/native/manifest.json');
const native=await createNativeRuntime({manifest,map,loadBinary:f=>readFileSync(resolve(project,'artifacts/native',f))});
const strike={DAMAGE:{PHYSIC:1},DAMAGE_TYPE:0,REACT_TYPE:1,BACK_SPEED_X:0,BACK_SPEED_Y:200,HIT_STOP_TIME:0,FORCE_DOWN:7};
function make({mp=300,facing=1}={}){
  // Isolate detonation from guild recovery multipliers, retaining the current
  // equipment formula: MP capacity300(base)+300(equipment), received MP base3.
  const s=createSimulation({profile,map,preset:{...preset,manaBreakImmediateDown:false,passives:[],guildPassives:[],loadout:Array(8).fill(null)},
    actors:[{id:'rf',team:0,position:[0,3800,0],lineId:4,facing,mp,passives:[]},
      {id:'target',team:1,position:[facing*500,3800,0],lineId:4,facing:-facing,passives:[]}],
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,
    nativeNasod:native.nasod,nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:native.versions,seed:2016});
  s.actor('rf').canNotAttackTime=100;s.actor('target').canNotAttackTime=100;return s;
}
const frame=(s,input={},dt=1/60)=>s.step(dt,{actorId:'rf',...input},{snapshot:false});
const hit=(s,data=strike)=>s.applyHit(s.actor('target'),s.actor('rf'),data,{kind:'source-mana-test'});
// V61 explicitly supersedes the V12 immediate host down phase. Compiled
// source bodies and raw declarations remain frozen; wait only on the new
// bounded project reservation, not on a guessed original match duration.
const finishBreak=(s,a=s.actor('rf'))=>{for(let n=0;n<90&&a.manaBreak.pendingDown;n++)frame(s);assert.equal(a.manaBreak.pendingDown,undefined);};
test('production loader has ten modules, fixed target rate, retained source bodies and preserved bounded republications',()=>{
  assert.equal(manifest.runtimeVersion,NATIVE_RUNTIME_VERSION);assert.equal(Object.keys(manifest.modules).length,10);
  assert.equal(profile.components.MP_CHARGE_RATE,130);assert.ok(native.manaBreak);
  const retained=read('reports/rf-mana-retained-modules-v12.json');
  for(const [name,record] of Object.entries(retained.modules)){
    if(name==='camera'){
      const evidence=read('reports/camera-translation-v28.json'),current=manifest.modules.camera;
      assert.deepEqual(evidence.previousCamera,record);assert.deepEqual(current.originalFunctions,record.originalFunctions);
      assert.equal(current.sha256,evidence.moduleSha256);assert.equal(current.presentationTranslation.sourceBodiesUnchanged,true);
      const old=readFileSync(resolve(historicalNativeRoot,record.sha256+'.wasm'));
      assert.equal(createHash('sha256').update(old).digest('hex'),record.sha256);
      assert.ok(manifest.seal.boundedRebuildHistory.some(h=>h.module==='camera'&&h.previousSha256===record.sha256&&h.sha256===current.sha256));
      continue;
    }
    if(name==='skills'){
      const current=manifest.modules[name],contract=read('contracts/rf-xcrash-source-v14.json');
      const old=readFileSync(resolve(historicalNativeRoot,record.sha256+'.wasm'));
      assert.equal(old.length,record.bytes);assert.equal(createHash('sha256').update(old).digest('hex'),record.sha256);
      const added=current.originalFunctions.filter(f=>f.name==='SI_SA_RRF_X_CRASH_FrameMove');
      assert.equal(added.length,1);assert.equal(added[0].sha256,'c194602818f61d7741daa094d405231c7b696569904bfe102eff5a3658fa1b4f');
      const arc=manifest.runtimeVersion==='original-source-functions-v11'?read('contracts/rf-native-skills-arc-v19.json'):null;
      const historicalCurrent=arc?arc.previousSkills:current;
      assert.deepEqual(historicalCurrent.originalFunctions.filter(f=>f.name!=='SI_SA_RRF_X_CRASH_FrameMove'),record.originalFunctions);
      if(['original-source-functions-v10','original-source-functions-v11'].includes(manifest.runtimeVersion)){
        const bounded=read('contracts/rf-awakened-skills-source-v17.json');
        assert.equal(historicalCurrent.sha256,bounded.runtimeModule.sha256);
        assert.equal(bounded.previousSkills.sha256,contract.runtimeModule.sha256);
        assert.equal(bounded.unchangedOriginalMethods,70);
        assert.ok(manifest.seal.boundedRebuildHistory.some(h=>h.module==='skills'&&h.previousSha256===contract.runtimeModule.sha256&&h.sha256===historicalCurrent.sha256));
      }else assert.equal(current.sha256,contract.runtimeModule.sha256);
      if(arc){
        assert.deepEqual(current,arc.runtimeModule);
        const byName=new Map(current.originalFunctions.map(f=>[f.name,f]));
        for(const f of historicalCurrent.originalFunctions)assert.deepEqual(byName.get(f.name),f);
        assert.equal(current.originalFunctions.length,historicalCurrent.originalFunctions.length+1);
        assert.ok(byName.has('RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove'));
        assert.ok(manifest.seal.boundedRebuildHistory.some(h=>h.module==='skills'&&h.previousSha256===historicalCurrent.sha256&&h.sha256===current.sha256));
      }
      assert.ok(manifest.seal.boundedRebuildHistory.some(h=>h.module==='skills'&&h.previousSha256===record.sha256));
      continue;
    }
    if(name!=='commands-recovery'){assert.deepEqual(manifest.modules[name],record);continue;}
    const current=manifest.modules[name],contract=read('contracts/rf-combo-recovery-source-v11.json');
    const bytes=readFileSync(resolve(historicalNativeRoot,record.sha256+'.wasm'));
    assert.equal(bytes.length,record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.deepEqual(current.originalFunctions.slice(0,record.originalFunctions.length),record.originalFunctions);
    assert.equal(current.originalFunctions.length,record.originalFunctions.length+1);
    assert.equal(current.originalFunctions.at(-1).name,'RSI_COMBO_XXX_FrameMove');
    assert.equal(current.sourceCommit,record.sourceCommit);assert.equal(current.sourceSha256,record.sourceSha256);
    assert.ok(JSON.stringify(contract).includes(record.sha256),'old module hash remains in explicit republication history');
  }
});
test('compiled source thresholds and full green cost are literal100/300; reserve is deferred',()=>{
  const n=native.manaBreak;
  assert.equal(n.evaluate('request',{mp:300,charge:99.99}).triggered,false);
  const request=n.evaluate('request',{mp:300,charge:156});
  assert.equal(request.triggered,true);assert.equal(request.mp,300);assert.equal(request.pendingCost,156);assert.equal(request.active,true);
  const consumed=n.evaluate('consume',{mp:300,charge:156,active:true,pendingCost:156});
  assert.equal(consumed.mp,144);assert.equal(consumed.charge,0);assert.equal(consumed.active,false);
  assert.equal(consumed.minimumCharge,100);assert.equal(consumed.maxCharge,300);
});
test('compiled source caps to current MP, resets on release, and retains its literal else-if order',()=>{
  const n=native.manaBreak;
  assert.equal(n.evaluate('frame',{mp:120,charge:119,canCharge:true,elapsed:.1}).charge,120);
  assert.equal(n.evaluate('frame',{mp:300,charge:156,canCharge:false,elapsed:.1}).charge,0);
  assert.equal(n.evaluate('frame',{mp:120,charge:299,canCharge:true,elapsed:.1}).charge,300,
    'source clamps THREE_CHARGE before its else-if current-MP clamp; this is not a fabricated min()');
});
for(const key of ['Z','X'])test(`V62 deliberate held ${key} uses next Gauge frame despite attack input lock; release immediately clears the project latch`,()=>{
  const s=make(),a=s.actor('rf');
  frame(s,{pressed:[key],held:[key]},.2);frame(s,{held:[key]},.2);assert.equal(a.manaBreak.charge,0);
  frame(s,{held:[key]},.2);
  assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,true);
  frame(s,{held:[key]},.2);assert.equal(a.manaBreak.charge,26);
  frame(s,{released:[key]},.2);assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,false);
  frame(s,{},.2);assert.equal(a.manaBreak.charge,0);assert.equal(a.state,'RSI_WAIT');
});
test('pressed-only tap is not the original pureZ held level',()=>{
  const s=make();frame(s,{pressed:['Z']},.2);frame(s,{},.2);assert.equal(s.actor('rf').manaBreak.charge,0);
});
test('source stop queues freeze positive remainder and resume the whole Gauge/Event packet when exhausted',()=>{
  const s=make(),a=s.actor('rf');for(let n=0;n<3;n++)frame(s,{held:['X']},.2);
  requestActorStop(a,'hit',.3);frame(s,{held:['X']},.2);assert.equal(a.manaBreak.charge,0);assert.equal(a.manaBreak.canCharge,true);
  // Stop queues deduct before the native callback gate. The next .2 packet
  // exhausts the remaining hit stop and advances the full .2, not a residual.
  frame(s,{held:['X']},.2);assert.equal(a.manaBreak.charge,26);
  requestActorStop(a,'world',.1);frame(s,{held:['X']},.2);assert.equal(a.manaBreak.charge,52);
  frame(s,{held:['X']},.2);assert.equal(a.manaBreak.charge,78);
});
for(const facing of [-1,1])test(`real map ground Mana Break consumes full green MP and preserves KD including next reserve (${facing})`,()=>{
  const s=make({facing}),a=s.actor('rf');a.manaBreak.charge=156;a.knockdown.now=83;
  assert.equal(a.mpMax,600);assert.equal(hit(s).accepted,true);assert.equal(a.mp,300+3);assert.equal(a.manaBreak.charge,156);
  assert.equal(a.state,'RSI_DAMAGE_SMALL_FRONT');assert.equal(a.knockdown.now,83);assert.equal(a.knockdown.pending,7);
  assert.equal(a.knockdown.activated,false);assert.equal(a.hitStop,Math.fround(.7));
  assert.deepEqual(a.sourceStopQueues.hit.at(-1),{remaining:Math.fround(.7),sourceId:'target'});
  frame(s);assert.equal(a.knockdown.now,90);assert.equal(a.mp,300+3,'mana-break hit stop freezes natural MP');
  finishBreak(s);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');assert.ok(Math.abs(a.mp-(300+3-156))<.1);
  assert.equal(s.state.events.filter(e=>e.type==='manaBreakConsumed').length,1);
});
test('Mana Break is selected before a full KD gauge without activating a KD reset',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=100;a.knockdown.now=100;
  hit(s);assert.equal(a.knockdown.now,100);assert.equal(a.knockdown.activated,false);
  frame(s);assert.equal(a.knockdown.now,100);assert.equal(s.state.events.filter(e=>e.type==='knockdownTriggered').length,0);
});
test('below100 leaves normal knockdown behavior intact',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=99;a.knockdown.now=100;hit(s);
  assert.equal(a.mp,300+3);assert.equal(a.knockdown.activated,true);frame(s);assert.equal(a.knockdown.now,7);
});
test('air Mana Break follows original backY and AIR_DOWN_INVINCIBLE instead of zero-speed KD fall',()=>{
  const s=make(),a=s.actor('rf');a.grounded=false;a.lineId=null;a.y=4050;a.manaBreak.charge=130;
  hit(s,{...strike,REACT_TYPE:4,BACK_SPEED_Y:321});assert.equal(a.mp,300+3);assert.equal(a.manaBreak.pendingDown.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');
  finishBreak(s);assert.ok(Math.abs(a.mp-(300+3-130))<.1);assert.equal(a.state,'RSI_DAMAGE_AIR_DOWN_INVINCIBLE');assert.equal(a.grounded,false);
});
test('ground launch hit still reads the future support before its queued reaction is dispatched',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=130;hit(s,{...strike,REACT_TYPE:4});
  assert.equal(a.manaBreak.pendingDown.state,'RSI_DAMAGE_DOWN_FRONT');finishBreak(s);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');assert.equal(a.grounded,true);
});
test('NO_DETONATION blocks subsequent charge events; buff damage cannot clear the hit-state flag',()=>{
  const s=make(),a=s.actor('rf');hit(s,{...strike,NO_DETONATION:1});
  assert.equal(a.manaBreak.noDetonation,true);
  frame(s,{held:['Z']},.01);frame(s,{held:['Z']},.01);assert.equal(a.manaBreak.charge,0);
  // DT_BUFF ordinary applyHit is outside the older critical bridge's0..5 ABI.
  // Test the independently sourced7746 flag rule without inventing that path.
  manaBreakDamageReact(a,{...strike,DAMAGE_TYPE:6});assert.equal(a.manaBreak.noDetonation,true);
  s.enter(a,'RSI_DAMAGE_SMALL_FRONT','source-buff-hit-state');assert.equal(a.manaBreak.noDetonation,true);
  s.enter(a,'RSI_WAIT','source-normal-state');assert.equal(a.manaBreak.noDetonation,false);
});
test('compiled DT_BUFF special down branch preserves reserved cost and requests no invented down/stop',()=>{
  const result=native.manaBreak.evaluate('down',{mp:300,active:true,pendingCost:120,charge:120,damageType:6,grounded:true});
  assert.equal(result.state,null);assert.equal(result.hitStop,0);assert.equal(result.active,true);assert.equal(result.pendingCost,120);
});
test('core guard exits before Mana Break; armor alone does not skip original detonation tail',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=150;a.core.gauge=40;a.core.level=2;
  a.core.helperLive=true;a.awakening.remaining=20;
  const guarded=hit(s);assert.equal(guarded.guarded,true);assert.equal(a.mp,300+3);assert.equal(a.manaBreak.charge,150);
  const armored=make(),b=armored.actor('rf');b.manaBreak.charge=150;b.superArmor=true;
  hit(armored);assert.ok(b.manaBreak.pendingDown);assert.equal(b.mp,300+3);finishBreak(armored);assert.equal(b.state,'RSI_DAMAGE_DOWN_FRONT');assert.ok(Math.abs(b.mp-(300+3-150))<.1);assert.equal(b.knockdown.activated,false);
});
test('same-frame multi-hit consumes green only once; invalid hits never reserve or consume',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=130;hit(s);const mp=a.mp;
  hit(s);assert.equal(a.mp,mp);assert.equal(s.state.events.filter(e=>e.type==='manaBreakConsumed').length,0);finishBreak(s);assert.equal(s.state.events.filter(e=>e.type==='manaBreakConsumed').length,1);
  const rejected=make(),b=rejected.actor('rf');b.manaBreak.charge=130;b.invincible=true;
  assert.equal(hit(rejected).accepted,false);assert.equal(b.manaBreak.charge,130);assert.equal(b.mp,300);
});
test('original event rejects actual buff identity; Enchant Hand immediate factor does not invent2seconds',()=>{
  assert.equal(native.manaBreak.evaluate('event',{mp:300,heldZ:true,blockedByBuff:true}).canCharge,false);
  const s=make(),a=s.actor('rf');
  const result=createBuffFromFactor(profile,{factor:633,sourceActor:a,targetActor:a,roll:0,nativeValues:native.skillValues});
  assert.equal(result.supported,true);assert.equal(result.buff.behaviors[0].kind,'manaBreakBlock');
  assert.deepEqual(result.buff.finalizers,[{kind:'immediate',remaining:1}]);
  assert.equal(tickBuffs(profile,[result.buff],0,{targetActor:a,nativeValues:native.skillValues}).manaBreakBlock,true);
  assert.equal(tickBuffs(profile,[result.buff],.001,{targetActor:a,nativeValues:native.skillValues}).buffs.length,0);
});
const stun=profile.damageEffects.DAMAGE_EFFECT_RRF_Infernal_Arms_Effect_Stun.raw.DAMAGE_DATA.BUFF_FACTOR;
test('Mana Break clears prior registered stun, preserving the Buff and unrelated behavior/timers',()=>{
  const s=make(),a=s.actor('rf'),enemy=s.actor('target');s.grantBuff(enemy,a,stun,1);
  s.grantBuff(a,a,632,1);s.advanceActorBuffs(a,.01);assert.equal(a.buffControls.inputBlock,true);
  const empty=a.buffs.find(b=>b.templateId===543);const duration=empty.finalizers[0].remaining;
  // Isolate Mana Break's source identity consumer. A received hit now first
  // removes the old stun Buff under the user's separately tested cure rule.
  a.manaBreak.charge=130;reserveManaBreak(native.manaBreak,a,{grounded:true,fromFront:true});
  s.enter(a,'RSI_DAMAGE_DOWN_FRONT','mana-break-source-fixture');assert.equal(a.buffControls.inputBlock,false);
  assert.ok(a.buffs.flatMap(b=>b.behaviors).find(r=>r.kind==='stun').identityCleared);
  assert.equal(a.buffs.find(b=>b.templateId===543).finalizers[0].remaining,duration);
  s.advanceActorBuffs(a,.01);assert.equal(a.buffControls.inputBlock,false);
  s.grantBuff(enemy,a,stun,1);s.advanceActorBuffs(a,.01);assert.equal(a.buffControls.inputBlock,false,
    'source DidStart preserves the cleared registration of a retained/reapplied object');
});
test('this hit applies its new stun before Mana down StateStart, so its new identity is cleared too',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=130;hit(s,{...strike,BUFF_FACTOR:stun});
  assert.equal(a.mp,300+3);assert.ok(a.manaBreak.pendingDown);finishBreak(s);assert.ok(Math.abs(a.mp-(300+3-130))<.1);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');
  const row=a.buffs.flatMap(b=>b.behaviors).find(r=>r.kind==='stun');assert.equal(row.identityCleared,true);
  s.advanceActorBuffs(a,.01);assert.equal(a.buffControls.inputBlock,false);
});
test('user-required stun priority clears normal KD without consuming charged MP or clearing stun',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=99;a.knockdown.now=100;
  hit(s,{...strike,BUFF_FACTOR:stun});assert.equal(a.knockdown.activated,false);
  assert.equal(a.state,'RSI_DAMAGE_GROGGY');assert.equal(a.knockdown.now,0);assert.equal(a.knockdown.pending,null);
  frame(s);assert.equal(a.knockdown.activated,false);assert.equal(a.mp,Math.fround(300+3+Math.fround(1/60)));
  assert.notEqual(a.buffs.flatMap(b=>b.behaviors).find(r=>r.kind==='stun').identityCleared,true);
  s.advanceActorBuffs(a,.01);assert.equal(a.buffControls.inputBlock,true);
});

test('ordinary full KD still activates and is consumed on the next frame without a stunning hit',()=>{
  const s=make(),a=s.actor('rf');a.manaBreak.charge=99;a.knockdown.now=100;
  hit(s);assert.equal(a.knockdown.activated,true);assert.equal(a.state,'RSI_DAMAGE_DOWN_FRONT');
  frame(s);assert.equal(a.knockdown.activated,false);assert.equal(a.mp,Math.fround(300+3+Math.fround(1/60)));
});
test('JSON snapshot preserves event latch, pending cost, frozen charge and subsequent180inputs',()=>{
  const s=make(),a=s.actor('rf');for(let i=0;i<40;i++)frame(s,{held:['Z']});
  const copy=make();copy.restore(JSON.parse(JSON.stringify(s.snapshot())));
  for(let i=0;i<180;i++){
    const input=i<100?{held:['X']}:{released:i===100?['X']:[]};
    if(i===90){hit(s);hit(copy);} // V62 waits for the new X hold, without inheriting the earlier Z clock.
    frame(s,input);frame(copy,input);
  }
  assert.deepEqual(copy.snapshot(),s.snapshot());assert.ok(a.mp<300);
});
test('native bridge rejects malformed inputs instead of generating unknown gauge values',()=>{
  const n=native.manaBreak;
  assert.throws(()=>n.evaluate('other'),/phase/);assert.throws(()=>n.evaluate('frame',{elapsed:NaN}),/Finite/);
  assert.throws(()=>n.evaluate('event',{heldZ:1}),/Boolean/);assert.throws(()=>n.evaluate('down',{damageType:7}),/damage type/);
});
