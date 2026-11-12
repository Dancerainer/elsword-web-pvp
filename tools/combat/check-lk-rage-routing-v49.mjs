/** Actual posed keyboard contact and source particle routing; no client gold. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {lkCommandFixture} from '../../tests/helpers/lk-command-fixture.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createDestructionRageEffects} from '../../apps/web/destruction-rage-effects.mjs';
import {swordHudState} from '../../apps/web/way-of-sword-hud.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const index=read('artifacts/lk/fx/index.json'),catalog=read('artifacts/ui/skills/lk/catalog.json');
const icon=catalog.skills.find(s=>s.id===21206);
const result={schemaVersion:1,evidenceClass:'current-native-web-routing',targetClientMeasured:false,gpuMeasured:false,
 skillIcon:{skillId:21206,icon:icon.icon,originalImagePiece:icon.template.m_wstrIconTexturePieceName??icon.template.m_wstrImageTexturePieceName},
 templates:Object.fromEntries(['MonsterAngryWind','Counter_Particle01'].map(name=>{const t=index.templates[name];return[name,{
  declarationSha256:t.declarationSha256,source:t.source,textures:t.textures,textureEvents:t.events.filter(e=>e.property==='Texture')}];})),runs:[]};
for(const facing of [-1,1]){
 const f=await lkCommandFixture({facing,gap:85,preset:{passives:[],guildPassives:[]}}),{sim,actor,target}=f;
 sim.rng=()=>.99;
 const runtime=createEffectRuntime({index,quality:'high'}),controller=createDestructionRageEffects({runtime});
 const rows=[],peaks={MonsterAngryWind:0,Counter_Particle01:0},samples={};let rage=0,hits=0;
 const dispatch=()=>{for(const event of sim.drainEvents()){
  if(event.type==='destructionRageStarted'){rage++;controller.event(event,sim.state);rows.push({type:event.type,actorId:event.actorId,ownerStateSerial:event.ownerStateSerial,position:event.position,particles:event.particles});}
  if(event.type==='hit'){hits++;rows.push({type:event.type,actorId:event.actorId,targetId:event.targetId,name:sim.state.effects.find(e=>e.id===event.origin.id)?.name??null,origin:event.origin.kind});}
 }};
 sim.prepareWayOfSword(actor.id,-2);dispatch();
 const entryHud=swordHudState(actor);assert.equal(entryHud.label,'Destruction active');
 assert.equal(rage,0,'mode entry is distinct from reactive Rage and cannot create a counter image');
 for(let frame=1;frame<=180;frame++){
  sim.step(1/60,{target:frame===1?{pressed:['Z']}:{}},{snapshot:false});dispatch();
  controller.step(sim.state);runtime.step(1/60,sim.state);
  for(const name of Object.keys(peaks)){
   const particles=[...runtime.particles.values()].filter(p=>p.name===name);peaks[name]=Math.max(peaks[name],particles.length);
   const visible=particles.find(p=>(p.values.Color?.[3]??0)>.05);
   if(visible&&!samples[name])samples[name]={texture:visible.values.Texture,color:visible.values.Color,size:visible.values.Size,position:visible.position};
  }
 }
 assert.equal(rage,1);assert.ok(hits>=2,'actual target Z contact triggers Rage, then original angry-wind collision hits the attacker');
 assert.ok(Object.values(peaks).every(n=>n>0));assert.equal(runtime.count,0);
 assert.equal(samples.Counter_Particle01.texture,'ColorBallGray.dds');assert.equal(samples.MonsterAngryWind.texture,'Arme_Ring2.dds');
 const buffRows=buildBuffRows(actor,{profile:sim.profileFor(actor)});
 assert.ok(!buffRows.some(row=>row.name==='Counterattack'),'reactive Rage has no fabricated counter buff icon');
 result.runs.push({facing,events:rows,entryHud,peaks,samples,after:{particleCount:runtime.count,proof:controller.proof(),buffRows,
  skillIcon:icon.icon,destructionRageRemaining:actor.destructionRageRemaining}});
}
result.inputs={fxIndexSha256:createHash('sha256').update(readFileSync(new URL('../../artifacts/lk/fx/index.json',import.meta.url))).digest('hex'),
 sourceProfileSha256:createHash('sha256').update(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url))).digest('hex')};
writeFileSync(new URL('../../reports/lk-rage-routing-v49.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runs:result.runs.map(r=>({facing:r.facing,events:r.events.length,peaks:r.peaks,ended:r.after.particleCount===0})),targetClientMeasured:false,gpuMeasured:false}));
