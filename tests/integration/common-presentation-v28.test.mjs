import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,MeshBuilder,PBRMaterial,TransformNode,Vector3} from '@babylonjs/core';
import {createImpactCamera} from '../../apps/web/impact-camera.mjs';
import {createHitFramebuffer} from '../../apps/web/hit-framebuffer.mjs';
import {groundShadowValues} from '../../apps/web/ground-shadow.mjs';
import {instantiateNativeCamera} from '../../packages/native-source/camera.mjs';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {updateWeaponPresentation,nativeOutlineWidth,sourceActorCameraDistance} from '../../apps/web/weapon-presentation.mjs';
import {nativeCharacterEdge} from '../../apps/web/native-character-edge.mjs';
import {characterToonMaterial,configureCharacterRim} from '../../apps/web/character-toon-material.mjs';
import {installNativeEffectMaterial} from '../../apps/web/native-effect-material.mjs';
import source from '../../contracts/common-presentation-source-v28.json' with {type:'json'};
const contact=(actorId,targetId,data,kind='character')=>({type:'hit',actorId,targetId,data,origin:{kind}});
test('shake is source focus-scoped; effect owner does not receive direct AttackResult camera feedback',()=>{
 const camera=createImpactCamera({focusFor:()=> 'a'}),data={CAMERA_CRASH_GAP:10,CAMERA_CRASH_TIME:.2};
 camera.event(contact('b','c',data));camera.event(contact('a','b',data,'effect'));assert.equal(camera.proof().accepted,0);
 camera.event(contact('b','a',data,'effect'));assert.equal(camera.proof().accepted,1);
 assert.deepEqual(camera.advance(.049),[0,0,0]);assert.deepEqual(camera.advance(.002),[0,-10,0]);
 assert.deepEqual(camera.advance(.05),[0,10,0]);camera.clear();assert.equal(camera.proof().accepted,0);
});
test('NoReset preserves alternating phase and interval; unsupported original cases remain absent',()=>{
 const camera=createImpactCamera({focusFor:()=> 'a'});camera.event(contact('a','b',{CAMERA_CRASH_GAP:10,CAMERA_CRASH_TIME:.2}));camera.advance(.051);
 camera.event(contact('a','b',{CAMERA_SHAKE_TYPE:4,CAMERA_CRASH_GAP:5,CAMERA_CRASH_TIME:.3}));assert.deepEqual(camera.advance(.05),[0,5,0]);
 const before=camera.proof().accepted;for(const type of [0,1,2,5,6,9,123])camera.event(contact('a','b',{CAMERA_SHAKE_TYPE:type,CAMERA_CRASH_GAP:50,CAMERA_CRASH_TIME:1}));
 assert.equal(camera.proof().accepted,before);
});
test('horizontal source GetRightVec retains camera pitch magnitude and first positive-right increment',()=>{
 const camera=createImpactCamera({focusFor:()=> 'a'});camera.event(contact('a','b',{CAMERA_SHAKE_TYPE:7,CAMERA_CRASH_GAP:10,CAMERA_CRASH_TIME:.2}));
 assert.deepEqual(camera.advance(.051,{right:[.8,0,.2]}),[8,0,2]);assert.deepEqual(camera.advance(.05,{right:[.8,0,.2]}),[-8,0,-2]);
});
test('compiled translation shifts eye/target equally and retains source tracking timers, then converges',async()=>{
 const camera=await instantiateNativeCamera(readFileSync('artifacts/native/camera.wasm'));
 camera.init({eye:[0,100,-100],target:[0,0,0]});camera.setTracking({eye:[0,100,-100],target:[0,0,0],eyeSeconds:.3,targetSeconds:.3});
 const before=camera.snapshot(),shift=camera.translate([0,-10,0]);assert.equal(shift.eye[1],90);assert.equal(shift.target[1],-10);
 assert.equal(shift.eyeSeconds,before.eyeSeconds);assert.equal(shift.targetSeconds,before.targetSeconds);
 camera.setTracking({eye:[0,100,-100],target:[0,0,0],eyeSeconds:.3,targetSeconds:.3});const after=camera.advance(.1);
 assert.ok(Math.abs(after.eye[1]-93.3333333)<.00002);assert.ok(Math.abs(after.target[1]+6.6666667)<.00002);
});
test('source clear counts render frames, uses strictly >.2 seconds, exact RGBA, no fabricated accumulated blur',()=>{
 const screen=createHitFramebuffer({focusFor:()=> 'a',enabled:true});screen.event(contact('a','b',{CLEAR_SCREEN:1}));assert.equal(screen.beginFrame(.2),null);
 screen.event(contact('a','b',{CLEAR_SCREEN:1,CLEAR_SCREEN_COLOR_R:.3,CLEAR_SCREEN_COLOR_A:0}));assert.deepEqual(screen.beginFrame(.001),[.3,1,1,0]);
 assert.equal(screen.beginFrame(1),null);assert.equal(screen.proof().clears,1);assert.equal(screen.proof().motionBlurAccumulation,false);
 screen.setEnabled(false);screen.event(contact('a','b',{CLEAR_SCREEN:3}));assert.equal(screen.beginFrame(1),null);
});
test('source clear CEffect callback is defender-only and zero request cancels pending count',()=>{
 const screen=createHitFramebuffer({focusFor:()=> 'a',enabled:true});screen.event(contact('a','b',{CLEAR_SCREEN:1},'effect'));assert.equal(screen.beginFrame(1),null);
 screen.event(contact('b','a',{CLEAR_SCREEN:2},'effect'));screen.event(contact('b','a',{},'effect'));assert.equal(screen.beginFrame(1),null);
});
test('shadow distance uses full position/land vector, original height shrink and fade without guessed ground',()=>{
 const actor={x:10,y:100,z:20,landPosition:[10,0,20]},values=groundShadowValues(actor);
 assert.deepEqual(values.land,[10,0,20]);assert.equal(values.distance,100);assert.ok(Math.abs(values.sizeFactor-2/3)<1e-15);assert.ok(Math.abs(values.alpha-.3)<1e-15);
 assert.equal(groundShadowValues({...actor,y:200}).alpha,0);assert.equal(groundShadowValues({...actor,landPosition:null}),null);
 assert.equal(groundShadowValues({...actor,y:0}).sizeFactor,1);
});
test('original shadow and fire palette hashes / independent BMP pixels match frozen source',()=>{
 const raw='asset_work/raw/',hash=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(hash(readFileSync(raw+source.shadow.originalPath)),source.shadow.sha256);
 assert.equal(hash(readFileSync('artifacts/'+source.shadow.pngPath)),source.shadow.pngSha256);
 const ramp=source.ramps.fire,b=readFileSync(raw+ramp.archive+'/'+ramp.name),offset=b.readUInt32LE(10),pixels=[];
 for(let i=0;i<b.readInt32LE(18);i++)pixels.push(b[offset+i*3+2],b[offset+i*3+1],b[offset+i*3],255);
 assert.equal(hash(b),ramp.sha256);assert.deepEqual(pixels,ramp.rgba);
});
test('weapon mount gates fire to weapon, inherited white/hit yields to awakening, REAL_COLOR accessory stays independent, teardown frees edges',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene),mount=new TransformNode('RF_SwordMount',scene);mount.parent=root;
 const weapon=MeshBuilder.CreateBox('weapon',{},scene),body=MeshBuilder.CreateBox('body',{},scene);weapon.parent=mount;body.parent=root;
 for(const mesh of [weapon,body])mesh.material=new PBRMaterial(mesh.name,scene);
 const view={id:'a',root,meshes:[weapon,body],nodesBySourceName:new Map([['RF_SwordMount',mount]])};styleCharacter(view);
 const p=characterToonMaterial(weapon.material);p.damage=true;p.invincible=true;
  p.direction=[1,0,0];
  updateWeaponPresentation(view,{awakening:{remaining:10}},'RF',{cameraDistance:1000});assert.equal(p.proof().mode,'fire');
  assert.deepEqual(p.proof().direction,[1,0,0],'awakening changes render type/palette while retaining inherited impact light');
 assert.equal(characterToonMaterial(body.material).proof().mode,'normal');assert.deepEqual(weapon.outlineColor.asArray(),[1,85/255,17/255]);
 assert.equal(nativeCharacterEdge(weapon).edge.isEnabled(),true);assert.equal(weapon.outlineWidth,1);
 updateWeaponPresentation(view,{awakening:{remaining:0}},'rf');assert.equal(p.proof().mode,'invincible');assert.deepEqual(weapon.outlineColor.asArray(),[0,0,0]);
 installNativeEffectMaterial(weapon.material);updateWeaponPresentation(view,{awakening:{remaining:10}},'rf');assert.equal(characterToonMaterial(weapon.material),null);
 assert.equal(configureCharacterRim(body.material,null),true);assert.throws(()=>configureCharacterRim(body.material,{operation:'add'}),/Unverified/);
 const edge=nativeCharacterEdge(weapon).edge;weapon.dispose();assert.equal(edge.isDisposed(),true);scene.dispose();engine.dispose();
});
test('source width threshold is exact, rather than an arbitrary constant pixel width',()=>{
 assert.equal(nativeOutlineWidth(700),1.4);assert.equal(nativeOutlineWidth(701),.701);assert.equal(nativeOutlineWidth(1000),1);
});
test('outline distance uses original KSM center transformed by actor root, not feet or animated pose bounds',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('unit',scene);root.scaling.setAll(.01);root.position.set(20,3,-4);
 const view={root},header=source.unitCenters.rf,raw=readFileSync('asset_work/'+header.source);
 assert.deepEqual(header.center,[raw.readFloatLE(12),raw.readFloatLE(16),raw.readFloatLE(20)]);
 const nativeCenter=[20+7.840678691864014*.01,3+98.48628234863281*.01,-4+11.275622367858887*.01];
 const camera=new Vector3(...nativeCenter);camera.z-=10;
 assert.ok(Math.abs(sourceActorCameraDistance(view,'RF',camera)-1000)<.001);
 assert.equal(sourceActorCameraDistance(view,'unknown',camera),null);scene.dispose();engine.dispose();
});
