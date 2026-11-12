import caShield from '../../contracts/ca-shield-visual-v45.json' with {type:'json'};
import bhAirFire from '../../contracts/bh-air-fire-visual-v45.json' with {type:'json'};
import moonlight from '../../contracts/de-moonlight-visual-v45.json' with {type:'json'};
import deAirCombo from '../../contracts/de-air-combo-visual-v45.json' with {type:'json'};
import counterWait from '../../contracts/lk-counter-visual-v49.json' with {type:'json'};
import {completeAddStardustFinalVisuals} from './add-stardust-final-visual-v58.mjs';
import {addMmChaserTrailTexture,MM_CHASER_TRAIL_TEXTURE} from './mm-chaser-trail-v61.mjs';
import {addCrestDisplayTemplates,ADD_CREST_SOURCE_FILES} from './add-crest-display-v61.mjs';
import caFinish from '../../contracts/ca-finish-visual-v58.json' with {type:'json'};

const swordIds=['LK','RS','IS'];
const counterIndexPath='lk/counter-v49/index.json';
function counterTemplates(id){return Object.fromEntries(Object.entries(counterWait.templates).map(([name,t])=>[name,{...t,
 textures:Object.fromEntries(Object.entries(t.textures??{}).map(([key,row])=>[key,{...row,file:(id==='LK'?'':'../lk/')+row.file}]))}]));}
/** The additive release index is read by both loaders and sealed by the server.
 * Its parsed content must equal the frozen source closure before rebasing. */
export async function loadPlayerFeedbackVisualIndexes(id,readAsset){
 if(!swordIds.includes(id))return [];
 const index=await readAsset(counterIndexPath);
 if(JSON.stringify(index)!==JSON.stringify(counterWait))throw TypeError('Counter Wait source closure mismatch');
 return [{...index,templates:counterTemplates(id)}];
}
export function playerFeedbackVisualIndexFiles(id){return swordIds.includes(id)?[counterIndexPath]:[];}
export function playerFeedbackVisualTextureFiles(id){return [...(swordIds.includes(id)?Object.values(counterWait.templates)
 .flatMap(t=>Object.values(t.textures??{}).map(r=>'lk/'+r.file)):[]),...(id==='MM'?['mm/'+MM_CHASER_TRAIL_TEXTURE.file]:[])];}

/** Additive, source-hashed closures. Existing resource/proof objects retain
 * ownership; conflicting original declarations fail before rendering starts. */
export function addPlayerFeedbackVisuals(index,id){
 const additions=id==='CA'?caShield:id==='BH'?bhAirFire:id==='DE'?deAirCombo:null;
 if(index.schemaVersion!==moonlight.schemaVersion||index.referenceVersion!==moonlight.referenceVersion)throw TypeError('Player feedback visual target version mismatch');
 const templates={...index.templates};
 const counter=swordIds.includes(id)?counterTemplates(id):{};
 const common=Object.fromEntries(Object.entries(moonlight.templates).map(([name,t])=>[name,{...t,
  ...(t.glb?{glb:'../de/'+t.glb}:{}),...(t.poseData?{poseData:'../de/'+t.poseData}:{}),
  textures:Object.fromEntries(Object.entries(t.textures??{}).map(([key,row])=>[key,{...row,file:'../de/'+row.file}]))}]));
 for(const [name,template]of Object.entries({...common,...additions?.templates,...(id==='CA'?caFinish.templates:{}),...counter})){
  const existing=templates[name];
  if(existing){if(existing.declarationSha256!==template.declarationSha256||existing.kind!==template.kind)throw Error('Player feedback original declaration conflict: '+name);}
  else templates[name]=template;
 }
 completeAddStardustFinalVisuals(templates,id);
 addCrestDisplayTemplates(templates,id);
 addMmChaserTrailTexture(templates,id);
 return {...index,templates,playerFeedbackSourceFiles:[...moonlight.sourceFiles,...ADD_CREST_SOURCE_FILES,...(additions?.sourceFiles??[]),...(id==='CA'?caFinish.sourceFiles:[]),...(swordIds.includes(id)?counterWait.sourceFiles:[])],
  playerFeedbackContracts:['contracts/add-crest-display-v61.json',...(id==='MM'?['contracts/mm-chaser-trail-v61.json']:[]),'contracts/de-moonlight-visual-v45.json',...(additions?[id==='CA'?'contracts/ca-shield-visual-v45.json':id==='BH'?'contracts/bh-air-fire-visual-v45.json':'contracts/de-air-combo-visual-v45.json']:[]),
   ...(id==='CA'?['contracts/ca-finish-visual-v58.json']:[]),...(swordIds.includes(id)?['contracts/lk-counter-visual-v49.json','contracts/lk-counter-native-v49.json']:[])]};
}
