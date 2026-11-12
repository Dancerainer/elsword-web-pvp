import {Simulation} from '../combat-core/index.mjs';
/** Bounded A/B experiment. Common phases are inherited candidates, not native fidelity claims. */
export class MinimalSimulation extends Simulation {
 constructor(options){super({...options,versions:{...options.versions,minimalRuntime:'reference-device-and-six-events-v1'}});this.movement=options.movement;}
 processInput(a,keys){
  if(!this.movement?.handles(a.state))return super.processInput(a,keys);
  const lower=keys.pressed.has('DOWN')&&a.grounded&&this.nativeGeometry?.down({position:[a.x,a.y,a.z],radius:this.profile.referenceSemantics.lineRadius,lastLineId:a.lastTouchLineId,downRadius:true,onLine:true});
  const result=this.movement.evaluate(a,keys,this.profile,!!lower?.found);
  const previous=a.state,direction=(keys.held.has('RIGHT')?1:0)-(keys.held.has('LEFT')?1:0);
  // Facing/commit remain the explicit common host. Do not run JS free-state priority a second time.
  if(direction&&['RSI_WAIT','RSI_WALK'].includes(previous))a.facing=direction;
  if(result.state){
   if(result.state==='RSI_DASH'&&direction)a.facing=direction;
   a.skillId=null;a.skillScale=1;
   this.enter(a,result.state,'minimal-original-event');
   if(result.state==='RSI_JUMP_UP'||result.state==='RSI_JUMP_DOWN'||result.state==='RSI_DASH_JUMP'){
    a.grounded=false;a.lineId=null;
   }
   this.emit('minimalDecision',a.id,{previous,next:result.state,evidence:'compiled-V5-event; JS common-phase and commit boundary'});
  }
  a.y+=result.offsetY;a.vy=result.vy;
  if(result.offsetY<0&&lower?.found){a.landPosition=lower.point;a.lastTouchLineId=lower.lineId;}
 }
}
