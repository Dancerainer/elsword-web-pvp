import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {make} from './rf-passive-fixture-v12.mjs';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';

// This private candidate is deliberately not a new production manifest seal.
// Root seals the new skills plus the unchanged nine paired modules at release.
const binary=readFileSync(new URL('../../.cache/native-awakened-skills-v17/skills.wasm',import.meta.url));
export const skillsSha256=createHash('sha256').update(binary).digest('hex');
export const skillsModule=await WebAssembly.compile(binary);
export async function makeAwakenedSkills(options={}){
  const s=await make({...options,passives:[],targetPassives:[]});
  s.nativeSkills=await instantiateNativeSkills(skillsModule);
  s.versions=Object.freeze({...s.versions,nativeSkills:skillsSha256});s.state.versions=s.versions;
  return s;
}
