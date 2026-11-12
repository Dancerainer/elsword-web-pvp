/** Native endpoint strip policy. Source and target evidence live independently
 * in contracts/rf-camera-trails-source.json. No guessed width, emitter or hitbox.
 * This is presentation-only and cannot produce combat hits.
 */
export const RF_TRAIL_REFERENCE=Object.freeze({
  sword:Object.freeze({up:'TRACE_START0',down:'TRACE_END0',bodySeconds:.4,tipSeconds:.5,bodyDrawCount:1,tipDrawCount:3}),
  claw:Object.freeze({up:'ATTACK_SPHERE1_Lhand1',down:'Bip01_L_Hand',bodySeconds:.4,tipSeconds:.5,bodyDrawCount:1,tipDrawCount:3}),
  color:0xcc5555ff,hyperColor:0xccff3333,tipColor:0xff5555ff,hyperTipColor:0xffff3333,
  tipWidth:4,localVertices:400,remoteVertices:150,curveType:0,gapThreshold:20,maxSplit:50,
  evidence:'fixed-V5 endpoints/color/lifetime; target field timing and model helpers; target renderer pending',
});
// Original 2016 Enum.lua differs from V5: V5's extra CUSTOM_TEXTURE slot shifts
// NONE to 5. Keep target NONE=4, never use that reference enum number here.
export const TARGET_TRACE_TYPES=Object.freeze({DEFAULT:0,CONSTANT_WIDTH:1,CIRCULAR:2,DOUBLE_TIP:3,NONE:4});
export function unpackArgb(value){return [((value>>>16)&255)/255,((value>>>8)&255)/255,(value&255)/255,((value>>>24)&255)/255];}
function point(v){if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw new TypeError('Finite native world endpoint required');return [...v];}
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const copyPair=p=>({up:[...p.up],down:[...p.down],color:[...p.color],downColor:[...p.downColor]});
export function nativeCatmullRom(p0,p1,p2,p3,t){
  return p0.map((a,i)=>.5*((2*p1[i])+(-a+p2[i])*t+(2*a-5*p1[i]+4*p2[i]-p3[i])*t*t+(-a+3*p1[i]-3*p2[i]+p3[i])*t*t*t));
}
export function trailTip(up,down,width=4){
  up=point(up);down=point(down);const length=distance(up,down);
  return up.map((v,i)=>v+(length?(down[i]-v)/length:0)*width);
}
function tuple(row,fields){
  if(!row || typeof row!=='object')return null;
  const v=fields.map(([key,fallback])=>row[key]??fallback);
  return v.every(Number.isFinite)?v:null;
}
/** Last declaration wins for an index, exactly as native timing map assignment.
 * Time is animation time (not state time). End is exclusive. */
export function traceTiming(raw,kind,{index=0,condition=0}={}){
  let found=null;
  if(kind==='sword'){
    const main=tuple(raw?.SLASH_TRACE,[['1',-1],['2',-1],['3',0]]);
    if(index===0&&main)found={start:main[0],end:main[1],type:main[2]};
    for(let n=1;Object.hasOwn(raw??{},'SLASH_TRACE'+n);n++){
      const r=tuple(raw['SLASH_TRACE'+n],[['1',-1],['2',-1],['3',0],['4',0]]);
      if(r&&r[2]===index)found={start:r[0],end:r[1],type:r[3]};
    }
  }else if(kind==='claw'){
    for(let n=0;Object.hasOwn(raw??{},'UNIT_SLASH_TRACE'+n);n++){
      const r=tuple(raw['UNIT_SLASH_TRACE'+n],[['1',0],['2',0],['3',0],['4',TARGET_TRACE_TYPES.NONE],['5',0]]);
      if(r&&r[0]===index&&r[4]===condition)found={start:r[1],end:r[2],type:r[3]};
    }
  }else throw new RangeError('Unknown trail kind');
  return found;
}
export function trailActive(timing,animationTime){return !!timing&&animationTime>=timing.start&&animationTime<timing.end;}

export class NativeTrailBuffer{
  constructor({vertexCount=400,disableSeconds=.4,curveType=0,maxSplit=50,textured=false}={}){
    if(!Number.isInteger(vertexCount)||vertexCount<2||!(Number.isFinite(disableSeconds)&&disableSeconds>0)||!Number.isInteger(maxSplit)||maxSplit<1)throw new RangeError('Invalid native strip capacity/lifetime');
    if(![0,1,2].includes(curveType))throw new RangeError('Unsupported curve type');
    if(textured)throw new RangeError('Textured strip UV/event policy is not implemented; original RF claw is untextured');
    this.capacity=Math.ceil(vertexCount/2);this.disableSeconds=disableSeconds;this.curveType=curveType;this.maxSplit=maxSplit;this.clear();
  }
  clear(){this.pairs=[];this.upHistory=null;this.downHistory=null;this.revision=(this.revision??0)+1;}
  get visible(){return this.pairs.some(p=>p.color[3]>0||p.downColor[3]>0);}
  fade(dt){
    if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('dt must be nonnegative');
    if(dt===0)return;
    for(const pair of this.pairs)for(const name of ['color','downColor'])pair[name][3]=Math.max(0,pair[name][3]-dt/this.disableSeconds);
    this.revision++;
  }
  add(up,down,color,{gradation=true}={}){
    up=point(up);down=point(down);
    if(!Array.isArray(color)||color.length!==4||!color.every(Number.isFinite))throw new TypeError('RGBA required');
    if(!this.visible){
      if(color[3]===0)return;
      this.pairs=[];this.upHistory=Array.from({length:4},()=>[...up]);this.downHistory=Array.from({length:4},()=>[...down]);
    }else{
      this.upHistory.shift();this.upHistory.push(up);this.downHistory.shift();this.downHistory.push(down);
    }
    const push=(u,d)=>{
      const downColor=[...color];if(gradation)downColor[3]/=10;
      this.pairs.unshift({up:[...u],down:[...d],color:[...color],downColor});
      if(this.pairs.length>this.capacity)this.pairs.length=this.capacity;
    };
    const u=this.upHistory,d=this.downHistory;
    if(this.curveType===2)push(up,down);
    else if(this.curveType===0){
      const dist=distance(u[1],u[2]);
      if(color[3]===0||dist<=20)push(u[2],d[2]);
      else{
        const split=Math.min(this.maxSplit,Math.floor(dist/20)+1);
        for(let i=0;i<split;i++)push(nativeCatmullRom(...u,i/split),nativeCatmullRom(...d,i/split));
      }
    }else{
      const dist=distance(u[2],u[3]);
      if(color[3]===0||dist<=20)push(u[3],d[3]);
      else{
        const split=Math.min(this.maxSplit,Math.floor(dist/20)+1);
        // The V5 tough-curve down control point is Up4 in the source (823).
        // Preserve it as a version reference, rather than silently correcting it.
        for(let i=0;i<split;i++)push(nativeCatmullRom(u[1],u[2],u[3],u[3],i/split),nativeCatmullRom(d[1],d[2],d[3],u[3],i/split));
      }
    }
    this.revision++;
  }
  /** Native frame order: fade first, then add. dt=0 freezes both operations. */
  step({dt,up,down,color=[0,0,0,0],emit=true,enabled=true,shown=true}){
    if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('dt must be nonnegative');
    if(dt===0||!enabled||!shown)return;
    this.fade(dt);if(emit)this.add(up,down,color);
  }
  snapshot(){return {pairs:this.pairs.map(copyPair),visible:this.visible,revision:this.revision,curveType:this.curveType,disableSeconds:this.disableSeconds};}
  geometry(toRender=p=>p){
    const positions=[],colors=[],indices=[];
    for(const p of this.pairs){positions.push(...toRender(p.up),...toRender(p.down));colors.push(...p.color,...p.downColor);}
    for(let i=0;i<this.pairs.length-1;i++){const v=i*2;indices.push(v,v+1,v+2,v+2,v+1,v+3);}
    return {positions,colors,indices};
  }
}
