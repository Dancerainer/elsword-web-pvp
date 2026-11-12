import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,steps,cast,profile} from '../helpers/rs-fixture.mjs';
import {runeSlayerCommands} from '../../packages/combat-core/rs-commands.mjs';
import {lordKnightCommands} from '../../packages/combat-core/lk-commands.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const inputs=(pressed=[],held=pressed)=>({pressed:new Set(pressed),held:new Set(held)});
function hits(f){const rows=[],original=f.sim.applyParticipantHit.bind(f.sim);f.sim.applyParticipantHit=(a,b,data,origin)=>{
  const out=original(a,b,data,origin);if(out.accepted)rows.push({actorId:a.id,targetId:b.id,data,state:b.state,vy:b.vy,flyCount:b.flyCount,origin});return out;};return rows;}
for(const facing of [-1,1])test(`Phoenix actual geometry launches without juggle accumulation, facing ${facing}`,()=>{
  const f=fixture({skillId:21015,facing}),rows=hits(f);cast(f);steps(f.sim,160);
  const launch=rows.filter(r=>r.actorId==='rs'&&r.data.REACT_TYPE===16);assert.ok(launch.length);
  assert.ok(launch.every(r=>r.state.startsWith('RSI_DAMAGE_AIR_FLY_')&&r.vy===700&&r.flyCount===0));
  assert.equal(profile.damageEffects.DamageEffect_SA_ERS_PhoenixTalon.raw.DAMAGE_DATA.FORCE_FLY,undefined,'original row unchanged');
});
test('Storm Blade later damage repeatedly launches using original drag-up speed',()=>{
  const f=fixture({skillId:21014}),rows=hits(f);cast(f);steps(f.sim,200);
  const later=rows.filter(r=>r.actorId==='rs'&&r.data.REACT_TYPE===16);assert.ok(later.length>2);
  assert.ok(later.every(r=>r.state.startsWith('RSI_DAMAGE_AIR_FLY_')&&r.vy===r.data.BACK_SPEED_Y));
});
test('RS 66X shares the exact LK held-key recovery boundary while Z continuation has priority',()=>{
  const raw=profile.states.RSI_DASH_COMBO_X.raw;
  for(const time of [.65,.6666666667,.67,.73]){
    const a={...fixture().a,state:'ESSI_DASH_ATTACK_X',animationTime:time,animationStopped:false};
    assert.equal(runeSlayerCommands.runEvent(a,inputs([],['X']),profile).state,lordKnightCommands.runEvent(a,inputs([],['X']),profile).state);
  }
  const a={...fixture().a,state:'RSI_DASH_COMBO_X',animationTime:.68};
  const buffered=runeSlayerCommands.runEvent(a,inputs(['Z']),profile);assert.equal(buffered.state,null);
  assert.equal(runeSlayerCommands.runEvent({...a,sourceCommandFlags:buffered.flags},inputs([],['Z']),profile).state,'ESSI_ERS_XZ_CHARGE');
  assert.equal(raw.EVENT_PROCESS_TIME1['3'],.666);
});
for(const full of [false,true])test(`66XZZ input completes original charge/release animation and rune (${full?'full':'tap'})`,()=>{
  const f=fixture();f.a.mp=100;f.sim.enter(f.a,'RSI_DASH_COMBO_X','test-dash');
  let released=false,secondPress=false;
  steps(f.sim,70,i=>{
    const inCharge=f.a.state==='ESSI_ERS_XZ_CHARGE';
    if(!full&&inCharge&&Math.fround(f.a.animationTime)>=Math.fround(.25))released=true;
    const second=inCharge&&!secondPress;if(second)secondPress=true;
    return {pressed:i===10||second?['Z']:[],held:i>=10&&!released?['Z']:[]};
  });
  steps(f.sim,130,full?{held:['Z']}:{});
  const expected=full?'ELSWORD_RUNE_SLAYER_COMBO_FULL_CHARGE_XZZ':'ELSWORD_RUNE_SLAYER_COMBO_XZZ';
  assert.ok(f.sim.state.events.some(e=>e.type==='effectStarted'&&e.name===expected));
  assert.ok(f.sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='ESSI_ERS_XZ_CHARGE'));
  if(!full)assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId==='rs'&&e.origin.kind==='effect'&&e.data.REACT_TYPE===5&&e.data.DAMAGE.MAGIC===2.82),'released rune itself launches through original geometry');
  assert.equal(f.a.state,'RSI_WAIT');
});
for(const facing of [-1,1])test(`668XZZ rune body and passive anchors travel down-forward and restore, facing ${facing}`,()=>{
  const f=fixture({facing});f.a.mp=100;f.a.y+=500;f.a.grounded=false;f.a.lineId=null;
  f.sim.enter(f.a,'ESSI_ERS_DASH_JUMP_XZ','test-air');steps(f.sim,60,i=>i===5?{pressed:['Z']}:{});
  const e=f.sim.state.effects.find(e=>e.name==='ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ'&&!e.dead);assert.ok(e);
  const birth=e.birthAnchor.position,now=e.currentAnchor.position;
  assert.ok((now[0]-birth[0])*facing>0);assert.ok(now[1]<birth[1]);
  assert.ok(Math.abs((now[1]-birth[1])/Math.abs(now[0]-birth[0])+Math.tan(Math.PI/6))<.001);
  const packet=encodeOwnedState(f.sim,'rs',{frameSeq:75,epoch:0});validateOwnedState(packet);
  const peer=fixture({facing});validateOwnedReferences(packet,peer.a,profile,peer.map);applyOwnedState(peer.sim,'rs',packet);
  const restored=peer.sim.state.effects.find(r=>r.networkId===e.id);
  // The shared wire contract omits local provenance text. Compare every
  // geometric field; the diagnostic string is deliberately not transmitted.
  assert.deepEqual(restored.currentAnchor,{rotation:e.currentAnchor.rotation,
    position:e.currentAnchor.position,facing:e.currentAnchor.facing});
  assert.equal(Object.hasOwn(restored.currentAnchor,'evidence'),false);
});
test('Wind Blade opening contact staggers without immediate knockdown',()=>{
  const f=fixture({skillId:21035}),rows=hits(f);cast(f);steps(f.sim,160);
  const first=rows.find(r=>r.actorId==='rs');assert.ok(first);assert.equal(first.data.REACT_TYPE,2);
  assert.ok(!first.state.includes('DOWN'));assert.equal(profile.damageEffects.DamageEffect_SA_EMK_WindBlade_Attack.raw.DAMAGE_DATA.REACT_TYPE,3);
});
test('Big Burst burns 2 MP on every accepted explosion hit, including repeated contacts',()=>{
  const f=fixture({skillId:21220}),rows=hits(f);cast(f);steps(f.sim,160);
  const effect=f.sim.state.events.find(e=>e.type==='effectStarted'&&e.name==='DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST');assert.ok(effect);
  const contacts=rows.filter(r=>r.origin.id===effect.effectId),burns=f.sim.state.events.filter(e=>e.type==='rsExtraManaDamage');
  assert.ok(contacts.length>3);assert.equal(burns.length,contacts.length);assert.ok(burns.every(e=>e.amount===2));
});
test('V62 first Luna blade contact burns once for this cast; explosion and synthetic callbacks cannot add another',()=>{
  const f=fixture({skillId:21017,facing:-1}),rows=hits(f);cast(f);
  for(let i=0;i<180&&!rows.length;i++)steps(f.sim,1);
  const first=f.sim.state.effects.find(e=>e.id===rows[0]?.origin.id);assert.equal(first?.name,'DamageEffect_SA_ERS_LunaBlade');
  steps(f.sim,1);let burns=f.sim.state.events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98);
  assert.equal(burns.length,1);
  const packet=encodeOwnedState(f.sim,'target',{frameSeq:1,epoch:0});validateOwnedState(packet);
  const peer=fixture({skillId:21017});applyOwnedState(peer.sim,'target',packet);
  assert.deepEqual(peer.b.sourceRuneSlayerHitReceipts,f.b.sourceRuneSlayerHitReceipts);
  steps(f.sim,200);
  burns=f.sim.state.events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98);
  assert.equal(burns.length,1);assert.ok(Math.abs(burns[0].delta+f.b.mpMax*.3)<.001);
  // Accepted callbacks without a real DD contact are not a second MP producer.
  for(const name of ['DamageEffect_SA_ERS_LunaBlade','DamageEffect_SA_ERS_LunaBlade_ExposionFinal']){
    const effect=f.sim.createEffect(f.a,{NAME:name});effect.skillId=21017;effect.ownerStateSerial=first.ownerStateSerial;
    for(const serial of [first.ownerStateSerial,first.ownerStateSerial+1,first.ownerStateSerial-1]){
      effect.ownerStateSerial=serial;
      f.sim.acceptedSkillHit(f.a,f.b,{ATTACK_TYPE:1},{kind:'effect',id:effect.id,skillId:21017});
    }
    effect.dead=true;
  }
  steps(f.sim,1);
  assert.equal(f.sim.state.events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98).length,1);
});
test('Luna and Big Burst resource losses execute on the defender owner through repeated remote reports',()=>{
  for(const skillId of [21017,21220]){
    const facing=skillId===21017?-1:1;
    const source=fixture({skillId,facing,networkOwnerId:'rs'}),peer=fixture({skillId,facing,networkOwnerId:'target'});cast(source);peer.b.mp=peer.b.mpMax;
    for(let frame=0;frame<180;frame++){
      steps(source.sim,1);const packet=encodeOwnedState(source.sim,'rs',{frameSeq:frame,epoch:0});
      // The simulation installs source common buffs (including Way of the
      // Sword57). Validate against that frozen runtime profile, as live rooms
      // do, rather than the pre-install profession JSON fixture.
      validateOwnedReferences(packet,peer.a,peer.sim.profileFor(peer.a),peer.map);applyOwnedState(peer.sim,'rs',packet);steps(peer.sim,1);
    }
    const events=peer.sim.state.events;
    if(skillId===21017)assert.equal(events.filter(e=>e.type==='buffMpChanged'&&e.templateId===98).length,1);
    else {const burns=events.filter(e=>e.type==='rsExtraManaDamage');assert.ok(burns.length>3);assert.ok(burns.every(e=>e.amount===2));}
    assert.ok(peer.b.mp<peer.b.mpMax);
  }
});
