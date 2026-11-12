import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addQuicksilverLinkEvents,updateAddQuicksilverLink,endAddQuicksilverLink,
  validateAddQuicksilverLinkState,ADD_QUICKSILVER_LINK,ADD_QUICKSILVER_LINK_MAIN} from '../../packages/combat-core/add-quicksilver-link.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
const states={forward:'ANSI_SA_ALP_QUICKSILVER_ACCEL',back:'ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK'};
function fixture(phase='forward'){
  const a={id:'lp',professionId:'LP',state:states[phase],stateSerial:17,skillId:29011,hp:100,x:0,y:0,z:0,facing:1,lineId:1,animationTime:0,fired:[]};
  const notes=[],events=[],sim={state:{actors:[a],effects:[]},profileFor:()=>profile,map:{lines:[{lineId:1,start:[0,0,0],end:[100,0,0]}]},
    effectAnchorSampler:({definition},actor)=>({position:definition.BONE_NAME==='Bip01'?[actor.x,actor.y,actor.z]:[actor.x+20,actor.y+30,actor.z+10]}),
    note:(...args)=>notes.push(args),emit:(...args)=>events.push(args),
    fire(actor,id,time,before,after,callback){if(!actor.fired.includes(id)&&before<=time&&after>=time&&after>before){actor.fired.push(id);callback();}},
    createEffect(actor,definition,options){const e={id:this.state.effects.length+1,ownerId:actor.id,ownerStateSerial:actor.stateSerial,
      name:definition.NAME,definition:structuredClone(definition),skillId:actor.skillId,mainEffectName:ADD_QUICKSILVER_LINK_MAIN,
      damage:structuredClone(profile.damageEffects[ADD_QUICKSILVER_LINK].raw),birthAnchor:structuredClone(options.birthAnchor),
      currentAnchor:null,elapsed:0,animationTime:0,deleteConditions:options.deleteConditions};this.state.effects.push(e);return e;}};
  const step=(before,after)=>{a.animationTime=after;addQuicksilverLinkEvents(sim,a,before,after);updateAddQuicksilverLink(sim,a);};
  return {a,sim,notes,events,step};
}
const live=sim=>sim.state.effects.filter(e=>!e.dead);
const near=(a,b,epsilon=1e-8)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<epsilon,`${a} != ${b}`));

for(const [phase,create,retire] of [['forward',.001,.85],['back',.01,.57]]){
  test(`${phase} link follows original creation/retirement boundaries and creates one handle`,()=>{
    const {sim,a,step,events}=fixture(phase);
    step(0,create/2);assert.equal(live(sim).length,0);
    step(create/2,create);assert.equal(live(sim).length,1);
    const e=live(sim)[0];assert.equal(e.name,ADD_QUICKSILVER_LINK);assert.deepEqual(e.deleteConditions,[2,3]);
    validateAddQuicksilverLinkState(e,'LP',[a]);
    step(create/2,create);assert.equal(sim.state.effects.length,1,'replayed interval cannot duplicate the handle');
    step(retire-.02,retire-.001);assert.equal(live(sim).length,1);
    step(retire-.001,retire);assert.equal(live(sim).length,0);
    endAddQuicksilverLink(sim,a);assert.equal(events.filter(([name])=>name==='effectEnded').length,1);
  });
}

test('the main mesh follows current source bones while damage/definition/ordinary anchors remain unchanged',()=>{
  const {sim,a,step}=fixture();step(0,.01);const e=live(sim)[0];
  const original=structuredClone({damage:e.damage,definition:e.definition,birthAnchor:e.birthAnchor,currentAnchor:e.currentAnchor});
  a.x=75;a.y=33;a.z=-41;a.animationTime=.4;updateAddQuicksilverLink(sim,a);
  near(e.sourceAddQuicksilverLink.mainAnchor.position,[95,63,-31]);
  assert.deepEqual({damage:e.damage,definition:e.definition,birthAnchor:e.birthAnchor,currentAnchor:e.currentAnchor},original);
  assert.equal(e.sourcePosedAnchor,undefined);assert.equal(e.sourceAddLinkScale,undefined);
  near(e.sourceAddQuicksilverLink.mainScale.slice(1),[1,1]);
  assert.ok(e.sourceAddQuicksilverLink.mainScale[0]>0&&e.sourceAddQuicksilverLink.mainScale[0]<1);
});

test('the original endpoint uses saved curved-line yaw and facing, not a screen-space offset',()=>{
  const {sim,a,step}=fixture();sim.map.lines[0].end=[0,0,100];a.facing=-1;step(0,.01);
  const s=live(sim)[0].sourceAddQuicksilverLink;
  // Curve yaw is -90, left-facing adds 180 => +90 degrees. Original literal
  // yaw+1.57 therefore points mainly toward -Z rather than +screen-X.
  assert.ok(s.mainAnchor.rotation[1]>80);assert.equal(s.mainAnchor.facing,-1);
});

test('positive sub-unit link distance is preserved rather than clamped to one unit',()=>{
  const {sim,step}=fixture();const yaw=Math.fround(1.5700000524520874);const end=[150*Math.sin(yaw),45,150*Math.cos(yaw)];
  sim.effectAnchorSampler=({definition})=>({position:definition.BONE_NAME==='Bip01'?[0,0,0]:[end[0]-.125,end[1],end[2]]});
  step(0,.01);assert.ok(Math.abs(live(sim)[0].sourceAddQuicksilverLink.mainScale[0]-.125/800)<1e-12);
});

test('early recast, state replacement and owner death clean only the owner link',()=>{
  for(const change of [a=>{a.state=states.back;a.stateSerial++;},a=>{a.state='RSI_WAIT';},a=>{a.hp=0;},a=>{a.pvpDisconnected=true;}]){
    const {sim,a,step}=fixture();step(0,.01);const original=live(sim)[0];
    const other={...structuredClone(original),id:77,ownerId:'other'};sim.state.effects.push(other);
    change(a);updateAddQuicksilverLink(sim,a);assert.equal(original.dead,true);assert.equal(other.dead,undefined);
  }
});

test('missing hand/root pose or source line never creates a guessed link; later loss retires it',()=>{
  for(const missing of ['Bip01','Bip01_L_Finger2']){
    const {sim,step,notes}=fixture(),sample=sim.effectAnchorSampler;
    sim.effectAnchorSampler=(e,a)=>e.definition.BONE_NAME===missing?null:sample(e,a);
    step(0,.01);assert.equal(live(sim).length,0);assert.ok(notes.some(([key])=>key==='add-quicksilver-link-bone'));
  }
  const {sim,a,step}=fixture();step(0,.01);sim.effectAnchorSampler=()=>null;a.animationTime=.2;
  updateAddQuicksilverLink(sim,a);assert.equal(live(sim).length,0);
  const absent=fixture();absent.sim.map.lines=[];absent.step(0,.01);assert.equal(live(absent.sim).length,0);
});

test('coarse intervals preserve impact before creation before retirement else-if order',()=>{
  const {sim,step}=fixture();step(0,.81);assert.equal(sim.state.effects.length,0,'the impact branch excludes creation');
  const back=fixture('back');back.step(0,.58);
  assert.equal(live(back.sim).length,1,'creation wins its same-interval retirement branch');
  endAddQuicksilverLink(back.sim,back.a);assert.equal(live(back.sim).length,0);
});

test('strict owned-state validation rejects wrong identities, extra members and nonfinite transforms',()=>{
  const {sim,a,step}=fixture();step(0,.01);const original=live(sim)[0];
  for(const mutate of [e=>{e.skillId=29017;},e=>{e.name='DamageEffect_ALP_Quicksilver_Accel_Impact';},
    e=>{e.sourceAddQuicksilverLink.group++;},e=>{e.sourceAddQuicksilverLink.extra=true;},
    e=>{e.sourceAddQuicksilverLink.mainAnchor.position[1]=NaN;},e=>{e.sourceAddQuicksilverLink.mainAnchor.rotation[2]=Infinity;},
    e=>{e.sourceAddQuicksilverLink.mainAnchor.extra=1;},e=>{e.sourceAddQuicksilverLink.mainScale[1]=2;},
    e=>{e.sourceAddQuicksilverLink.mainScale[0]=0;},e=>{e.sourceAddFury={role:'beam'};}]){
    const e=structuredClone(original);mutate(e);assert.throws(()=>validateAddQuicksilverLinkState(e,'LP',[a]),TypeError);
  }
  assert.throws(()=>validateAddQuicksilverLinkState(original,'MM',[a]),TypeError);
  assert.throws(()=>validateAddQuicksilverLinkState(original,'LP',[{...a,stateSerial:99}]),TypeError);
  assert.throws(()=>validateAddQuicksilverLinkState(original,'LP',[{...a,state:states.back}]),TypeError);
  validateAddQuicksilverLinkState(structuredClone(original),'LP',[a]);
});
