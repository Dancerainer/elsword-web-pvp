/** Original2016 recipient-space STOP/STOP2 policy. This resolves one request;
 * existing Web timer aggregation is deliberately outside this source rule. */
import source from '../../contracts/source-distance-native-v45.json' with {type:'json'};
export const SOURCE_STOP_DISTANCE_VERSION='source-stop-distance-v45';
const position=a=>[a.x,a.y,a.z];
const vector=value=>{if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw TypeError('Invalid original stop position');return value;};
const duration=value=>{if(!Number.isFinite(value)||value<0)throw TypeError('Invalid original stop duration');return value;};
export function sourceStopRadii(nativeGameType=1){
 const row=nativeGameType===1?source.unitStop.pvpGameType1:[2,3,4].includes(nativeGameType)?source.unitStop.nativeOtherModes2To4:null;
 if(!row||!(row.fullRadius>0)||!(row.halfRadius>row.fullRadius))throw TypeError('Unsupported original stop game type or source radii');
 return {fullRadius:row.fullRadius,halfRadius:row.halfRadius};
}
export function sourceStopDuration(a,b,requested,{nativeGameType=1,kind='other',otherTeam=false,ownDuration=0}={}){
 duration(requested);duration(ownDuration);
 if(!['all','other'].includes(kind))throw TypeError('Invalid original stop iterator');
 const {fullRadius,halfRadius}=sourceStopRadii(nativeGameType);
 if(kind==='other'&&(a.id===b.id||(otherTeam||[2,3,4].includes(nativeGameType))&&a.team===b.team))return 0;
 if(kind==='all'&&a.id===b.id&&ownDuration>0)return ownDuration;
 const from=vector(position(a)),to=vector(position(b));
 // Keep the existing Web Euclidean evaluator; the acquired policy proves
 // source XYZ and strict bands, not bit-exact native arithmetic ordering.
 const distance=Math.hypot(...to.map((n,i)=>n-from[i]));
 return distance<fullRadius?requested:distance<halfRadius?requested/2:0;
}
