import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelAuditFixture,cancelAuditInput,cancelProfiles} from '../helpers/cancel-audit-fixture.mjs';
import {historicalSourcePostRows,historicalSourcePostRow,sourceCancelProfile,originalEnterCancelFields} from '../../packages/combat-core/source-cancel-fields-v53.mjs';
import {runHistoricalExplicitPost,HISTORICAL_EXPLICIT_POSTS} from '../../packages/combat-core/historical-cancel-post-v53.mjs';
import {withSourcePostRequests,applySourceStateRequest} from '../../packages/combat-core/source-state-requests-v53.mjs';
const keys=cancelAuditInput,f=Math.fround;
const post=(sim,a,input=keys())=>withSourcePostRequests(sim,a,()=>runHistoricalExplicitPost(sim,a,input),{profile:sourceCancelProfile(a,sim.profileFor(a))});
test('72 source buckets retain their original classification and each selected Web state gets independent original-enter gates',()=>{
 assert.equal(historicalSourcePostRows.length,72);let count=0;
 for(const r of historicalSourcePostRows){if(r.status!=='selected-local-post-control-contract')continue;count++;
  for(const s of r.states){const p=cancelProfiles[s.profession],d=p.states[s.state];assert.ok(d,s.profession+':'+s.state);
   assert.equal(historicalSourcePostRow({state:s.state,professionId:s.profession},p)?.sourceState,r.sourceState);
   const normalized=originalEnterCancelFields(d.raw);
   for(const[k,v]of Object.entries(r.cancelFields))assert.equal(normalized[k],v,r.sourceState+'/'+k);
  }
 }assert.equal(count,66);
});
test('BM261 waits for animation end plus contact and enters actual native18 on next update',()=>{
 const {sim,a}=cancelAuditFixture('BM');sim.enter(a,'RBM_DASH_JUMP_COMBO_XZ','source-test');
 a.animationTime=.01;a.grounded=true;post(sim,a);assert.equal(a.sourcePendingState,undefined);
 a.animationStopped=true;a.grounded=false;post(sim,a);assert.equal(a.sourcePendingState,undefined);
 a.grounded=true;post(sim,a);assert.equal(a.state,'RBM_DASH_JUMP_COMBO_XZ');assert.equal(a.sourcePendingState.state,'RSI_JUMP_LANDING');
 applySourceStateRequest(sim,a);assert.equal(a.state,'RSI_JUMP_LANDING');assert.notEqual(a.state,'RBM_DASH_JUMP_COMBO_XZ_Landing');
});
test('RS136 captures EPT1 Z and requests214 directly; charge respects .25 inclusive release gate and1 maximum',()=>{
 const {sim,a}=cancelAuditFixture('RS');sim.enter(a,'RSI_DASH_COMBO_X','source-test');const commands=sim.commandsFor(a),p=sim.profileFor(a);
 a.animationTime=.2;let out=commands.runEvent(a,keys(['Z'],['Z']),p);assert.equal(out.state,null);a.sourceCommandFlags=out.flags;
 a.animationTime=.7;out=commands.runEvent(a,keys(['Z']),p);assert.equal(out.state,'ESSI_ERS_XZ_CHARGE');
 sim.enter(a,out.state,'source-test');a.animationTime=.249;post(sim,a,keys());assert.equal(a.sourcePendingState,undefined);
 a.animationTime=.25;post(sim,a,keys());assert.equal(a.sourcePendingState.state,'ESSI_ERS_XZZ');
 sim.enter(a,'ESSI_ERS_XZ_CHARGE','source-test-reset');a.animationTime=1;post(sim,a,keys(['Z']));assert.equal(a.sourcePendingState.state,'ESSI_ERS_FULL_CHARGE_XZZ');
 sim.enter(a,'ESSI_ERS_XZ_CHARGE','source-test-reset');a.grounded=false;const y=a.y;post(sim,a);assert.equal(a.y,y,'charge214 own branch has no45 offset');
 assert.equal(a.sourcePendingState.state,'RSI_JUMP_DOWN');
});
test('ordinary zero/.01/.066 gates clamp to .1 while raw declarations remain untouched',()=>{
 const {sim,a}=cancelAuditFixture('LK',{skillId:21006});sim.enter(a,'RSI_COMBO_Z','source-test');
 const raw=sim.profileFor(a).states[a.state].raw;assert.equal(raw.SKILL_CANCEL_AFTER,0);
 a.animationTime=f(.1);assert.equal(sim.skillAvailability(a.id,0).available,false);
 a.animationTime=.1001;assert.equal(sim.skillAvailability(a.id,0).available,true);assert.equal(raw.SKILL_CANCEL_AFTER,0);
 const bm=cancelAuditFixture('BM');bm.sim.enter(bm.a,'RBM_COMBO_XZZ','source-test');
 assert.equal(sourceCancelProfile(bm.a,bm.sim.profileFor(bm.a)).states[bm.a.state].raw.SKILL_CANCEL_AFTER,f(.1));
});
test('source X3a ends on held X while source X3 excludes held attacks from its .7 skip',()=>{
 const {sim,a}=cancelAuditFixture('RS');sim.enter(a,'ESSI_COMBO_X3a','source-test');a.animationTime=.61;
 post(sim,a,keys(['X']));assert.equal(a.sourcePendingState.state,'RSI_WAIT');
 sim.enter(a,'RSI_COMBO_XXX','source-test');a.animationTime=.71;post(sim,a,keys(['X']));assert.equal(a.sourcePendingState,undefined);
 post(sim,a,keys(['LEFT']));assert.equal(a.sourcePendingState.state,'RSI_WAIT');
});
test('Revolver end uses W before D before S; Hellfire has no base tail',()=>{
 const {sim,a}=cancelAuditFixture('VC',{skillId:24034});sim.enter(a,'RSI_SA_RWT_REVOLVER_CANNON_OVER_END','source-test');a.animationTime=.6;
 const mp=a.mp;withSourcePostRequests(sim,a,context=>{assert.ok(runHistoricalExplicitPost(sim,a,{...keys(['RIGHT','A'],['DASH','A']),pureDoubleRight:true}));assert.equal(context.skipBaseTail,true);},
  {profile:sourceCancelProfile(a,sim.profileFor(a))});
 assert.equal(a.sourcePendingState.state,'RSI_WAIT');assert.equal(a.mp,mp);
 sim.enter(a,'RSI_SA_RWT_HELLFIRE_GATLING_OVER_END','source-test');withSourcePostRequests(sim,a,context=>{runHistoricalExplicitPost(sim,a,keys());assert.equal(context.skipBaseTail,true);});
});
test('guard READY retains paid skill context; GUARD strict five-second release retains equality',()=>{
 const {sim,a}=cancelAuditFixture('RS',{skillId:21211});sim.step(1/60,{actor:{held:['A'],pressed:['A']}},{snapshot:false});
 assert.equal(a.state,'ESSI_ERS_COUNTER_GUARD_READY');a.animationStopped=true;post(sim,a,keys(['A']));applySourceStateRequest(sim,a);
 assert.equal(a.state,'ESSI_ERS_COUNTER_GUARD');assert.equal(a.skillContext.key,'A');
 a.stateTime=5;post(sim,a,keys(['A']));assert.equal(a.sourcePendingState,undefined);
 a.stateTime=5.001;post(sim,a,keys(['A']));assert.equal(a.sourcePendingState.state,'ESSI_ERS_COUNTER_GUARD_END');
});
test('historical post queues after frame and applies on the following eligible update',()=>{
 const {sim,a}=cancelAuditFixture('RS');sim.enter(a,'ESSI_COMBO_X3a','source-test');a.animationTime=.61;
 sim.step(1/60,{actor:{held:['X']}},{snapshot:false});assert.equal(a.state,'ESSI_COMBO_X3a');assert.equal(a.sourcePendingState.state,'RSI_WAIT');
 sim.step(1/60,{actor:{}},{snapshot:false});assert.equal(a.state,'RSI_WAIT');
});
test('Z1 independent main-end overrides an accepted paid skill; Z3 ordinary S precedes a pending combo',()=>{
 const {sim,a}=cancelAuditFixture('LK',{skillId:21006});sim.enter(a,'RSI_COMBO_Z','source-test');a.animationTime=1;a.animationStopped=true;
 const before=a.mp;post(sim,a,keys(['A'],['A']));assert.ok(a.mp<before);assert.equal(a.sourcePendingState.state,'RSI_WAIT');
 assert.equal(a.canNotAttackTime,f(.1));
 sim.enter(a,'RSI_COMBO_ZZZ','source-test');a.cooldowns={};a.mp=a.mpMax;a.animationTime=.4;a.sourceCommandFlags=1;
 post(sim,a,keys(['A'],['A']));assert.equal(a.sourcePendingState.skill.skillId,a.loadout[0].skillId);
});
test('X1 RS Z latch uses original .43 literal; RS Z2 latch precedes simultaneous ordinary skill',()=>{
 const {sim,a}=cancelAuditFixture('RS',{skillId:21026});sim.enter(a,'RSI_COMBO_X','source-test');a.animationTime=.42;
 post(sim,a,keys(['Z'],['Z']));assert.equal(a.sourceCommandFlags&2,2);assert.equal(a.sourcePendingState,undefined);
 a.animationTime=.4300000071525574;post(sim,a,keys());assert.equal(a.sourcePendingState,undefined);
 a.animationTime=.431;post(sim,a,keys());assert.equal(a.sourcePendingState.state,'ESSI_ERS_XZ');
 sim.enter(a,'RSI_COMBO_ZZ','source-test');a.animationTime=.6;a.sourceCommandFlags=4;const mp=a.mp;
 post(sim,a,keys(['A'],['A']));assert.equal(a.sourcePendingState.state,'RSI_COMBO_ZZZ');assert.equal(a.mp,mp);
});
test('RS ZZZZ does not acquire an ATTACK consumer from its declaration',()=>{
 const {sim,a}=cancelAuditFixture('RS');sim.enter(a,'RSI_COMBO_ZZZZ','source-test');a.animationTime=1.11;
 // Keep main end false to isolate the declaration-only T field from end.
 sim.profileFor(a).states[a.state].clip.durationSeconds=4;
 post(sim,a,keys(['Z','X'],['Z','X']));assert.equal(a.sourcePendingState,undefined);
});
test('DashAttackX and Z3Landing do not expose ordinary S simply because the table declares it',()=>{
 const {sim,a}=cancelAuditFixture('RS',{skillId:21026});
 for(const n of ['RSI_DASH_COMBO_X','ESSI_DASH_JUMP_COMBO_Z3_LANDING']){
  sim.enter(a,n,'source-test');a.animationTime=.9;assert.equal(sim.skillAvailability(a.id,0).available,false,n);
 }
});
test('DashZ1 selected EPT latch wins before end and VC dashZZ writes native216 with L1',()=>{
 const lk=cancelAuditFixture('LK');lk.sim.enter(lk.a,'RSI_DASH_COMBO_Z','source-test');lk.a.animationStopped=true;lk.a.sourceCommandFlags=1;
 post(lk.sim,lk.a);assert.equal(lk.a.sourcePendingState.state,'RSI_DASH_COMBO_ZZ');
 const vc=cancelAuditFixture('VC');vc.sim.enter(vc.a,'RVC_DASH_COMBO_ZZ','source-test');vc.a.animationTime=.2;
 post(vc.sim,vc.a,keys(['Z'],['Z']));assert.equal(vc.a.sourceCommandFlags&2,2);vc.a.animationTime=.44;
 post(vc.sim,vc.a);assert.equal(vc.a.sourcePendingState.state,'RVC_DASH_COMBO_ZZZ');
});
test('Barrage stand has direction before S and independent end, while air ends in18 on contact',()=>{
 const {sim,a}=cancelAuditFixture('VC',{skillId:24034});sim.enter(a,'RSI_A_RWT_BARRAGE_ATTACK_STAND','source-test');a.animationTime=.94;
 const mp=a.mp;post(sim,a,keys(['RIGHT','A'],['A']));assert.equal(a.sourcePendingState.state,'RSI_WALK');assert.equal(a.mp,mp);
 a.animationStopped=true;post(sim,a,keys(['RIGHT']));assert.equal(a.sourcePendingState.state,'RSI_WAIT');
 sim.enter(a,'RSI_A_RWT_BARRAGE_ATTACK_AIR','source-test');a.animationStopped=true;post(sim,a);assert.equal(a.sourcePendingState.state,'RSI_JUMP_LANDING');
});
test('user-confirmed Haze finished air follow-ups remain available above the original end request',()=>{
 const {sim,a}=cancelAuditFixture('VC',{skillId:24218});sim.enter(a,'RSI_A_RWT_BARRAGE_ATTACK_AIR','source-test');
 a.animationStopped=true;a.grounded=false;const y=a.y,mp=a.mp;
 post(sim,a,keys(['A'],['A']));assert.equal(a.sourcePendingState.state,'RSI_A_RWT_FLAME_SWORD_FLY');assert.ok(a.mp<mp);assert.equal(a.y,y);
 sim.enter(a,'RSI_A_RWT_BARRAGE_ATTACK_AIR','source-test-reset');a.animationStopped=true;a.grounded=false;
 post(sim,a,{...keys(['RIGHT','X'],['DASH','X']),pureDoubleRight:true});
 assert.equal(a.sourcePendingState.state,'RSI_DASH_JUMP');assert.deepEqual(a.sourcePendingState.productPressed,['X']);assert.equal(a.y,y);
});
test('all explicit historical profession instances consume the independent grounded main-end trace',()=>{
 // Expected native successors read from the retained original post bodies:
 // all other selected rows below request13 at main.end without held/latches.
 const expected={ESSI_ERS_COUNTER_GUARD_READY:'ESSI_ERS_COUNTER_GUARD',ESSI_ERS_COUNTER_GUARD:'ESSI_ERS_COUNTER_GUARD_END',
  ESSI_ESK_DASH_COMBO_ZChargeX:'ESSI_ESK_DASH_COMBO_ZX',ESSI_ELK_DASH_COMBO_XChargeX:'ESSI_ELK_DASH_COMBO_XX',
  ESSI_ERS_XZ_CHARGE:null,ESSI_DASH_JUMP_COMBO_Z3_LANDING:null,ESSI_JUMP_ATTACK_X:'RSI_JUMP_LANDING',ESSI_JUMP_ATTACK_Z:'RSI_JUMP_LANDING',
  ESSI_DASH_JUMP_COMBO_Z1:'RSI_DASH_JUMP_LANDING',ESSI_DASH_JUMP_COMBO_Z2:'RSI_DASH_JUMP_LANDING',
  ESSI_DASH_JUMP_COMBO_Z3:'RSI_DASH_JUMP_LANDING',ESSI_DASH_JUMP_COMBO_X1:'RSI_DASH_JUMP_LANDING',
  ESSI_DASH_JUMP_COMBO_X2:'ESSI_DASH_JUMP_COMBO_X2_LANDING',RBM_DASH_JUMP_COMBO_XZ:'RSI_JUMP_LANDING',
  RBM_COMBO_XZZZ:'RSI_JUMP_LANDING',RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZ:'RSI_DASH_JUMP_COMBO_ZZ_Landing',
  RVC_SI_A_BLEEDING_SLICER_FLY:'RSI_JUMP_LANDING'};
 const fixtures=new Map();let instances=0,delegated=0;
 for(const row of historicalSourcePostRows){if(row.status!=='selected-local-post-control-contract'||!HISTORICAL_EXPLICIT_POSTS.has(row.sourceState))continue;
  for(const item of row.states){let fixture=fixtures.get(item.profession);if(!fixture){fixture=cancelAuditFixture(item.profession);fixtures.set(item.profession,fixture);}
   const {sim,a}=fixture;a.state=item.state;a.stateSerial++;a.animationTime=0;a.animationStopped=true;a.grounded=true;a.sourceCommandFlags=0;a.hits={};
   delete a.sourcePendingState;const handled=post(sim,a);
   if(item.profession==='IS'&&['ESSI_DASH_JUMP_COMBO_X1','ESSI_DASH_JUMP_COMBO_Z2'].includes(row.sourceState)){
    assert.equal(handled,false,'shared historical consumer delegates to the existing IS product callback');
    assert.equal(a.sourcePendingState,undefined);
    const postProfile=sourceCancelProfile(a,sim.profileFor(a));
    withSourcePostRequests(sim,a,()=>sim.runActorPost(a,keys(),{before:0,serial:a.stateSerial,inputSerial:a.stateSerial,
      def:postProfile.states[a.state],elapsed:1/60,remotePlayback:false}),{profile:postProfile});
    delegated++;
   }
   assert.equal(a.state,item.state,'post must not immediately apply');
   const next=Object.hasOwn(expected,row.sourceState)?expected[row.sourceState]:'RSI_WAIT';
   assert.equal(a.sourcePendingState?.state??null,next,item.profession+'/'+row.sourceState);instances++;
  }
 }assert.ok(instances>110);assert.equal(delegated,4,'both original names and Web aliases use the IS consumer');
});
