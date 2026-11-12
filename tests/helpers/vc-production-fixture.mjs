/** Current selected equipment and passives, distinct from authored old fixtures. */
import {readFileSync} from 'node:fs';
import {vcFixture} from './vc-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
export const vcProductionPreset=JSON.parse(readFileSync(new URL('../../config/vc-preset.json',import.meta.url)));
export function vcProductionFixture({preset={},actor={},gap=2500}={}){
  const fixture=vcFixture();
  const sim=createSimulation({...fixture.sim,profile:fixture.profile,
    preset:{...vcProductionPreset,loadout:[{skillId:24024},...Array(7).fill(null)],...preset},seed:2016,
    actors:[{id:'vc',professionId:'VC',team:0,position:[0,3080,0],lineId:2,facing:1,...actor},
      {id:'target',professionId:'VC',team:1,position:[gap,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}]});
  const a=sim.actor('vc');a.mp=a.mpMax;
  return {...fixture,sim,a,b:sim.actor('target')};
}
export function runDeadlyRaid({awake=false,hpFraction=1,multiplier,preset={}}={}){
  const f=vcProductionFixture({preset:{...(multiplier==null?{}:{overheatHpCostMultiplier:multiplier}),...preset}}),{sim,a}=f;
  a.hp=Math.fround(a.hpMax*hpFraction);
  if(awake){a.awakening.remaining=30;a.awakening.orbs=1;}
  const initial={hp:a.hp,hpMax:a.hpMax,mpMax:a.mpMax,stats:structuredClone(a.stats)},events=[];
  for(let i=0;i<600;i++){
    sim.step(1/60,{vc:{pressed:i===0||i<190&&i%2===0?['A']:[]}},{snapshot:false});
    events.push(...sim.drainEvents());
  }
  const penalties=events.filter(e=>e.type==='overheatHpChanged'),cost=initial.hp-a.hp;
  return {initial,finalHp:a.hp,cost,percentOfMax:cost/a.hpMax*100,penalties,
    states:events.filter(e=>e.type==='stateChanged'&&e.actorId==='vc').map(e=>e.state),
    activationCount:events.filter(e=>e.type==='overheatActivated'&&e.actorId==='vc').length};
}
