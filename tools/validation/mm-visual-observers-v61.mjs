/** Read-only current-Web evidence selectors. Source names/data are supplied
 * independently from the pinned MM declaration, never inferred from a hit. */
import assert from 'node:assert/strict';
export function bindFactoryDpContacts({events,actorId,targetId,initialDp,finalDp,source}){
 const starts=events.filter(e=>e.type==='effectStarted'&&e.actorId===actorId&&e.name===source.damageName&&e.setName===source.setName&&e.skillId===null),
  states=events.filter(e=>e.type==='stateChanged'&&e.actorId===actorId&&e.state===source.state),
  gains=events.filter(e=>e.type==='addDpChanged'&&e.actorId===actorId),used=new Set(),contacts=[];
 let dp=initialDp;
 assert.ok(gains.length>0,'Actual owner DP changes are required');
 for(const gain of gains){
  assert.equal(gain.reason,'hit','Verified addHitResources consumer owns ordinary DP');assert.ok(gain.delta>0);
  assert.equal(gain.before,dp);assert.equal(gain.delta,gain.dp-gain.before);
  const hit=events.find(e=>e.type==='hit'&&e.actorId===actorId&&e.targetId===targetId&&e.amount>0&&
   e.origin?.kind==='effect'&&e.origin.skillId===null&&e.time===gain.time&&e.eventId>gain.eventId&&!used.has(e.eventId)&&
   starts.some(start=>start.effectId===e.origin.id&&start.eventId<gain.eventId&&start.time<=gain.time&&
    states.some(state=>state.stateSerial===start.ownerStateSerial&&state.eventId<start.eventId&&state.time<=start.time)));
  assert.ok(hit,'Each DP change must bind the original Z state/set/carrier ID and real recipient hit in the same tick');
  for(const field of ['DYNAMO_PARTICLE_RATE_TYPE','DAMAGE_TYPE','HIT_TYPE','REACT_TYPE'])assert.equal(hit.data?.[field],source.data[field]);
  assert.equal(hit.data?.DAMAGE?.PHYSIC,source.data.DAMAGE.PHYSIC);assert.notEqual(hit.data?.NO_DAMAGE,true);assert.notEqual(hit.data?.NO_DAMAGE,1);
  used.add(hit.eventId);dp=gain.dp;contacts.push({gain,hit,carrier:starts.find(e=>e.effectId===hit.origin.id)});
 }
 assert.equal(dp,finalDp,'All prepared DP must be accounted for by bound original ordinary contacts');
 return {gains,hits:contacts.map(c=>c.hit),contacts};
}

/** The immutable fee receipt and subsequent original Pylon contact DP are
 * separate operations. Account for both; never infer the fee from net DP. */
export function settleFactoryOperationDp({events,actorId,targetId,initialDp,finalDp,skillId,mode,expectedCost,impact,maxImpactGain}){
 const commits=events.filter(e=>e.type==='addSkillResourcesCommitted'&&e.actorId===actorId&&e.skillId===skillId&&e.mode===mode);
 assert.equal(commits.length,1);const committed=commits[0];assert.equal(committed.dpCost,expectedCost);
 assert.ok(initialDp>=expectedCost);let dp=Math.fround(initialDp-expectedCost);const paidDp=dp;
 const gains=events.filter(e=>e.type==='addDpChanged'&&e.actorId===actorId),contacts=[],used=new Set();
 const starts=events.filter(e=>e.type==='effectStarted'&&e.actorId===actorId&&e.skillId===skillId&&e.name===impact.damageName&&e.setName===impact.setName&&
  events.some(s=>s.type==='stateChanged'&&s.actorId===actorId&&s.state===impact.state&&s.stateSerial===e.ownerStateSerial&&s.eventId>committed.eventId&&s.eventId<e.eventId));
 const hits=events.filter(e=>e.type==='hit'&&e.actorId===actorId&&e.targetId===targetId&&e.amount>0&&e.origin?.kind==='effect'&&e.origin.skillId===skillId&&starts.some(s=>s.effectId===e.origin.id));
 assert.ok(gains.length<=1,'Original RE_ATTACK0 Pylon and one opponent permit at most one recovery');
 for(const gain of gains){
  assert.ok(gain.eventId>committed.eventId&&gain.time>=committed.time);assert.equal(gain.reason,'hit');
  const maximumDelta=Math.fround(Math.min(8000,gain.before+maxImpactGain))-gain.before;
  assert.equal(gain.before,dp);assert.ok(gain.delta>0&&gain.delta<=maximumDelta,'Recovery is bounded by original Pylon DP rates, frozen gain options and binary32 rounding');
  assert.equal(gain.delta,gain.dp-gain.before);assert.ok(gain.dp>=0&&gain.dp<=8000);
  const hit=hits.find(h=>h.time===gain.time&&h.eventId>gain.eventId&&!used.has(h.eventId)&&starts.some(s=>s.effectId===h.origin.id&&s.eventId<gain.eventId));
  assert.ok(hit,'Post-fee DP must bind the original factory impact carrier and actual recipient');
  for(const field of ['DYNAMO_PARTICLE_RATE_TYPE','DAMAGE_TYPE','HIT_TYPE','REACT_TYPE','APPLIED_SKILL_ID'])assert.equal(hit.data?.[field],impact.data[field]);
  assert.equal(hit.data?.DAMAGE?.MAGIC,impact.data.DAMAGE.MAGIC);assert.notEqual(hit.data?.NO_DAMAGE,true);assert.notEqual(hit.data?.NO_DAMAGE,1);
  used.add(hit.eventId);contacts.push({gain,hit,carrier:starts.find(s=>s.effectId===hit.origin.id)});dp=gain.dp;
 }
 assert.equal(contacts.length,hits.length,'A positive original impact cannot disappear from DP accounting');
 assert.equal(dp,finalDp,'Fixed payment and every observed original restoration must account for net DP');
 return {committed,initialDp,paidDp,restored:gains.reduce((n,e)=>n+e.delta,0),finalDp,contacts,maxImpactGain};
}
