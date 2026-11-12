/** Phase expectations are the original2016 3272c610/32740210/32758740
 * contract, independent of a captured current-Web output. No asset/render I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addRecastStateStart,addRecastEvents,addStasisDamageObserved} from '../../packages/combat-core/add-recasts.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lp-profile.json',import.meta.url)));
const ACTIVE='ANSI_SA_APT_STASIS_FIELD_ACTIVE',FIRST='ANSI_SA_APT_STASIS_FIELD';
const state=()=>({id:'lp',professionId:'LP',state:FIRST,stateSerial:1,skillId:29007,skillScale:1,x:0,y:100,z:0,hpMax:1000,sourceAddCombat:{}});
function fixture(){
 const a=state(),events=[],effects=[];
 const sim={state:{effects,nextEffectId:1},map:{lines:[{lineId:0,start:[0,100,0],end:[1000,100,0]}]},profileFor:()=>profile,
 fire(actor,key,time,before,after,fn){if(before<time&&after>=time)fn();},
 spawnSet(actor,name){events.push({kind:'set',name});effects.push({id:this.state.nextEffectId++,ownerId:actor.id,name:'display',setName:name,definition:{SCALE_X:2,SCALE_Y:3,SCALE_Z:4}});},
 createEffect(actor,definition){const e={id:this.state.nextEffectId++,ownerId:actor.id,name:definition.NAME,definition,power:actor.skillScale};effects.push(e);return e;},
 emit(type,id,data){events.push({type,id,...data});}};
 a.lineId=0;return {a,sim,events,effects};
}
test('first cast and 15-second stored display receive no charge scale even after a previous capped store',()=>{
 const {a,sim,effects}=fixture();a.sourceAddCombat.stasis={remaining:1,hitValue:500,damageValue:500,powerMultiplier:2};
 addRecastStateStart(sim,a);assert.deepEqual(a.sourceAddCombat.stasis,{remaining:15,hitValue:0,damageValue:0,group:1,skillId:29007,powerMultiplier:1});
 addStasisDamageObserved(a,500);addStasisDamageObserved(a,100,{received:true});
 addRecastEvents(sim,a,0,.2);
 assert.equal(effects.length,1);assert.equal(effects[0].setName,'EffectSet_SA_APT_STASIS_FIELD_Loop');
 assert.equal(effects[0].sourceAddStasisSize,undefined);assert.deepEqual(effects[0].definition,{SCALE_X:2,SCALE_Y:3,SCALE_Z:4});
 assert.equal(a.skillScale,1,'storage observations do not change the caster skill scalar');
});
for(const [hit,received,M,size]of [[0,0,1,1],[250,0,1.25,1.25],[500,100,2,1.5]])test(`only second explosion freezes M${M} and visual scale${size}`,()=>{
 const {a,sim,effects}=fixture();addRecastStateStart(sim,a);addStasisDamageObserved(a,hit);addStasisDamageObserved(a,received,{received:true});
 a.state=ACTIVE;a.stateSerial++;addRecastStateStart(sim,a);
 assert.equal(a.sourceAddCombat.stasis.powerMultiplier,M);assert.equal(a.sourceAddCombat.stasis.remaining,0);
 addStasisDamageObserved(a,1000);assert.equal(a.sourceAddCombat.stasis.hitValue,hit,'release freezes both accumulators');
 addRecastEvents(sim,a,0,.01);const display=effects[0];assert.equal(display.sourceAddStasisSize,size);
 assert.deepEqual(display.definition,{SCALE_X:2*size,SCALE_Y:3*size,SCALE_Z:4*size});
 addRecastEvents(sim,a,.29,.31);const burst=effects.at(-1);assert.equal(burst.name,'DamageEffect_APT_Stasis_Field_Activate');
 assert.equal(burst.power,M);assert.equal(burst.sourceAddStasisSize,size);assert.equal(burst.definition.SCALE_X,size);
 assert.equal(a.sourceAddCombat.stasis,null);assert.equal(a.skillScale,1);
 assert.equal(profile.damageEffects.DamageEffect_SA_APT_Stasis_Field_Attack.raw.DAMAGE_DATA.DAMAGE.MAGIC,5.25);
 assert.equal(profile.damageEffects.DamageEffect_APT_Stasis_Field_Activate.raw.DAMAGE_DATA.DAMAGE.MAGIC,52.5);
});
