/** Actual map/helper/WASM diagnostics; output is simulation evidence, never a target oracle. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {dashZxFixture,dashZxFrame} from './rf_dash_zx_audit.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));

export async function downZFixture({facing=1,gap=70,delay=0,dash=false,targetFloor='lower',holdDown=true,presetOverride}={}){
  if(![-1,1].includes(facing)||!Number.isFinite(gap)||gap<0||gap>170||!Number.isInteger(delay)||delay<0||delay>40||
    typeof dash!=='boolean'||typeof holdDown!=='boolean'||!['lower','same'].includes(targetFloor))
    throw new TypeError('Invalid bounded platform fixture');
  const f=await dashZxFixture({facing,gap,position:[1290,3320,0],lineId:5,presetOverride});
  const {s,a,b}=f;b.x=a.x+facing*gap;
  if(targetFloor==='lower'){b.y=3080;b.lineId=2;b.lastTouchLineId=2;b.landPosition=[b.x,b.y,b.z];}
  f.case={facing,gap,delay,dash,targetFloor,holdDown};
  return f;
}

export function startDownZ(f){
  const {s,a}=f,{facing,delay,dash,holdDown}=f.case;
  const key=facing===1?'RIGHT':'LEFT';
  if(dash){
    dashZxFrame(f,{pressed:[key],held:[key]});dashZxFrame(f,{released:[key]});
    dashZxFrame(f,{pressed:[key],held:[key]});
  }
  dashZxFrame(f,{pressed:['DOWN'],held:dash?[key,'DOWN']:['DOWN']});
  for(let i=0;i<delay;i++)dashZxFrame(f,{held:holdDown?['DOWN']:[]});
  dashZxFrame(f,{pressed:['Z'],held:holdDown?['DOWN','Z']:['Z']});
  return f;
}

export async function observeDownZ(options={}){
  const f=await downZFixture(options),{s,a,b}=f,samples=[];
  const original=s.checkCharacterAttack.bind(s);
  // Observe immediately before the real consumer; never inject shapes/hits or
  // alter the current input, animation interval, defender, or attack radius.
  s.checkCharacterAttack=(actor,before,after)=>{
    if(actor.id===a.id&&['RSI_JUMP_COMBO_Z','RSI_DASH_JUMP_COMBO_Z'].includes(actor.state)){
      const raw=s.profile.states[actor.state].raw;
      const shapes=s.collisionSampler(actor,{profile:s.profile,raw,stateTime:actor.stateTime,animationTime:after});
      const defenders=s.defenderSampler(b);
      const points=shapes.flatMap(x=>defenders.map(d=>s.hitPoint(x,d)).filter(Boolean));
      const windows=Object.entries(raw).filter(([k])=>/^ATTACK_TIME\d+$/.test(k)).map(([,v])=>v);
      samples.push({time:s.state.time,state:actor.state,before,after,grounded:actor.grounded,
        position:[actor.x,actor.y,actor.z],targetPosition:[b.x,b.y,b.z],targetState:b.state,
        active:windows.some(w=>after>w['1']&&after<w['2']),geometricOverlap:points.length>0,
        attackHelpers:shapes.map(x=>x.source?.helper),priorAccepted:Object.hasOwn(actor.hits,b.id),targetInvincible:b.invincible});
    }
    return original(actor,before,after);
  };
  startDownZ(f);
  for(let i=0;i<90;i++)dashZxFrame(f,{held:f.case.holdDown?['DOWN']:[]});
  const events=s.drainEvents(),hits=events.filter(e=>e.type==='hit'&&e.actorId===a.id&&e.origin?.kind==='character');
  const landTimes=events.filter(e=>e.type==='landed'&&e.actorId===a.id).map(e=>e.time);
  return {fixture:f.case,hitCount:hits.length,hitMultipliers:hits.map(e=>e.data.DAMAGE),
    activeOverlaps:samples.filter(x=>x.active&&x.geometricOverlap&&!x.priorAccepted&&!x.targetInvincible).length,
    landingFrameActiveOverlap:samples.some(x=>landTimes.includes(x.time)&&x.active&&x.geometricOverlap),
    missedActiveOverlap:samples.filter(x=>x.active&&x.geometricOverlap&&!x.priorAccepted&&!x.targetInvincible).length>0&&hits.length===0,
    landTimes,stateChanges:events.filter(e=>e.type==='stateChanged'&&e.actorId===a.id).map(e=>({time:e.time,state:e.state,reason:e.reason})),
    finished:{state:a.state,position:[a.x,a.y,a.z],targetState:b.state,hp:b.hp},samples};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const cases=[];
  for(const facing of [-1,1])for(const gap of [0,35,70,120,170])for(const delay of [0,1,3,6,9])
    for(const dash of [false,true])for(const targetFloor of ['lower','same'])
      cases.push(await observeDownZ({facing,gap,delay,dash,targetFloor}));
  const output=resolve(root,process.argv[2]??'artifacts/proof-v14/down-z-implementation.json');
  if(!output.startsWith(resolve(root,'artifacts')+'/')&&!output.startsWith(resolve(root,'artifacts')+'\\'))throw new TypeError('Private output must stay in this task artifacts');
  const hashes=Object.fromEntries(['packages/combat-core/index.mjs','packages/combat-assets/index.mjs','artifacts/rf/runtime-pose.json',
    'artifacts/scene/sander-garpai-rock-pvp/collision.json','artifacts/native/commands.wasm','artifacts/native/geometry.wasm']
    .map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]));
  const summary={caseCount:cases.length,hitCases:cases.filter(c=>c.hitCount>0).length,
    missedActiveOverlapCases:cases.filter(c=>c.missedActiveOverlap).length,
    landingFrameOverlapCases:cases.filter(c=>c.landingFrameActiveOverlap).length,
    landingFrameOverlapHitCases:cases.filter(c=>c.landingFrameActiveOverlap&&c.hitCount>0).length};
  const record={schema:'rf-down-z-implementation-v14',evidenceClass:'current-simulation-observations',targetClientMeasured:false,
    method:'production input edges, real authored platform5/line2, original RF helper pose and actual WASM; instrumentation only before existing checkCharacterAttack',
    limits:['No target2016 trajectory oracle. A no-overlap case is not evidence that original2016 must miss. Do not turn output hit counts into original-client expected values.'],
    summary,implementationHashes:hashes,cases};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify({output,...summary,targetClientMeasured:false}));
}
