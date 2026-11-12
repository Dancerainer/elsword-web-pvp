/** Independent original declaration/clip receipts, never simulation hit gold. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {ELSWORD_STANDUP_SOURCE,ELSWORD_NO_DOWN_STANDUP_STATES} from '../../packages/combat-core/elsword-standup-source-v2.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(readFileSync(p));
assert.equal(sha(readFileSync(ELSWORD_STANDUP_SOURCE.path)),ELSWORD_STANDUP_SOURCE.sha256);
const decoded=read('.cache/is-target/elsword-declarations.json'),clips=read('artifacts/lk/clips.json');
const originals={};
for(const [name,state]of Object.entries(ELSWORD_NO_DOWN_STANDUP_STATES)){
  const original=decoded.globals[name],clip=clips.find(c=>c.name===original.ANIM_NAME);
  assert.deepEqual(state.raw,original);assert.deepEqual(state.sourcePc,decoded.locations[name]);
  const info=Object.fromEntries(Object.keys(state.clip).map(k=>[k,clip[k]]));assert.deepEqual(state.clip,info);
  originals[name]={raw:original,sourcePc:decoded.locations[name],clip:info};
}
const path='.cache/is-source/X2GUElsword_SwordMan.cpp',bytes=readFileSync(path),cpp=bytes.toString('latin1');
assert.equal(sha(bytes),'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d');
function method(name){
  const needle=`::${name}()`;assert.equal(cpp.split(needle).length,2);
  const marker=cpp.indexOf(needle),start=cpp.lastIndexOf('\n',marker)+1;let end=cpp.indexOf('{',marker)+1,depth=1;
  for(;depth;end++){if(cpp[end]==='{')depth++;if(cpp[end]==='}')depth--;}
  return {name,lineStart:cpp.slice(0,start).split('\n').length,lineEnd:cpp.slice(0,end).split('\n').length,
    sha256:sha(Buffer.from(cpp.slice(start,end),'latin1'))};
}
const result={schema:'six-profession-fast-standup-sources-v2',targetClientMeasured:false,
  originals:[ELSWORD_STANDUP_SOURCE],originalElswordNonDown:originals,
  reference:{commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',localInput:path,sha256:sha(bytes),
    methods:['DamageDownFrontEventProcess','DamageDownBackEventProcess','DamageAirDownLandingEventProcess',
      'StandUpAttackFrontNoDownEventProcess','StandUpAttackBackNoDownEventProcess',
      'StandUpAttackFrontNoDownEnd','StandUpAttackBackNoDownEnd'].map(method)},
  priorRavenSource:'contracts/common-charge-standup-source-v8.json',
  sourceRules:{motion:'Both Elsword and Raven GetChance original clip periods are 0.7 seconds; item attack speed still applies',
    transition:'Existing fixedV5 SkinAnim period-transitionTime threshold is retained; no original XET override is claimed',
    input:'Original animation time >0.66 queues X; execute after the down clip ends',
    hit:'Original non-down attack window 0.23–0.4 seconds; back pose FLIP_DIR_END=1',
    protection:'Original INVINCIBLE window during motion; fixedV5 End adds 0.3 seconds force/show protection'},
  userRules:{professionScope:['RF','LK','VC','RS','BM','IS'],x:'Deterministic non-down GetChance path; full knockdown gauge must not turn this hit into knockdown',
    heldX:'Held X through the permitted boundary is the existing web keyboard accommodation; an early released tap is ignored'},
  resourceReuse:{newMeshBytes:0,newOriginalClipConversions:0,rsCompactPoseExpandsExistingKeys:true,
    elswordSharedModelClips:Object.keys(originals).map(k=>originals[k].raw.ANIM_NAME)},
  limits:['No original2016 runtime trace or original GPU comparison','Deterministic X outcome is a user rule; source passive probability is not claimed']};
writeFileSync('contracts/fast-standup-source-v2.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({matchedOriginalStates:Object.keys(originals).length,referenceMethods:result.reference.methods.length,newMeshBytes:0,rsCompactPoseExpansion:true}));
