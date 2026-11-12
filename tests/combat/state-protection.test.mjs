import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateStateProtection,shouldDeleteDamageReactEffects} from '../../packages/combat-core/state-protection.mjs';

const contract=JSON.parse(readFileSync(new URL('../../contracts/rf-state-protection-source.json',import.meta.url),'utf8'));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePath=relative=>[
  new URL('../../.cache/native-source-runtime/'+relative,import.meta.url),
  new URL('../../.cache/native-reference/'+relative,import.meta.url),
].find(path=>existsSync(path));
const sourceReady=contract.sourceFiles.every(source=>sourcePath(source.relativePath));

test('frozen original consumer bytes and independent source slices match the contract',{skip:!sourceReady},()=>{
  for(const source of contract.sourceFiles){
    const bytes=readFileSync(sourcePath(source.relativePath));
    assert.equal(hash(bytes),source.sha256,source.relativePath);
    assert.equal(bytes.length,source.bytes);
    assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),source.gitBlob);
  }
  for(const section of contract.sourceSections){
    // latin1 retains every original byte, including CRLF and the source encoding.
    const text=readFileSync(sourcePath(section.relativePath)).toString('latin1');
    const lines=text.match(/[^\n]*\n|[^\n]+$/g);
    const excerpt=Buffer.from(lines.slice(section.lineStart-1,section.lineEnd).join(''),'latin1');
    assert.equal(hash(excerpt),section.sha256,section.name);
    for(const marker of section.markers)assert.ok(excerpt.includes(Buffer.from(marker,'ascii')),`${section.name}: ${marker}`);
  }
});

const originalRaven='asset_work/raw/data/data036.kom/RAVEN_FIGHTER.lua';
const originalEnum='asset_work/raw/data/data036.kom/Enum.lua';
test('target fields and reaction values match independent 2016 declaration evidence',{
  skip:!existsSync(originalRaven)||!existsSync(originalEnum),
},()=>{
  assert.equal(hash(readFileSync(originalRaven)),contract.targetSource.sha256);
  assert.equal(hash(readFileSync(originalEnum)),contract.targetEnumSource.sha256);
  assert.equal(profile.sources.raven.sha256,contract.targetSource.sha256);
  for(const example of contract.targetExamples){
    const state=profile.states[example.state];assert.ok(state,example.state);
    const actual=Object.fromEntries(Object.entries(state.raw).filter(([key])=>key.startsWith('SUPER_ARMOR')||key==='INVINCIBLE'));
    assert.deepEqual(actual,example.fields,example.state);
    assert.deepEqual(state.sourcePc,example.sourcePc,example.state+' target KL assignment');
  }
  assert.equal(profile.enums.REACT_TYPE.RT_NO_DAMAGE,0);
  assert.equal(profile.enums.REACT_TYPE.RT_DUMMY_DAMAGE,7);
  assert.equal(profile.enums.REACT_TYPE.RT_FLIP_DIFF_DIR_DUMMY_DAMAGE,22);
  assert.deepEqual(contract.semantics.damageReactCleanup.excludedTargetValues,{RT_DUMMY_DAMAGE:7,RT_FLIP_DIFF_DIR_DUMMY_DAMAGE:22});
});

test('missing state protection is unprotected with the original NOT_RED default',()=>{
  for(const raw of [undefined,null,{}])
    assert.deepEqual(evaluateStateProtection(raw,0),{invincible:false,superArmor:false,superArmorNotRed:true});
});

test('invincible animation window includes its start and excludes its end',()=>{
  // Target Archenemy declaration; independent literal values, not observed output.
  const raw={INVINCIBLE:{1:.01,2:1.72}};
  assert.deepEqual([0,.009,.01,1.7199,1.72,2].map(t=>evaluateStateProtection(raw,t).invincible),[false,false,true,true,false,false]);
  assert.equal(evaluateStateProtection(raw,0,{initial:true}).invincible,false);
  assert.equal(evaluateStateProtection({INVINCIBLE:{1:0,2:0}},0).invincible,false);
});

test('state entry evaluates zero rather than its passed clock and has no sentinel filter',()=>{
  assert.equal(evaluateStateProtection({INVINCIBLE:{1:0,2:1}},8,{initial:true}).invincible,true);
  assert.equal(evaluateStateProtection({INVINCIBLE:{1:2,2:3}},2.5,{initial:true}).invincible,false);
  // GUUser 14261 differs deliberately from CommonFrameMove_Invincible 18081.
  const sentinel={INVINCIBLE:{1:-1,2:1}};
  assert.equal(evaluateStateProtection(sentinel,0,{initial:true}).invincible,true);
  assert.equal(evaluateStateProtection(sentinel,0).invincible,false);
  assert.equal(evaluateStateProtection({INVINCIBLE:{1:0,2:-1}},0,{initial:true}).invincible,false);
});

test('missing invincible endpoints use native -1 defaults and numbered tables do not substitute',()=>{
  assert.equal(evaluateStateProtection({INVINCIBLE:{2:1}},0,{initial:true}).invincible,true);
  assert.equal(evaluateStateProtection({INVINCIBLE:{2:1}},0).invincible,false);
  assert.equal(evaluateStateProtection({INVINCIBLE:{1:0}},0,{initial:true}).invincible,false);
  assert.equal(evaluateStateProtection({INVINCIBLE0:{1:0,2:1}},0).invincible,false);
});

test('positive force timer overrides a missing, expired, or sentinel invincible window',()=>{
  for(const raw of [{},{INVINCIBLE:{1:0,2:1}},{INVINCIBLE:{1:-1,2:-1}}]){
    assert.equal(evaluateStateProtection(raw,2,{forceInvincible:.0001}).invincible,true);
    assert.equal(evaluateStateProtection(raw,2,{forceInvincible:0}).invincible,false);
    assert.equal(evaluateStateProtection(raw,2,{forceInvincible:-.1}).invincible,false);
  }
});

test('Hell Dive armor includes both endpoints but time armor is not applied during state entry',()=>{
  const raw={SUPER_ARMOR_TIME0:{1:0,2:.57},SUPER_ARMOR_NOT_RED:0};
  assert.deepEqual([-.001,0,.5699,.57,.5701].map(t=>evaluateStateProtection(raw,t).superArmor),[false,true,true,true,false]);
  assert.equal(evaluateStateProtection(raw,0,{initial:true}).superArmor,false);
  assert.equal(evaluateStateProtection(raw,0).invincible,false,'armor is not invincibility');
  assert.equal(evaluateStateProtection(raw,0).superArmorNotRed,false);
});

test('XX6X armor starts at .1 and state-level successor armor is already on at entry',()=>{
  const first={SUPER_ARMOR_TIME0:{1:.1,2:100},SUPER_ARMOR_NOT_RED:0};
  assert.deepEqual([0,.0999,.1,100,100.0001].map(t=>evaluateStateProtection(first,t).superArmor),[false,false,true,true,false]);
  assert.equal(evaluateStateProtection({SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:0},0,{initial:true}).superArmor,true);
  assert.equal(evaluateStateProtection({SUPER_ARMOR:true},999).superArmor,true);
  assert.equal(evaluateStateProtection({SUPER_ARMOR:0},0).superArmor,false);
  assert.equal(evaluateStateProtection({SUPER_ARMOR:1,SUPER_ARMOR_NOT_RED:false},0).superArmorNotRed,false);
});

test('armor loads contiguous numbered windows and stops at the first absent table',()=>{
  const first={SUPER_ARMOR_TIME0:{1:2,2:3}},second={SUPER_ARMOR_TIME1:{1:5,2:6}};
  assert.deepEqual([2,3,4,5,6,6.001].map(t=>evaluateStateProtection({...first,...second},t).superArmor),[true,true,false,true,true,false]);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME2:{1:0,2:1}},.5).superArmor,false);
  assert.equal(evaluateStateProtection({...first,SUPER_ARMOR_TIME2:{1:0,2:1}},.5).superArmor,false);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME:{1:0,2:1}},.5).superArmor,false);
});

test('armor missing endpoints use zero defaults while host malformed endpoints remain bounded',()=>{
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME0:{}},0).superArmor,true);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME0:{2:1}},.5).superArmor,true);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME0:{1:1}},.5).superArmor,false);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME0:'not a table'},0).superArmor,false);
  assert.equal(evaluateStateProtection({SUPER_ARMOR_TIME0:{1:NaN,2:1}},.5).superArmor,true,'host fallback policy, not native malformed-Lua evidence');
});

test('reaction cleanup preserves armored or invincible effects and excludes exactly dummy 7 and dummy flip 22',()=>{
  for(const superArmor of [false,true])for(const invincible of [false,true])for(let type=0;type<=22;type++){
    const expected=!superArmor&&!invincible&&type!==7&&type!==22;
    assert.equal(shouldDeleteDamageReactEffects({superArmor,invincible},type),expected,`${superArmor}/${invincible}/${type}`);
  }
  assert.equal(shouldDeleteDamageReactEffects({superArmor:false,invincible:false},0),true,'RT_NO_DAMAGE is not excluded by this original cleanup if');
});

test('state transitions do not inherit protection from a previous raw state',()=>{
  const armored={SUPER_ARMOR:1,INVINCIBLE:{1:0,2:100}};
  assert.deepEqual(evaluateStateProtection(armored,.2),{invincible:true,superArmor:true,superArmorNotRed:true});
  assert.deepEqual(evaluateStateProtection({},0,{initial:true}),{invincible:false,superArmor:false,superArmorNotRed:true});
  const before=structuredClone(armored);evaluateStateProtection(armored,.7);assert.deepEqual(armored,before);
});

test('nonfinite or nonnumeric animation clocks and force timers are rejected at the host boundary',()=>{
  for(const clock of [NaN,Infinity,-Infinity,'0',null])assert.throws(()=>evaluateStateProtection({},clock),TypeError);
  for(const forceInvincible of [NaN,Infinity,-Infinity,'1',null])
    assert.throws(()=>evaluateStateProtection({},0,{forceInvincible}),TypeError);
});
