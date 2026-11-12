/** Caller-owned GPU upload storage for the existing native strip history.
 * A sample is temporary: its active prefixes are overwritten by the next call.
 * Source pairs, fading, interpolation, colors and winding are not modified.
 * Float32 rounding matches Babylon's existing vertex-buffer conversion. */
export function createNativeTrailGeometry({scale=.01}={}){
  if(!(Number.isFinite(scale)&&scale>0))throw new RangeError('Positive native trail scale required');
  let owner=null,capacity=0,positions,colors,indices,view=null,pairCount=-1,allocations=0;
  return {
    sample(buffer){
      const count=buffer.pairs.length;
      if(!buffer.visible||count<2)return null;
      if(owner!==buffer||capacity<buffer.capacity){
        owner=buffer;capacity=buffer.capacity;
        positions=new Float32Array(capacity*6);colors=new Float32Array(capacity*8);
        indices=capacity*2<=65536?new Uint16Array(Math.max(0,capacity-1)*6):new Uint32Array(Math.max(0,capacity-1)*6);
        for(let i=0;i<capacity-1;i++){const v=i*2,j=i*6;indices[j]=v;indices[j+1]=v+1;indices[j+2]=v+2;indices[j+3]=v+2;indices[j+4]=v+1;indices[j+5]=v+3;}
        pairCount=-1;allocations++;
      }
      if(count!==pairCount){
        pairCount=count;view={positions:positions.subarray(0,count*6),colors:colors.subarray(0,count*8),indices:indices.subarray(0,(count-1)*6)};
      }
      for(let i=0;i<count;i++){
        const pair=buffer.pairs[i],p=i*6,c=i*8;
        positions[p]=pair.up[0]*scale;positions[p+1]=pair.up[1]*scale;positions[p+2]=-pair.up[2]*scale;
        positions[p+3]=pair.down[0]*scale;positions[p+4]=pair.down[1]*scale;positions[p+5]=-pair.down[2]*scale;
        for(let n=0;n<4;n++){colors[c+n]=pair.color[n];colors[c+4+n]=pair.downColor[n];}
      }
      return view;
    },
    proof:()=>({capacity,allocations}),
  };
}
