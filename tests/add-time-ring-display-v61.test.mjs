import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddTimeRingEffects} from '../apps/web/add-time-ring-effects-v61.mjs';
import source from '../contracts/add-crest-display-v61.json' with {type:'json'};
for(const professionId of ['LP','MM','DE'])test(`${professionId} recipient ring uses original436 Bip01 attachment and reconciles expiry/consume/death without a combat record`,()=>{
 const births=[],ends=[],active=new Set(),actor={id:'recipient',professionId,hp:100,stateSerial:1,sourceTimeRing:{remaining:16.5}},state={actors:[actor],effects:[]};
 const view=createAddTimeRingEffects({samplers:{effectAnchorSampler:()=>({position:[10,30,0],facing:1})},start:e=>{births.push(e);active.add(e.effectId);},stop:id=>{ends.push(id);active.delete(id);},hasEffect:id=>active.has(id)});
 view.step(state);assert.equal(births.length,1);assert.equal(births[0].name,'Buff_Crest_of_Time_Time');assert.equal(births[0].definition.BONE_NAME,'Bip01');assert.equal(births[0].definition.TRACE,1);
 for(let i=0;i<20;i++)view.step(state);assert.equal(births.length,1,'frames and reapplication do not reopen the 9999s original sequence');
 actor.sourceTimeRing=null;view.step(state);assert.equal(active.size,0);assert.equal(ends.length,1);
 actor.sourceTimeRing={remaining:10};view.step(state);assert.equal(births.length,2);
 actor.hp=0;view.step(state);assert.equal(active.size,0);assert.equal(view.proof().combatRecordsAdded,0);assert.equal(view.proof().wireFieldsAdded,0);assert.deepEqual(state.effects,[]);
});
test('original ring recipient closure retains exact source declarations and independent orbit/trace clocks',()=>{
 const t=source.templates.Buff_Crest_of_Time_Time,c=source.templates.Buff_Crest_of_Time_Time01;
 assert.equal(source.buffTemplate.raw.BUFF_TEMPLET_ID,436);assert.equal(source.buffTemplate.sourcePc.instruction,26782);
 assert.equal(source.effectSets.EffectSet_ATT_Common_Crest_of_Time_Buff.sourcePc.instruction,41938);
 assert.equal(t.fields.Lifetime,9999);assert.equal(t.fields.Emitrate,100);assert.equal(t.fields.NumParticles,1);assert.equal(t.fields.TriggerCount,1);assert.equal(t.fields.TraceParticleList,c.name);
 assert.equal(t.events.filter(e=>e.property==='Velocity').length,4);assert.deepEqual(t.events.find(e=>e.property==='EventTimer'),{property:'EventTimer',start:2,end:2,fade:false,value:.001});
 assert.equal(c.fields.Emitrate,40);assert.equal(c.fields.Lifetime,.4);assert.equal(c.textures['Arme_Ring2.dds'].source.sha256,'9fa65a5787fc8896f49dfe0fd0a18776958235805091fc3ec85dec39c2cb2102');
});
