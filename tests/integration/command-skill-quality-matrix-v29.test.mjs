import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PROFESSION_PROFILES as RAW_PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {installAddDeCommandSource} from '../../packages/combat-core/add-de-command-v45.mjs';
import {installElesisFeedbackSource} from '../../packages/combat-core/elesis-feedback-source-v45.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {mergeVisualEffectIndexes} from '../../packages/combat-assets/effect-indexes.mjs';
import {rebaseAddSummonEffectIndex} from '../../packages/combat-assets/add-summon-assets.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectPresentationPolicy,particlePresentationBudget,showsDamageParticle,showsCharacterHit,
  DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY,ACTIVE_ARMOR_CAST_EFFECT_SET,RS_DENSE_COMMAND_EFFECT_SETS,CA_DENSE_COMMAND_EFFECT_SETS,STRUCTURAL_MESH_SOURCE_CLOCK_CUES} from '../../packages/effect-runtime/presentation-quality.mjs';
import {collectEffectTemplates,collectEffectMeshBudget,collectCommandTemplateQualities,effectNumberUpperBound} from '../../apps/web/effect-prewarm.mjs';
import {lordKnightCommands} from '../../packages/combat-core/lk-commands.mjs';
import {runeSlayerCommands} from '../../packages/combat-core/rs-commands.mjs';
import {infinitySwordCommands} from '../../packages/combat-core/is-commands.mjs';
import {elesisCommands,elesisCommandEffectRoots} from '../../packages/combat-core/elesis-commands.mjs';
import {addCommands} from '../../packages/combat-core/add-commands.mjs';
import {ADD_BARRIER_STATE} from '../../packages/combat-core/add-barrier.mjs';
import {ADD_COMMAND_SHOTS,getAddSkillResourceRoots} from '../../packages/combat-core/add-skills.mjs';
import {createVeteranCommands} from '../../packages/combat-core/vc-commands.mjs';
import {createBladeMasterCommands} from '../../packages/combat-core/bm-commands.mjs';
import {RAVEN_COMMAND_PRESENTATION_STATES} from '../../packages/native-source/commands.mjs';
import {RF_COMMAND_FALLBACK_STATES} from '../../packages/combat-core/rf-command-fallback.mjs';
import {ELESIS_NO_DOWN_STANDUP_SOURCE_STATES} from '../../packages/combat-core/standup-policy.mjs';
import bindings from '../../contracts/command-presentation-bindings-v29.json' with {type:'json'};
import clockContract from '../../contracts/structural-mesh-source-clocks-v29.json' with {type:'json'};
const historicalIdentity = process.env.PRESENTATION_IDENTITY_FILE;

const assets=resolve(process.env.ELSWORD_ASSETS_ROOT??(existsSync('runtime/v29-assets')?'runtime/v29-assets':'artifacts'));
const PROFESSION_PROFILES=Object.fromEntries(Object.entries(RAW_PROFESSION_PROFILES).map(([id,raw])=>[id,
 installAddDeCommandSource(installElesisFeedbackSource({...raw,effectSets:{...raw.effectSets},damageEffects:{...raw.damageEffects},effectTemplates:{...raw.effectTemplates}}))]));
const json=file=>JSON.parse(readFileSync(file)),raven={handlesEvent:a=>RAVEN_COMMAND_PRESENTATION_STATES.includes(a.state)};
const consumers={RF:raven,VC:createVeteranCommands(null,raven),BM:createBladeMasterCommands(null,raven),LK:lordKnightCommands,
  RS:runeSlayerCommands,IS:infinitySwordCommands,GM:elesisCommands,BH:elesisCommands,CA:elesisCommands,LP:addCommands,MM:addCommands,DE:addCommands};
function indexFor(id){const base=resolve(assets,id.toLowerCase()),manifest=json(resolve(base,'manifest.json'));
  const indexes=(manifest.visualEffectIndexes??['fx/index.json']).map(file=>json(resolve(base,file)));
  if(id==='MM'){const summon=json(resolve(base,'summons/apocalypse/manifest.json'));indexes.push(rebaseAddSummonEffectIndex(json(resolve(base,'summons/apocalypse',summon.fx))));}
  return addPlayerFeedbackVisuals(mergeVisualEffectIndexes(...indexes),id);
}
const expectedSkill=(id,skillId)=>({level:'medium',particleDivisor:skillId===24010?16:8,...(['LP','MM','DE'].includes(id)?{sourceFamily:'add'}:{})});
// The explicitly requested finite active-armor startup is the only local
// skill-set exception. Actor, character-hit and every other skill stay medium.
const expectedSkillEffect=(id,skillId,setName)=>['LK','RS','IS','GM','BH','CA'].includes(id)&&setName===ACTIVE_ARMOR_CAST_EFFECT_SET?
  FULL_EFFECT_QUALITY:expectedSkill(id,skillId);

test('archived presentation consumers match their supplied identity file', {skip: !historicalIdentity && 'Set PRESENTATION_IDENTITY_FILE to check an archived release'}, ()=>{
  const runtimeIdentity=JSON.parse(readFileSync(historicalIdentity));
  // v29 remains the historical source seal. Later reviewed gameplay changes
  // receive a separate current-Web identity, never new quality/timing goldens.
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(runtimeIdentity.targetClientMeasured,false);
  assert.equal(runtimeIdentity.historicalSeal.sha256,digest(readFileSync('contracts/command-presentation-bindings-v29.json')));
  assert.deepEqual(Object.keys(runtimeIdentity.sourceFiles).sort(),Object.keys(bindings.sourceFiles).sort());
  for(const [file,sha]of Object.entries({...runtimeIdentity.sourceFiles,...runtimeIdentity.actualPresentationInputs}))
    assert.equal(digest(readFileSync(file)),sha,file+'; refresh current identity only after the final SUT freeze');
  assert.equal(runtimeIdentity.preservation.success,true);
  assert.equal(runtimeIdentity.preservation.rawBlocks,5138,'independent V52 raw blocks, with new records listed separately');
});

test('presentation quality remains a leaf dependency',()=>{
  const source=readFileSync('packages/effect-runtime/presentation-quality.mjs','utf8');
  assert.ok(!/from ['"].*\/(?:add-skills|\w+-commands|native-source\/commands)\.mjs/.test(source),'no gameplay/native runtime imports that create initialization cycles');
});

for(const [id,profile]of Object.entries(PROFESSION_PROFILES)){
  test(id+' actual command handlers, aliases, all catalog skills and dynamic roots use consistent display levels',t=>{
    const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),skills=new Set(profile.skillCatalog.flatMap(row=>row.states??[]));let checkedStates=0,checkedSkills=0;
    for(const [state,definition]of Object.entries(profile.states)){
      const actor={professionId:id,state,skillId:null},source=definition.sourceState??state;
      const actual=consumers[id].handlesEvent(actor,profile)||consumers[id].handlesEvent({...actor,state:source},profile);
      // Add's actual command handler also runs DamageReact barrier recovery.
      // Its shared cancel callback is not evidence that it is a Z/X command.
      const system=['LP','MM','DE'].includes(id)&&source===ADD_BARRIER_STATE;
      if(actual&&!skills.has(state)&&!system)assert.equal(policy.actor(actor).level,'high',id+'/'+state);
      if(system){assert.equal(policy.actor(actor).level,'medium',id+'/'+state);assert.ok(!policy.comboStates.has(state));}
      if(/(?:^|_)(?:DAMAGE|HYPER_MODE|PARRYING)(?:_|$)/.test(source))assert.equal(policy.actor(actor).level,'medium','non-command '+id+'/'+state);
      if(policy.comboStates.has(state)){assert.equal(policy.actor(actor).level,'high');assert.ok(!skills.has(state));checkedStates++;}
    }
    for(const row of profile.skillCatalog){
      for(const state of row.states??[]){assert.ok(profile.states[state]);assert.deepEqual(policy.actor({state,skillId:row.skillId}),expectedSkill(id,row.skillId));
        assert.equal(policy.actor({state,skillId:null}).level,'medium','lost skill ID must not promote a skill state');}
      for(const root of [...policy.comboSets,...policy.comboEffects,...policy.fullQualityEffectSets])assert.deepEqual(policy.effect({setName:root,name:root,skillId:row.skillId}),expectedSkillEffect(id,row.skillId,root),'skill root quality '+root);
      assert.deepEqual(policy.characterHit({origin:{skillId:row.skillId}}),expectedSkill(id,row.skillId));checkedSkills++;
    }
    for(const root of bindings.professions[id].dynamicRoots){const q=policy.effect({setName:root,name:root,skillId:null});
      assert.equal(q.level,'high',root);assert.equal(showsDamageParticle({SHOW_LEVEL:'OL_HIGH'},q),true,root);}
    const denseRoots=id==='RS'?RS_DENSE_COMMAND_EFFECT_SETS:id==='CA'?CA_DENSE_COMMAND_EFFECT_SETS:[];
    assert.deepEqual([...policy.denseCommandSets],denseRoots,id+' exact local density exceptions');
    for(const setName of denseRoots)assert.deepEqual(policy.effect({setName,skillId:null}),{level:'high',particleDivisor:8});
    assert.equal(showsCharacterHit({actorId:'peer1',targetId:'peer2'},'local',policy.characterHit({origin:{skillId:null}})),true);
    if(['LP','MM','DE'].includes(id)){
      assert.equal(policy.actor({state:'ANSI_DP_BARRIER_ACTIVE',skillId:null}).level,'medium');
      for(const state of ['ANSI_HYPER_MODE','RSI_HYPER_MODE'])assert.equal(policy.actor({state,skillId:null}).level,'medium');
      assert.equal(policy.effect({setName:'EffectSet_AN_Formation_Start',name:'ADD_STR_ToKang',skillId:null}).level,'medium');
      for(const row of Object.values(ADD_COMMAND_SHOTS))assert.equal(policy.effect({setName:row[1],skillId:null}).level,'high');
      if(id!=='DE')assert.equal(policy.effect({setName:'EffectSet_ADE_Combo_XXX_Projectile',skillId:null}).level,'medium','DE-only callback stays out of sibling command policy');
    }
    for(const root of elesisCommandEffectRoots(profile))assert.equal(policy.effect({...(profile.damageEffects?.[root]?{name:root}:{setName:root}),skillId:null}).level,'high',root);
    if(['RF','VC','BM'].includes(id))for(const state of RF_COMMAND_FALLBACK_STATES)
      if(profile.states[state])assert.equal(policy.actor({state,skillId:null}).level,'high','shared Raven fallback command '+state);
    if(['GM','BH','CA'].includes(id)){
      for(const state of Object.values(ELESIS_NO_DOWN_STANDUP_SOURCE_STATES))
        if(profile.states[state])assert.equal(policy.actor({state,skillId:null}).level,'high','canonical quick standup '+state);
      assert.equal(policy.actor({state:'ESI_SI_A_EL_SONIC_ASSAULT_STING',skillId:null}).level,'medium','unselected skill declaration is not a command');
    }
    t.diagnostic(JSON.stringify({profession:id,commandStates:checkedStates,allSkillIds:checkedSkills,dynamicRoots:bindings.professions[id].dynamicRoots.length}));
  });
  test(id+' actual resource closure and mesh capacity follow live command policy for all skill IDs and deferred descendants',
    {skip:!existsSync(resolve(assets,id.toLowerCase(),'manifest.json'))},t=>{
      const index=indexFor(id),policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY),qualities=collectCommandTemplateQualities(profile,index,DEFAULT_EFFECT_QUALITY);
      const slots=profile.skillCatalog.map(row=>({skillId:row.skillId})),warmed=collectEffectTemplates(profile,index,slots),budget=collectEffectMeshBudget(profile,index,slots,{effectQuality:DEFAULT_EFFECT_QUALITY});
      for(const name of qualities.keys())assert.ok(warmed.has(name),'command must be prewarmed: '+id+'/'+name);
      for(const row of profile.skillCatalog){
        if(['LP','MM','DE'].includes(id))for(const root of getAddSkillResourceRoots(row))assert.equal(policy.effect({name:root,setName:root,skillId:row.skillId}).level,'medium',root);
      }
      for(const [name,demand]of budget.demands){const template=index.templates[name];assert.ok(warmed.has(name));
        if(template.kind!=='particle'||demand.budgetScope==='resource-materials-only')continue;
        const fields=template.fields;if(![fields.NumParticles,fields.Emitrate,fields.Lifetime].every(Number.isFinite))continue;
        const q=qualities.get(name)??({...DEFAULT_EFFECT_QUALITY,...(['LP','MM','DE'].includes(id)?{sourceFamily:'add'}:{})});
        const live=particlePresentationBudget(template,Math.floor(fields.NumParticles),fields.TriggerCount??-1,q);
        const rate=effectNumberUpperBound(fields.Emitrate),life=effectNumberUpperBound(fields.Lifetime),tick=1/60;
        const upper=Math.min(live.max,rate===0||life===0?0:Math.ceil(rate/live.divisor*tick*Math.ceil(life/tick))+1,live.limit<0?Infinity:Math.floor(live.limit));
        assert.equal(demand.peakParticles,upper,'prewarm/live particle capacity: '+id+'/'+name);
      }
      t.diagnostic(JSON.stringify({profession:id,skillIds:slots.length,warmedTemplates:warmed.size,meshDemands:budget.demands.size,commandTemplates:qualities.size}));
    });
}

test('DP barrier system classification wins over shared command callbacks, aliases and buffer metadata',()=>{
  for(const id of ['LP','MM','DE']){
    const original=PROFESSION_PROFILES[id],alias='quality-check-barrier-alias';
    assert.ok(addCommands.handlesEvent({professionId:id,state:ADD_BARRIER_STATE},original));
    const profile={...original,states:{...original.states,[alias]:{...original.states[ADD_BARRIER_STATE],sourceState:ADD_BARRIER_STATE}},
      referenceSemantics:{...original.referenceSemantics,comboBuffers:{...original.referenceSemantics.comboBuffers,[alias]:{Z:ADD_BARRIER_STATE}}}};
    const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
    for(const state of [ADD_BARRIER_STATE,alias]){
      assert.equal(policy.actor({state,skillId:null}).level,'medium');assert.ok(!policy.comboStates.has(state));
    }
    assert.ok(!bindings.professions[id].states.includes(ADD_BARRIER_STATE));
    assert.ok(bindings.professions[id].systemStates.includes(ADD_BARRIER_STATE));
  }
});

test('RS five measured flame roots expose high layers while keeping the identical V4 fan cap/density',()=>{
  const p=PROFESSION_PROFILES.RS,policy=createEffectPresentationPolicy(p,DEFAULT_EFFECT_QUALITY);
  for(const setName of RS_DENSE_COMMAND_EFFECT_SETS)assert.deepEqual(policy.effect({setName,skillId:null}),{level:'high',particleDivisor:8});
  const index=indexFor('RS');for(const name of ['SwordFire_ReadyP01L','SwordFire_ReadyP01','SwordFire_ComboXZZ','SwordFire_FM02','SwordFire_FM01']){
    const template=index.templates[name],max=template.fields.NumParticles,limit=template.fields.TriggerCount??-1;
    assert.deepEqual(particlePresentationBudget(template,max,limit,{level:'high',particleDivisor:8}),particlePresentationBudget(template,max,limit,DEFAULT_EFFECT_QUALITY),name);
    assert.equal(particlePresentationBudget(template,max,limit,FULL_EFFECT_QUALITY).divisor,1,'native full density remains available');
  }
  assert.equal(policy.effect({name:'ELK_WIND_SLICER_M01',setName:'EffectSet_SI_P_ELK_WIND_SLICER',skillId:21402}).level,'medium');
});

test('nineteen frozen sparse structural mesh cues retain the original first birth and capacity',()=>{
  assert.equal(clockContract.cues.length,19);
  for(const row of clockContract.cues){assert.ok(STRUCTURAL_MESH_SOURCE_CLOCK_CUES.has(row.name));
    const source=row.sources[0],index=indexFor(row.professions[0]),template=index.templates[row.name];assert.ok(template.glb,row.name);
    assert.equal(template.fields.particleType,source.particleType);assert.equal(template.fields.NumParticles,source.NumParticles);
    const q=particlePresentationBudget(template,source.NumParticles,source.TriggerCount??clockContract.runtimeDefaults.TriggerCount,DEFAULT_EFFECT_QUALITY);assert.equal(q.divisor,1,row.name);
    const first=[];for(const effectQuality of [FULL_EFFECT_QUALITY,DEFAULT_EFFECT_QUALITY]){
      const runtime=createEffectRuntime({index,effectQuality});runtime.add(row.name);let frame=0;
      for(;frame<240;frame++){runtime.step(1/60,{});if([...runtime.particles.values()].some(p=>p.name===row.name))break;}
      assert.ok(frame<240,'real structural birth '+row.name);first.push(frame);runtime.clear();
    }assert.equal(first[1],first[0],row.name);
  }
});

test('CA looping skin body retains the first source packet at half density; fragment shower stays budgeted',()=>{
  const index=indexFor('CA'),body=index.templates.SDK_BR_BR_PE03_S,shower=index.templates.SDK_BR_BR_PE04_S;
  assert.deepEqual(particlePresentationBudget(body,25,25,DEFAULT_EFFECT_QUALITY),{divisor:2,max:13,limit:13,firstSourcePacket:true});
  assert.equal(particlePresentationBudget(shower,25,25,DEFAULT_EFFECT_QUALITY).divisor,8);
  const runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY});runtime.add(body.name);runtime.step(1/60,{});
  assert.ok([...runtime.particles.values()].some(p=>p.name===body.name),'body arrives on the original first source packet');runtime.clear();
});
