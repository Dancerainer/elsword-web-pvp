import test from 'node:test';
import assert from 'node:assert/strict';
const {addCommands}=await import(process.env.ADD_V61_COMMAND_MODULE??'../../packages/combat-core/add-commands.mjs');
const {addXxzzFrame}=process.env.ADD_V61_XXZZ_BASELINE==='1'?{addXxzzFrame:()=>{}}:await import('../../packages/combat-core/add-xxzz-2016.mjs');
const states=['ANSI_COMBO_ZZZ','ANSI_COMBO_XXZZ_START','ANSI_COMBO_XXZZ_LOOP','ANSI_COMBO_XXZZ_FINISH','RSI_JUMP_DOWN','RSI_WAIT'];
const p={states:Object.fromEntries(states.map(n=>[n,{raw:{},sourceState:n,clip:{durationSeconds:n.endsWith('_LOOP')?.2:1}}])),referenceSemantics:{lineRadius:30},stateAliases:{}};
const keys=(pressed=[],held=[])=>({pressed:new Set(pressed),held:new Set(held)});
function actor(professionId,facing=1){return {id:'a',professionId,state:'ANSI_COMBO_ZZZ',grounded:true,vx:3000*facing,vy:0,y:3080,facing,
 animationTime:.1,animationStopped:false,passiveSpeed:{x:-1,y:-1},sourceCommandFlags:0,sourceAddCombat:{pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1}};}
for(const id of ['LP','MM','DE'])for(const facing of [-1,1])test(`${id}/${facing}: original third Z off-support resets local speed550 before free fall`,()=>{
 const a=actor(id,facing);a.grounded=false;
 const r=addCommands.runEvent(a,keys(),p);
 assert.equal(r.state,'RSI_JUMP_DOWN');assert.equal(r.y,3050);assert.equal(r.vx,550*facing);
 const b=actor(id,facing);assert.equal(addCommands.runEvent(b,keys(),p).vx,3000*facing,'supported third Z is unchanged');
});
function enter(a,n){a.state=n;a.animationTime=0;a.animationStopped=false;a.sourceCommandFlags=0;addCommands.runStart(a,p);}
for(const id of ['LP','MM','DE'])for(const extend of [false,true])test(`${id}: XXZZ ${extend?'fresh-Z extension reaches max10 total':'minimum2 loops + finish despite held Z'}`,()=>{
 const a=actor(id);enter(a,'ANSI_COMBO_XXZZ_START');a.animationTime=.46;
 assert.equal(addCommands.runEvent(a,keys(),p).state,'ANSI_COMBO_XXZZ_LOOP');
 enter(a,'ANSI_COMBO_XXZZ_LOOP');let loops=0;
 while(a.state==='ANSI_COMBO_XXZZ_LOOP'){
  a.animationTime=.02;let r=addCommands.runEvent(a,keys(extend?['Z']:[],['Z']),p);a.sourceCommandFlags=r.flags;
  a.animationTime=.2;a.animationStopped=true;r=addCommands.runEvent(a,keys([],['Z']),p);loops++;
  assert.ok(loops<=9);enter(a,r.state);
 }
 assert.equal(a.state,'ANSI_COMBO_XXZZ_FINISH');assert.equal(loops,extend?9:2);assert.equal(a.sourceAddCombat.xxzzLoops,0);
});
test('XXZZ off-support exits without advancing count; buffered fresh Z survives until animation completion',()=>{
 const a=actor('MM');enter(a,'ANSI_COMBO_XXZZ_LOOP');a.sourceAddCombat.xxzzLoops=4;a.grounded=false;
 assert.equal(addCommands.runEvent(a,keys(['Z']),p).state,'RSI_JUMP_DOWN');assert.equal(a.sourceAddCombat.xxzzLoops,4);
 a.grounded=true;a.animationTime=.1;const r=addCommands.runEvent(a,keys(['Z']),p);assert.equal(r.flags&1,1);assert.equal(r.state,null);
});
function frameFixture({id='LP',mp=10,formation=false,learned=false}={}){
 const a={...actor(id),mp,mpMax:300,state:'ANSI_COMBO_XXZZ_LOOP',sourceAdd:{formation,dp:0},passivePolicy:{skillLevels:learned?{29410:1}:{}}};
 const events=[],sim={state:{effects:[],nextEffectId:1},profileFor:()=>p,fire(_a,_id,_t,_b,_n,fn){fn();},
  spawnSet(_a,name){sim.state.effects.push({id:sim.state.nextEffectId++,ownerId:a.id,setName:name,clock:'animation',setStartAnimation:.01});},emit(...args){events.push(args);}};
 return {a,sim,events};
}
for(const id of ['LP','MM','DE'])test(`${id}: original .01 XXZZ frame pays1MP and spawns original damage set with absolute member clock`,()=>{
 const {a,sim,events}=frameFixture({id});addXxzzFrame(sim,a,0,Math.fround(.01));
 assert.equal(a.mp,9);assert.equal(sim.state.effects[0]?.setName,'EffectSet_AN_Combo_XXZZ_Loop');assert.equal(sim.state.effects[0].setStartAnimation,0);
 assert.equal(events[0]?.[0],'addXxzzLoop');assert.equal(events[0]?.[2].declaredAmount,1);
});
test('XXZZ frame cannot fire before/again at equal previous threshold, outside loop, or without resource',()=>{
 for(const [before,after,change]of [[0,.009,{}],[Math.fround(.01),.02,{}],[0,.02,{state:'ANSI_COMBO_XXZZ_START'}],[0,.02,{mp:0}],[0,.02,{professionId:'LK'}]]){
  const {a,sim}=frameFixture();Object.assign(a,change);addXxzzFrame(sim,a,before,after);assert.equal(sim.state.effects.length,0);
 }
});
