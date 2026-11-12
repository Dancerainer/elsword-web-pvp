/** V55 additions to the unchanged archived-input V51/V54 virtual-wire probes.
 * These are current Web simulations; no GPU-rendered visibility is claimed. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ApplicationWire} from './network-application-wire-v40.mjs';
import {createProductionPair} from './network-production-client-v51.mjs';
import {runPairedProbe as runExistingProbe,frames,drainFrames} from './network-gameplay-probes-v51.mjs';
import {distribution,stepMs} from './network-fault-model-v38.mjs';
import {withVictimCollisionWitness,attachVictimWitness} from './network-victim-witness-v55.mjs';
export {frames,drainFrames};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pose=a=>({x:a.x,y:a.y,z:a.z,state:a.state,stateSerial:a.stateSerial,animationTime:a.animationTime,
  hp:a.hp,hitStop:a.hitStop??0,worldStop:a.worldStop??0});

export async function runPairedProbe(version,job){
  const audit=withVictimCollisionWitness(version);
  return attachVictimWitness(await runObservedProbe(audit.version,job),audit);
}

async function runObservedProbe(version,job){
  if(job.kind!=='late-move-away')return runExistingProbe(version,job);
  const {scenario,seed}=job,ids=['a','b'];
  const wire=new ApplicationWire({scenario,seed,lateAttack:true});wire.install();
  let pair,syncs=[];
  try{
    const profile=JSON.parse(readFileSync(resolve(version.root,'packages/combat-core/rf-profile.json')));
    profile.states.TEST_ATTACK={animationName:'Wait',raw:{ANIM_NAME:'Wait',ANIM_SPEED:1,PLAY_TYPE:2,APPLY_ANIM_MOVE:0,
      ATTACK_TIME0:{1:.12,2:.22},DAMAGE_DATA:structuredClone(profile.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA)}};
    const map={sceneId:'v55-late-move-away-synthetic',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
    const sims=ids.map(owner=>version.simulation.createSimulation({profile,map,networkOwnerId:owner,seed:2016,
      preset:{passives:[],guildPassives:[]},collisionSampler:actor=>[{kind:'sphere',center:[actor.x+30,50,0],radius:30}],
      defenderSampler:actor=>[{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}],
      actors:ids.map((id,index)=>({id,team:index,position:[index?30:0,0,0],lineId:0,loadout:Array(8).fill(null)}))}));
    for(const sim of sims){for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}sim.drainEvents();}
    for(const sim of sims)sim.actor('b').hp=1;
    syncs=ids.map(()=>version.ownership.createLocalOwnershipSync({clock:()=>wire.now,combatPlaybackVersion:1,ownerStatusVersion:1,continuousAuraVersion:2}));
    pair=await createProductionPair({version,wire,sims,syncs});
    const trace=[],events=[],inputs=[],settled=[],reportedHits=new Map(),hpChanges=[],errors=[],emissions=[];
    let previousHeld=[];
    for(let frame=1;frame<=480;frame++){
      await pair.advance(frame*stepMs);
      if(frame===1){sims[0].enter(sims[0].actor('a'),'TEST_ATTACK','fixture-generated-attack');
        Object.assign(sims[0].actor('a'),{animationPlaybackSpeed:1,animationSpeedRamp:null});}
      for(let i=0;i<2;i++){
        const held=i===1&&frame<=60?['RIGHT']:[],prior=i===1?previousHeld:[];
        if(i===1)previousHeld=held;
        const input={held,pressed:held.filter(k=>!prior.includes(k)),released:prior.filter(k=>!held.includes(k))};
        inputs.push([frame,i,input]);const sim=sims[i],sync=syncs[i],own=sim.actor(ids[i]);
        const beforePrepare=pose(own);sync.beforeStep(sim,ids[i]);
        if(own.hp!==beforePrepare.hp)errors.push({frame,owner:ids[i],reason:'before-step-mutated-owner-hp'});
        pair.endpoints[ids[i]].client.notifyOwnerCapacity?.();
        const before=pose(own),attackerBefore=pose(sim.actor(ids[1-i]));
        sim.step(1/60,{...sync.remoteInputs(sim,ids[i]),[ids[i]]:input},{snapshot:false});
        const received=sim.drainEvents();events.push(...received.map(event=>({frame,localOwner:ids[i],...event})));
        const localHits=received.filter(event=>event.type==='hit'&&event.targetId===ids[i]);
        for(const event of localHits)settled.push({frame,owner:ids[i],eventId:event.eventId,damage:event.amount,
          sourceState:sim.actor(event.actorId)?.state,targetState:own.state,
          localStepWitness:{positiveStepSeconds:1/60,attackerBefore,attackerAfter:pose(sim.actor(event.actorId)),
            defenderBefore:before,defenderAfter:pose(own)}});
        if(own.hp!==before.hp)hpChanges.push({frame,owner:ids[i],before:before.hp,after:own.hp,localHitIds:localHits.map(hit=>hit.eventId)});
        const report=sync.afterStep(sim,ids[i],received,input);
        if(report){for(const hit of report.hits)reportedHits.set(ids[i]+':'+hit.id,{...hit,owner:ids[i]});
          emissions.push([i,frame,report.actions.map(a=>a.id)]);await pair.send(i,input,report);}
      }
      trace.push({frame,at:wire.now,defender:pose(sims[1].actor('b')),localAttacker:pose(sims[1].actor('a')),
        sourceAttacker:pose(sims[0].actor('a'))});
    }
    await pair.advance(660*stepMs);
    const transport=pair.report(),localHits=settled.filter(hit=>hit.owner==='b'),endHp=sims[1].actor('b').hp;
    if(transport.errors.length)throw Error('production-client-or-driver-error:'+JSON.stringify(transport.errors));
    return {kind:job.kind,trace,events,wirePackets:wire.packets,transport,
      inputSha256:sha(inputs),ownerTraceSha256:sha(trace.map(row=>[row.frame,row.sourceAttacker,row.defender])),
      controllerEmissionSha256:sha(emissions),positionError:distribution([]),maximumFreezeMs:0,activeFreezeMs:0,
      diagnostics:syncs.map(sync=>sync.combatPlaybackDiagnostics.receiver),
      integrity:{initialHp:1,endHp,hpDelta:1-endHp,localHits,hpChanges,preStepOwnerHpMutations:errors,
        duplicateHitIds:settled.length-new Set(settled.map(hit=>hit.owner+':'+hit.eventId)).size,
        allSettledHitsReported:settled.every(hit=>reportedHits.has(hit.owner+':'+hit.eventId)),
        coordinatorDuplicateHits:transport.server.canonicalHitAudit.duplicateIds.reduce((n,row)=>n+row.count-1,0),
        victimWalkedAway:trace[59].defender.x>150,
        fixture:'One 120-220ms synthetic attack starts at frame1; victim at30 walks RIGHT for60frames; all attacker action packets held until>=700ms. VictimHP1 catches a delayed lethal hit.',
        limits:'Positive local simulation step and local collision events only. This does not prove the human saw a rendered frame; no GPU/browser or native transport is running.'}};
  }finally{
    try{pair?.close();for(const sync of syncs)sync.clear();await wire.settle();}
    finally{wire.close();}
  }
}

export function additionalGameplayViolations(row){
  const failures=[];
  if(!row.integrity.victimCollisionWitness?.passed)failures.push('local-hit-without-positive-current-victim-collision-witness');
  if(row.kind!=='late-move-away')return failures;
  if(row.integrity.localHits.length||row.integrity.hpDelta!==0)failures.push('late-attack-hit-victim-after-local-move-away');
  if(!row.integrity.victimWalkedAway)failures.push('move-away-fixture-did-not-move');
  if(row.integrity.preStepOwnerHpMutations.length)failures.push('owner-hp-mutated-before-positive-local-step');
  return failures;
}
