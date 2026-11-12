/** Target2016 line declarations with pinned V5 User physics consumers.
 * Timers and notices are actor state, so replay, respawn and peer snapshots
 * retain the same trigger. Product overrides: bungee costs 10% and returns
 * 200 units above the destination (V5 overwrites its own +200 with the floor).
 * See contracts/pvp-map-mechanics-source-v1.json.
 */
export const MAP_MECHANICS_VERSION='authored-pvp-map-mechanics-v1';
export const PORTAL_WAIT=.7, PORTAL_LOCK=.3, BUNGEE_WAIT=2, BUNGEE_HP_FRACTION=.1, BUNGEE_RETURN_HEIGHT=200;
const symbol=value=>value?.symbol??value?.$symbol??value;
export const lineType=line=>symbol(line?.type??line?.nativeFields?.LINE_TYPE);
export const isPortal=line=>lineType(line)===2||String(lineType(line)).endsWith('LT_POTAL');
export const isBungee=line=>lineType(line)===6||String(lineType(line)).endsWith('LT_BUNGEE');
export const isJumpPlatform=line=>[4,5].includes(lineType(line))||/LT_JUMP_UP_(?:REL|ABS)$/.test(lineType(line)??'');
export const midpoint=line=>line.start.map((v,i)=>(v+line.end[i])/2);
export function lineMotionBasis(actor,map){
  const line=map.lines.find(l=>l.lineId===(actor.lineId??actor.lastTouchLineId));
  if(!line)return {direction:[1,0,0],depth:[0,0,1]};
  const delta=line.end.map((v,i)=>v-line.start[i]),length=Math.hypot(...delta);
  if(!length)return {direction:[1,0,0],depth:[0,0,1]};
  const direction=delta.map(v=>v/length),depth=[-direction[2],0,direction[0]];
  // GetZVector normalizes only for a sloped line. Airborne movement drops the
  // native direction's Y without renormalizing the horizontal projection.
  if(direction[1]){const n=Math.hypot(...depth);if(n)for(let i=0;i<3;i++)depth[i]/=n;}
  return {direction,depth};
}
export function translateAlongLine(actor,map,distance,{grounded=actor.grounded}={}){
  const {direction}=lineMotionBasis(actor,map);
  actor.x+=direction[0]*distance;actor.z+=direction[2]*distance;
  if(grounded)actor.y+=direction[1]*distance;
}
export function translateMotionOffset(actor,map,x,z){
  const {direction,depth}=lineMotionBasis(actor,map);
  actor.x+=(direction[0]*x+depth[0]*z)*actor.facing;
  actor.z+=(direction[2]*x+depth[2]*z)*actor.facing;
}
/** A body push changes horizontal position after slope transport. Preserve
 * the foot on the same authored, connected floor before the narrow support
 * query; only reciprocal neighbours with a shared endpoint are eligible. */
export function groundedBodyPushPoint(actor,map){
  const first=map.lines.find(l=>l.lineId===actor.lineId);if(!first)return null;
  const pending=[first],visited=new Set();
  while(pending.length){
    const l=pending.shift();if(visited.has(l.lineId))continue;visited.add(l.lineId);
    const [start,end]=[l.start,l.end],dx=end[0]-start[0];
    if(dx&&actor.x>=Math.min(start[0],end[0])&&actor.x<=Math.max(start[0],end[0])){
      const t=(actor.x-start[0])/dx,z=start[2]+(end[2]-start[2])*t;
      if(Math.abs(actor.z-z)<30)return [actor.x,start[1]+(end[1]-start[1])*t,z];
    }
    for(const [key,opposite,endpoint]of [['beforeLine','nextLine',start],['nextLine','beforeLine',end]]){
      const next=map.lines.find(n=>n.lineId===l[key]);
      if(next?.[opposite]===l.lineId&&(key==='beforeLine'?next.end:next.start).every((v,i)=>v===endpoint[i]))pending.push(next);
    }
  }
  return null;
}
export function createMapMechanics(){
  return {portalLineId:null,portalElapsed:0,portalReady:true,bungeeLineId:null,bungeeElapsed:0,
    returnSerial:0,portalSerial:0,portalNotice:null,lastReturn:null,lockRemaining:0};
}
export function jumpPlatformRequest(actor,line){
  if(!actor.grounded||!isJumpPlatform(line)||actor.hp<=0||
    ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_FALL','RSI_DAMAGE_AIR_DOWN_LANDING'].includes(actor.state))return null;
  const f=line.nativeFields??{},x=f.JUMP_SPEED_X,y=f.JUMP_SPEED_Y;
  if(!Number.isFinite(x)||!Number.isFinite(y))return null;
  const direction=symbol(f.LINEMAP_DIRECTION_OPTION);
  if(String(direction).endsWith('LDO_RIGHT')||direction===2)actor.facing=1;
  else if(String(direction).endsWith('LDO_LEFT')||direction===1)actor.facing=-1;
  return {lineId:line.lineId,x,y,absolute:String(lineType(line)).endsWith('LT_JUMP_UP_ABS')||lineType(line)===5};
}
function placeOnLine(actor,line,{above=0}={}){
  const position=midpoint(line);
  [actor.x,actor.y,actor.z]=position;actor.y+=above;
  actor.landPosition=position;actor.lastTouchLineId=line.lineId;
  actor.lineId=above?null:line.lineId;actor.grounded=above===0;
  // Received old-position motion cannot be replayed through a teleport.
  actor.ignoreLineId=null;actor.dropRemaining=0;actor.pendingPlatformJump=null;
}
function portalNotice(state,line){
  state.portalNotice={serial:++state.portalSerial,lineId:line.lineId,position:midpoint(line),age:0};
}
/** Run after the native support query, in Jump -> Bungee -> Portal order.
 * Portal waiting is cancelled on another supported line; airborne packets
 * retain it, just as the original bFootOnLine gate does. A destination portal
 * cannot send the actor straight back until another floor has been touched.
 */
export function advanceMapMechanics(sim,actor,dt){
  const state=actor.mapMechanics??=(createMapMechanics());
  if(state.portalNotice)state.portalNotice.age+=dt;
  if(actor.hp<=0||actor.deathComplete){state.portalLineId=null;state.bungeeLineId=null;return;}
  const line=sim.map.lines.find(l=>l.lineId===(actor.lineId??actor.lastTouchLineId));
  if(state.bungeeLineId!==null){
    state.bungeeElapsed+=dt;
    if(state.bungeeElapsed>BUNGEE_WAIT&&isBungee(line)){
      const target=sim.map.lines.find(l=>l.lineId===line.nativeFields?.TELEPORT_LINE);
      if(target){
        state.bungeeLineId=null;state.bungeeElapsed=0;
        const hpBefore=actor.hp;
        // StateChange must keep room/respawn forceInvincible. Environment HP
        // loss is independent of incoming-hit protection.
        sim.enter(actor,'RSI_DAMAGE_AIR_DOWN','map-bungee-return');
        actor.hp=Math.max(1,actor.hp-actor.hpMax*BUNGEE_HP_FRACTION);
        placeOnLine(actor,target,{above:BUNGEE_RETURN_HEIGHT});
        actor.vx=0;actor.vy=0;state.lockRemaining=0;
        state.lastReturn={serial:++state.returnSerial,fromLineId:line.lineId,toLineId:target.lineId,hpBefore,hpAfter:actor.hp};
        sim.emit('mapBungeeReturned',actor.id,{...state.lastReturn,position:[actor.x,actor.y,actor.z]});
      }
    }
  }else if(actor.grounded&&isBungee(line)){
    state.bungeeLineId=line.lineId;state.bungeeElapsed=0;
    actor.inputLock=Math.max(actor.inputLock??0,BUNGEE_WAIT);
    state.lockRemaining=BUNGEE_WAIT;
    sim.emit('mapBungeeStarted',actor.id,{lineId:line.lineId});
  }
  if(!actor.grounded)return;
  if(isPortal(line)){
    if(!state.portalReady)return;
    if(state.portalLineId===null){
      state.portalLineId=line.lineId;state.portalElapsed=0;
      portalNotice(state,line);sim.emit('sound',actor.id,{name:'Nasod_Element_Teleport.ogg'});
    }else{
      state.portalElapsed+=dt;
      if(state.portalElapsed>PORTAL_WAIT){
        const target=sim.map.lines.find(l=>l.lineId===line.nativeFields?.TELEPORT_LINE);
        if(target){
          const fromLineId=line.lineId;
          state.portalReady=false;state.portalLineId=null;state.portalElapsed=0;
          actor.inputLock=Math.max(actor.inputLock??0,PORTAL_LOCK);
          state.lockRemaining=PORTAL_LOCK;
          placeOnLine(actor,target);portalNotice(state,target);
          sim.emit('sound',actor.id,{name:'Nasod_Element_Teleport.ogg'});
          sim.emit('mapTeleported',actor.id,{fromLineId,toLineId:target.lineId,position:[actor.x,actor.y,actor.z]});
        }
      }
    }
  }else{state.portalLineId=null;state.portalElapsed=0;state.portalReady=true;}
}
/** The room's respawn invincibility rejects ordinary owner HP loss. This
 * narrowly accepts a new, source-linked environment return's bounded 10%
 * loss; an old serial cannot be replayed to spend HP again.
 */
export function invincibleBungeeHp(actor,incoming,map){
  const prior=actor.mapMechanics?.returnSerial??0,next=incoming.mapMechanics?.lastReturn;
  if(!next||next.serial!==prior+1||incoming.mapMechanics.returnSerial!==next.serial)return actor.hp;
  const from=map.lines.find(l=>l.lineId===next.fromLineId);
  if(!isBungee(from)||from.nativeFields?.TELEPORT_LINE!==next.toLineId)return actor.hp;
  if(!(next.hpBefore>0)||next.hpAfter!==Math.max(1,next.hpBefore-actor.hpMax*BUNGEE_HP_FRACTION))return actor.hp;
  const minimum=Math.max(1,actor.hp-actor.hpMax*BUNGEE_HP_FRACTION);
  return Math.max(minimum,Math.min(actor.hp,incoming.hp));
}
