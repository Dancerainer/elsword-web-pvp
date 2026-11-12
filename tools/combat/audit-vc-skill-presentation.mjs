/** Static target declarations and fixed-reference methods are recorded apart
 * from current implementation observations. This is not a client trace. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {vcFixture,vcProfile as profile,vcPreset} from '../../tests/helpers/vc-fixture.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const methods=read('.cache/vc/source-methods.json');
const original=read('.cache/vc/raven-declarations.json');
const heatSkills=new Set([24031,24034,24020,24021,24022,24023,24024]);
const strings=v=>typeof v==='string'?[v]:v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
const stable=v=>JSON.stringify(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
const fixes={24020:'The muzzle EffectSet fires once per loop. Bullets retain their original .001/.09/.06/.12 timings.',
  24021:'The fire pillar uses the FireTail -200Y offset. The finishing wave preserves facing and reverses DirSpeed on one side.',
  24024:'The explosion EffectSet uses the left hand plus a directional offset of 100 before bone or TRACE placement.',
  24216:'SA_PROJECTILE_SIZE 1.5 applies to particles that support instance scaling. Rock geometry and damage are independent.',
  24605:'The shared mesh handler controls the crow carrier’s Velocity and AniName. Existing Hyper Active rules apply.'};
const rows=[];
for(const skill of profile.skillCatalog.filter(s=>s.topTier&&!s.passive)){
  const states=skill.states.map(name=>{
    const s=profile.states[name],source=original.globals[s.sourceState??name];
    if(stable(s.raw)!==stable(source))throw new Error('state differs from target: '+name);
    return {state:name,sourceState:s.sourceState,animation:s.animationName,durationSeconds:s.clip.durationSeconds,
      rawAnimationSpeed:s.raw.ANIM_SPEED??null,applyItemSpeed:s.raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY??null,
      transition:s.raw.TRANSITION??null,playType:s.raw.PLAY_TYPE??null,
      effectSets:Object.fromEntries(Object.entries(s.raw).filter(([k])=>k.startsWith('EFFECT_SET'))),
      sourcePc:s.sourcePc,poseHash:s.clip.decodedKeysSha256};
  });
  const callbackPrefixes=skill.states.map(s=>profile.states[s].sourceState??s);
  if(skill.skillId===24217)callbackPrefixes.push('RVC_SI_P_SHADOW_BACK_SLIDE','RVC_SI_P_SHADOW_STEP_FINISH','RVC_SI_P_SHADOW_BUSTER');
  const callbacks=Object.entries(methods).filter(([k])=>callbackPrefixes.some(s=>k.startsWith(s+'_')));
  const sharedCallbacks=skill.referenceBinding?.functions??[];
  const roots=[...strings(states),...callbacks.flatMap(([,s])=>[...s.matchAll(/L"([^"\r\n]+)"/g)].map(m=>m[1])),...sharedCallbacks.flatMap(f=>f.stringLiterals??[])];
  if(skill.skillId===24021)roots.push('RAVEN_GIGA_PROMINENCE_FINISH_OVERHEAT','RAVEN_GIGA_PROMINENCE_FINISH_SMOKE');
  const seen=new Set(),sets=[],damages=[],templates=[],pending=roots;
  while(pending.length){const name=pending.pop();if(seen.has(name))continue;seen.add(name);
    const set=profile.effectSets[name],damage=profile.damageEffects[name],template=profile.effectTemplates[name];
    if(set){sets.push(name);pending.push(...strings(set.raw));}
    if(damage){damages.push(name);pending.push(...strings(damage.raw));}
    if(template){templates.push(name);pending.push(...strings(template.repeated));}
  }
  const variants=[];
  const modes=skill.skillId===24217?['default','follow-z','follow-x','return']:[24218,24221].includes(skill.skillId)?['default','air']:['default'];
  for(const mode of modes)for(const awakened of vcPreset.bannedSkillIds.includes(skill.skillId)?[]:[false,true])for(const heat of heatSkills.has(skill.skillId)?[false,true]:[false]){
    const f=vcFixture({skillId:skill.skillId,gap:160});
    if(skill.skillId===24031||mode==='air'){f.a.y+=450;f.a.grounded=false;f.a.lineId=null;f.sim.enter(f.a,'RSI_JUMP_DOWN','audit-air-fixture');}
    if(awakened){f.a.awakening.remaining=30;f.a.awakening.active=true;}
    const trace=[],observedStates=new Set(),effects=new Set(),icons=[],coordinates=new Map();
    let hits=0,penalties=0,started=0;
    for(let i=0;i<900;i++){
      const follow=i===15&&mode!=='default'&&mode!=='air'?[mode==='follow-z'?'Z':mode==='follow-x'?'X':'A']:[];
      f.sim.step(1/60,{vc:{pressed:i===0||heat&&i<240&&i%2===0?['A']:follow}},{snapshot:false});observedStates.add(f.a.state);
      for(const e of f.sim.drainEvents()){
        if(e.type==='stateChanged'&&e.actorId==='vc')trace.push({step:i,state:e.state});
        if(e.type==='effectStarted'&&e.actorId==='vc'){effects.add(e.name);if(!coordinates.has(e.name))coordinates.set(e.name,e.birthAnchor?.position??null);}
        if(e.type==='overheatIcon')icons.push(e.size);
        if(e.type==='skillStarted')started++;if(e.type==='hit')hits++;if(e.type==='overheatHpChanged')penalties++;
      }
      if(![f.a.x,f.a.y,f.a.z,f.a.animationTime,f.a.hp].every(Number.isFinite))throw new Error('nonfinite '+skill.skillId);
    }
    variants.push({mode,awakened,overheatInput:heat,castCount:started,finalState:f.a.state,hits,penalties,icons,
      states:[...observedStates],effects:[...effects].sort(),firstEffectCoordinates:Object.fromEntries(coordinates),
      unsupported:f.sim.state.unsupported.filter(e=>!/default-size|default-velocity|nasod|client-baseline/.test(e.id))});
  }
  const missing=[];
  for(const n of sets)for(const [key,d]of Object.entries(profile.effectSets[n].raw))if(/^EFFECT\d+$/.test(key))
    for(const ref of [d.NAME,d.HYPER_NAME].filter(Boolean))if(!profile.effectTemplates[ref]&&!profile.damageEffects[ref])missing.push(ref);
  const missingDamageRefs=v=>{if(v&&typeof v==='object')for(const [key,value]of Object.entries(v)){
    if(['PARTICLE_NAME','MAIN_EFFECT_NAME','DAMAGE_EFFECT_NAME'].includes(key)&&typeof value==='string'&&!profile.effectTemplates[value]&&!profile.damageEffects[value])missing.push(value);
    else missingDamageRefs(value);
  }};
  for(const name of damages)missingDamageRefs(profile.damageEffects[name].raw);
  rows.push({skillId:skill.skillId,name:skill.name.replace(/#C[\da-f]{6}|#CX/gi,'').replace(/\n/g,' '),
    pvpAllowed:!vcPreset.bannedSkillIds.includes(skill.skillId),sharedWithRF:skill.sharedWithRF,states,
    referenceCallbacks:[...callbacks.map(([name,body])=>({name,sha256:sha(body)})),...sharedCallbacks.map(f=>({name:f.function,sha256:f.functionTextSha256}))],
    closure:{effectSets:sets.sort(),damageEffects:damages.sort(),templates:templates.sort(),missingDefinitions:[...new Set(missing)].sort()},
    correction:fixes[skill.skillId]??'The shared presentation fixes apply. No skill-specific difference was confirmed.',
    currentSimulation:variants});
  console.log(skill.skillId,variants.map(v=>`${v.awakened?'awake':'normal'}/${v.overheatInput?'heat':'base'}:${v.finalState}`).join(' '));
}
const out={schema:1,evidenceClass:'target2016 static declarations + fixedV5 reference + current simulation, recorded separately',
  originalClientRuntimeTraces:0,gpuComparison:false,source:{target:original.source,
    referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',referenceMethodIndex:'contracts/vc-reference-consumers-v1.json'},
  skillCount:rows.length,pvpSkillCount:rows.filter(r=>r.pvpAllowed).length,
  limits:['No 2016 client runtime or GPU comparison; no 1:1/visual acceptance claim',
    'Static resource closure includes reference-only memo variants; not all are emitted in current target skills',
    'All movement/follow-line/main-loop scheduling remains a qualified adapter',
    'The two raw aliases/upgrade controllers and current particle blending still require visual comparison'],rows};
writeFileSync('reports/vc-skill-presentation-matrix-v3.json',JSON.stringify(out,null,2)+'\n');
