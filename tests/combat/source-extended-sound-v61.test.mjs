import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getSourceExtendedSoundEntries,sourceExtendedSoundEntryForField,
  sourceSoundDeleteConditionMatches,SOURCE_DELETE_CONDITION_SOUND} from '../../packages/combat-core/source-extended-sound-v61.mjs';
const profile=id=>JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id}-profile.json`,import.meta.url),'utf8'));
const gm=profile('gm'),ca=profile('ca'),de=profile('de');

test('native EX columns are name, animation time and delete conditions, not rate',()=>{
  const raw=gm.states.ESI_A_SGM_PROVOKE.raw;
  const [entry]=getSourceExtendedSoundEntries(raw);
  assert.equal(entry.name,'ElesisVoice_Provoke01.ogg');
  assert.equal(entry.time,.001);assert.equal(entry.rate,100);
  assert.equal(entry.loop,false);assert.equal(entry.onlyIfLocal,false);
  assert.deepEqual(entry.deleteConditions,[4]);
  assert.equal(sourceSoundDeleteConditionMatches(entry,4),true);
  assert.equal(sourceSoundDeleteConditionMatches(entry,2),false);
  assert.strictEqual(sourceExtendedSoundEntryForField(raw,null,'SOUND_PLAY_EX:1'),entry);
  assert.equal(sourceExtendedSoundEntryForField(raw,null,'SOUND_PLAY_EX:0'),null);
});

test('GM 66XX retains both original timed rows and state-end conditions',()=>{
  const entries=getSourceExtendedSoundEntries(gm.states.ESI_DASH_COMBO_SGM_XX_ATTACK.raw);
  assert.deepEqual(entries.map(e=>[e.field,e.name,e.time,e.deleteConditions]),[
    ['SOUND_PLAY_EX:1','Elesis_SGM_XX_Attack1.ogg',.28,[2]],
    ['SOUND_PLAY_EX:2','ElesisVoice_Shout12.ogg',.43,[2]],
  ]);
});

test('all eight currently reachable extension rows retain original fields and non-looping playback',()=>{
  const actual=[];
  for(const [id,p]of [['GM',gm],['CA',ca],['DE',de]])for(const [state,d]of Object.entries(p.states))
    for(const entry of getSourceExtendedSoundEntries(d.raw))actual.push({id,state,entry});
  assert.equal(actual.length,8);assert.equal(actual.filter(r=>r.entry.kind==='state').length,3);
  for(const {entry}of actual){assert.equal(entry.loop,false);assert.equal(entry.rate,100);}
  assert.deepEqual(actual.filter(r=>r.entry.kind==='state').map(r=>[r.entry.name,r.entry.time]),[
    ['Elesis_BrandishiBreaker03.ogg',.01],['Elesis_BurningPhantom2.ogg',.001],['ADD_VOID_FIELD02.ogg',.001],
  ]);
  assert.equal(getSourceExtendedSoundEntries(ca.states.ESI_DASH_COMBO_SCA_XZ_CHARGE.raw)[0].time,.1);
  assert.equal(getSourceExtendedSoundEntries(ca.states.ESI_DASH_JUMP_COMBO_SDK_ZX_CHARGE.raw)[0].time,.001);
});

test('parsing uses consecutive native rows and preserves separate state handles',()=>{
  const raw={SOUND_PLAY_EX:{1:{1:'first.ogg',2:.1,3:2,4:4},3:{1:'gap.ogg',2:.2}},
    STATE_SOUND_PLAY0:{1:.01,2:'state.ogg',3:60,4:1},STATE_SOUND_PLAY2:{1:.3,2:'gap.ogg'}};
  const entries=getSourceExtendedSoundEntries(raw);
  assert.deepEqual(entries.map(e=>e.name),['first.ogg','state.ogg']);
  assert.deepEqual(entries[0].deleteConditions,[2,4]);
  assert.equal(entries[1].onlyIfLocal,true);assert.equal(entries[1].rate,60);
  assert.equal(entries[1].nativeHandleGroup,'state');
  assert.equal(sourceSoundDeleteConditionMatches(entries[1],2),false);
  assert.strictEqual(getSourceExtendedSoundEntries(raw),entries);
  assert.throws(()=>entries.push({}),TypeError);
  assert.throws(()=>entries[0].deleteConditions.push(3),TypeError);
});

test('unsupported bank combinations and missing/invalid fields do not invent audio',()=>{
  assert.deepEqual(getSourceExtendedSoundEntries(null),[]);
  assert.deepEqual(getSourceExtendedSoundEntries(gm.states.ESI_A_SGM_PROVOKE.raw,{selected:0,mode:'NORMAL'}),[]);
  assert.deepEqual(getSourceExtendedSoundEntries({STATE_SOUND_PLAY0:{1:NaN,2:'bad.ogg'}}),[]);
  assert.deepEqual(getSourceExtendedSoundEntries({SOUND_PLAY_EX:{1:{1:''},2:{1:'after-empty.ogg'}}}),[]);
  assert.equal(sourceSoundDeleteConditionMatches({nativeHandleGroup:'condition',deleteConditions:[0,7]},0),false);
  assert.equal(sourceSoundDeleteConditionMatches({nativeHandleGroup:'condition',deleteConditions:[7]},7),false);
  assert.deepEqual(SOURCE_DELETE_CONDITION_SOUND,{DCS_NONE:0,DCS_DAMAGE_REACT:1,DCS_STATE_END:2,DCS_DIE:3,DCS_CUSTOM_STATE:4,DCS_SKILL_STATE_END:5});
});
