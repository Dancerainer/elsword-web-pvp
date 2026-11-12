/** Original f32 literals/previous<t<=now come from independent native bytes
 * in ca-commands-native-v58.json, not from production output snapshots. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {caOriginalCommandWaveEvents} from '../../packages/combat-core/ca-command-native-v58.mjs';
function fixture(mp=20){
 const a={professionId:'CA',mp,fired:[]},sets=[],notes=[],calls=[];
 const sim={fire(actor,id,at,before,after,fn){calls.push({at,before,after});
  if(!actor.fired.includes(id)&&before<=at&&after>=at&&after>before){actor.fired.push(id);fn();}},
  spawnSet(_a,name){sets.push(name);},note(...args){notes.push(args)}};
 return {a,sim,sets,notes,calls};
}
for(const[state,at,name]of [
 ['START',.43,'EffectSet_C_SCA_Dash_ZZZ'],['LOOP_1',.01,'EffectSet_C_SCA_Dash_ZZZ_Uppercut'],
 ['LOOP_1',.25,'EffectSet_C_SCA_Dash_ZZZ'],['LOOP_2',.08,'EffectSet_C_SCA_Dash_ZZZ'],
 ['LOOP_2',.31,'EffectSet_C_SCA_Dash_ZZZ_Uppercut'],['END',.37,'EffectSet_C_SCA_Dash_ZZZ_Finish'],
])test(`CA ${state}: original f32 ${at} exact crossing emits once and excludes previous==threshold`,()=>{
 const n='ESI_DASH_COMBO_SCA_ZZZ_'+state,target=Math.fround(at),f=fixture();
 caOriginalCommandWaveEvents(f.sim,f.a,n,target-1e-5,target);
 assert.deepEqual(f.sets,[name]);assert.equal(f.a.mp,17);
 caOriginalCommandWaveEvents(f.sim,f.a,n,target,target+1e-5);assert.deepEqual(f.sets,[name]);
 const late=fixture();caOriginalCommandWaveEvents(late.sim,late.a,n,target,target+1e-5);
 assert.deepEqual(late.sets,[],'strict previous<t; a fresh late controller cannot replay the passed cue');
 const early=fixture();caOriginalCommandWaveEvents(early.sim,early.a,n,target-2e-5,target-1e-5);assert.deepEqual(early.sets,[]);
});
test('CA stored f32 clocks, MP3 gate and unrelated professions are scoped to this new native callback',()=>{
 const f=fixture(3);caOriginalCommandWaveEvents(f.sim,f.a,'ESI_DASH_COMBO_SCA_ZZZ_START',.42,.43);
 assert.deepEqual(f.sets,['EffectSet_C_SCA_Dash_ZZZ']);assert.equal(f.a.mp,0);
 const noMp=fixture(2);caOriginalCommandWaveEvents(noMp.sim,noMp.a,'ESI_DASH_COMBO_SCA_ZZZ_END',.36,Math.fround(.37));
 assert.deepEqual(noMp.sets,[]);assert.equal(noMp.a.mp,2);assert.equal(noMp.notes.length,1);
 const other=fixture();other.a.professionId='BH';caOriginalCommandWaveEvents(other.sim,other.a,'ESI_DASH_COMBO_SCA_ZZZ_START',0,1);
 assert.deepEqual(other.calls,[]);
});
