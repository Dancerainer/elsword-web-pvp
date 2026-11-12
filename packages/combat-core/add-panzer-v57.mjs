/** Panzer Buster's declared up/down aim, original REDLINE/BG resources and
 * qualified fixed-source callbacks (X2GUAdd.cpp b9ea0a23,16490..16767).
 * This is a version-qualified Web adapter, not2016 client measurement. */
import {arcLineBasis} from './archenemy-mesh.mjs';
const f=Math.fround;
export const PANZER_PREFIX='ANSI_SA_AAT_PANZER_BUSTER_';
export const PANZER_RED='DamageEffect_Panzer_Buster_Aiming_REDLINE';
export const PANZER_BG='EffectSet_SI_SA_AAT_Panzer_Buster_Aiming_BG';
export const PANZER_FIRE='EffectSet_SI_SA_AAT_Panzer_Buster_Fire';
const state=(sim,a)=>sim.profileFor(a).states[a.state]?.sourceState??a.state;
const own=a=>a.professionId==='MM'&&[29012,29032].includes(a.skillId);
const alive=a=>a.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
function stopAim(sim,a){for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG)){
 e.dead=true;e.endEmitted=true;e.suppressSecondaryDamage=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason:'add-panzer-aim-ended'});
}}
export function validateAddPanzerState(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==4||![29012,29032].includes(s.skillId)||
  !Number.isFinite(s.charge)||s.charge<0||s.charge>3.250001||!Number.isFinite(s.angle)||Math.abs(s.angle)>42.500001||typeof s.pending!=='boolean')throw new TypeError('Invalid Add Panzer state');return true;
}
export function addPanzerStateStart(sim,a){
 const m=a.sourceAddCombat;
 // Ordinary Add transitions have no Panzer handles or controller to retire.
 // An existing controller must still clean up after skill/class replacement.
 if(!own(a)&&!m?.panzer)return;
 const n=state(sim,a);
 if(!own(a)||!n.startsWith(PANZER_PREFIX)||!alive(a)){stopAim(sim,a);if(m)delete m.panzer;return;}
 if(n===PANZER_PREFIX+'START'){
  stopAim(sim,a);m.panzer={skillId:a.skillId,charge:0,angle:0,pending:false};return;
 }
 const s=m.panzer;if(!s)return;
 if(n===PANZER_PREFIX+'FIRE'){stopAim(sim,a);return;}
 if(n!==PANZER_PREFIX+'AIMING'||sim.state.effects.some(e=>e.ownerId===a.id&&e.name===PANZER_RED&&!e.dead))return;
 const sample=sim.effectAnchorSampler?.({definition:{BONE_NAME:'EF01'}},a,{profile:sim.profileFor(a)});
 if(!sample){sim.note('add-panzer-original-ef01','Original EF01 required for Panzer aiming line',a);return;}
 const basis=arcLineBasis(a,sim.map.lines),e=sim.createEffect(a,{NAME:PANZER_RED},{birthAnchor:{position:[...sample.position],facing:a.facing,rotation:[0,basis.rotation[1],s.angle],customPosition:true}});
 if(e){e.currentAnchor=structuredClone(e.birthAnchor);e.sourcePosedAnchor=structuredClone(e.birthAnchor);}
 sim.spawnSet(a,PANZER_BG);
}
/** Charge uses native actor elapsed time across all three aiming states;
 * switching to UP/DOWN must never reset the three-second total. */
export function tickAddPanzer(sim,a,dt){
 const s=a.sourceAddCombat?.panzer,n=state(sim,a);if(!s)return;
 if(!alive(a)||!own(a)||!n.startsWith(PANZER_PREFIX)){stopAim(sim,a);delete a.sourceAddCombat.panzer;return;}
 if(!['AIMING','DEGREE_UP','DEGREE_DOWN'].some(suffix=>n===PANZER_PREFIX+suffix)||!(dt>0))return;
 s.charge=f(s.charge+f(dt));
 if(n===PANZER_PREFIX+'DEGREE_UP')s.angle=s.angle>=30?30:f(s.angle+dt*50);
 else if(n===PANZER_PREFIX+'DEGREE_DOWN')s.angle=s.angle<=-30?-30:f(s.angle-dt*50);
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.name===PANZER_RED&&!e.dead){
  const anchor=e.currentAnchor??e.birthAnchor;if(!anchor)continue;
  e.currentAnchor={...anchor,rotation:[0,anchor.rotation[1],s.angle]};e.sourcePosedAnchor=structuredClone(e.currentAnchor);
 }
}
export function addPanzerInput(sim,a,keys){
 if(!own(a))return null;const n=state(sim,a),s=a.sourceAddCombat?.panzer;if(!s)return null;
 const held=keys.held,keyHeld=held.has(a.skillContext?.key);
 if(n===PANZER_PREFIX+'AIMING'){
  if(!keyHeld&&s.charge>f(.5)||s.charge>3)return PANZER_PREFIX+'FIRE';
  if(held.has('UP')){s.pending=false;return PANZER_PREFIX+'DEGREE_UP';}
  if(held.has('DOWN')){s.pending=false;return PANZER_PREFIX+'DEGREE_DOWN';}
  return false;
 }
 if(n===PANZER_PREFIX+'DEGREE_UP'||n===PANZER_PREFIX+'DEGREE_DOWN'){
  if(!keyHeld||s.charge>3)return PANZER_PREFIX+'FIRE';
  const w=sim.profileFor(a).states[a.state].raw.EVENT_PROCESS_TIME0,t=f(a.animationTime),direction=n.endsWith('_UP')?'UP':'DOWN';
  if(s.pending&&(t>f(w['3'])||a.animationStopped)){s.pending=false;return PANZER_PREFIX+'AIMING';}
  if(!held.has(direction)&&t>=f(w['1'])&&t<f(w['2']))s.pending=true;
  return false;
 }
 return null;
}
export function fireAddPanzer(sim,a){
 const s=a.sourceAddCombat?.panzer;if(!s||!own(a))return;
 const first=sim.state.nextEffectId;sim.spawnSet(a,PANZER_FIRE);
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.id>=first){
  const sampled=sim.effectAnchorSampler?.(e,a,{profile:sim.profileFor(a)});
  if(!sampled){sim.note('add-panzer-fire-anchor','Original Panzer member anchor required for group rotation',a);continue;}
  // Group rotation is an instance input, never a mutation of the raw member.
  e.birthAnchor={...sampled,position:[...sampled.position],rotation:[...(sampled.rotation??[0,0,0])],customPosition:true};
  delete e.birthAnchor.matrix;e.birthAnchor.rotation[2]+=s.angle;
 }
 sim.emit('addPanzerFired',a.id,{angle:s.angle,charge:s.charge,skillId:a.skillId,evidence:'qualified fixed-source Panzer aim; target2016 input prose/resources'});
}
