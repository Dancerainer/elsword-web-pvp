/** Records original/static source hashes only; never imports combat runtime. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const methods=read('.cache/vc/source-methods.json');
const fragments=[
  ['RSI_SA_RWT_HELLFIRE_GATLING_LOOP_FrameMove','One muzzle set at .001, extra bullets .09 or .06/.12 without extra sets'],
  ['RVC_SI_SA_DEADLY_RAID_FrameMove','Custom world position at left hand plus direction100 for both set and damage'],
  ['RVC_SI_SA_DEADLY_RAID_FINISH_FrameMove','Same fixed custom origin for final larger explosion'],
  ['RSI_SA_RWT_GIGA_PROMINENCE_FINISH_FrameMove','Both creates use owner rotation; negate first instance DirSpeed only'],
  ['RSI_SA_RWT_GIGA_PROMINENCE_OVER_FINISH_FrameMove','Same signed-DirSpeed rule for overheat wave'],
  ['SI_A_RRF_GROUND_IMPACT_FrameMove','SA_PROJECTILE_SIZE supplied as EffectSet instance scale'],
  ['_ShowOverheatIcon','Head+140 facing line dir+Y60; overlap additional direction50+Y20'],
  ['PossibleDeadlyRaidLoop','Three notices accepted at 3/5/7 presses, eligible loop <=1/2/3'],
  ['RSI_SA_RWT_REVOLVER_CANNON_LOOP_EventProcess','Overheat threshold notice accepted in loop after input'],
  ['RSI_SA_RWT_HELLFIRE_GATLING_LOOP_EventProcess','Overheat threshold notice accepted in loop after input'],
  ['RSI_SA_RWT_HARPOON_SPEAR_EventProcess','Four-press notice before overheat release'],
  ['RSI_SA_RWT_GIGA_PROMINENCE_OVER_FINISH_StateStart','Notice when entering accepted overheat finish'],
  ['RVC_SI_SA_IGNITION_CROW_EventProcess','Notice and branch latch before time2.01'],
  ['RVC_SI_SA_IGNITION_CROW_INCINERATION_EventProcess','Same accepted input latch for Incineration'],
  ['CreateOverHeatObject','GetCloneFrameDXMatrix left forearm + SetUseDXMatrix'],
  ['DeleteOverHeatObject','Close object retains forearm matrix'],
].map(([method,purpose])=>{if(!methods[method])throw new Error('Missing source '+method);return {method,purpose,sha256:sha(methods[method])};});
const effectBytes=readFileSync('.cache/native-source-runtime/X2Lib/X2EffectSet.cpp');
const lines=effectBytes.toString('latin1').split(/(?<=\n)/);
const source=read('.cache/vc/raven-declarations.json'),skills=read('.cache/vc/skill-declarations.json');
const output={schema:1,evidenceClass:'target2016 static + fixedV5 reference; not original client runtime',
  referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',referenceRavenIndex:'vc-reference-consumers-v1.json',
  methods:fragments,effectSetConsumer:{path:'X2Lib/X2EffectSet.cpp',sha256:sha(effectBytes),
    fragments:[{start:2769,end:2801,purpose:'Custom position precedes bones; declared offsets still applied'},
      {start:2974,end:3006,purpose:'Instance scale excludes DAMAGE_EFFECT unless explicitly forced'},
      {start:3536,end:3630,purpose:'Offset X follows horizontal unit direction, Y world-up, Z unit Z vector'}]
      .map(r=>({...r,sha256:sha(Buffer.from(lines.slice(r.start-1,r.end).join(''),'latin1'))}))},
  target:{raven:source.source,skill:skills.source,groundImpact:{skillId:24216,SA_PROJECTILE_SIZE:1.5},
    gigaTail:{effectSet:'EffectSet_Raven_Giga_Prominence_Flame',effect:'RWT_GIGA_PROMINENCE_FireTail',POSITION_OFFSET_Y:-200}},
  unsupported:['Full target client main-loop, original D3DX transitions and GPU compositing remain unmeasured'],
  regression:'tests/combat/vc-skill-presentation-v3.test.mjs'};
writeFileSync('contracts/vc-skill-presentation-source-v3.json',JSON.stringify(output,null,2)+'\n');
console.log('Recorded',fragments.length,'reference methods and 3 EffectSet fragments');
