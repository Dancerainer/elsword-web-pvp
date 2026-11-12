/** Simulation regression. Expected values below are independent target2016
 * declarations/reference branches, never exported simulator answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {activateVeteranOverheat,burnVeteranOverheat,canVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const close=(a,b,t=.03)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function run(f,seconds,input=()=>({})){const events=[];for(let i=0;i<seconds*60;i++){f.sim.step(1/60,{vc:input(i)});events.push(...f.sim.drainEvents());}return events;}

test('VC uses six original passives without RF-only proc/awakening/defence additions',()=>{
  const {a}=vcFixture();assert.deepEqual(a.passives.sort(),[24400,24411,24412,24413,24414,24415]);
  assert.equal(a.stats.physicalAttack,2000);assert.equal(a.stats.magicAttack,2000);
  assert.equal(a.passivePolicy.explosive.enabled,false);assert.equal(a.passivePolicy.awakening.canReawaken,false);
  close(a.passivePolicy.veteran.hpLimit,.02,.000001);close(a.passivePolicy.veteran.hpCostMultiplier,.6,.000001);
});
test('target buff217 adds7.3% per stack, caps at2, refreshes16s and restores base stats',()=>{
  const f=vcFixture();activateVeteranOverheat(f.sim,f.a);close(f.a.stats.physicalAttack,2146);
  activateVeteranOverheat(f.sim,f.a);activateVeteranOverheat(f.sim,f.a);
  const buff=f.a.buffs.find(b=>b.templateId===250);assert.equal(buff.accumulationCount,2);close(f.a.stats.magicAttack,2292);
  assert.equal(buff.finalizers[0].remaining,16);assert.equal(f.a.sourceVeteranCommander.heatEffects.length,3);
  run(f,17);assert.equal(f.a.buffs.length,0);assert.equal(f.a.stats.magicAttack,2000);assert.deepEqual(f.a.sourceVeteranCommander.heatEffects,[]);
});
test('base overheat buff84 remains5%/10s without VC buff-enhancing passive',()=>{
  const f=vcFixture({passives:[]});activateVeteranOverheat(f.sim,f.a);activateVeteranOverheat(f.sim,f.a);
  assert.equal(f.a.buffs[0].templateId,103);close(f.a.stats.magicAttack,1050);assert.equal(f.a.buffs[0].finalizers[0].remaining,10);
});
test('self penalty follows named target damage, PvP rate,20% penalty and40% passive reduction, bypassing equipment',()=>{
  const f=vcFixture(),hp=f.a.hp,mp=f.a.mp;
  const amount=burnVeteranOverheat(f.sim,f.a,'RAVEN_REVOLVER_CANNON_SHELL_OVERHEAT',{power:1});
  close(amount,2000*6.2272*.6*.2*.6);close(hp-f.a.hp,amount,.07);assert.equal(f.a.mp,mp);
  assert.ok(!f.sim.state.events.some(e=>e.type==='hit'),'self cost creates no offensive hit reward');
  f.a.hp=f.a.hpMax*.2099;assert.equal(burnVeteranOverheat(f.sim,f.a,'RWT_COMBO_XXX_LOOP_OVERHEAT'),0);
  f.a.hp=f.a.hpMax*.02;assert.equal(canVeteranOverheat(f.a),false,'original328b9600 requires strictly greater than the float32 limit');
  f.a.hp-=1;assert.equal(canVeteranOverheat(f.a),false);
  const fragile=vcFixture({passives:[24414]});fragile.a.hp=2;
  burnVeteranOverheat(fragile.sim,fragile.a,'RWT_COMBO_XXX_LOOP_OVERHEAT');assert.equal(fragile.a.hp,1);
});
test('command overheat halves only its self penalty;20% remains the skill cost',()=>{
  const a=vcFixture(),b=vcFixture();
  close(burnVeteranOverheat(a.sim,a.a,'RWT_COMBO_XXX_LOOP_OVERHEAT',{extra:.5,power:1}),2000*1.46*.2*.5*.6);
  close(burnVeteranOverheat(b.sim,b.a,'RWT_COMBO_XXX_LOOP_OVERHEAT',{power:1}),2000*1.46*.2*.6);
});

test('repeated skill input is consumed by overheat without a second cast or rejection toast',()=>{
  const f=vcFixture();
  const events=run(f,.4,i=>({pressed:i%2===0?['A']:[]}));
  assert.equal(events.filter(e=>e.type==='skillStarted').length,1);
  assert.equal(events.filter(e=>e.type==='skillRejected').length,0);
  assert.ok(f.a.sourceVeteranCommander.presses>=5);
});

for(const id of [24031,24034,24020,24021,24022,24023,24024]){
  test(`VC skill${id}: one cast transitions into normal/overheat forms and returns control`,()=>{
    const variants=[];
    for(const heat of [false,true]){
      const f=vcFixture({skillId:id,gap:180});if(id===24031){f.a.y+=450;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','air-skill-fixture');}
      const events=run(f,13,i=>({pressed:i===0||heat&&i<190&&i%2===0?['A']:[]}));
      assert.equal(events.filter(e=>e.type==='skillStarted').length,1,'single cast');
      assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.skillDisableGravity===true,false);
      const penalties=events.filter(e=>e.type==='overheatHpChanged');assert.equal(penalties.length>0,heat);
      assert.equal(events.some(e=>e.type==='overheatActivated'),heat);
      const effects=events.filter(e=>e.type==='effectStarted').map(e=>e.name);
      variants.push({events,penalties,effects});
      if(heat)assert.ok(f.a.hp<f.a.hpMax);
    }
    assert.notDeepEqual(variants[0].effects,variants[1].effects,'original alternate templates/shots');
    if(id===24034){assert.equal(variants[1].penalties.length,2);assert.equal(variants[0].events.filter(e=>e.type==='hit').length,3);assert.equal(variants[1].events.filter(e=>e.type==='hit').length,5);}
    if(id===24020){
      // target2016 Loop_OverHit is one eight-FX explosion chain per loop.
      // 17/27 loop counts and the input gate remain a qualified V5 adapter;
      // the obsolete V5 three-bullet schedule is not the target damage path.
      // Independent raw declarations: contracts/vc-gatling-source-v4.json.
      assert.equal(variants[1].penalties.length,10,'ten adapter heat loops, one target explosion penalty each');
      assert.ok(variants[1].penalties.every(e=>e.name==='DamageEffect_SA_RWT_HellFire_Explosion_OverHit'));
      assert.ok(variants[1].effects.includes('DamageEffect_SA_RWT_HellFire_Explosion_OverHit'));
      assert.ok(!variants.some(v=>v.effects.some(name=>name.startsWith('RAVEN_HELLFIRE_GATLING_BULLET'))));
    }
    if(id===24024)assert.equal(variants[1].penalties.length,3,'loop,ready,finish penalty identities');
  });
}
for(const skill of vcProfile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900)){
  test(`VC active${skill.skillId} executes from original pose helpers and original Garpai collision`,()=>{
    const f=vcFixture({skillId:skill.skillId,gap:160});if(skill.skillId===24031){f.a.y+=450;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','air-skill-fixture');}
    const events=run(f,13,i=>({pressed:i===0?['A']:[]}));
    assert.ok(events.some(e=>e.type==='skillStarted'));assert.equal(f.a.state,'RSI_WAIT');assert.ok(Number.isFinite(f.a.x)&&Number.isFinite(f.a.hp));
    assert.ok(!events.some(e=>e.type==='unsupported'&&/buff-factor|vc-bone|vc-overheat-damage/.test(e.id)),JSON.stringify(events.filter(e=>e.type==='unsupported')));
    if(![24217,24031].includes(skill.skillId))assert.ok(events.some(e=>e.type==='hit'),'authored helper hit');
  });
}
test('Mental Crash applies original3s receive/attack MP suppression and expires cleanly',()=>{
  const f=vcFixture({skillId:24214,gap:160});run(f,.5,i=>({pressed:i===0?['A']:[]}));
  assert.ok(f.b.buffs.some(b=>b.templateId===545));close(f.b.stats.receivedMpMultiplier,.0001,.000001);
  f.b.mp=0;f.b.hitStop=0;f.b.worldStop=0;f.sim.state.step++;
  f.sim.injectHit({attackerId:'vc',targetId:'target',damageData:{DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},REACT_TYPE:1,HIT_TYPE:0,HIT_ADD_MP:0}});
  assert.ok(f.b.mp<.001);run(f,4);assert.equal(f.b.stats.receivedMpMultiplier,undefined);
});
test('mercenary duration reduction targets original listed debuffs, preserving beneficial overheat time',()=>{
  const f=vcFixture();const factor=Object.entries(vcProfile.buffFactors).find(([id,r])=>r.raw.BUFF_TEMPLET_ID===87);
  assert.ok(factor);const buff=f.sim.grantBuff(f.a,f.a,Number(factor[0]),1);assert.ok(buff);close(buff.durationMultiplier,.2,.000001);
  activateVeteranOverheat(f.sim,f.a);assert.equal(f.a.buffs.find(b=>b.templateId===250).finalizers[0].remaining,16);
});
test('low HP attack/defence buffs remove only after crossing above50%',()=>{
  const f=vcFixture();run(f,1/60);f.a.hp=f.a.hpMax*.49;run(f,1/60);
  assert.ok(f.a.buffs.some(b=>b.templateId===2));assert.ok(f.a.buffs.some(b=>b.templateId===104));close(f.a.stats.physicalAttack,2600);
  f.a.hp=f.a.hpMax*.5;run(f,1/60);assert.ok(f.a.buffs.some(b=>b.templateId===2));
  f.a.hp++;run(f,1/60);assert.equal(f.a.buffs.some(b=>[2,104].includes(b.templateId)),false);assert.equal(f.a.stats.physicalAttack,2000);
});
for(const facing of [-1,1])test(`VC actual X input with facing${facing} reaches repeat overheat and finishes`,()=>{
  const f=vcFixture({facing,gap:600}),input=createInputBuffer(),events=[];
  for(let i=0;i<420;i++){
    if(i<175&&i%9===0)input.tap('X',f.sim.state.time+.001);
    f.sim.step(1/60,{vc:input.consume(f.sim.state.time+1/60)});events.push(...f.sim.drainEvents());
  }
  assert.ok(events.some(e=>e.type==='overheatHpChanged'));assert.ok(events.some(e=>e.type==='stateChanged'&&e.state==='RSI_WEAPON_TAKER_COMBO_XXX_LOOP'));
  assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.facing,facing);
});
test('held dash flamethrower stops its continuous effect when interrupted',()=>{
  const f=vcFixture();f.sim.enter(f.a,'RVC_DASH_COMBO_ZZZPushZ','fixture-state-consumer');run(f,.8,()=>({held:['Z']}));
  const id=f.a.sourceVeteranCommander.flameEffect;assert.ok(id);assert.ok(f.a.hp<f.a.hpMax);
  f.sim.enter(f.a,'RSI_DAMAGE_BIG','fixture-interrupt');assert.equal(f.a.sourceVeteranCommander.flameEffect,undefined);
  assert.equal(f.sim.state.effects.find(e=>e.id===id)?.dead,true);
});

for(const mode of ['flame','air'])test(`VC ${mode} command overheat is reachable through dash/jump input and releases control`,()=>{
  const f=vcFixture({gap:1500}),states=new Set(),events=[];
  for(let i=0;i<600;i++){
    let held=[],pressed=[];
    if(i===0){held=['RIGHT'];pressed=['DASH','RIGHT'];}
    else if(i===1&&mode==='air'){held=['RIGHT'];pressed=['UP'];}
    else if(i<180){held=mode==='flame'?['Z']:[];if(i>2&&i%7===3)pressed=[mode==='flame'?'Z':'X'];}
    f.sim.step(1/60,{vc:{held,pressed}},{snapshot:false});states.add(f.a.state);events.push(...f.sim.drainEvents());
  }
  assert.ok(states.has(mode==='flame'?'RVC_DASH_COMBO_ZZZPushZ':'RVC_DASH_JUMP_COMBO_XX_LOOP'));
  const penalty=mode==='flame'?'DAMAGE_EFFECT_RVC_FRAME_THROW_OVERHEAT_PENALTY':'DAMAGE_EFFECT_DASH_JUMP_Xloop_BULLET_HIT';
  assert.ok(events.some(e=>e.type==='overheatHpChanged'&&e.name===penalty));
  assert.ok(f.a.hp<f.a.hpMax);assert.equal(f.a.state,'RSI_WAIT');assert.ok(!f.a.skillDisableGravity);
});
test('VC owner packet restores active heat buffs and rejects corrupt counters or foreign class state',()=>{
  const f=vcFixture(),g=vcFixture();activateVeteranOverheat(f.sim,f.a);run(f,.1);
  const report=encodeOwnedState(f.sim,'vc',{frameSeq:6});validateOwnedState(report);validateOwnedReferences(report,f.a,vcProfile,f.map);
  applyOwnedState(g.sim,'vc',report);close(g.a.stats.magicAttack,f.a.stats.magicAttack);assert.equal(g.a.buffs[0].templateId,250);
  const bad=structuredClone(report);bad.actor.sourceVeteranCommander.loop=NaN;assert.throws(()=>validateOwnedState(bad));
  assert.throws(()=>validateOwnedReferences(report,f.a,{...vcProfile,target:{...vcProfile.target,unitClass:107}},f.map));
});
test('identical VC rules, input and seed produce identical complete snapshots',()=>{
  const a=vcFixture({skillId:24021,seed:71}),b=vcFixture({skillId:24021,seed:71});
  for(const f of[a,b])run(f,8,i=>({pressed:i<190&&i%2===0?['A']:[]}));assert.deepEqual(a.sim.snapshot(),b.sim.snapshot());
});
