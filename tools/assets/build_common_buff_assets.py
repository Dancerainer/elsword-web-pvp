"""Export global target2016 profession buff declarations and display-only resources.

The roots are actual source-owned buffs on all frozen profession profiles.
No attack state, skill tree, damage effect or random proc is added to a victim.
Icons use source atlas rectangles; all source/copy bytes are hash verified.
"""
import argparse
import json
import sys
from pathlib import Path
from PIL import Image
from ui import read_tet,crop_piece

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
sys.path.insert(0,str(ROOT/'tools/combat'))
from build_rf import Catalog,digest,write_json
from build_lk_fx import build as build_fx
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable


DEFAULT_PROFESSIONS=('rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de')
APOCALYPSE_SOURCE_SHA='88829766340a21abb208a2edb2c81347e49e1ca38b61f7fc57e345ccea0f6eb9'

def collect_roots(source,profile_paths):
    """Read declarations independently of conversion or global output mutation."""
    source=source.resolve()
    cat=Catalog(source);enum=read_declarations(cat.path('Enum.lua'))
    prior=EnumTable(enum['globals']);declarations={}
    for key,name in [('buff','BattleFieldBuffTemplet.lua'),('factor','BattleFieldBuffFactor.lua'),
        ('factor-int','BattleFieldBuffFactor_INT.lua'),('effect','EffectSet.lua')]:
        # JSON caches stringify Lua's numeric table keys; normalize only those
        # key encodings before comparing the frozen profile's exact raw values.
        declarations[key]=json.loads(json.dumps(read_declarations(cat.path(name),prior,capture_calls=True,capture_unresolved=True)))
    target_templates={str(c['args'][-1]['BUFF_TEMPLET_ID']):{'raw':c['args'][-1],
        'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']},'source':declarations['buff']['source']}
        for c in declarations['buff']['nativeCalls'] if c['target'].endswith('AddBuffTemplet_LUA')}
    target_factors={}
    for key in ('factor','factor-int'):
        for c in declarations[key]['nativeCalls']:
            value=c['args'][-1]
            if isinstance(value,dict) and isinstance(value.get('BUFF_FACTOR_ID'),int):
                target_factors[str(value['BUFF_FACTOR_ID'])]={'raw':value['BUFF_FACTOR'],
                    'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']},'source':declarations[key]['source']}
    wanted_templates=set();wanted_factors=set();profiles=[];excluded_npc=[]
    for path in profile_paths:
        profile=json.loads(path.read_text('utf8'));wanted_templates.update(profile['buffTemplates']);wanted_factors.update(profile['buffFactors'])
        profiles.append({'profileId':profile['profileId'],'path':str(path.resolve()),
            'sha256':digest(path.read_bytes().replace(b'\r\n',b'\n')),'hashNormalization':'UTF-8 LF'})
        for key,value in profile['buffTemplates'].items():
            if value['raw']!=target_templates[key]['raw']:raise ValueError('Frozen buff template differs from original target: '+key)
        for key,value in profile['buffFactors'].items():
            if value['raw']!=target_factors[key]['raw']:raise ValueError('Frozen buff factor differs from original target: '+key)
        npc=profile.get('summonDeclarations',{}).get('apocalypse',{})
        if '443' in profile['buffFactors'] and '414' in profile['buffTemplates']:
            if npc.get('source',{}).get('sha256')!=APOCALYPSE_SOURCE_SHA or profile['buffFactors']['443']['raw']['BUFF_TEMPLET_ID']!=414 or (
                profile['buffTemplates']['414']['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET')!={'1':'EffectSet_SI_HA_AMM_Apocalypse_Always'}):
                raise ValueError('NPC-only Apocalypse buff provenance changed')
            excluded_npc.append({'factorId':443,'templateId':414,'effectSet':'EffectSet_SI_HA_AMM_Apocalypse_Always',
                'source':npc['source'],'reason':'Original NPC START self buff; its 38 independent summon bones are not recipient character display roots'})
    if excluded_npc:wanted_templates.discard('414');wanted_factors.discard('443')
    templates={key:target_templates[key] for key in sorted(wanted_templates,key=int)}
    factors={key:target_factors[key] for key in sorted(wanted_factors,key=int)}
    all_sets={c['args'][-1]['NAME']:{'raw':c['args'][-1],
        'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']},'source':declarations['effect']['source']}
        for c in declarations['effect']['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA')
        and isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')}
    display_names={name for row in templates.values() for name in row['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET',{}).values() if isinstance(name,str)}
    missing_sets=display_names-all_sets.keys()
    if missing_sets:raise ValueError('Original global buff display effect set missing: '+str(sorted(missing_sets)))
    effect_sets={name:all_sets[name] for name in sorted(display_names)}
    roots={'schemaVersion':1,'profileId':'target2016-global-buffs-v1','targetVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,
        'scope':'global buff DISPLAYER only; no profession attacks','profiles':profiles,
        'buffTemplates':templates,'buffFactors':factors,'effectSets':effect_sets,'damageEffects':{},
        'enums':{k:v for k,v in enum['globals'].items() if k.startswith('BUFF_')},
        'sourceEvidence':list(cat.used.values()),'excludedNpcOnlyDisplays':excluded_npc}
    return roots,cat

def build_icons(cat,roots,ui_output):
    """Export exact source atlas pieces for the supplied template subset."""
    ui_output.mkdir(parents=True,exist_ok=True)
    templates=roots['buffTemplates']
    icons={'schemaVersion':1,'targetVersion':roots['targetVersion'],'nativeClientMeasured':False,
        'buffIcons':{},'pieces':{},'sources':{},'scope':'global source-owned buff display identities'}
    atlases={}
    for key,row in templates.items():
        raw=row['raw'];atlas=raw.get('BUFF_ICON_TEXTURE_NAME');piece=raw.get('BUFF_ICON_TEXTURE_KEY')
        if not atlas or not piece:continue
        if atlas not in atlases:
            ap,tp=cat.path(atlas),cat.path(Path(atlas).with_suffix('.tet').name)
            with Image.open(ap) as image:rgba=image.convert('RGBA')
            atlases[atlas]=(rgba,read_tet(tp.read_bytes()),cat.evidence(ap),cat.evidence(tp))
        rgba,rects,ap,tp=atlases[atlas];keys=[k for k in rects if k.casefold()==piece.casefold()]
        if len(keys)!=1:raise ValueError('Original buff icon absent or ambiguous: '+piece)
        crop,bounds=crop_piece(rgba,rects[keys[0]]);file='icons/'+piece.lower()+'.png'
        (ui_output/file).parent.mkdir(parents=True,exist_ok=True);crop.save(ui_output/file)
        record={'file':file,'width':crop.width,'height':crop.height,'atlas':atlas,'piece':keys[0],
            'bounds':bounds,'rgbaSha256':digest(crop.tobytes()),'sha256':digest((ui_output/file).read_bytes()),
            'atlasSource':ap,'tetSource':tp}
        icons['buffIcons'][key]=record;icons['pieces']['buff:'+piece]=record
    write_json(ui_output/'manifest.json',icons)
    return icons

def build(source,output,ui_output,profile_paths,contracts_root=None,report_path=None):
    source,output,ui_output=[p.resolve() for p in (source,output,ui_output)]
    contracts_root=(contracts_root or ROOT/'contracts').resolve()
    report_path=(report_path or ROOT/'reports/common-buff-assets.json').resolve()
    if any(p.is_relative_to(source) for p in (output,ui_output,contracts_root,report_path)):
        raise ValueError('Output overlaps read-only target inputs')
    roots,cat=collect_roots(source,profile_paths)
    write_json(contracts_root/'common-buff-display-roots.json',roots)
    output.mkdir(parents=True,exist_ok=True)
    icons=build_icons(cat,roots,ui_output)
    fx=build_fx(output/'fx',contracts_root/'common-buff-display-roots.json',source,
        contracts_root/'common-buff-display-fx-index.json',('GameMinorParticle.txt',))
    roots.update(effectTemplates=fx['templates'])
    write_json(output/'catalog.json',roots)
    write_json(contracts_root/'common-buff-catalog.json',roots)
    inventory=[{'file':p.relative_to(output).as_posix(),'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size}
        for p in sorted(output.rglob('*')) if p.is_file() and p!=output/'manifest.json'
        and not p.name.endswith('.animation.json')]
    write_json(output/'manifest.json',{'schemaVersion':1,'id':'common-buffs','visualEffectIndexes':['fx/index.json'],
        'definitionCatalog':'catalog.json','uiManifest':'../ui/buffs/manifest.json','scope':roots['scope'],'outputs':inventory})
    report={'schemaVersion':1,'clientMeasured':False,'output':str(output),'uiOutput':str(ui_output),
        'scope':roots['scope'],'profiles':roots['profiles'],'sourceEvidence':list(cat.used.values()),
        'summary':{'buffTemplates':len(roots['buffTemplates']),'buffFactors':len(roots['buffFactors']),'effectSets':len(roots['effectSets']),
            'effectTemplates':len(fx['templates']),'icons':len(icons['buffIcons']),'uniqueIconPieces':len(icons['pieces']),
            'meshFailures':len(fx['meshFailures']),'missingTemplates':len(fx['missingTemplates'])},
        'unsupportedDisplayEntries':[{'effectSet':name,'property':key,'raw':v,'reason':'offensive damage route is not a buff display resource'}
            for name,row in roots['effectSets'].items() for key,v in row['raw'].items() if isinstance(v,dict) and v.get('EFFECT_TYPE')==1],
        'outputs':inventory,'limits':['No buff is created or applied by this resource catalog.',
            'Buff sourceActorId/profession and victim bone/sampler routing require the executor to use the frozen source profile.',
            'Unknown native display/clock/render fields remain unsupported; original client/GPU traces unavailable.']}
    write_json(report_path,report);print(json.dumps(report['summary']))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/common-buffs');p.add_argument('--ui-output',type=Path,default=ROOT/'artifacts/ui/buffs')
    p.add_argument('--contracts-root',type=Path);p.add_argument('--report',type=Path)
    p.add_argument('--profile',type=Path,action='append');a=p.parse_args()
    build(a.source_root,a.output,a.ui_output,a.profile or [ROOT/f'packages/combat-core/{name}-profile.json' for name in DEFAULT_PROFESSIONS],a.contracts_root,a.report)
