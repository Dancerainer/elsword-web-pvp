/** Bounded binary32 reference executor, NOT compiled original code or a
 * measured2016 client trace. Scope: four target Shadow mesh declarations.
 * Source/macro/fragment provenance: contracts/rf-shadow-mesh-source-v11.json.
 */
const f=Math.fround,epsilon=1.1920928955078125e-7;
import {ELESIS_LITERAL_MESH_NAMES} from './elesis-literal-meshes.mjs';
import {ADD_LITERAL_MESH_NAMES} from './add-literal-meshes.mjs';
export const SHADOW_MESH_NAMES=new Set(['RVC_C_ShadowBackSlide_grenade_M01_1',
  'RVC_C_ShadowBackSlide_grenade_M01_2','RVC_C_ShadowBackSlide_grenade_M01_3','SHADOW_BURSTER_DIE_CHECK']);
// Fixed declarations whose movement uses the same CXMeshInstance consumer.
// No particle velocity approximation: mesh fades integrate the midpoint.
export const LITERAL_MESH_NAMES=new Set(['SwordFallBlade1','SwordFallBlade2','SwordFallBlade3','SwordFallBlade4',
  'elsword_A_swordFall_M02','elsword_A_swordFall_M03','elsword_A_swordFall_M04','elsword_A_swordFall_M05',
  'RVC_C_NapalmGrenade_Bullet_M01_1','RVC_C_NapalmGrenade_Bullet_M01_2',
  'RVC_C_NapalmGrenade_Bullet_M01_3','RVC_C_dashJumpX_bullet_M01','RVC_IGNITION_CROW_DROPFIRE',
  'RVC_SA_ignitionCrow_crow_M01','RVC_SA_ignitionCrow_crow_M01_Over_Heat',
  'SA_RVC_IGNITION_CROW_INCINERATION_M01','SA_RVC_IGNITION_CROW_INCINERATION_M03',
  'SA_RVC_IGNITION_CROW_INCINERATION_OVERHEAT_M01','SA_RVC_IGNITION_CROW_INCINERATION_OVERHEAT_M03',
  'RWT_X_Shell','Raven_Revolver_Cannon_Shell','Raven_Harpoon_Spear_Shell_MEMO',
  'RWT_SA_HARPOON_SPEAR_EXPLOSION_Ultimate','RWT_SA_HARPOON_SPEAR_EXPLOSION_MEMO',
  'Raven_SevenBurst1','Raven_CannonBlade_Memo','GigaProminenceFinalAttackSphere','EffectSet_RVC_Flame_Buster_CROW_M01',
  'ERS_LunaBladeM','ERS_LunaBladeM_Start','ERS_LunaBladeM_End','Elsword_RS_DashJumpComboXa_Mesh01',
  'RST_DashJump_XZ_ProDummy','RST_ShockWave_ProDummy',...ELESIS_LITERAL_MESH_NAMES,...ADD_LITERAL_MESH_NAMES]);
const number=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||!Number.isFinite(f(v)))throw new TypeError('Original Shadow mesh '+label+' required');return f(v);};
const vector=(v,label)=>{if(!Array.isArray(v)||v.length!==3)throw new TypeError('Original Shadow mesh '+label+' required');return v.map(n=>number(n,label));};
const sameZero=v=>Math.abs(v)<=epsilon;
export function createShadowMesh({name,position,velocity,landY,fields,events,facing=1,rotation}){
  if(!SHADOW_MESH_NAMES.has(name))throw new RangeError('Unsupported Shadow mesh '+name);
  if(fields?.LifeType!=='LT_TIME'||fields.MeshType!=='X_SKIN_MESH'||fields.UseLand!==true)
    throw new TypeError('Original Shadow mesh lifetime/type/land declaration required');
  if(facing!==1&&facing!==-1)throw new RangeError('Original Shadow mesh facing required');
  if(events&&(!Array.isArray(events)||events.some(e=>e.start!==0||e.end!==0||e.fade===true||!['Color','AniName','Size','Velocity'].includes(e.property))))
    throw new RangeError('Unverified Shadow mesh event outside bounded time-zero declarations');
  // This scoped target EffectSet has only actor-facing movement axes. The
  // shared birth sampler now writes the same left-facing yaw explicitly as 180;
  // facing below already consumes that cardinal rotation exactly once. Other
  // Euler axes still require the original D3DX inverse/transform boundary.
  if(rotation&&(!Array.isArray(rotation)||rotation.length!==3||rotation.some(n=>!Number.isFinite(n))||
      rotation[0]!==0||rotation[2]!==0||rotation[1]!==0&&rotation[1]!==(facing<0?180:0)))
    throw new RangeError('Unverified Shadow mesh nonzero additional movement rotation');
  const life=number(fields.LifeTime,'LifeTime');if(life<=0)throw new RangeError('Positive original mesh LifeTime required');
  return {name,position:vector(position,'position'),velocity:vector(velocity,'velocity'),
    velocityAccum:[0,0,0],gravity:vector(fields.Gravity??[0,0,0],'gravity'),landY:number(landY,'owner landPosition.y'),
    facing,globalTime:0,nowLifeTime:0,maxLifeTime:life,animationTime:0,animationSpeed:1,
    notCheckLandTime:number(fields.NotCheckLandTime??fields.NOT_CHECK_LAND_TIME??0,'NotCheckLandTime'),
    elastic:number(fields.ElasticCoeff??.5,'ElasticCoeff'),elasticX:number(fields.ElasticCoeff_X??0,'ElasticCoeff_X'),
    crashLand:fields.CrashLand===true,deathReason:null,landRefreshPending:false,
    evidenceClass:'binary32-JS-execution-of-bounded-fixed-V5-mesh-consumers; target2016-unmeasured'};
}
// D3DX yaw/pitch/roll basis, cached at birth; transpose is the gravity inverse.
function basis(degrees){const [x,y,z]=degrees.map(n=>n*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return [[cz*cy+sz*sx*sy,sz*cx,-cz*sy+sz*sx*cy],[-sz*cy+cz*sx*sy,cz*cx,sz*sy+cz*sx*cy],[cx*sy,-sx,cx*cy]].map(v=>v.map(f));}
const transform=(v,m)=>[0,1,2].map(i=>f(f(f(v[0]*m[0][i])+f(v[1]*m[1][i]))+f(v[2]*m[2][i])));
// MeshPlayer1690..1702 transforms the template's world gravity using the
// current movement axes every frame. FollowLine changes those axes; retaining
// gravity in the old birth axes adds a false horizontal acceleration.
function setFollowBasis(s,rotation){
  const worldGravity=s.literalMotion?transform(s.gravity,s.basis):null;
  s.rotation=rotation;s.basis=basis(rotation);
  if(worldGravity)s.gravity=transform(worldGravity,[0,1,2].map(i=>s.basis.map(v=>v[i])));
}
export function createLiteralMesh(options){
  const {name,fields,events=[],rotation=[0,options.facing<0?180:0,0]}=options;
  if(!LITERAL_MESH_NAMES.has(name)&&!SHADOW_MESH_NAMES.has(name))throw new RangeError('Unverified literal mesh '+name);
  if(events.some(e=>!['Color','Size','Velocity','DirSpeed','AniName','AniSpeed','Rotate'].includes(e.property)||
    !Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<e.start||
    e.property==='Velocity'&&(!Array.isArray(e.value)||e.value.length!==3||!e.value.every(Number.isFinite))||
    e.property==='DirSpeed'&&!Number.isFinite(e.value)||e.property==='AniSpeed'&&(!Number.isFinite(e.value)||e.fade)||e.property==='AniName'&&e.fade))
    throw new RangeError('Unverified literal mesh event '+name);
  const s=createShadowMesh({...options,name:'SHADOW_BURSTER_DIE_CHECK',fields:{...fields,UseLand:true},events:[],rotation:null});
  s.name=name;s.literalMotion=true;s.useLand=fields.UseLand===true;s.rotation=vector(rotation,'rotation');s.basis=basis(options.motionRotation??s.rotation);
  s.gravity=transform(s.gravity,[0,1,2].map(i=>s.basis.map(v=>v[i])));
  s.dirSpeed=number(events.find(e=>e.property==='DirSpeed'&&e.start===0)?.value??0,'DirSpeed');
  const ani=events.find(e=>e.property==='AniName'&&e.start===0)?.value;
  s.animationName=ani?.animation??null;s.animationPlayback=ani?.playback??null;
  s.animationSpeed=number(events.find(e=>e.property==='AniSpeed'&&e.start===0)?.value??1,'AniSpeed');
  return s;
}
function accumulateVelocity(s,elapsed){for(let i=0;i<3;i++)s.velocityAccum[i]=f(s.velocityAccum[i]+f(s.velocity[i]*elapsed));}
export function orientLiteralMesh(s,direction,{preserveWorldGravity=false}={}){
 vector(direction,'native lock-on direction');
 const length=Math.hypot(...direction);if(!(length>0))return;
 if(!s.literalMotion||s.gravity.some(n=>n!==0)&&!preserveWorldGravity)throw new RangeError('Unqualified locked mesh gravity');
 const worldGravity=preserveWorldGravity?transform(s.gravity,s.basis):null,worldVelocity=preserveWorldGravity?transform(s.velocity,s.basis):null;
 s.rotation=[0,Math.atan2(-direction[2],direction[0])*180/Math.PI,Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))*180/Math.PI].map(f);
 s.basis=basis(s.rotation);
 // Callers may preserve an already accumulated world velocity while the
 // separate direction-speed vector turns. Marked Rushing's producer clears
 // its gravity before this path; ordinary source gravity is not reintroduced.
 if(preserveWorldGravity){const inverse=[0,1,2].map(i=>s.basis.map(v=>v[i]));s.gravity=transform(worldGravity,inverse);s.velocity=transform(worldVelocity,inverse);}
}
function velocityEvents(s,oldTime,newTime,events){
  let cursor=oldTime;
  for(const e of events){
    if(e.property==='AniName'&&e.start>oldTime&&e.start<=newTime){s.animationName=e.value.animation;s.animationPlayback=e.value.playback;s.animationTime=0;}
    if(e.property==='AniSpeed'&&e.start>oldTime&&e.start<=newTime)s.animationSpeed=f(e.value);
    if(e.property==='DirSpeed'&&e.start<=newTime&&e.end>oldTime){
      // Fixed MeshPlayer3679..3700 optimized fade consumer. Direction speed
      // takes the frame-end interpolated value before world displacement.
      if(!e.fade||e.end<=newTime)s.dirSpeed=f(e.value);
      else {const begin=f(Math.max(oldTime,e.start)),ratio=f(Math.max(0,Math.min(1,f(f(newTime-begin)/f(f(e.end)-begin)))));
        s.dirSpeed=f(s.dirSpeed+f(f(f(e.value)-s.dirSpeed)*ratio));}
    }
    if(e.property==='DirSpeed'&&!e.fade&&e.start>oldTime&&e.start<=newTime)s.dirSpeed=f(e.value);
    if(e.property!=='Velocity'||e.start===0&&!e.fade||e.end<=oldTime||e.start>newTime)continue;
    const start=f(e.start),end=f(e.end),begin=f(Math.max(cursor,start)),stop=f(Math.min(newTime,end));
    if(start>cursor){accumulateVelocity(s,f(start-cursor));cursor=start;}
    if(!e.fade){s.velocity=e.value.map(f);continue;}
    if(begin<stop){const ratio=f(f(stop-begin)/f(end-begin)),old=[...s.velocity],remain=old.map((n,i)=>f(f(e.value[i])-n));
      s.velocity=old.map((n,i)=>f(n+f(remain[i]*f(ratio*.5))));accumulateVelocity(s,f(stop-begin));cursor=stop;
      s.velocity=old.map((n,i)=>f(n+f(remain[i]*ratio)));
    }
    if(end<=newTime)s.velocity=e.value.map(f);
  }
  accumulateVelocity(s,f(newTime-cursor));
}
export function stepShadowMesh(s,dt,events=[]){
  const elapsed=number(dt,'elapsed');if(elapsed<=0||elapsed>.25)throw new RangeError('Shadow mesh fixed packet required');
  vector(s.position,'position');vector(s.velocity,'velocity');vector(s.velocityAccum,'velocity accumulator');
  vector(s.gravity,'gravity');
  for(const k of ['landY','nowLifeTime','maxLifeTime','globalTime','animationTime','animationSpeed','notCheckLandTime','elastic','elasticX'])number(s[k],k);
  if(!(SHADOW_MESH_NAMES.has(s.name)||s.literalMotion&&LITERAL_MESH_NAMES.has(s.name))||![1,-1].includes(s.facing)||s.maxLifeTime<=0||s.nowLifeTime<0||s.globalTime<0||typeof s.crashLand!=='boolean')
    throw new TypeError('Corrupt original Shadow mesh snapshot');
  if(s.deathReason)throw new RangeError('Ended original Shadow mesh cannot advance');
  // PlayProcess advances global time before its lifetime branch (.cpp:2068).
  // RunEvent accumulates the rounded new-global minus old-global interval,
  // which need not be exactly elapsed after many binary32 packets.
  const oldGlobal=s.globalTime;s.globalTime=f(oldGlobal+elapsed);
  const velocityElapsed=f(s.globalTime-oldGlobal);
  // PlayProcess: LT_TIME checks old age before crash, then advances lifetime.
  // OnFrameMove continues its movement phase even after PlayProcess ends.
  // Stardust target31c744d0 uses OLD age > life, unlike this executor's
  // qualified V5 >= branch. Preserve the selected2016 boundary explicitly.
  const stardust=s.name==='ATT_Stardust_Shower_M01'||s.name==='ATT_Stardust_Shower_M02'||s.name==='Mesh_ATT_Stardust_Shower_Drop';
  if(stardust?s.nowLifeTime>s.maxLifeTime:s.nowLifeTime>=s.maxLifeTime)s.deathReason='template-life-time';
  else if(s.crashLand&&s.nowLifeTime>s.notCheckLandTime&&s.position[1]<=s.landY){
    s.nowLifeTime=s.maxLifeTime;s.deathReason='template-land-crash';
  }
  else s.nowLifeTime=f(s.nowLifeTime+elapsed);
  const halfTimeSquared=f(f(.5*elapsed)*elapsed);
  if(s.literalMotion)velocityEvents(s,oldGlobal,s.globalTime,events);
  for(let i=0;i<3;i++){
    // RunEvent's final UpdateVelocityAccumPosAndEventTimer consumes this
    // packet's velocity; bounce residuals from the preceding packet survive.
    if(!s.literalMotion)s.velocityAccum[i]=f(s.velocityAccum[i]+f(s.velocity[i]*velocityElapsed));
    s.velocityAccum[i]=f(s.velocityAccum[i]+f(halfTimeSquared*s.gravity[i]));
    s.velocity[i]=f(s.velocity[i]+f(s.gravity[i]*elapsed));
  }
  const movement=s.literalMotion?transform(s.velocityAccum,s.basis):s.velocityAccum.map((n,i)=>f(n*(i===1?1:s.facing)));
  for(let i=0;i<3;i++)s.position[i]=f(s.position[i]+movement[i]);
  s.velocityAccum=[0,0,0];
  if(s.useLand!==false&&s.nowLifeTime>s.notCheckLandTime&&s.position[1]<s.landY){
    s.position[1]=s.landY;
    if(!s.crashLand){
      if(s.velocity[1]<0){
        s.velocity[1]=s.velocity[1]>=-50?0:f(s.velocity[1]*-s.elastic);
        s.velocityAccum[1]=f(s.velocity[1]*elapsed);
      }
      if(!sameZero(s.elasticX)&&!sameZero(s.velocity[0])){
        if(s.velocity[0]>=-10&&s.velocity[0]<=10){s.velocity[0]=0;s.elasticX=0;s.velocityAccum[0]=0;}
        else {s.velocity[0]=f(s.velocity[0]*s.elasticX);s.velocityAccum[0]=f(s.velocity[0]*elapsed);}
        s.animationSpeed=f(s.animationSpeed*s.elasticX);
      }
    }
  }
  if(s.literalMotion&&s.dirSpeed){const delta=transform([f(s.dirSpeed*elapsed),0,0],s.basis);for(let i=0;i<3;i++)s.position[i]=f(s.position[i]+delta[i]);}
  // SkinAnim is advanced after the land branch, with the changed play speed.
  s.animationTime=f(s.animationTime+f(elapsed*s.animationSpeed));
  return s;
}
export function refreshShadowMeshLand(s,geometry,{refresh=true}={}){
  if(!refresh||s.deathReason)return {supported:true,refreshed:false};
  const radius=s.crashLand?90:30;
  if(!s.crashLand&&sameZero(s.elasticX))return {supported:true,refreshed:false};
  if(!geometry?.land)return {supported:false,reason:'Original GetLandPosition boundary unavailable'};
  // DamageEffect uses index=-1 for elastic meshes and NULL for CrashLand.
  // Both exclude the actor's remembered line; native query_land initializes
  // -1 and executes the byte-preserved GetLandPosition on the authored map.
  const q=geometry.land({position:[...s.position],radius});
  if(!s.crashLand&&!q.found){s.landRefreshPending=true;
    return {supported:false,reason:'Original GetNearest_LUA fallback unavailable; previous source plane retained'};}
  const p=q.found?q.point:q.rawPoint;
  const land=vector(p,'GetLandPosition result');
  s.landY=land[1];
  // DamageEffect.cpp2527 retains the whole query result for DEPT_DIE_POS;
  // the scalar mesh collision plane cannot reconstruct its X/Z afterwards.
  if(s.crashLand)s.landPosition=land;
  s.landRefreshPending=false;
  return {supported:true,refreshed:true,radius};
}
/** Fixed-V5 DamageEffect FollowLine, for native mesh state. Uses the actual
 * native CanDown query (including its 3D radius), never an X-only projection.
 * Source fragments and target declarations: vc-harpoon-source-v4.json. */
export function followLiteralMeshLine(s,damage,geometry,lines,{initial=false}={}){
  if(damage?.FOLLOW_LINE!==1)return {supported:true};
  if(!geometry?.down)return {supported:false,reason:'Original FollowLine CanDown unavailable'};
  const previous=s.followBeforePosition??[0,0,0];
  const updateLand=!sameZero(s.elasticX);
  const q=geometry.down({position:s.position,radius:updateLand?15:30,downRadius:false,onLine:false});
  const stop=()=>{s.velocity=[0,0,0];s.dirSpeed=0;s.followEndPending=true;};
  const toggle=()=>{
    if(!updateLand||s.followToggle)return;
    s.followToggle=true;s.followFacing=-(s.followFacing??s.facing);
    s.rotation??=[0,s.facing<0?180:0,0];
    const rotation=[...s.rotation];rotation[1]=f(rotation[1]+(s.followFacing<0?180:-180));setFollowBasis(s,rotation);
  };
  if(q.found){
    const line=lines.find(line=>line.lineId===q.lineId);
    if(!line)return {supported:false,reason:'Original FollowLine result lacks its authored line'};
    const dx=line.end[0]-line.start[0],dz=line.end[2]-line.start[2];
    setFollowBasis(s,[0,f(Math.atan2(-dz,dx)*180/Math.PI+((s.followFacing??s.facing)<0?180:0)),0]);
    const p=vector(q.point,'FollowLine result');
    if(!sameZero(previous[0]-p[0])||!sameZero(previous[2]-p[2])){
      if(damage.MUST_ON_LINE===1&&s.position[1]-p[1]>200)stop();
      if(damage.FOLLOW_LINE_GRAVITY===1){
        if(s.position[1]-p[1]>200)p[1]=s.position[1];
      }else if(damage.FOLLOW_LINE_NEW===1){
        if(Math.abs(p[1]-s.position[1])>150)p[1]=s.position[1];
      }else p[1]=s.position[1];
      s.position=p;
    }else toggle();
  }else{
    if(damage.FOLLOW_ON_LINE===1){s.position=[previous[0],s.position[1],previous[2]];toggle();}
    if(damage.MUST_ON_LINE===1)stop();
  }
  // Constructor FollowLine does not perform the later OnFrameMove assignment.
  if(!initial)s.followBeforePosition=[...s.position];
  return {supported:true};
}
export function allowDieDamageChild(definition,deathReason){
  const byCrash=deathReason==='template-land-crash';
  if(definition.LAND_CRASH_ONLY===1||definition.LIFE_TIME_ONLY===1)
    return definition.LAND_CRASH_ONLY===1&&byCrash||definition.LIFE_TIME_ONLY===1&&!byCrash;
  return true;
}
