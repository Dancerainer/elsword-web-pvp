import {NativeTrailBuffer,unpackArgb} from './weapon-trails.mjs';
import source from '../../contracts/mm-chaser-trail-v61.json' with {type:'json'};
const point=v=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw TypeError('Finite original Chaser trace endpoint required');return v;};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Scoped qualified-reference display adapter. The underlying tough curve is
 * already isolated from combat. No emit-rate/lifetime/quality override. */
export class AddChaserTrail {
 constructor(){this.buffer=new NativeTrailBuffer({vertexCount:100,disableSeconds:.4,curveType:1});this.oldCenter=[0,0,0];}
 step({dt,up,down,direction,active=true}){
  point(up);point(down);point(direction);const center=up.map((v,i)=>(v+down[i])*.5),delta=center.map((v,i)=>v-this.oldCenter[i]);this.oldCenter=center;
  const radius=Math.hypot(...up.map((v,i)=>v-down[i]))*.5,dot=delta.reduce((s,v,i)=>s+v*direction[i],0),projected=direction.map(v=>v*dot);projected[1]=delta[1];
  const normal=cross(projected,cross(direction,[0,1,0])),length=Math.hypot(...normal),offset=normal.map(v=>length?v/length*radius:0);
  this.buffer.fade(dt);for(const pair of this.buffer.pairs)for(const key of ['color','downColor'])if(pair[key][3]<.1)pair[key][3]=0;
  this.buffer.add(center.map((v,i)=>v+offset[i]),center.map((v,i)=>v-offset[i]),active?unpackArgb(source.consumer.color):[0,0,0,0],{gradation:false});
 }
 geometry(){const result=this.buffer.geometry(p=>[p[0]*.01,p[1]*.01,-p[2]*.01]),uvs=[];
  // Source UV update spans the visible leading prefix. The Web adapter applies
  // this defined formula after this packet's insert; native first-pair pixels
  // before the next UV update remain unmeasured (see independent contract).
  const firstZero=this.buffer.pairs.findIndex(p=>p.color[3]===0),count=firstZero<0?this.buffer.pairs.length:firstZero;
  for(let i=0;i<this.buffer.pairs.length;i++)uvs.push(count?i/count:0,0,count?i/count:0,1);
  return {...result,uvs};
 }
}
