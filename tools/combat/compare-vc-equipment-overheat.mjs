import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
if(!process.argv[2])throw Error('Usage: node tools/combat/compare-vc-equipment-overheat.mjs <attributes-worktree>');
const root=path.resolve(process.argv[2]).replaceAll('\\','/')+'/';
const sourceCommit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceSha256=Object.fromEntries(['config/vc-preset.json','packages/combat-core/vc-skills.mjs','packages/combat-core/index.mjs'].map(p=>[p,createHash('sha256').update(fs.readFileSync(root+p)).digest('hex')]));
const {vcFixture}=await import(pathToFileURL(root+'tests/helpers/vc-fixture.mjs'));
const {createSimulation,CORE_VERSION}=await import(pathToFileURL(root+'packages/combat-core/index.mjs'));
const {burnVeteranOverheat}=await import('../../packages/combat-core/vc-skills.mjs');
const preset=JSON.parse(fs.readFileSync(root+'config/vc-preset.json'));
const results=[];
for(const awake of [false,true]){
const fixture=vcFixture(),sim=createSimulation({...fixture.sim,profile:fixture.profile,preset:{...preset,loadout:[{skillId:24024},...Array(7).fill(null)]},seed:2016,actors:[{id:'vc',professionId:'VC',team:0,position:[0,3080,0],lineId:2,facing:1},{id:'target',professionId:'VC',team:1,position:[2500,3080,0],lineId:2,facing:-1,loadout:Array(8).fill(null),passives:[],guildPassives:[]}]});
const a=sim.actor('vc');a.mp=a.mpMax;if(awake){a.awakening.remaining=30;a.awakening.orbs=1;}
const initial={hp:a.hp,hpMax:a.hpMax,mpMax:a.mpMax,stats:structuredClone(a.stats)},penalties=[],states=[];
for(let i=0;i<600;i++){
 sim.step(1/60,{vc:{pressed:i===0||i<190&&i%2===0?['A']:[]}},{snapshot:false});
 for(const e of sim.drainEvents()){
  if(e.type==='stateChanged'&&e.actorId==='vc')states.push(e.state);
  if(e.type==='overheatHpChanged'){
   const copy=structuredClone(a);copy.hp=initial.hp;
   const currentLocalCost=burnVeteranOverheat({profileFor:x=>sim.profileFor(x),emit:()=>{},note:()=>{}},copy,e.name,{rate:e.rate,extra:e.extra,power:a.skillScale});
   penalties.push({...e,stats:structuredClone(a.stats),skillScale:a.skillScale,currentLocalFixAmount:currentLocalCost});
  }
 }
}
const currentAmount=penalties.reduce((n,e)=>n+e.amount,0),fixedAmount=penalties.reduce((n,e)=>n+e.currentLocalFixAmount,0);
results.push({awake,initial,penalties,states,finalHp:a.hp,currentAmount,currentPercent:currentAmount/a.hpMax*100,fixedAmount,fixedPercent:fixedAmount/a.hpMax*100});
}
fs.writeFileSync('reports/vc-overheat-equipment-v2-comparison.json',JSON.stringify({evidence:'current simulation with production preset read from specified attributes task; not original-client measurement',sourceCommit,sourceSha256,coreVersion:CORE_VERSION,presetVersion:preset.presetVersion,results},null,2)+'\n');
console.log(JSON.stringify(results.map(({penalties,states,...r})=>({...r,penaltyCount:penalties.length,states,parts:penalties.map(p=>({name:p.name,amount:p.amount,fixed:p.currentLocalFixAmount,magic:p.stats.magicAttack}))})),null,2));
