import {readFileSync} from 'node:fs';
import {addFixture} from './add-fixture.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {createNativeSamplers,mergeEffectIndexes} from '../../packages/combat-assets/index.mjs';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const cache=new Map();
export function originalAddSamplers(id){
 if(cache.has(id))return cache.get(id);
 const base='artifacts/'+id.toLowerCase()+'/',manifest=read(base+'manifest.json'),raw=read(base+manifest.runtimePose);
 const characterPose=composeCharacterPose(raw,raw.sharedPose?read(base+raw.sharedPose):null);
 const visuals=addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...(manifest.visualEffectIndexes??[]).map(p=>read(base+p))),id);
 const effectIndex=mergeEffectIndexes(read(base+manifest.effectAssetIndex),visuals);
 const effectPoses=Object.fromEntries([...new Set(Object.values(effectIndex.templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,read(base+p)]));
 const samplers=createNativeSamplers({profile:PROFESSION_PROFILES[id],characterPose,effectIndex,effectPoses});
 cache.set(id,samplers);return samplers;
}
export function originalAddFixture(id,options={}){return addFixture(id,{...options,samplers:originalAddSamplers(id)});}
