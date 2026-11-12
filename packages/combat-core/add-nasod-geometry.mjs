/** Fixed V5 KTDGLineMap.cpp 2004..2069 traversal adapter. Land and distance
 * queries run in the existing original C++ module. This is not a flat-X offset.
 * IEEE float32 arithmetic follows the source expression boundaries. */
const f=Math.fround;
export function addFixedDistancePosition(geometry,map,{position,distance,right}){
 if(!geometry?.land||!geometry?.distance)throw new TypeError('Original land and distance queries required');
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||!Number.isFinite(distance)||distance<0||typeof right!=='boolean')throw new TypeError('Invalid Nasod distance query');
 const q=geometry.land({position,radius:30,lastLineId:null});
 if(!q.found)return {found:false,point:null,lineId:null};
 let line=map.lines.find(l=>l.lineId===q.lineId);if(!line)throw new TypeError('Original land query returned unknown line');
 const endpoint=right?'end':'start',neighbor=right?'nextLine':'beforeLine',nativeField=right?'NEXT_LINE':'BEFORE_LINE';
 let walked=f(geometry.distance(position,line[endpoint])),target=f(distance),seen=new Set([line.lineId]);
 while(walked<target){
  const id=line[neighbor]??line.nativeFields?.[nativeField];if(id==null||typeof id==='number'&&id<0)break;
  const next=map.lines.find(l=>l.lineId===id);if(!next)throw new TypeError('Original line neighbor unavailable');
  if(seen.has(id))throw new TypeError('Cyclic fixed-distance line traversal unsupported');seen.add(id);line=next;
  walked=f(walked+f(geometry.distance(line.start,line.end)));
 }
 if(walked<f(target+15))return {found:false,point:[...line[endpoint]],lineId:line.lineId};
 const length=f(geometry.distance(line.start,line.end));if(!length)throw new TypeError('Zero-length original line');
 const t=f(f(walked-target)/length),u=f(1-t),left=right?t:u,other=right?u:t;
 return {found:true,point:line.start.map((n,i)=>f(f(left*f(n))+f(other*f(line.end[i])))),lineId:line.lineId};
}
