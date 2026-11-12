/** Static original2016 expectations and qualified callback constants are
 * frozen independently of the production executor. No client trace claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make as nativeMake,profile,map,read,effectIndex} from '../fixtures/is-native-simulation.mjs';
import {createLiteralMesh,stepShadowMesh} from '../../packages/combat-core/shadow-mesh.mjs';
import {xCrashMeshTransform} from '../../packages/combat-core/xcrash-mesh-transform.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const evidence=read('contracts/is-swordfall-source-v3.json'),dt=1/120;
// These frozen four-projectile V5 expectations exercise unenhanced21019.
// The separately specified target21033 +2 adapter has its own regression.
const make=options=>nativeMake({...options,skillId:options?.skillId===21033?21019:options?.skillId,unenhancedSwordFall:true});
const near=(a,b,tolerance=.001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
const advance=(sim,n)=>{const events=[];for(let i=0;i<n;i++){sim.step(dt,{}, {snapshot:false});events.push(...sim.drainEvents());}return events;};
function receive(sim,report){validateOwnedState(report);validateOwnedReferences(report,sim.actor('is'),profile,map,
  {actors:sim.state.actors,profiles:{IS:profile}});applyOwnedState(sim,'is',report);}

test('Sword Fall source contract seals original2016 bytes and keeps frozen raw data intact',()=>{
  assert.equal(evidence.originalFilesVerified.length,19);
  assert.equal(evidence.clientMeasured,false);
  assert.deepEqual(profile.states.ESSI_SI_SA_ETK_SWORD_FALL.raw,evidence.state);
  for(const [name,data] of Object.entries(evidence.damageEffects))assert.deepEqual(profile.damageEffects[name].raw,data,name);
  for(const [name,data] of Object.entries(evidence.templates)){
    assert.deepEqual(effectIndex.templates[name].fields,data.fields,name);
    assert.deepEqual(effectIndex.templates[name].events,data.events,name);
  }
  // Seal this skill's original resources and raw projections. Capability
  // metadata for other skills may change without altering Sword Fall.
  const resources=read('artifacts/is/fx/index.json').sourceFiles;
  for(const source of evidence.originalFilesVerified.filter(row=>row.archive==='data/data118.kom'))
    assert.equal(resources.find(row=>row.name===source.name)?.sha256,source.sha256,source.name);
});

for(const facing of [-1,1]){
  test(`target2016 Sword Fall ${facing}: zero velocity then original forward/down fade and landing lifetime`,()=>{
    const template=evidence.templates.SwordFallBlade1;
    const mesh=createLiteralMesh({name:'SwordFallBlade1',fields:template.fields,events:template.events,
      position:[0,1000,0],velocity:[0,0,0],landY:0,facing});
    for(const [x,y] of [[0,1000],[0,1000],[87.5,931.25],[350,725],[700,450],[1050,175],[1400,-100]]){
      stepShadowMesh(mesh,.05,template.events);near(mesh.position[0],x*facing);near(mesh.position[1],y);
    }
    assert.equal(mesh.deathReason,null);stepShadowMesh(mesh,.05,template.events);
    assert.equal(mesh.deathReason,'template-land-crash');
  });
  test(`Sword Fall ${facing}: local rotation is shared by the real helper and the visible passive sword`,()=>{
    const sim=make({facing,skillId:21033,target:false});sim.step(dt,{is:{pressed:['A']}});
    let projectile;
    for(let i=0;i<180;i++){advance(sim,1);projectile=sim.state.effects.find(e=>e.name==='ELSWORD_SWORDFALL_BLADE1'&&e.elapsed>.15);if(projectile)break;}
    assert.ok(projectile);
    const template=profile.effectTemplates.SwordFallBlade1,shape=sim.effectSampler(projectile,sim.actor('is'))[0];
    assert.equal(shape.kind,'line');
    const dx=shape.start[0]-shape.end[0],dy=shape.start[1]-shape.end[1];
    assert.ok(dx*facing>0&&dy<0,'sword tip faces forward and down');
    near(Math.abs(dy/dx),Math.tan(35*Math.PI/180),.00001);
    const transformed=xCrashMeshTransform(template,projectile,projectile.currentAnchor);
    assert.deepEqual(transformed.localRotation,[-35,-90,-90]);
    assert.deepEqual(transformed.rotation,[-35,facing<0?90:-90,-90]);
    assert.deepEqual(transformed.scale,[1.75,1.75,1.75]);
    assert.equal(evidence.templates.elsword_A_swordFall_08.fields.Mesh,'elsword_active_swordFall_sword_plan.Y');
  });
  test(`Sword Fall ${facing}: live moving preparation emits four original timed projectiles`,()=>{
    const sim=make({facing,skillId:21033,target:false});sim.step(dt,{is:{pressed:['A']}});
    const preparations=new Map(),releases=[];
    for(let i=0;i<230;i++){
      const before=sim.state.effects.find(e=>e.name==='elsword_A_swordFall_M02');
      if(before&&before.elapsed>.7)assert.ok(Math.abs(before.currentAnchor.position[0]-before.birthAnchor.position[0])>20);
      const events=advance(sim,1);
      for(const event of events.filter(e=>e.type==='effectStarted')){
        if(/^elsword_A_swordFall_M0[2-5]$/.test(event.name))preparations.set(event.name,event.effectId);
        if(/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(event.name)){
          const index=Number(event.name.at(-1))-1;
          near(sim.actor('is').animationTime,evidence.callbackReference.releaseAnimationSeconds[index],dt*1.25+.00001);
          const projectile=sim.state.effects.find(e=>e.id===event.effectId);
          assert.deepEqual(projectile.damage,evidence.damageEffects[event.name]);releases.push(event);
        }
      }
    }
    assert.equal(preparations.size,4);assert.equal(releases.length,4);
    assert.equal(new Set(releases.map(e=>e.time)).size,4);
    assert.ok(!sim.state.effects.some(e=>preparations.has(e.name)||e.name==='SecondBlade'));
  });
  test(`Sword Fall ${facing}: real collisions hit the forward target and leave a far target untouched`,()=>{
    const close=make({facing,skillId:21033,distance:165}),far=make({facing,skillId:21033,distance:5000});
    close.step(dt,{is:{pressed:['A']}});far.step(dt,{is:{pressed:['A']}});
    const hits=advance(close,420).filter(e=>e.type==='hit'&&e.actorId==='is');
    assert.ok(hits.length>0);for(const hit of hits){assert.equal(hit.data.REACT_TYPE,5);assert.equal(hit.data.BACK_SPEED_Y,550);}
    assert.equal(advance(far,420).filter(e=>e.type==='hit'&&e.actorId==='is').length,0);
  });
}

test('Sword Fall actual preparation and live projectile ownership survive packet reconstruction',()=>{
  const owner=make({skillId:21033,target:false}),receiver=make({skillId:21033,target:false});
  owner.step(dt,{is:{pressed:['A']}});advance(owner,65);
  receive(receiver,encodeOwnedState(owner,'is',{epoch:1,frameSeq:65}));
  const forged=encodeOwnedState(owner,'is',{epoch:1,frameSeq:66});
  forged.effects.find(e=>e.name==='elsword_A_swordFall_M02').sourceShadowMesh.name='SwordFallBlade1';
  assert.throws(()=>receive(receiver,forged),/invalid-owner-mesh-template/);
  for(const name of ['elsword_A_swordFall_M02','elsword_A_swordFall_M03','elsword_A_swordFall_M04','elsword_A_swordFall_M05']){
    const a=owner.state.effects.find(e=>e.name===name),b=receiver.state.effects.find(e=>e.name===name);
    const {evidenceClass,...physical}=a.sourceShadowMesh;
    assert.deepEqual(b.sourceShadowMesh,JSON.parse(JSON.stringify(physical)));
  }
  advance(owner,45);receive(receiver,encodeOwnedState(owner,'is',{epoch:1,frameSeq:110}));
  for(const a of owner.state.effects.filter(e=>/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name))){
    const b=receiver.state.effects.find(e=>e.name===a.name);assert.deepEqual(b.damage,evidence.damageEffects[a.name]);
    const {evidenceClass,...physical}=a.sourceShadowMesh;
    assert.deepEqual(b.sourceShadowMesh,JSON.parse(JSON.stringify(physical)));assert.deepEqual(b.sourceArcPose,a.sourceArcPose);
  }
});

test('Sword Fall JSON continuation is deterministic through release, collision and original visual children',()=>{
  const owner=make({skillId:21033}),restored=make({skillId:21033});owner.step(dt,{is:{pressed:['A']}});advance(owner,65);
  restored.restore(JSON.parse(JSON.stringify(owner.snapshot())));owner.drainEvents();restored.drainEvents();
  for(let i=0;i<280;i++){owner.step(dt,{}, {snapshot:false});restored.step(dt,{}, {snapshot:false});
    assert.deepEqual(restored.drainEvents(),owner.drainEvents());}
  assert.deepEqual(restored.snapshot(),owner.snapshot());
});

test('interrupting Sword Fall destroys all unlaunched swords and cannot emit a delayed wave',()=>{
  const sim=make({skillId:21033,target:false});sim.step(dt,{is:{pressed:['A']}});advance(sim,65);
  assert.equal(sim.state.effects.filter(e=>/^elsword_A_swordFall_M0[2-5]$/.test(e.name)).length,4);
  sim.enter(sim.actor('is'),'RSI_WAIT','interrupt-fixture');
  const events=advance(sim,240);
  assert.ok(!sim.state.effects.some(e=>/^elsword_A_swordFall_M0[2-5]$/.test(e.name)||e.name==='SecondBlade'));
  assert.ok(!events.some(e=>e.type==='effectStarted'&&/^ELSWORD_SWORDFALL_BLADE[1-4]$/.test(e.name)));
});
