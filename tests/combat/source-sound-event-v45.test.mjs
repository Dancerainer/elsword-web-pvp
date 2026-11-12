import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import gm from '../../packages/combat-core/gm-profile.json' with {type:'json'};
import evidence from '../../contracts/source-distance-native-v45.json' with {type:'json'};
import {sourceSoundEventMetadata,sourceSoundPositionMetadata,sourceEffectSoundEventMetadata,SOURCE_SOUND_DISTANCE} from '../../packages/combat-core/source-sound-event-v45.mjs';
const map={lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(){return createSimulation({profile:gm,map,preset:{passives:[],guildPassives:[]},actors:[
 {id:'local',team:0,position:[0,0,0],lineId:0},{id:'remote',team:1,position:[5000,0,0],lineId:0}]});}

test('actual original three GM start sounds preserve local-only2D ownership metadata even for remote represented actors',()=>{
 const sim=fixture(),a=sim.actor('remote');sim.enter(a,'ESI_SGM_START','source-audio');
 sim.processStateEvents(a,0,2);const sounds=sim.state.events.filter(e=>e.type==='sound'&&e.actorId===a.id&&/^SOUND_PLAY/.test(e.field));
 assert.deepEqual(sounds.map(e=>e.name),['ElesisVoice_Start4.ogg','Slash2.ogg','NPCRaven_Slash1.ogg']);
 for(const sound of sounds){assert.equal(sound.onlyIfLocal,true);assert.equal(sound.native3D,false);assert.equal(sound.soundDistance,undefined);assert.deepEqual(sound.sourcePosition,[5000,0,0]);}
 assert.equal(evidence.gmStartDeclaration.states.ESI_SGM_START.sounds.SOUND_PLAY0['4'],1);
});

test('ordinary original sound events carry emission XYZ and default80/4800 camera-space metadata without changing combat RNG',()=>{
 const sim=fixture(),a=sim.actor('local'),before=sim.state.seed;a.x=123;a.y=40;a.z=12;
 sim.soundEvent(a,'source-sample',{'1':0,'2':'Slash.ogg','3':100});
 const sound=sim.state.events.at(-1);assert.equal(sound.native3D,true);assert.equal(sound.onlyIfLocal,false);
 assert.deepEqual(sound.sourcePosition,[123,40,12]);assert.deepEqual(sound.soundDistance,{min:80,max:4800,curve:'linear',listener:'camera-eye',units:'source-world'});
 assert.equal(sim.state.seed,before);a.x=999;assert.equal(sound.sourcePosition[0],123,'emission metadata is a value snapshot');
 assert.deepEqual(SOURCE_SOUND_DISTANCE,sound.soundDistance);
});

test('local-only source sound metadata has no invented distance curve and invalid source positions are rejected',()=>{
 const data=sourceSoundEventMetadata({x:1,y:2,z:3},true);assert.equal(data.native3D,false);assert.equal(data.soundDistance,undefined);
 assert.throws(()=>sourceSoundEventMetadata({x:1,y:NaN,z:3}),TypeError);
});

test('effect sound uses the live main-mesh transform and a missing transform stays unsupported instead of guessing owner XYZ',()=>{
 const effect={birthAnchor:{position:[10,20,30]},currentAnchor:{position:[40,50,60]}};
 const data=sourceEffectSoundEventMetadata(effect);assert.deepEqual(data.sourcePosition,[40,50,60]);
 effect.currentAnchor.position[0]=100;assert.deepEqual(data.sourcePosition,[40,50,60]);
 assert.equal(data.soundPositionSource,'effect-main-mesh');assert.match(data.soundPositionEvidence,/original2016 SOUND consumer not closed/);
 const unknown=sourceEffectSoundEventMetadata({ownerId:'local',x:123,y:456,z:789});
 assert.equal(unknown.native3D,true);assert.equal(unknown.sourcePosition,null);assert.match(unknown.soundSpatialUnsupported,/unavailable/);
 assert.throws(()=>sourceSoundPositionMetadata([1,2]),TypeError);
 assert.throws(()=>sourceSoundPositionMetadata([1,2,3,4]),TypeError);
});
