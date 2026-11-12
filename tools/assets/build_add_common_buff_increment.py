"""Build/merge an additive, hash-verified Add buff display resource increment.

The build reads original data and a frozen nine-career baseline. It emits only
new templates/files into the caller's private output. Merge validates every
entry before preserving and extending the destination's current union.
"""
from __future__ import annotations
import argparse,copy,json,shutil,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets'),str(ROOT/'tools/assets/character')]
from PIL import Image
from build_common_buff_assets import collect_roots,build_icons
from build_rf import Catalog,digest,json_bytes,write_json
from build_rf_fx import read_definitions,select_templates

def read(path):return json.loads(Path(path).read_text('utf8'))
def normalized_hash(path):return digest(Path(path).read_bytes().replace(b'\r\n',b'\n'))
def declaration(row):return row.get('raw',{k:row.get(k) for k in ('kind','fields','events','repeated')})
def merge_entries(base,extra,label):
    result=copy.deepcopy(base)
    for key,row in extra.items():
        if key in result:
            if declaration(result[key])!=declaration(row):raise ValueError('Conflicting original '+label+': '+key)
        else:result[key]=copy.deepcopy(row)
    return result

def merge_catalog(base,extra):
    if base['schemaVersion']!=extra['schemaVersion'] or base['targetVersion']!=extra['targetVersion']:
        raise ValueError('Common buff target/schema mismatch')
    if extra.get('states') or extra.get('skillCatalog') or extra.get('damageEffects'):
        raise ValueError('A common buff display increment cannot add offensive state/skill/damage definitions')
    result=copy.deepcopy(base)
    for group in ('buffTemplates','buffFactors','effectSets','effectTemplates'):
        result[group]=merge_entries(base.get(group,{}),extra.get(group,{}),group)
    allowed={n for row in result['buffTemplates'].values() for n in row['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET',{}).values()}
    if set(result['effectSets'])-allowed:raise ValueError('EffectSet outside the combined buff DISPLAYER closure')
    for group,identity in [('profiles','profileId'),('sourceEvidence','sha256'),('excludedNpcOnlyDisplays','templateId')]:
        entries={str(row[identity]):copy.deepcopy(row) for row in result.get(group,[])}
        for row in extra.get(group,[]):entries[str(row[identity])]=copy.deepcopy(row)
        result[group]=list(entries.values())
    return result

def merge_icons(base,extra):
    if base['schemaVersion']!=extra['schemaVersion'] or base['targetVersion']!=extra['targetVersion']:
        raise ValueError('Buff UI target/schema mismatch')
    result=copy.deepcopy(base)
    for group in ('buffIcons','pieces'):
        result.setdefault(group,{})
        for key,row in extra[group].items():
            old=result[group].get(key)
            if old and (old.get('rgbaSha256')!=row.get('rgbaSha256') or old.get('bounds')!=row.get('bounds')):
                raise ValueError('Conflicting original buff atlas piece: '+key)
            if not old:result[group][key]=copy.deepcopy(row)
    return result

def safe_relative(name):
    path=Path(name)
    if path.is_absolute() or ':' in name or '\\' in name or any(p in ('','..','.') for p in name.split('/')):
        raise ValueError('Unsafe increment path: '+name)
    return path

def contained_path(root,relative):
    path=root/safe_relative(relative)
    if not path.resolve().is_relative_to(root.resolve()):raise ValueError('Output path escapes destination: '+relative)
    return path

def converted_inventory(asset_roots):
    records={}
    for root in asset_roots:
        for path in sorted(root.rglob('index.json')):
            for name,row in read(path).get('templates',{}).items():
                signature=row.get('declarationSha256')
                if signature:records.setdefault((name,signature),(row,path,path.parent.parent,root.resolve()))
    return records

def build(source,profiles,baseline_contracts,baseline_assets,output,reuse_roots):
    source,output=source.resolve(),output.resolve()
    if output.is_relative_to(source) or any(output.is_relative_to(p.resolve()) for p in reuse_roots):
        raise ValueError('Increment output must be independent of all source/reuse inputs')
    if output.exists() and any(output.iterdir()):raise ValueError('Use a fresh private increment directory')
    output.mkdir(parents=True,exist_ok=True)
    base=read(baseline_contracts/'common-buff-catalog.json')
    base_index=read(baseline_contracts/'common-buff-display-fx-index.json')
    base_ui=read(baseline_assets/'ui/buffs/manifest.json')
    # Freeze profile inputs before source parsing; another task may continue
    # working on its own tree while this build converts resources.
    frozen=[];receipts=[]
    for path in profiles:
        target=output/'inputs'/path.name;target.parent.mkdir(exist_ok=True);target.write_bytes(path.read_bytes());frozen.append(target)
        receipts.append({'path':str(path.resolve()),'sha256':normalized_hash(target),'normalization':'UTF-8 LF'})
    roots,cat=collect_roots(source,frozen)
    for row,original in zip(roots['profiles'],profiles):row['path']=str(original.resolve())
    delta={k:copy.deepcopy(v) for k,v in roots.items() if k not in ('buffTemplates','buffFactors','effectSets','effectTemplates')}
    for group in ('buffTemplates','buffFactors','effectSets'):
        merge_entries(base[group],roots[group],group)
        delta[group]={k:v for k,v in roots[group].items() if k not in base[group]}
    definitions=read_definitions(cat,('GameMinorParticle.txt',))
    selected,missing=select_templates(definitions,{'effectSets':delta['effectSets'],'damageEffects':{}})
    if missing:raise ValueError('Original buff display declarations missing: '+str(missing))
    for key in set(selected)&base_index['templates'].keys():
        if selected[key]['declarationSha256']!=base_index['templates'][key]['declarationSha256']:
            raise ValueError('Baseline declaration hash differs: '+key)
    selected={k:v for k,v in selected.items() if k not in base_index['templates']}
    existing=converted_inventory(reuse_roots);copies=[]
    def copy_resource(path,source_record=None):
        raw=path.read_bytes();hash_=digest(raw);name='add-fx/files/'+hash_[:16]+'-'+path.name
        target=output/'common-buffs'/safe_relative(name);target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists() and target.read_bytes()!=raw:raise ValueError('Resource hash/name collision')
        target.write_bytes(raw);copies.append({'source':str(path),'file':name,'sha256':hash_,'bytes':len(raw),
            **({'sourceRecord':source_record} if source_record else {})});return name
    templates={}
    for name,record in selected.items():
        found=existing.get((name,record['declarationSha256']))
        if found:
            original,index_path,asset_base,allowed=found
            if declaration(original)!=declaration(record):raise ValueError('Converted raw declaration differs: '+name)
            result=copy.deepcopy(original)
            def rebase(file):
                path=(asset_base/file).resolve()
                if not path.is_relative_to(allowed):raise ValueError('Reused asset escapes declared read-only asset root')
                return copy_resource(path)
            for key in ('glb','poseData'):
                if result.get(key):result[key]=rebase(result[key])
            for texture in result.get('textures',{}).values():texture['file']=rebase(texture['file'])
            result['globalBuffReuse']={'index':str(index_path),'declarationSha256':record['declarationSha256']}
        else:
            result=copy.deepcopy(record);result['textures']={}
            if result['kind']=='mesh' or result['fields'].get('Mesh'):raise ValueError('Missing verified mesh conversion: '+name)
        # A verified earlier mesh conversion can still omit a field-owned
        # texture, e.g. the helper-only AN_Formation_TRACE slash trail. Keep
        # that authored resource even when its consumer is not implemented.
        texture_names={e['value'] for e in result['events'] if 'texture' in e['property'].lower() and isinstance(e['value'],str)}
        texture_names.update(value for key,value in result['fields'].items() if 'texture' in key.lower() and isinstance(value,str))
        for texture in sorted(texture_names-result.get('textures',{}).keys()):
            path=cat.path(texture);raw=path.read_bytes();relative='add-fx/files/'+digest(raw)[:16]+'-'+path.stem+'.png'
            target=output/'common-buffs'/relative;target.parent.mkdir(parents=True,exist_ok=True)
            with Image.open(path) as image:rgba=image.convert('RGBA');rgba.save(target)
            result.setdefault('textures',{})[texture]={'file':relative,'width':rgba.width,'height':rgba.height,'source':cat.evidence(path)}
        templates[name]=result
    fx={'schemaVersion':1,'referenceVersion':base_index['referenceVersion'],'clientMeasured':False,'templates':templates,
        'sourceFiles':list(cat.used.values()),'meshFailures':[],'missingTemplates':[],
        'scope':'Additional original Add recipient buff display templates; NPC-owned Always excluded'}
    delta['effectTemplates']=templates;delta['sourceEvidence']=list(cat.used.values())
    write_json(output/'common-buffs/add-fx/index.json',fx)
    write_json(output/'delta-catalog.json',delta)
    icons=build_icons(cat,{**roots,'buffTemplates':delta['buffTemplates']},output/'ui/buffs')
    combined=merge_catalog(base,delta);combined_ui=merge_icons(base_ui,icons)
    # Reviewable merged previews are never installed over a live union by build.
    write_json(output/'preview/common-buff-catalog.json',combined)
    write_json(output/'preview/buff-ui-manifest.json',combined_ui)
    report={'schemaVersion':1,'targetClientMeasured':False,'baseline':{
        'catalogSha256':normalized_hash(baseline_contracts/'common-buff-catalog.json'),
        'fxIndexSha256':normalized_hash(baseline_contracts/'common-buff-display-fx-index.json'),
        'uiManifestSha256':normalized_hash(baseline_assets/'ui/buffs/manifest.json')},'profiles':receipts,
        'summary':{group:len(delta[group]) for group in ('buffTemplates','buffFactors','effectSets','effectTemplates')},
        'iconTemplates':len(icons['buffIcons']),'iconPieces':len(icons['pieces']),
        'excludedNpcOnlyDisplays':roots['excludedNpcOnlyDisplays'],'reusedResources':copies,
        'sourceEvidence':list(cat.used.values()),'outputs':[]}
    for base_dir in ('common-buffs','ui/buffs'):
        for path in sorted((output/base_dir).rglob('*')):
            if path.is_file():report['outputs'].append({'file':path.relative_to(output).as_posix(),'bytes':path.stat().st_size,'sha256':digest(path.read_bytes())})
    report['deltaCatalogSha256']=digest((output/'delta-catalog.json').read_bytes())
    write_json(output/'receipt.json',report);print(json.dumps(report['summary']),flush=True);return report

def merge(increment,destination):
    increment,destination=increment.resolve(),destination.resolve();receipt=read(increment/'receipt.json')
    if digest((increment/'delta-catalog.json').read_bytes())!=receipt['deltaCatalogSha256']:raise ValueError('Delta catalog SHA mismatch')
    files=[]
    for entry in receipt['outputs']:
        relative=safe_relative(entry['file']);source=increment/relative
        if not source.resolve().is_relative_to(increment) or digest(source.read_bytes())!=entry['sha256'] or source.stat().st_size!=entry['bytes']:
            raise ValueError('Increment resource SHA/size mismatch: '+entry['file'])
        if not (entry['file'].startswith('common-buffs/add-fx/') or entry['file'].startswith('ui/buffs/')):
            raise ValueError('Resource outside authorized increment namespaces')
        target=contained_path(destination,'artifacts/'+relative.as_posix())
        if relative.as_posix()=='ui/buffs/manifest.json':continue
        if target.exists() and digest(target.read_bytes())!=entry['sha256']:raise ValueError('Refusing to replace existing different resource: '+str(target))
        files.append((source,target))
    delta=read(increment/'delta-catalog.json');fx=read(increment/'common-buffs/add-fx/index.json')
    if delta['effectTemplates']!=fx['templates']:raise ValueError('Delta/index display definitions differ')
    # Validate and stage every merge before the first write. Destination may
    # contain newer non-Add entries; they remain untouched and fully present.
    staged={}
    for relative in ('contracts/common-buff-catalog.json','artifacts/common-buffs/catalog.json'):
        staged[relative]=merge_catalog(read(destination/relative),delta)
    roots=read(destination/'contracts/common-buff-display-roots.json');has_templates='effectTemplates' in roots
    merged_roots=merge_catalog({**roots,'effectTemplates':roots.get('effectTemplates',{})},delta)
    if not has_templates:merged_roots.pop('effectTemplates',None)
    staged['contracts/common-buff-display-roots.json']=merged_roots
    old_index=read(destination/'contracts/common-buff-display-fx-index.json')
    if old_index['referenceVersion']!=fx['referenceVersion']:raise ValueError('Global visual index target mismatch')
    source_files={row['sha256']:row for row in old_index.get('sourceFiles',[])}
    source_files.update({row['sha256']:row for row in fx.get('sourceFiles',[])})
    staged['contracts/common-buff-display-fx-index.json']={**old_index,'templates':merge_entries(old_index['templates'],fx['templates'],'FX'),
        'sourceFiles':list(source_files.values())}
    staged['artifacts/ui/buffs/manifest.json']=merge_icons(read(destination/'artifacts/ui/buffs/manifest.json'),read(increment/'ui/buffs/manifest.json'))
    manifest=read(destination/'artifacts/common-buffs/manifest.json')
    manifest['visualEffectIndexes']=list(dict.fromkeys([*manifest['visualEffectIndexes'],'add-fx/index.json']))
    output_rows={r['file']:r for r in manifest['outputs']}
    for entry in receipt['outputs']:
        if entry['file'].startswith('common-buffs/'):
            row={**entry,'file':entry['file'][len('common-buffs/'): ]};output_rows[row['file']]=row
    # catalog.json changes because of the merged definitions; retain every
    # previous inventory entry and update only that changed digest.
    catalog_bytes=json_bytes(staged['artifacts/common-buffs/catalog.json'])
    output_rows['catalog.json']={'file':'catalog.json','sha256':digest(catalog_bytes),'bytes':len(catalog_bytes)}
    manifest['outputs']=list(output_rows.values());staged['artifacts/common-buffs/manifest.json']=manifest
    for relative in staged:contained_path(destination,relative)
    for source,target in files:target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    for relative,value in staged.items():write_json(destination/relative,value)
    return {'files':len(files),'mergedMetadata':list(staged)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='mode',required=True)
    b=sub.add_parser('build');b.add_argument('--source-root',type=Path,default=Path('asset_work'))
    b.add_argument('--profile',type=Path,action='append',required=True);b.add_argument('--baseline-contracts',type=Path,required=True)
    b.add_argument('--baseline-assets',type=Path,required=True);b.add_argument('--output',type=Path,required=True)
    b.add_argument('--reuse-assets',type=Path,action='append',required=True)
    m=sub.add_parser('merge');m.add_argument('--increment',type=Path,required=True);m.add_argument('--destination-root',type=Path,required=True)
    a=p.parse_args()
    if a.mode=='build':build(a.source_root,a.profile,a.baseline_contracts,a.baseline_assets,a.output,a.reuse_assets)
    else:print(json.dumps(merge(a.increment,a.destination_root)))
