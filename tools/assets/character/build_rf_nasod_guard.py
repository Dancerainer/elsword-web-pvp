"""Verify target guard declarations and extract their original particle/audio closure."""
from pathlib import Path
import argparse,json,sys
from build_rf import Catalog,digest,write_json
from build_rf_fx import build as build_fx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from audio import inspect_ogg
ROOT=Path(__file__).resolve().parents[3]
TARGET=ROOT/'contracts/rf-nasod-target-v11.json'
ROOTS=ROOT/'contracts/rf-core-shield-roots-v11.json'
INDEX=ROOT/'contracts/rf-core-shield-fx-index-v11.json'
PIN={'raven':'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3',
     'effect':'6c6a0fd7759921c070a8d04fa26ddd1a6432c307e185d9a4d5188919099b16c7',
     'enum':'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6'}

def declarations(cache):
    data={}
    for name,expected in PIN.items():
        row=json.loads((cache/(name+'-declarations.json')).read_bytes())
        if row['source']['sha256']!=expected or digest(Path(row['source']['path']).read_bytes())!=expected:
            raise ValueError('Target declaration hash drift: '+name)
        data[name]=row
    raven,effect=data['raven'],data['effect']
    candidates=[call for call in effect['nativeCalls'] if call['target']=='g_pEffectSet.AddEffectSetTemplet_LUA'
        and isinstance(call['args'][-1],dict) and call['args'][-1].get('NAME')=='EffectSet_RAVEN_PARRING']
    if len(candidates)!=1:raise ValueError('Ambiguous original shield effect set')
    call=candidates[0];raw=call['args'][-1]
    if raw!={'NAME':'EffectSet_RAVEN_PARRING','EFFECT0':{'NAME':'raven_bead_shield_01','EFFECT_TYPE':8,'TRACE':1},
              'EFFECT1':{'NAME':'raven_bead_shield_02','EFFECT_TYPE':8,'TRACE':1}}:raise ValueError('Original shield set changed')
    small=raven['globals']['RSI_PARRYING_SMALL']
    if small['ANIM_NAME']!='GuardBigFront' or small['ANIM_SPEED']!=1.2:raise ValueError('Original small parry declaration changed')
    result={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','targetClientMeasured':False,
        'declarationSources':[raven['source'],effect['source'],data['enum']['source']],
        'blockedExtraTypes':{name:data['enum']['globals']['EXTRA_DAMAGE_TYPE'][name] for name in
            ('EDT_MANA_DAMAGE','EDT_DAMAGE_RATE','EDT_WATER_HOLD','EDT_ATTACK_ALL_TEAM')},
        'smallState':{'raw':small,'sourceAssignment':raven['locations']['RSI_PARRYING_SMALL']},
        'effectSet':{'raw':raw,'sourceCall':{k:call[k] for k in ['prototype','instruction','target']}}}
    write_json(TARGET,result)
    roots={'effectSets':{'EffectSet_RAVEN_PARRING':result['effectSet']},'damageEffects':{},
        'declarationSources':result['declarationSources'],'sounds':['Raven_NasodCore_Guard.ogg','Raven_NasodCore_Trans_Parry.ogg']}
    write_json(ROOTS,roots)
    return result

def build(cache,source_root,output):
    output=output.resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(source_root.resolve()):raise ValueError('Unsafe resource output')
    target=declarations(cache)
    index=build_fx(output/'fx',ROOTS,source_root,INDEX)
    if index['missingTemplates'] or index['meshFailures']:raise ValueError('Incomplete original shield closure')
    names={'raven_bead_shield_01','raven_bead_shield_02'}
    if not names.issubset(index['templates']):raise ValueError('Missing original shield closure')
    # General RF extraction also includes common impact defaults. They belong
    # to the existing base index, not this independently mergeable closure.
    index['templates']={name:index['templates'][name] for name in sorted(names)}
    unsupported={name:row['unsupported'] for name,row in index['templates'].items() if row['unsupported']}
    if unsupported:raise ValueError('Unsupported original shield declaration: '+str(unsupported))
    # The browser merges independent indexes; the URL must identify this closure.
    for row in index['templates'].values():
        for texture in row.get('textures',{}).values():
            texture['file']=texture['file'].replace('fx/','core-shield-fx/',1)
    write_json(INDEX,index);write_json(output/'fx/index.json',index)
    catalog=Catalog(source_root);audio={}
    for name in ('Raven_NasodCore_Guard.ogg','Raven_NasodCore_Trans_Parry.ogg'):
        source=catalog.path(name);raw=source.read_bytes();dest=output/'audio'/name
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
        audio[name]={'file':name,'sha256':digest(raw),'bytes':len(raw),'source':catalog.evidence(source),**inspect_ogg(raw)}
    write_json(output/'audio/manifest.json',{'schemaVersion':1,'files':audio,'clientMeasured':False,'unsupported':[]})
    write_json(ROOT/'reports/rf-core-shield-assets-v11.json',{'schemaVersion':1,'targetClientMeasured':False,
        'targetContractSha256':digest(TARGET.read_bytes()),'resourceIndexSha256':digest(INDEX.read_bytes()),
        'sourceFiles':index['sourceFiles'],'audio':audio,
        'inventory':[{'path':p.relative_to(ROOT).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())}
                     for p in sorted(output.rglob('*')) if p.is_file()]})
    print(json.dumps({'templates':len(index['templates']),'audio':len(audio),'output':str(output)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=ROOT/'.cache/shield-declarations')
    p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/rf-core-shield-v11')
    a=p.parse_args();build(a.cache,a.source_root,a.output)
