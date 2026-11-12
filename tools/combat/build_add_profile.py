"""Build Add profiles from target data and real original clip evidence."""
import argparse,copy,hashlib,json,re,posixpath
from pathlib import Path
from rf_skill_catalog import buff_catalog,buff_templates,strings,trait_catalog
from add_definitions import PROFESSIONS,ACTIVE,FOLLOWUP,ALIASES,COMMANDS,SKILL_LIMITATIONS,NO_EFFECTIVE_ATTACK
from kl82_static import parse
ROOT=Path(__file__).resolve().parents[2]
def build(cache,assets,profession):
 b=PROFESSIONS[profession];docs={p.name.removesuffix('-declarations.json'):json.loads(p.read_text('utf8')) for p in cache.glob('*-declarations.json')};unit,enum,skills=[docs[k] for k in ('add','enum','skill')];raw=unit['globals']
 clip_path=assets/'clips.json'
 if not clip_path.is_file():clip_path=assets/'source-proof/clips.json'
 clips=json.loads(clip_path.read_text('utf8'));clip_info={c['name']:{k:c[k] for k in ('durationSeconds','durationTicks','ticksPerSecond','sourceName','decodedKeysSha256')} for c in clips}
 ts={c['args'][-1]['m_eID']:c['args'][-1] for c in skills['nativeCalls'] if c['target'].endswith('AddSkillTemplet_LUA')};nodes=[c['args'][-1] for c in skills['nativeCalls'] if c['target'].endswith('AddSkillTreeTemplet_LUA') and c['args'][-1].get('m_eUnitClass')==b['classId']];replaced={ts[n['m_iSkillID']].get('m_DeleteSkillIDByUpgrade') for n in nodes}
 branches,branch_provenance=trait_catalog(docs['skill-note'],enum,ts,nodes,b['classes']);power={c['args'][-1]['m_eID']:c['args'][-1]['m_Value'] for c in docs['skill-data']['nativeCalls'] if c['target'].endswith('AddSkillPowerRate_LUA')}
 catalog=[]
 for n in nodes:
  sid=n['m_iSkillID'];t=ts[sid];level=n['m_iMasterLevel'];base=sid
  while base not in ACTIVE and ts[base].get('m_DeleteSkillIDByUpgrade'):base=ts[base]['m_DeleteSkillIDByUpgrade']
  passive=29400<=sid<=29414;state,executor=ACTIVE.get(base,(None,None));states=([state]+FOLLOWUP.get(base,[])) if state else []
  if state and state+'_HYPER' in raw:states.append(state+'_HYPER')
  if not passive and not state:raise ValueError('Unbound active Add skill '+str(sid))
  entries=branches.get(sid,[])
  for entry in entries:
   limits={'MI_USEFUL':['Original extra-hit consumer unavailable; do not fabricate schedules'],'MI_CRITICAL':['Defensive-effect bypass consumer not fully recovered']}.get(entry['memoTypeName'],[]);entry.update(supported=not limits,limitations=limits,supportStatus='target-declaration-adapter; consumer-unverified')
  catalog.append(dict(skillId=sid,unitClass=b['classId'],name=t['m_wstrName'],raw=t,treeNode=n,maxLevel=level,maxLevelEvidence='target2016 AddSkillTreeTemplet_LUA.m_iMasterLevel',topTier=sid not in replaced,replacesSkillId=t.get('m_DeleteSkillIDByUpgrade'),passive=passive,type=t['m_eType'],useCondition=t['m_eActiveSkillUseCondtion'],mpCost=t.get('m_MPConsumption',{}).get(str(level)),cooldown=t.get('m_SkillCoolTime',{}).get(str(level)),powerRateType=t.get('m_ePowerRate'),levelPowerRate=power.get(t.get('m_ePowerRate'),{}).get(str(level)),powerMultiplier=max(t.get('SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE',{}).get(str(level),1),1),state=state,executor=executor,states=states,supported=bool(state and sid!=900),supportStatus='target-declaration+qualified-reference-adapter',fidelityVerified=False,selectable=sid not in replaced and not passive,slotEligible=not passive,defaultGranted=sid not in replaced and passive,branches=entries,branchStatus=branch_provenance['status']))
  row=catalog[-1];row['limitations']=[{'key':key,'message':message,'evidenceClass':'target2016 declarations; absent or unbound native consumer'} for key,message in SKILL_LIMITATIONS.get(base,[])]
  if row['limitations']:row['supportStatus']='partial-target-declaration-adapter'
  if base in NO_EFFECTIVE_ATTACK:
   row['supported']=False;row['supportStatus']='unsupported-no-effective-attack';row['unavailableReason']=row['limitations'][0]['key']
 selected=set(ALIASES.values())|{s for c in catalog for s in c['states']}
 # Include common commands and only this career's promotion commands/poses.
 for k,v in raw.items():
  if not isinstance(v,dict) or 'ANIM_NAME' not in v:continue
  if re.match(r'ANSI_(?:COMBO_|JUMP_ATTACK_|DASH_COMBO_|DASH_JUMP_COMBO_|STANDUP_ROLLING_)',k) or k in ('ANSI_HYPER_WAIT','ANSI_AIR_DASH','ANSI_LEVITATION_WAIT','ANSI_DP_BARRIER_ACTIVE','ANSI_START_INTRUDE'):selected.add(k)
  if any(k.startswith('ANSI_'+x+'_') for x in b['prefixes']) and not re.match(r'ANSI_(?:A_|SA_|HA_)',k):selected.add(k)
 poses=raw['INIT_COMMON_RANDOM_STATE'][b['pose']];selected|={v for g in poses.values() for v in g.values() if isinstance(v,str)}
 states={};missing_states={}
 for name in sorted(selected):
  v=raw[name];animation=v['ANIM_NAME']
  if animation not in clip_info:
   missing_states[name]={'raw':v,'sourcePc':unit['locations'][name],'reason':'target declaration references animation absent from original career motion files'};continue
  states[name]=dict(raw=v,sourceState=name,animationName=animation,clip=clip_info[animation],rootMotion=next((c.get('rootMotion') for c in clips if c['name']==animation),None),sourcePc=unit['locations'][name],defaultAnimationEvidence='target2016 ANIM_NAME')
 for c in catalog:
  c['missingAnimationStates']=[n for n in c['states'] if n in missing_states];c['states']=[n for n in c['states'] if n not in missing_states]
  if c['missingAnimationStates'] and c['supported']:c['supportStatus']='partial-missing-original-animation'
 for role,src in ALIASES.items():states[role]={**states[src],'stateRole':role}
 allsets={c['args'][-1]['NAME']:dict(raw=c['args'][-1],sourcePc=dict(prototype=c['prototype'],instruction=c['instruction'])) for c in docs['effect']['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA') and c['args'][-1].get('NAME')};effects={};damage={};seen=set()
 # All Add callback resource literals belong to the shared asset closure, not automatic triggers.
 methods_path=cache/'source-methods.json';literal=['EffectSet_AN_Hyper_Attack','DamageEffect_AN_Hyper']
 if methods_path.is_file():
  methods=json.loads(methods_path.read_text('utf8'));literal=sorted(set(literal)|{v for name,text in methods.items() if any(name.upper().startswith(state.upper()+'_') for state in selected) or not any(x in name.upper() for x in ('APT','ALP','AAT','AMM','ATT_','ADE')) or any(x in name.upper() for x in b['prefixes']) for v in re.findall(r'L"([^"\r\n]+)"',text)})
 if profession=='mm':
  # These names are formed by the qualified callbacks' literal suffixes;
  # validate against the original dictionaries instead of omitting variants.
  literal=sorted(set(literal+['DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation0','EffectSet_SI_A_AMM_Flick_Disc_Fire_Lock_Mutation1','DamageEffect_ANSI_AMM_COMBO_ZZXX','DamageEffect_ANSI_AMM_COMBO_ZZXX_Attack','DamageEffect_ANSI_AMM_COMBO_ZZXX_Dummy_Attack']))
 def closure(pending):
  while pending:
   name=pending.pop()
   if name in seen:continue
   seen.add(name)
   if name in allsets:effects[name]=allsets[name];pending.extend(strings(allsets[name]))
   if name in docs['damage']['globals']:damage[name]=dict(raw=docs['damage']['globals'][name],sourcePc=docs['damage']['locations'][name]);pending.extend(strings(damage[name]))
 summons={};summon_literals=[]
 if profession=='mm':
  npc=json.loads((cache.parent/'add-npc/apocalypse-declarations.json').read_text('utf8'));source=Path(npc['source']['path']).read_bytes()
  if hashlib.sha256(source).hexdigest()!=npc['source']['sha256']:raise ValueError('Apocalypse original script hash mismatch')
  # Function bytecode is not executed. Literal names seed only the resource
  # closure, while the independently audited consumer owns callback timing.
  summon_literals=sorted({v for p in parse(source)['prototypes'][:-1] for v in strings(p['gc'])})
  summons['apocalypse']={**npc,'callbackLiteralResources':summon_literals}
 closure(list(strings(states))+literal+list(strings(summons)))
 factors,fp=buff_catalog(cache,[states,catalog,damage,{'BUFF_FACTOR_ID':{'1':enum['globals']['BUFF_FACTOR_ID']['BFI_FORMATION_MODE'],**({'2':347} if profession=='de' else {'2':369,'3':443,'4':368,'5':370} if profession=='mm' else {'2':356,'3':357})}}]);buffs,bp=buff_templates(cache,[states,catalog,damage,factors]);closure(list(strings(buffs)))
 pose_result={kind:[dict(state=g[str(i)],weight=g[str(i+1)],animationName=states[g[str(i)]]['animationName'],duration=states[g[str(i)]]['clip']['durationSeconds']/raw[g[str(i)]].get('ANIM_SPEED',1),durationEvidence='original clip / target speed; adapter') for i in range(1,len(g)+1,2)] for kind,g in [(kind,poses[key]) for kind,key in [('start','START_STATE_LIST'),('win','WIN_STATE_LIST'),('lose','LOSE_STATE_LIST')]]}
 result=dict(schemaVersion=1,profileId=profession+'-target2016-v1',professionId=profession,target=dict(region='Steam NA',build='V6.0420.5',unitType=9,unitClass=b['classId'],displayName=b['label']),validation=dict(clientMeasured=False,fidelityGate='pending',simulationEvidence='independent from original baseline'),presentation=dict(cameraDynamic=False,skillCutIn=False,skillBarMode='eight',slotKeys=['A','S','D','C','Q','W','E','R'],pvpPoses=pose_result,pvpPosesEvidence='target2016 INIT_COMMON_RANDOM_STATE.'+b['pose']),physics=raw['INIT_PHYSIC'],body=raw['INIT_SYSTEM'],components=raw['INIT_COMPONENT'],states=states,stateAliases=ALIASES,skillCatalog=catalog,clips=clip_info,defaultPassiveSkillIds=[c['skillId'] for c in catalog if c['defaultGranted']],buffFactors=factors,buffFactorProvenance=fp,buffTemplates=buffs,buffTemplateProvenance=bp,effectSets=effects,damageEffects=damage,effectTemplates={},resourceOnlyEffectSets=[n for n in literal if n in allsets],resourceOnlyTemplates=[],sourceLiteralResources=literal,skillBranches={**branch_provenance,'powerRateTables':{str(k):{'values':v} for k,v in power.items()},'powerRateSource':docs['skill-data']['source']},enums={k:enum['globals'][k] for k in ('EFFECT_SET_TIMER_TYPE','DELETE_CONDITION_EFFECT_SET','REACT_TYPE','DAMAGE_TYPE','ATTACK_TYPE','BUFF_BEHAVIOR_TYPE','BUFF_FINALIZER_TYPE','BUFF_CHANGE_TYPE','BUFF_RELATION_TYPE','BUFF_DURATION_TIME_TYPE','BUFF_USE_COUNT_TYPE','SKILL_TYPE','MEMO_ID','ACTIVE_SKILL_USE_CONDITION')},referenceSemantics=dict(commandStates=COMMANDS,comboBuffers={},mechanicBindings={},awakening=dict(applyAnimationTime=.46,orbsMax=0,chargePerOrb=100,onHitBase=0,onReceivedBase=0,powerMultiplier=1.2,evidence='target2016 BFI315/BTI320 FORMATION_MODE declares melee/range x1.2, applied once through awake power path without granting BFI315; fixedV5 Add.cpp4888 CommonHyperModeFrameMove(.05,.46) supplies qualified activation timing; target2016 declares BoostPower at1.4 without native apply timing; DP module owns gauge'),lineRadius=30,lineCanDownDefault=True,dashJumpHorizontalMultiplier=1.6,dashJumpAdditionalGravityMultiplier=1.2,evidence='shared fixedV5 movement consumer candidate, target2016 physics independent'),unsupported=[dict(id='client-baseline',reason='No target2016 combat/GPU trajectory; never 1:1'),dict(id='consumer-version',reason='Fixed V5 Add callback file includes later reconstructed portions; target declarations and simulation kept independent'),dict(id='unknown-native-fields',reason='Raw declarations retained; unknown consumers are not substituted from other careers')],sources={k:d['source'] for k,d in docs.items()})
 # Only states whose qualified callback actually invokes the Nasod macro.
 result['summonDeclarations']=summons
 if summons:
  result['sourceLiteralResources']=sorted(set(literal+summon_literals))
  result['resourceOnlyEffectSets']=sorted(set(result['resourceOnlyEffectSets']+[n for n in summon_literals if n in allsets]))
 methods=json.loads(methods_path.read_text('utf8')) if methods_path.is_file() else {}
 nasod_methods={re.sub('_?EventProcess$','',k).replace('ANSI_','',1).replace('_','').upper() for k,v in methods.items() if 'ELSE_IF_CAN_NASOD_ARMOR_ATTACK' in v}
 result['referenceSemantics']['nasodArmorStates']=[n for n in states if n.replace('ANSI_','',1).replace('_','').upper() in nasod_methods]
 # Confirmed dangling target declaration; never allow arbitrary missing visuals.
 memo='DamageEffect_SI_SA_AN_Neutron_Bomb_Start_Memo'
 if memo in damage:
  damage[memo]['unsupportedMainEffect']={'name':memo,'reason':'Target damage MAIN_EFFECT_NAME references itself; original resource catalog contains no matching particle template','evidenceClass':'target2016 source inconsistency, not optimization loss'}
 result['unsupportedStates']=missing_states
 if missing_states:result['unsupported'].append(dict(id='missing-original-animation',states=list(missing_states),reason='No substitution for unavailable original followup clips; see unsupportedStates raw declarations'))
 fx_sources=[(assets/'fx/index.json','')]+([(assets/'summons/apocalypse/fx/index.json','summons/apocalypse/'),(assets/'mutation-fx/index.json','')] if profession=='mm' else [])
 for fx,prefix in fx_sources:
  if not fx.is_file():continue
  for name,t in json.loads(fx.read_text('utf8'))['templates'].items():
   if prefix:
    t=copy.deepcopy(t)
    for key in ['glb','poseData']:
     if t.get(key):t[key]=posixpath.normpath(prefix+t[key])
    for texture in t.get('textures',{}).values():
     if texture.get('file'):texture['file']=posixpath.normpath(prefix+texture['file'])
   initial={e['property']:e['value'] for e in t['events'] if e['start']==0 and not e['fade']};result['effectTemplates'][name]={**t,'initialSize':initial.get('Size'),'initialVelocity':initial.get('Velocity'),'initialDirSpeed':initial.get('DirSpeed'),'initialAnimation':{'name':initial['AniName']['animation'],'playback':initial['AniName']['playback']} if 'AniName' in initial else None,'missingExplicitTickRate':t.get('animationMissingTickRate',False)}
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,default=ROOT/'.cache/add-target');p.add_argument('--assets',type=Path,required=True);p.add_argument('--profession',choices=list(PROFESSIONS),required=True);p.add_argument('--output',type=Path);a=p.parse_args();r=build(a.cache,a.assets,a.profession);out=a.output or ROOT/f'packages/combat-core/{a.profession}-profile.json';out.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n','utf8');print(json.dumps(dict(profession=a.profession,states=len(r['states']),skills=len(r['skillCatalog']),sha256=hashlib.sha256(out.read_bytes()).hexdigest())))
