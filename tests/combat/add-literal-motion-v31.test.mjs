import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {ADD_LITERAL_MESH_NAMES} from '../../packages/combat-core/add-literal-meshes.mjs';
import v31LiteralSource from '../../contracts/add-literal-meshes-v31.json' with {type:'json'};
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

for(const facing of [1,-1])test(`actual Add 668ZZZ detached projectile follows original -30-degree forward/down motion, facing ${facing}`,()=>{
 const {sim,a,b,profile}=originalAddFixture('LP');a.facing=facing;a.y+=300;a.grounded=false;a.lineId=null;b.x=2000;
 const e=sim.createEffect(a,{NAME:'DamageEffect_AN_Dash_Jump_Combo_Z_Bullet_Final',BONE_NAME:'Bip01',SCALE_X:1.5,SCALE_Y:1.5,SCALE_Z:1.5,REVERSE_Y:1});
 sim.step(1/60,{});assert.equal(e.sourceLiteralMotion,true);assert.ok(e.sourceShadowMesh);
 const start=[...e.sourceShadowMesh.position];sim.step(1/60,{});
 const position=e.sourceShadowMesh.position;
 // Independent authored constants: DirSpeed3000, RotateZ-30, one60Hz packet.
 assert.ok(Math.abs((position[0]-start[0])*facing-3000*Math.cos(Math.PI/6)/60)<.002);
 assert.ok(Math.abs(position[1]-start[1]+25)<.002);
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:2})));
 const report=validateOwnedState(raw);validateOwnedReferences(report,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 applyOwnedState(sim,a.id,report);assert.ok(sim.state.effects.find(x=>x.name===e.name).sourceShadowMesh);
});
test('moving Add declarations are explicitly scoped to the independently audited original mesh list',()=>{
 assert.equal(v31LiteralSource.rows.length,48,'frozen v31 declaration inventory remains intact');
 assert.equal(ADD_LITERAL_MESH_NAMES.size,53,'v32 adds two Fission DA meshes; v37 two Starfall meshes; v45 adds original DE aerial ZX projectile');
 assert.ok(v31LiteralSource.rows.every(row=>ADD_LITERAL_MESH_NAMES.has(row.name)));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('ADD_Dividing_Missile_MESH_01_DA'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('ADD_Dividing_Missile_MESH_02_DA'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('ADD_Star_Fall_Attack_Mesh_Start'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('ADD_Star_Fall_Attack_Mesh_Attack'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('Mesh_Quake_Buster_Projectile'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('Mesh_Conqueror_Projectile'));
 assert.ok(ADD_LITERAL_MESH_NAMES.has('Mesh_ALP_Psionic_Beat_Projectile'));
 assert.equal(ADD_LITERAL_MESH_NAMES.has('Mesh_AN_Jump_Combo_X'),false,'trace-bound hit volume must remain attached');
});

for(const duration of [0,1,3])test(`actual Add 668XX charge releases the authored projectile after ${duration}s`,()=>{
 const {sim,a,b}=originalAddFixture('LP');a.sourceAdd.dp=8000;a.y+=500;a.grounded=false;a.lineId=null;b.x=2000;
 sim.enter(a,'ANSI_DASH_JUMP_COMBO_XX_CHARGE','source-charge-fixture');assert.equal(a.manaBreak.noDetonation,true);
 for(let i=0;i<Math.ceil(duration*60);i++)sim.step(1/60,{add:{held:['X']}});
 if(a.state==='ANSI_DASH_JUMP_COMBO_XX_CHARGE')sim.step(1/60,{});
 for(let i=0;i<4&&!sim.state.effects.some(e=>e.name==='DamageEffect_AN_Dash_Jump_Combo_XX_Bullet');i++)sim.step(1/60,{});
 const e=sim.state.effects.find(e=>e.name==='DamageEffect_AN_Dash_Jump_Combo_XX_Bullet');assert.ok(e);
 assert.equal(a.manaBreak.noDetonation,false);
 const rate=duration>=3?2:1+.25*((duration*60+1)/60);
 assert.ok(Math.abs(e.powerMultiplier-rate)<1e-6);assert.ok(Math.abs(e.definition.SCALE_X-rate)<1e-6);
 assert.ok(e.sourceShadowMesh);assert.ok(e.sourceShadowMesh.velocity[0]>0&&e.sourceShadowMesh.velocity[1]<0);
 const events=sim.state.events.filter(e=>e.type==='addCommandDpSpent'&&e.chargeRate!==undefined);assert.equal(events.length,1);assert.equal(events[0].amount,2);
});
