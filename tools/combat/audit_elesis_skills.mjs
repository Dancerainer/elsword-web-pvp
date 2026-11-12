/** Simulation observations only, never original-client regression answers. */
import {writeFileSync} from 'node:fs';
import {elesisFixture} from '../../tests/helpers/elesis-skill-fixture.mjs';
const rows=[];
for(const profession of process.argv.slice(2).length?process.argv.slice(2):['GM','BH','CA']){
 const {profile,make}=elesisFixture(profession);
 for(const sk of profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.skillId!==900)){
  const sim=make(sk.skillId),a=sim.actor('elesis'),b=sim.actor('target');const events=[];let buffs=0;const seenBuffs=new Set();
  const beforeMp=a.mp,beforeHp=a.hp;
  sim.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});events.push(...sim.drainEvents());
  const castCost={mp:beforeMp-a.mp,hp:beforeHp-a.hp,cooldown:a.cooldowns[sk.skillId]};
  for(let i=0;i<900;i++){
   const input=sk.skillId===28217&&i===5?{pressed:['Z']}:sk.skillId===28214&&i===20?{pressed:['X']}:{held:[]};
   sim.step(1/60,{elesis:input},{snapshot:false});events.push(...sim.drainEvents());buffs=Math.max(buffs,a.buffs.length);for(const buff of a.buffs)seenBuffs.add(buff.templateId);
  }
  const r={profession,id:sk.skillId,started:events.filter(e=>e.type==='skillStarted').length,hits:events.filter(e=>e.type==='hit'&&e.actorId==='elesis').length,
   hpDelta:b.hpMax-b.hp,castCost,mp:a.mp,cd:a.cooldowns[sk.skillId],buffs,buffTemplates:[...seenBuffs].sort((x,y)=>x-y),state:a.state,skillId:a.skillId,fx:sim.state.effects.length,
   damageCarriersAfter15Seconds:sim.state.effects.filter(e=>e.ownerId===a.id&&e.damage).length,
   unsupported:[...sim.state.unsupported,...a.unsupported].map(x=>({id:x.id,reason:x.reason}))};rows.push(r);console.log(JSON.stringify(r));
 }
}
writeFileSync('.cache/elesis-skill-audit.json',JSON.stringify({evidence:'current-simulation-only',rows},null,2));
