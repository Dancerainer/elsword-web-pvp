/** Authored Web Buff objects from the production factory and frozen numeric
 * WASM. This is a codec fixture, not a captured original-client packet. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';
import {createBuffFromFactor,tickBuffs} from '../../packages/combat-core/buffs.mjs';
import {encodeOwnedStatusSource} from '../../packages/online/owned-state.mjs';
export async function authoredBuffFixtures(){
 const wasmPath=process.env.RF_CODEC_SKILL_VALUES??fileURLToPath(new URL('../../artifacts/native/skill-values.wasm',import.meta.url));
 const binary=readFileSync(wasmPath),nativeValues=await instantiateNativeSkillValues(binary),hash=value=>createHash('sha256').update(value).digest('hex');
 const sourceActor={id:'source',stats:{physicalAttack:2000,magicAttack:1500}},targetActor={id:'target',hp:5000,hpMax:10000,mp:100,mpMax:300,stateSerial:1,buffResistances:{0:0,1:0},debuffDurationMultiplier:1};
 const factors={RF:42,BM:146,VC:84,LK:321,RS:236,IS:629,GM:143,BH:143,CA:143,LP:357,MM:369,DE:347},profiles={},rows=[];
 for(const [id,factor]of Object.entries(factors)){
  const path=new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url),raw=readFileSync(path),profile=profiles[id]=JSON.parse(raw);
  const result=createBuffFromFactor(profile,{factor,sourceActor,targetActor,roll:0,nativeValues});
  assert.equal(result.supported,true,id+': '+JSON.stringify(result.unsupported));assert.equal(result.accepted,true,id);
  const buff=encodeOwnedStatusSource({buffs:[result.buff],invincible:false,superArmor:false,superArmorNotRed:true},{projectResources:false}).buffs[0];
  rows.push({id,factor,profileSha256:hash(raw),buff});
 }
 return {rows,profiles,nativeValues,sourceActor,targetActor,wasm:{path:wasmPath,bytes:binary.length,sha256:hash(binary)},
  tick(id,buffs){return tickBuffs(profiles[id],buffs,1/60,{targetActor,nativeValues,advanceIntervals:false}).buffs;}};
}
