/** Source-only proof, independent of current simulation regression output. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {RAVEN_STANDUP_SOURCE,RAVEN_NO_DOWN_STANDUP_STATES} from '../../packages/combat-core/raven-standup-source-v8.mjs';
const read=p=>JSON.parse(readFileSync(p));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const source=read('.cache/vc/raven-declarations.json');
assert.equal(sha(RAVEN_STANDUP_SOURCE.path),RAVEN_STANDUP_SOURCE.sha256);
const originalElsword='asset_work/raw/data/data036.kom/Elsword_SwordMan.lua';
const elswordHash='743fc48b74fd35ed69a2e8573acd2d7759d3005340ff4e1655c0678dbf741031';
assert.equal(sha(originalElsword),elswordHash);
const lk=read('packages/combat-core/lk-profile.json');
const charge=read('.cache/common-charge-standup-v8/elsword-charge-rows.json');
for(const [name,raw]of Object.entries(charge)){
  assert.deepEqual(lk.states[name].raw,raw);assert.equal(raw.CAN_MANA_BREAK,0);
}
const rf=read('packages/combat-core/rf-profile.json');
for(const [name,state]of Object.entries(RAVEN_NO_DOWN_STANDUP_STATES)){
  assert.deepEqual(state.raw,source.globals[name]);
  assert.deepEqual(state.sourcePc,source.locations[name]);
  assert.deepEqual(state.clip,rf.clips[state.animationName]);
}
const referencePath='.cache/native-source-runtime/X2Lib/X2GURaven.cpp';
const cpp=readFileSync(referencePath).toString('latin1');
const method=name=>{
  const needle=`::${name}()`;assert.equal(cpp.split(needle).length,2);
  const marker=cpp.indexOf(needle),start=cpp.lastIndexOf('\n',marker)+1;
  let end=cpp.indexOf('{',marker)+1,depth=1;
  for(;depth;end++){if(cpp[end]==='{')depth++;if(cpp[end]==='}')depth--;}
  const body=cpp.slice(start,end);
  return {name,lineStart:cpp.slice(0,start).split('\n').length,lineEnd:cpp.slice(0,end).split('\n').length,
    sha256:createHash('sha256').update(Buffer.from(body,'latin1')).digest('hex')};
};
const methods=['RVC_DASH_COMBO_ZZZ_StateStart','RVC_DASH_COMBO_ZZZPushZ_READY_StateStart',
  'RVC_DASH_COMBO_ZZZPushZ_StateStart','RSI_STANDUP_ATTACK_FRONT_NO_DOWN_End','RSI_STANDUP_ATTACK_BACK_NO_DOWN_End'].map(method);
const proof={schema:'common-charge-standup-sources-v8',targetClientMeasured:false,
  evidenceClass:'target2016-static-declarations+fixedV5-consumer-candidate+user-rule',
  originals:[RAVEN_STANDUP_SOURCE,{path:originalElsword,sha256:elswordHash}],
  reference:{commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',localInput:referencePath,sha256:sha(referencePath),methods},
  originalChargeRows:charge,originalRavenNonDown:Object.fromEntries(Object.entries(RAVEN_NO_DOWN_STANDUP_STATES).map(([k,v])=>[k,{raw:v.raw,clip:v.clip,sourcePc:v.sourcePc}])),
  sourceRules:{vcHeldZ:'three fixed Raven state starts set NoDetonation(true); End clears it; ordinary DamageReact replaces the flag',
    lkCharge:'2016 both CAN_MANA_BREAK=0; voluntary charge hold must not accumulate green',
    ravenNonDown:'original two GetChance poses, .23-.4 hit window, REACT_TYPE2, back speed500; state End supplies .3 seconds invulnerability'},
  userRules:{xRise:'X deterministically chooses non-down; ignore old full knockdown threshold; Z keeps original down attack',
    lkRise:'no source non-down LK pose validated; current LK standup attack pose/hit timing reused with non-down reaction',
    input:'strict source .66-second choice window; X held through the boundary is an explicit web input accommodation'},
  resourceReuse:{newMeshBytes:0,newPoseKeyBytes:0,vcSharedClipNames:['SI_A_RF_GET_CHANCE_FRONT','SI_A_RF_GET_CHANCE_BACK']},
  limitations:['No original2016 runtime trace or native GPU measurement','Fixed reference consumer macros are separate from the target declaration','LK X non-down outcome and held-X input accommodation are user-specified adapters']};
writeFileSync('contracts/common-charge-standup-source-v8.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({matchedRavenNonDown:2,matchedLkChargeRows:2,fixedReferenceMethods:methods.length,newModelBytes:0}));
