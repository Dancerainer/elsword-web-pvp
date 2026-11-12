/** Current-simulation evidence, deliberately separate from source contracts.
 * Enumerate actual skill branches and skipped descendants, never bless a trace
 * as the original answer simply because it reaches WAIT. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcFixture,vcProfile} from '../../tests/helpers/vc-fixture.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const effectSource=read('.cache/vc/effect-declarations.json'),damageSource=read('.cache/vc/damage-declarations.json');
const allSets=Object.fromEntries(effectSource.nativeCalls.filter(c=>c.target.endsWith('AddEffectSetTemplet_LUA')&&c.args.at(-1)?.NAME).map(c=>[c.args.at(-1).NAME,c.args.at(-1)]));
const skills=vcProfile.skillCatalog.filter(s=>s.selectable&&s.state&&s.skillId!==900),heatIds=new Set([24020,24021,24022,24023,24024,24031,24034]);
const rows=[];
for(const skill of skills){
  const ids=[skill.skillId,skill.replacesSkillId].filter(Number.isInteger);
  const declarations=Object.entries(damageSource.globals).filter(([,raw])=>ids.includes(raw?.DAMAGE_DATA?.APPLIED_SKILL_ID)).map(([name])=>name);
  const unselectedSets=Object.entries(allSets).filter(([name,raw])=>!vcProfile.effectSets[name]&&Object.values(raw).some(row=>row&&typeof row==='object'&&declarations.includes(row.NAME))).map(([name,raw])=>({name,damageNames:Object.values(raw).filter(row=>row&&typeof row==='object'&&declarations.includes(row.NAME)).map(row=>row.NAME)}));
  const modes=skill.skillId===24217?['default','follow-z','follow-x','return']:[24218,24221].includes(skill.skillId)?['default','air']:['default'];
  const cases=[];
  for(const inputMode of modes)for(const awakened of [false,true])for(const heat of heatIds.has(skill.skillId)?[false,true]:[false]){
    const {sim,a,b}=vcFixture({skillId:skill.skillId,position:[-600,3080,0],gap:800});
    if(skill.skillId===24031||inputMode==='air'){a.y+=450;a.grounded=false;a.lineId=null;sim.enter(a,'RSI_JUMP_DOWN','explicit-v4-audit-air-fixture');}
    if(awakened){a.awakening.remaining=60;a.awakening.full=true;}
    sim.drainEvents();const states=new Set(),births={},children={},secondary={},startParticles={},events={},missingSets=new Set();let hpCost=0;
    for(let frame=0;frame<720;frame++){
      const follow=frame===15&&['follow-z','follow-x','return'].includes(inputMode)?[inputMode==='follow-z'?'Z':inputMode==='follow-x'?'X':'A']:[];
      const input=frame===0||heat&&frame<240&&frame%2===0?{pressed:['A'],held:['A']}:{pressed:follow};
      sim.step(1/60,input,{snapshot:false});states.add(a.state);
      for(const event of sim.drainEvents())if(event.actorId===a.id){
        events[event.type]=(events[event.type]??0)+1;
        if(event.type==='effectSet'&&!vcProfile.effectSets[event.name])missingSets.add(event.name);
        if(event.type==='effectStarted')births[event.name]=(births[event.name]??0)+1;
        if(event.type==='damageChildCreated')children[event.name]=(children[event.name]??0)+1;
        if(event.type==='damageSecondaryCreated')secondary[event.name]=(secondary[event.name]??0)+1;
        if(event.type==='effectStartParticles')for(const {entry}of event.entries)startParticles[entry.PARTICLE_NAME]=(startParticles[entry.PARTICLE_NAME]??0)+1;
        if(event.type==='overheatHpChanged')hpCost+=event.amount;
      }
    }
    const notes=[...sim.state.unsupported.map(note=>({...note,actorId:null})),...sim.state.actors.flatMap(actor=>(actor.unsupported??[]).map(note=>({...note,actorId:actor.id})))].filter(note=>note.id!=='fidelity-unverified');
    const skipped=notes.filter(note=>/^damage-(secondary|child)-/.test(note.id));
    const expectedBranch=skill.skillId===24217?{'follow-z':'RSI_SHADOW_STEP_Z_UPGRADE','follow-x':'RSI_SHADOW_STEP_X_UPGRADE',return:'RSI_SHADOW_BACK_SLIDE_UPGRADE'}[inputMode]:
      skill.skillId===24218?(inputMode==='air'?'RSI_A_RWT_FLAME_SWORD_FLY':'RSI_A_RWT_FLAME_SWORD_GROUND'):
      skill.skillId===24221?(inputMode==='air'?'RSI_A_RWT_BARRAGE_ATTACK_AIR':'RSI_A_RWT_BARRAGE_ATTACK_STAND'):null;
    cases.push({inputMode,awakened,overheatInput:heat,skillStarted:events.skillStarted??0,states:[...states],expectedBranch:expectedBranch??null,branchEntered:!expectedBranch||states.has(expectedBranch),births,children,secondary,startParticles,hpCost,targetHpLoss:b.hpMax-b.hp,notes,skipped,missingSets:[...missingSets]});
  }
  rows.push({skillId:skill.skillId,executor:skill.executor,state:skill.state,
    sourceSelectedStateSets:Object.fromEntries(skill.states.map(name=>[name,Object.fromEntries(Object.entries(vcProfile.states[name].raw).filter(([key])=>key.startsWith('EFFECT_SET')))])),
    sourceDamageNames:declarations,sourceDamageNamesNotSelected:declarations.filter(name=>!vcProfile.damageEffects[name]),unselectedSourceEffectSets:unselectedSets,cases});
}
const cases=rows.flatMap(row=>row.cases),failed=cases.filter(row=>row.skillStarted!==1||row.skipped.length||row.missingSets.length||!row.branchEntered);
const report={schemaVersion:1,evidenceClass:'static original declaration candidates + current simulation execution; not original-client trajectory',clientMeasured:false,
  profileSha256:createHash('sha256').update(readFileSync(new URL('../../packages/combat-core/vc-profile.json',import.meta.url),'utf8').replaceAll('\r\n','\n')).digest('hex'),
  source: {effect:effectSource.source,damage:damageSource.source},skills:rows.length,cases:cases.length,
  actualCasts:cases.reduce((sum,row)=>sum+row.skillStarted,0),skippedDescendantCases:cases.filter(row=>row.skipped.length).length,missingSetCases:cases.filter(row=>row.missingSets.length).length,wrongBranchCases:cases.filter(row=>!row.branchEntered).length,rows,
  limits:['Unused source candidates include historical/memo/cosmetic variants; absence alone does not authorize adding them',
    'APPLIED_SKILL_ID lookup is a candidate search, not a full semantic matcher',
    'SkillStarted=1 and no skipped descendants do not establish original positioning, timing, visual quality or real-time input feel',
    'Gatling count/input/self-damage scheduling remains the explicitly qualified V5/target adapter in vc-gatling-source-v4.json']};
writeFileSync(new URL('../../reports/vc-core-flow-v4.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({skills:report.skills,cases:report.cases,actualCasts:report.actualCasts,skippedDescendantCases:report.skippedDescendantCases,
  notes:[...new Set(cases.flatMap(row=>row.notes.map(note=>note.id)))],failed:failed.length}));
if(failed.length)process.exitCode=1;
