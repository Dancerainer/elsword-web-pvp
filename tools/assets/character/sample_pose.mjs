/** Pure JS sampling of original 2016 RF key tracks and helper geometry.
 * Caller decompresses pose-tracks.json.gz. This module has no rendering/network
 * dependency. Keyframe/track quaternion NLERP and normalized track weights are
 * verified by original client DLL probes in rf-native-d3dx-execution.json.
 * Complete original-client combat and collision remain separate evidence.
 * Matrices are column major. Native axes are the default (no Z reflection).
 */

export function multiply(a, b) {
  const c = Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) c[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return c;
}

export function transform(m, [x,y,z]) {
  return [m[0]*x + m[4]*y + m[8]*z + m[12],
    m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
}

function normalized(q) {
  const length = Math.hypot(...q);
  if (!(length > 0) || !Number.isFinite(length)) throw new Error('Invalid quaternion');
  return q.map(v => v / length);
}

/** Original D3DX raw-input GetSRT/track blend, distinct from glTF SLERP.
 * GetSRT preserves exact-key raw quaternion values. Between keys and across
 * tracks it weights those raw values then normalizes; normalizing each input
 * first changes the result for the original nonunit author keys.
 */
export function nativeQuaternionNlerp(left,right,weight) {
  if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error('Invalid native quaternion weight');
  const a=[...left];let b=[...right];
  if(a.length!==4||b.length!==4||![...a,...b].every(Number.isFinite)||Math.hypot(...a)===0||Math.hypot(...b)===0)throw new Error('Invalid quaternion');
  if(a.reduce((sum,v,i)=>sum+v*b[i],0)<0)b=b.map(v=>-v);
  return normalized(a.map((v,i)=>v+(b[i]-v)*weight));
}

function quaternionValuesToRef(ax,ay,az,aw,bx,by,bz,bw,weight,result) {
  if(!Number.isFinite(weight)||weight<0||weight>1)throw new Error('Invalid native quaternion weight');
  if(!Number.isFinite(ax)||!Number.isFinite(ay)||!Number.isFinite(az)||!Number.isFinite(aw)
    ||!Number.isFinite(bx)||!Number.isFinite(by)||!Number.isFinite(bz)||!Number.isFinite(bw)
    ||Math.hypot(ax,ay,az,aw)===0||Math.hypot(bx,by,bz,bw)===0)throw new Error('Invalid quaternion');
  if(ax*bx+ay*by+az*bz+aw*bw<0){bx=-bx;by=-by;bz=-bz;bw=-bw;}
  const x=ax+(bx-ax)*weight,y=ay+(by-ay)*weight,z=az+(bz-az)*weight,w=aw+(bw-aw)*weight;
  const length=Math.hypot(x,y,z,w);
  if(!(length>0)||!Number.isFinite(length))throw new Error('Invalid quaternion');
  result[0]=x/length;result[1]=y/length;result[2]=z/length;result[3]=w/length;
  return result;
}

/** Same raw-input D3DX interpolation into caller-owned double storage.
 * Hot render paths must not create spread/map arrays for every bone and frame. */
export function nativeQuaternionNlerpToRef(left,right,weight,result) {
  if(left?.length!==4||right?.length!==4||result?.length!==4)throw new Error('Invalid quaternion');
  return quaternionValuesToRef(left[0],left[1],left[2],left[3],right[0],right[1],right[2],right[3],weight,result);
}

/** Keep exact-key raw values and binary key selection, without Float64
 * subarray wrappers or transient vectors. The caller owns result exclusively. */
export function sampleChannelToRef(channel,time,quaternion,result) {
  const stride=channel?.stride;
  if(!channel?.times?.length||(stride!==undefined&&![3,4].includes(stride))
    ||channel.times.length*(stride??1)!==channel.values.length)throw new Error('Invalid channel');
  const {times,values}=channel,width=stride??values[0].length;
  if(result?.length!==width)throw new Error('Invalid channel result');
  let low=0,high=times.length;
  while(low<high){const mid=(low+high)>>>1;if(times[mid]<=time)low=mid+1;else high=mid;}
  const right=low;
  if(right===0||right===times.length||times[right-1]===time){
    const index=right===0?0:right-1;
    for(let i=0;i<width;i++)result[i]=stride===undefined?values[index][i]:values[index*stride+i];
    return result;
  }
  const span=times[right]-times[right-1];if(!(span>0))throw new Error('Non-increasing key times');
  const factor=(time-times[right-1])/span;
  if(quaternion){
    if(width!==4)throw new Error('Invalid quaternion');
    if(stride===undefined){const a=values[right-1],b=values[right];
      return quaternionValuesToRef(a[0],a[1],a[2],a[3],b[0],b[1],b[2],b[3],factor,result);}
    const a=(right-1)*stride,b=right*stride;
    return quaternionValuesToRef(values[a],values[a+1],values[a+2],values[a+3],values[b],values[b+1],values[b+2],values[b+3],factor,result);
  }
  for(let i=0;i<width;i++){
    const a=stride===undefined?values[right-1][i]:values[(right-1)*stride+i],b=stride===undefined?values[right][i]:values[right*stride+i];
    result[i]=a+(b-a)*factor;
  }
  return result;
}

export function sampleChannel(channel, time, quaternion = false) {
  const stride = channel?.stride;
  if (!channel?.times?.length || (stride !== undefined && ![3,4].includes(stride))
    || channel.times.length * (stride ?? 1) !== channel.values.length) throw new Error('Invalid channel');
  const {times, values} = channel;
  const at = i => stride === undefined ? values[i] : values.subarray(i * stride, (i + 1) * stride);
  let low = 0, high = times.length;
  while (low < high) { const mid = (low + high) >>> 1; if (times[mid] <= time) low = mid + 1; else high = mid; }
  const right = low;
  if (right === 0) return [...at(0)];
  if (right === times.length) return [...at(times.length-1)];
  if(times[right-1]===time)return [...at(right-1)];
  const width = times[right] - times[right - 1];
  if (!(width > 0)) throw new Error('Non-increasing key times');
  const factor = (time - times[right - 1]) / width;
  let a = at(right - 1), b = at(right);
  if (!quaternion) return Array.from(a, (v, i) => v + (b[i] - v) * factor);
  return nativeQuaternionNlerp(a,b,factor);
}

export function compose(translation, scale, quaternion) {
  const [x,y,z,w] = normalized(quaternion), [sx,sy,sz] = scale;
  return [(1-2*(y*y+z*z))*sx, 2*(x*y+z*w)*sx, 2*(x*z-y*w)*sx, 0,
    2*(x*y-z*w)*sy, (1-2*(x*x+z*z))*sy, 2*(y*z+x*w)*sy, 0,
    2*(x*z+y*w)*sz, 2*(y*z-x*w)*sz, (1-2*(x*x+y*y))*sz, 0,
    ...translation, 1];
}

export function createPoseLibrary(document) {
  if (document.schemaVersion !== 1) throw new Error('Unsupported RF pose schema');
  if (document.unsupportedTracks?.length) throw new Error('Source pose contains unsupported tracks: ' + JSON.stringify(document.unsupportedTracks));
  const clips = new Map(document.clips.map(c => [c.name, { ...c,
    // Pose documents retain original double key times, but do not necessarily
    // contain the summary's durationSeconds. Both hosts must use that period.
    durationSeconds: c.durationSeconds ?? Math.max(0, ...c.tracks.flatMap(track =>
      ['translation','rotation','scale'].map(key => track[key]?.times?.at(-1) ?? 0))),
    tracks: new Map(c.tracks.map(track => [track.frame_name, track])) }]));
  return { ...document, clips, framesByName: new Map(document.frames.map((frame, i) => [frame.name, i])) };
}

function bindTrs(matrix) {
  const scale=[0,4,8].map(i=>Math.hypot(...matrix.slice(i,i+3)));
  if(scale.some(n=>!(n>0)))throw new Error('Singular bind transform');
  const m=matrix.map((v,i)=>i<12&&i%4<3?v/scale[Math.floor(i/4)]:v);
  const trace=m[0]+m[5]+m[10];let q;
  if(trace>0){const s=Math.sqrt(trace+1)*2;q=[(m[6]-m[9])/s,(m[8]-m[2])/s,(m[1]-m[4])/s,s/4];}
  else if(m[0]>m[5]&&m[0]>m[10]){const s=Math.sqrt(1+m[0]-m[5]-m[10])*2;q=[s/4,(m[4]+m[1])/s,(m[8]+m[2])/s,(m[6]-m[9])/s];}
  else if(m[5]>m[10]){const s=Math.sqrt(1+m[5]-m[0]-m[10])*2;q=[(m[4]+m[1])/s,s/4,(m[9]+m[6])/s,(m[8]-m[2])/s];}
  else{const s=Math.sqrt(1+m[10]-m[0]-m[5])*2;q=[(m[8]+m[2])/s,(m[9]+m[6])/s,s/4,(m[1]-m[4])/s];}
  return {translation:matrix.slice(12,15),scale,rotation:normalized(q)};
}
function trackTrs(track, frame, time) {
  if(!track)return bindTrs(frame.nativeRowMatrix);
  if(!track.translation||!track.scale||!track.rotation)throw new Error('Incomplete KAC TRS track');
  return {translation:sampleChannel(track.translation,time),scale:sampleChannel(track.scale,time),rotation:sampleChannel(track.rotation,time,true)};
}

/** One original local frame, before MotionOffset extraction/world placement. */
export function sampleLocalTransform(library, clipName, timeSeconds, frameName, options = {}) {
  if (!Number.isFinite(timeSeconds)) throw new Error('Invalid animation time');
  const clip=library.clips.get(clipName),index=library.framesByName.get(frameName);
  if(!clip)throw new Error(`Unknown original animation: ${clipName}`);
  if(index===undefined)throw new Error(`Unknown original frame: ${frameName}`);
  const frame=library.frames[index],current=trackTrs(clip.tracks.get(frameName),frame,timeSeconds);
  const transition=options.transition;
  if(transition){
    const {weight:w,timeSeconds:oldTime,clipName:oldName}=transition;
    if(!Number.isFinite(w)||w<0||w>1||!Number.isFinite(oldTime)||!library.clips.has(oldName))throw new Error('Invalid previous animation track');
    if(w<1){
      const old=trackTrs(library.clips.get(oldName).tracks.get(frameName),frame,oldTime);
      current.translation=old.translation.map((v,i)=>v+(current.translation[i]-v)*w);
      current.scale=old.scale.map((v,i)=>v+(current.scale[i]-v)*w);
      current.rotation=nativeQuaternionNlerp(old.rotation,current.rotation,w);
    }
  }
  return current;
}

/** Asset D3DXPLAYBACK_TYPE is distinct from gameplay XAP_ONE/WAIT/LOOP. */
export function mapClipTime(time, period, loop=false, nativePlaybackField=null) {
  if(!Number.isFinite(time)||!Number.isFinite(period)||period<0)throw new Error('Invalid native clip clock');
  if(nativePlaybackField!==null && ![0,1,2].includes(nativePlaybackField))throw new Error('Unsupported native playback type');
  time=Math.max(0,time);
  if(period===0)return 0;
  if(nativePlaybackField===2){const mapped=time%(2*period);return mapped>period?2*period-mapped:mapped;}
  return nativePlaybackField===0 || (nativePlaybackField===null && loop) ? time%period : Math.min(time,period);
}

/** Source ChangeAnim linear old-track speed ramp. Clock comes from simulation. */
export function sampleTransitionTrack(transition, periodForName, playbackForName=()=>null) {
  if(!transition?.enabled)return null;
  const {durationSeconds:D,elapsedSeconds:e,fromTime,fromSpeed}=transition,carry=transition.fromWeight??1;
  if(![D,e,fromTime,fromSpeed,carry].every(Number.isFinite)||D<=0||e<0||fromSpeed<0||carry<0||carry>1)throw new Error('Invalid native animation transition');
  if(e>=D)return null;
  const period=periodForName(transition.fromName);
  if(!Number.isFinite(period)||period<0)throw new Error('Missing old transition clip: '+transition.fromName);
  const time=mapClipTime(fromTime+fromSpeed*(e-e*e/(2*D)),period,transition.fromLoop,playbackForName(transition.fromName)??null);
  const newWeight=e/D,oldWeight=carry*(1-newWeight),total=oldWeight+newWeight;
  return {clipName:transition.fromName,timeSeconds:time,weight:total>0?newWeight/total:0,
    oldWeight,newWeight,zeroTotalWeight:total===0};
}

/** Zero total weight retains prior controller output, never a guessed bind. */
export function resolveControllerPose(actor,periodForName,playbackForName=()=>null,depth=0) {
  if(depth>8)throw new Error('Invalid retained controller pose chain');
  const clipName=actor.animationName,period=periodForName(clipName);
  if(!Number.isFinite(period)||period<0)throw new Error('Missing controller pose clip: '+clipName);
  const timeSeconds=mapClipTime(actor.animationTime,period,actor.animationLoop,playbackForName(clipName)??null);
  const transition=sampleTransitionTrack(actor.presentationTransition,periodForName,playbackForName);
  if(transition?.zeroTotalWeight){
    const retained=actor.presentationTransition.retainedPose;
    if(!retained)throw new Error('Missing native zero-weight retained pose');
    return {...resolveControllerPose(retained,periodForName,playbackForName,depth+1),retained:true};
  }
  return {clipName,timeSeconds,transition,retained:false};
}

// SkinAnim's extraction flag is independent of User's APPLY_ANIM_MOVE gate.
// Explicit false is used by the internal raw source-pose inspector only.
export function consumesRootTranslation(actor) { return actor.consumeRootTranslation !== false; }

export function samplePose(library, clipName, timeSeconds, options = {}) {
  if (!Number.isFinite(timeSeconds)) throw new Error('Invalid animation time');
  const clip = library.clips.get(clipName);
  if (!clip) throw new Error(`Unknown original animation: ${clipName}`);
  const {rootTranslationOverride = null, worldMatrix = null, transition = null} = options;
  if(transition&&(!Number.isFinite(transition.weight)||transition.weight<0||transition.weight>1||!Number.isFinite(transition.timeSeconds)||!library.clips.has(transition.clipName)))throw new Error('Invalid previous animation track');
  const previous=transition&&transition.weight<1?library.clips.get(transition.clipName):null;
  const matrices = new Map(), visiting = new Set();
  function evaluate(index) {
    const frame = library.frames[index];
    if (matrices.has(frame.name)) return matrices.get(frame.name);
    if (visiting.has(index)) throw new Error('Cyclic skeleton');
    visiting.add(index);
    const track = clip.tracks.get(frame.name);
    let local = [...frame.nativeRowMatrix];
    const oldTrack=previous?.tracks.get(frame.name);
    if (track || oldTrack) {
      const current=sampleLocalTransform(library,clipName,timeSeconds,frame.name,{transition});
      local = compose(current.translation,current.scale,current.rotation);
    }
    if (frame.name === 'Bip01' && rootTranslationOverride) for (let axis = 0; axis < 3; axis++) {
      if (rootTranslationOverride[axis] !== null && rootTranslationOverride[axis] !== undefined) local[12+axis] = rootTranslationOverride[axis];
    }
    const parent = frame.parent === null ? worldMatrix : evaluate(frame.parent);
    const world = parent ? multiply(parent, local) : local;
    visiting.delete(index); matrices.set(frame.name, world); return world;
  }
  for (let i = 0; i < library.frames.length; i++) evaluate(i);
  return matrices;
}

const poseSamplePlans=new WeakMap();
/** Reusable, caller-owned output for one live actor/effect. Frozen hierarchy
 * traversal is shared by buffers, but world matrices and interpolation scratch
 * never are. The original allocating samplePose remains the reference path. */
export function createPoseSampleBuffer(library) {
  let plan=poseSamplePlans.get(library);
  if(!plan){
    // The legacy sampler keys evaluation by name. A duplicate can suppress a
    // different index's parent walk, so index-based reuse is not equivalent.
    // Keep that unusual input on the unchanged reference implementation.
    if(new Set(library.frames.map(frame=>frame.name)).size!==library.frames.length){
      plan={referenceOnly:true};poseSamplePlans.set(library,plan);
    }else{
      const order=[],visiting=new Uint8Array(library.frames.length);
      function visit(index){
        if(visiting[index]===2)return;
        if(visiting[index]===1)throw new Error('Cyclic skeleton');
        const frame=library.frames[index];if(!frame)throw new Error('Invalid skeleton parent');
        visiting[index]=1;if(frame.parent!==null)visit(frame.parent);
        visiting[index]=2;order.push(index);
      }
      for(let i=0;i<library.frames.length;i++)visit(i);
      plan={order,bind:new Array(library.frames.length)};poseSamplePlans.set(library,plan);
    }
  }
  if(plan.referenceOnly)return {library,plan,matrices:new Map()};
  const world=library.frames.map(()=>Array(16).fill(0));
  return {library,plan,world,matrices:new Map(plan.order.map(index=>[library.frames[index].name,world[index]])),
    local:Array(16).fill(0),translation:new Float64Array(3),scale:new Float64Array(3),rotation:new Float64Array(4),
    oldTranslation:new Float64Array(3),oldScale:new Float64Array(3),oldRotation:new Float64Array(4)};
}

function copyPoseTrs(track,frame,index,time,buffer,translation,scale,rotation){
  if(track){
    if(!track.translation||!track.scale||!track.rotation)throw new Error('Incomplete KAC TRS track');
    sampleChannelToRef(track.translation,time,false,translation);
    sampleChannelToRef(track.scale,time,false,scale);
    sampleChannelToRef(track.rotation,time,true,rotation);
  }else{
    const bind=buffer.plan.bind[index]??=bindTrs(frame.nativeRowMatrix);
    for(let i=0;i<3;i++){translation[i]=bind.translation[i];scale[i]=bind.scale[i];}
    for(let i=0;i<4;i++)rotation[i]=bind.rotation[i];
  }
}

/** Numerically identical hierarchy evaluation without per-bone vectors,
 * matrices, Maps or Sets. Returned matrices are valid until this same buffer
 * is sampled again; copy a matrix when retaining it as a world-space birth. */
export function samplePoseToRef(library,clipName,timeSeconds,buffer,options={}) {
  if(!Number.isFinite(timeSeconds))throw new Error('Invalid animation time');
  const clip=library.clips.get(clipName);if(!clip)throw new Error(`Unknown original animation: ${clipName}`);
  if(buffer?.library!==library)throw new Error('Pose sample buffer belongs to another library');
  if(buffer.plan.referenceOnly)return buffer.matrices=samplePose(library,clipName,timeSeconds,options);
  const {rootTranslationOverride=null,worldMatrix=null,transition=null}=options;
  if(transition&&(!Number.isFinite(transition.weight)||transition.weight<0||transition.weight>1||!Number.isFinite(transition.timeSeconds)||!library.clips.has(transition.clipName)))throw new Error('Invalid previous animation track');
  const previous=transition&&transition.weight<1?library.clips.get(transition.clipName):null;
  const {local,translation,scale,rotation,oldTranslation,oldScale,oldRotation}=buffer;
  for(const index of buffer.plan.order){
    const frame=library.frames[index],track=clip.tracks.get(frame.name),oldTrack=previous?.tracks.get(frame.name);
    if(track||oldTrack){
      copyPoseTrs(track,frame,index,timeSeconds,buffer,translation,scale,rotation);
      if(previous){
        copyPoseTrs(oldTrack,frame,index,transition.timeSeconds,buffer,oldTranslation,oldScale,oldRotation);
        const weight=transition.weight;
        for(let i=0;i<3;i++){
          translation[i]=oldTranslation[i]+(translation[i]-oldTranslation[i])*weight;
          scale[i]=oldScale[i]+(scale[i]-oldScale[i])*weight;
        }
        nativeQuaternionNlerpToRef(oldRotation,rotation,weight,rotation);
      }
      const length=Math.hypot(rotation[0],rotation[1],rotation[2],rotation[3]);
      if(!(length>0)||!Number.isFinite(length))throw new Error('Invalid quaternion');
      const x=rotation[0]/length,y=rotation[1]/length,z=rotation[2]/length,w=rotation[3]/length;
      const sx=scale[0],sy=scale[1],sz=scale[2];
      local[0]=(1-2*(y*y+z*z))*sx;local[1]=2*(x*y+z*w)*sx;local[2]=2*(x*z-y*w)*sx;local[3]=0;
      local[4]=2*(x*y-z*w)*sy;local[5]=(1-2*(x*x+z*z))*sy;local[6]=2*(y*z+x*w)*sy;local[7]=0;
      local[8]=2*(x*z+y*w)*sz;local[9]=2*(y*z-x*w)*sz;local[10]=(1-2*(x*x+y*y))*sz;local[11]=0;
      local[12]=translation[0];local[13]=translation[1];local[14]=translation[2];local[15]=1;
    }else for(let i=0;i<16;i++)local[i]=frame.nativeRowMatrix[i];
    if(frame.name==='Bip01'&&rootTranslationOverride)for(let i=0;i<3;i++){
      if(rootTranslationOverride[i]!==null&&rootTranslationOverride[i]!==undefined)local[12+i]=rootTranslationOverride[i];
    }
    const parent=frame.parent===null?worldMatrix:buffer.world[frame.parent],world=buffer.world[index];
    if(parent)for(let column=0;column<4;column++)for(let row=0;row<4;row++){
      let value=0;for(let k=0;k<4;k++)value+=parent[k*4+row]*local[column*4+k];world[column*4+row]=value;
    }
    else for(let i=0;i<16;i++)world[i]=local[i];
  }
  return buffer.matrices;
}

export function sampleHelpers(library, clipName, timeSeconds, options = {}) {
  const matrices = samplePose(library, clipName, timeSeconds, options);
  return library.helpers.map(helper => {
    const matrix = matrices.get(helper.name);
    if (!matrix) throw new Error(`Missing helper node: ${helper.name}`);
    const vertices = helper.nativeVertices?.map(vertex => transform(matrix, vertex)) ?? [];
    const result = {name: helper.name, matrix, position: transform(matrix, [0,0,0]), vertices,
      triangles: helper.nativeTriangles ?? [], coordinates: 'native DirectX axes, original units',
      nativeStoredBoundingRadius: helper.nativeStoredBoundingRadius ?? null,
      geometryBoundingSphereCandidate: helper.geometryBoundingSphereCandidate ?? null};
    if (vertices.length) result.bounds = {min: [0,1,2].map(axis => Math.min(...vertices.map(v => v[axis]))),
      max: [0,1,2].map(axis => Math.max(...vertices.map(v => v[axis])))};
    return result;
  });
}
