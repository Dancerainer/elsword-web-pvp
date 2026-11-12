"""Read-only 2016 concentrated-light resources and qualified V5 callbacks.

Skill energy was #if 0 in this V5 reference. Enabling its original centre
templates is an explicit user-requested web presentation adaptation, not 1:1.
Black-hole/look-point lines stay unsupported; no invented substitute is used.
"""
import argparse,json,re,sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog,digest,write_json
from build_rf_fx import declaration
NAMES={'GameMajorParticle.txt':['SpecialEnergyCenter','SpecialEnergyCenterRed'],
       'GameMinorParticle.txt':['HyperModeChangeCenter','WhiteShockWave','ImpactTick','GroundShockWave']}
HASHES={'X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
        'KTDGParticleSystem.cpp':'43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050',
        'X2GURaven.cpp':'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
        'X2GUElsword_SwordMan.cpp':'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'}
def functions(text):
 result={}
 # Braces in comments must not affect function boundaries.
 clean=re.sub(r'/\*.*?\*/|//[^\n]*',lambda m:'\n'*m[0].count('\n'),text,flags=re.S)
 # Alternate #ifdef function signatures/braces coexist in the raw reference.
 # Bound literal inspection by the next qualified function definition instead
 # of pretending the file has already been preprocessed for one build.
 matches=list(re.finditer(r'^\s*[\w:*&<> ]+\s+\w+::(\w+)\s*\([^{};]*\)\s*(?:const\s*)?\{',clean,re.M))
 for i,match in enumerate(matches):
  result[match[1]]=clean[match.end():matches[i+1].start() if i+1<len(matches) else len(clean)]
 return result
def build(source,reference,output):
 source,reference,output=map(lambda p:Path(p).resolve(),(source,reference,output))
 if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source):raise ValueError('Task-owned artifact output required')
 refs={};bodies={};routes={}
 for name in ['X2GUUser.cpp','X2GURaven.cpp','X2GUElsword_SwordMan.cpp','KTDGParticleSystem.cpp']:
  raw=(reference/name).read_bytes();sha=digest(raw)
  if name in HASHES and sha!=HASHES[name]:raise ValueError('Frozen reference hash differs: '+name)
  text=raw.decode('latin1');refs[name]={'sha256':sha,'evidenceClass':'fixed-V5-source-reference'}
  bodies[name]=functions(text)
  route={}
  for m in re.finditer(r'MakeTableReference\(\s*"([^"]+)"\s*,\s*(\w+)\.stateID\s*\)',text):
   segment=text[m.end():];segment=segment[:segment.find('MakeTableReference(')] if 'MakeTableReference(' in segment else segment
   cb=re.search(r'\b'+re.escape(m[2])+r'\.OnFrameMove\s*=\s*SET_CB_FUNC\(\s*\w+\s*,\s*(\w+)',segment)
   if cb:route[m[1]]=cb[1]
  routes[name]=route
 cat=Catalog(source);templates={}
 for filename,names in NAMES.items():
  path=cat.path(filename);text=path.read_bytes().decode('latin1')
  for name in names:
   matches=list(re.finditer(r'eventsequence\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}',text))
   if len(matches)!=1:raise ValueError('Unique original declaration required: '+name)
   m=matches[0];row=declaration(m[1],casefold_tokens=True)
   if row['unsupported']:raise ValueError('Unsupported declaration: '+name+str(row['unsupported']))
   key='cast:'+name
   row.update(name=key,kind='particle',source={**cat.evidence(path),'byteOffset':m.start(),'line':text.count('\n',0,m.start())+1},declarationSha256=digest(m[0].encode('latin1')),textures={})
   for tex in sorted({e['value'] for e in row['events'] if e['property']=='Texture'}):
    p=cat.path(tex);file='textures/'+Path(tex).stem+'-'+digest(p.read_bytes())[:10]+'.png';(output/file).parent.mkdir(parents=True,exist_ok=True)
    with Image.open(p) as image:
     rgba=image.convert('RGBA');rgba.save(output/file);row['textures'][tex]={'file':file,'width':rgba.width,'height':rgba.height,'source':cat.evidence(p)}
   templates[key]=row
 professions={}
 for id in ['RF','LK','VC','RS','BM','IS']:
  p=json.loads((ROOT/f'packages/combat-core/{id.lower()}-profile.json').read_text(encoding='utf-8'))
  raven=id in ['RF','VC','BM'];name='X2GURaven.cpp' if raven else 'X2GUElsword_SwordMan.cpp';rows={}
  names=set(s for skill in p['skillCatalog'] for s in skill.get('states',[]))|{'RSI_HYPER_MODE','ESSI_HYPER_MODE'}
  for state,data in p['states'].items():
   raw=data['raw'];cb=routes[name].get(state,state+'_FrameMove');body=bodies[name].get(cb,'')
   if any(k.startswith('STOP_OTHER_UNIT') for k in raw) or raw.get('SHOW_SKILL_CUT_IN_TIME',-1)>=0 or raw.get('CHANGE_WORLD_COLOR') or 'ShowActiveSkillCutInAndLight(' in body or 'ChangeWorldColorByHyperMode();' in body:
    names.add(state)
  for state in sorted(names):
   data=p['states'].get(state)
   if not data:continue
   raw=data['raw'];cb=routes[name].get(state,state+'_FrameMove');body=bodies[name].get(cb,'')
   light=raw.get('SHOW_SKILL_CUT_IN_TIME');times=[]
   if isinstance(light,(int,float)) and light>=0:times=[light]
   else:
    pattern=r'ShowActiveSkillCutInAndLight\(\s*'+(r'L"[^"]+"\s*,\s*' if raven else '')+r'([\d.]+)f?\s*,'
    times=sorted(set(float(m[1]) for m in re.finditer(pattern,body)))
   rows[state]={'lightTimes':times,'bone':'Dummy2_Lhand' if raven else 'Dummy1_Rhand',
    'dark':raw.get('CHANGE_WORLD_COLOR') in [True,1] or 'ChangeWorldColorByHyperMode();' in body or state in ['RSI_HYPER_MODE','ESSI_HYPER_MODE'],
    'lightEvidence':'target2016-state-field' if light is not None and light>=0 else 'fixed-V5-callback' if times else 'no-confirmed-trigger',
    'callback':cb if body else None,'source':data.get('source'),
    'stops':{k:v for k,v in raw.items() if k.startswith('STOP_OTHER_UNIT')},
    'awakening':state in ['RSI_HYPER_MODE','ESSI_HYPER_MODE']}
  professions[id]={'profileSha256':digest((ROOT/f'packages/combat-core/{id.lower()}-profile.json').read_bytes()),'states':rows}
 index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,'templates':templates,'professions':professions,'references':refs,'sourceFiles':list(cat.used.values()),
  'awakening':{'bone':'Dummy1_Rhand','changeTime':.05,'shockTime':.83},'particleConstructor':{'billboardType':'BT_ALL','reference':'KTDGParticleSystem.cpp:2698'},
  'limits':['Skill centre enabled by user request; V5 ActiveSkillShow energy block is #if 0.',
    'No complete target client playback or GPU trace; static callback routes are qualified source references.',
    'SpecialEnergyLine / HyperModeChangeLine black-hole and look-point consumers remain unsupported.',
    'Original ImpactTick UseLand plane collision is still explicitly unsupported by the particle runtime.']}
 write_json(output/'fx/index.json',index);write_json(ROOT/'contracts/cast-display-index-v1.json',index)
 files=[{'file':p.relative_to(output).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())} for p in sorted(output.rglob('*')) if p.is_file() and p.name!='manifest.json']
 write_json(output/'manifest.json',{'schemaVersion':1,'id':'cast-display','visualEffectIndexes':['fx/index.json'],'outputs':files})
 print(json.dumps({id:{'states':len(p['states']),'light':sum(bool(s['lightTimes']) for s in p['states'].values()),'dark':sum(s['dark'] for s in p['states'].values())} for id,p in professions.items()}))
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-root',default='asset_work');parser.add_argument('--reference',default=ROOT/'.cache/battle-cast-source');parser.add_argument('--output',default=ROOT/'artifacts/cast-display');a=parser.parse_args();build(a.source_root,a.reference,a.output)
