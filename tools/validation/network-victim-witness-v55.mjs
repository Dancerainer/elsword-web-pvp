/** Observe actual production calls without sampling geometry a second time or
 * changing decisions. A witness is simulation evidence, not rendered pixels. */
const clone=value=>value===undefined?null:structuredClone(value);
const point=actor=>[actor.x,actor.y,actor.z];
const pose=actor=>({position:point(actor),state:actor.state,stateSerial:actor.stateSerial,
  animationTime:actor.animationTime,hp:actor.hp});

export function withVictimCollisionWitness(version){
  const witnesses=[],unwitnessedCalls=[],unexplainedHpReductions=[];
  const audited={...version,simulation:{...version.simulation,createSimulation(options){
    const sim=version.simulation.createSimulation(options),owner=options.networkOwnerId;
    if(!owner)return sim; // Frozen coordinator does no local combat settlement.
    let positiveStep=null,contact=null;
    const step=sim.step.bind(sim),checkHits=sim.checkHits.bind(sim),contactGeometry=sim.contactGeometry.bind(sim),
      hitPoint=sim.hitPoint.bind(sim),applyHit=sim.applyHit.bind(sim);
    sim.step=(dt,...args)=>{const previous=positiveStep;positiveStep={dt,timeBefore:sim.state.time};
      const before=sim.actor(owner)?.hp,eventStart=sim.state.events.length;
      try{return step(dt,...args);}finally{
        const after=sim.actor(owner)?.hp,localHits=sim.state.events.slice(eventStart).filter(event=>event.type==='hit'&&event.targetId===owner);
        if(after<before&&!localHits.length)unexplainedHpReductions.push({owner,step:clone(positiveStep),before,after});
        positiveStep=previous;
      }};
    sim.checkHits=(attacker,shapes,data,hits,origin)=>{
      const previous=contact;contact={attackerId:attacker.id,origin:clone(origin),shapes:clone(shapes),target:null,impact:null};
      try{return checkHits(attacker,shapes,data,hits,origin);}finally{contact=previous;}
    };
    sim.contactGeometry=(target,attacker)=>{
      const posed=contactGeometry(target,attacker);
      if(contact&&contact.attackerId===attacker?.id){contact.target={id:target.id,actual:pose(target),posed:pose(posed)};contact.impact=null;}
      return posed;
    };
    sim.hitPoint=(attack,defender)=>{
      const impact=hitPoint(attack,defender);
      if(contact&&impact)contact.impact={attack:clone(attack),defender:clone(defender),point:clone(impact)};
      return impact;
    };
    sim.applyHit=(attacker,defender,data,origin={})=>{
      if(defender?.id!==owner)return applyHit(attacker,defender,data,origin);
      const local=sim.actor(owner),before=pose(local),eventStart=sim.state.events.length;
      const currentContact=contact&&contact.attackerId===attacker?.id&&contact.target?.id===owner
        &&contact.origin.kind===origin.kind&&contact.origin.id===origin.id?clone(contact):null;
      const observation={owner,at:sim.state.time,positiveStep:clone(positiveStep),attacker:pose(attacker),
        defender:before,origin:clone(origin),contact:currentContact,
        damage:{RE_ATTACK:data.RE_ATTACK??null,HIT_GAP:data.HIT_GAP??null,REACT_TYPE:data.REACT_TYPE??null}};
      const result=applyHit(attacker,defender,data,origin);
      const localEvents=sim.state.events.slice(eventStart).filter(event=>event.type==='hit'&&event.targetId===owner);
      for(const event of localEvents){
        const witness={...observation,eventId:event.eventId,damageAmount:event.amount,hpAfter:sim.actor(owner).hp,
          positiveLocalStep:positiveStep?.dt>0,currentCollision:!!currentContact?.impact,
          currentVictimPosition:!!currentContact?.target&&JSON.stringify(currentContact.target.posed.position)===JSON.stringify(before.position),
          sameImpact:!!currentContact?.impact&&JSON.stringify(currentContact.impact.point)===JSON.stringify(origin.impactPoint)};
        witnesses.push(witness);
        if(!witness.positiveLocalStep||!witness.currentCollision||!witness.currentVictimPosition||!witness.sameImpact)unwitnessedCalls.push(witness);
      }
      return result;
    };
    return sim;
  }}};
  return {version:audited,witnesses,unwitnessedCalls,unexplainedHpReductions};
}

export function attachVictimWitness(row,audit){
  const keys=new Set(audit.witnesses.map(value=>`${value.owner}:${value.eventId}`));
  const missing=row.integrity.localHits.filter(hit=>!keys.has(`${hit.owner}:${hit.eventId}`));
  row.integrity.victimCollisionWitness={witnesses:audit.witnesses,unwitnessedCalls:audit.unwitnessedCalls,
    unexplainedHpReductions:audit.unexplainedHpReductions,
    missingLocalHitWitnesses:missing,passed:!audit.unwitnessedCalls.length&&!missing.length&&!audit.unexplainedHpReductions.length,
    scope:'Actual current checkHits/contactGeometry/hitPoint/applyHit during a positive local step, observed without extra geometry evaluation. No renderer or original-client-runtime claim.'};
  return row;
}
