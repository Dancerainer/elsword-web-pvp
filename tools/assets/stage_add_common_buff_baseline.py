"""Audit a read-only common-buff union and stage an additive reconciliation.

prepare never writes to either baseline or target. apply verifies the complete
prepared receipt and all prior destination hashes before copying any file.
"""
import argparse,copy,json,os,shutil,sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_add_common_buff_increment as inc

GROUPS=('buffTemplates','buffFactors','effectSets','effectTemplates')
CONTRACTS=('common-buff-catalog.json','common-buff-display-roots.json','common-buff-display-fx-index.json')
METADATA={'artifacts/common-buffs/catalog.json','artifacts/common-buffs/fx/index.json',
    'artifacts/common-buffs/manifest.json','artifacts/ui/buffs/manifest.json',*('contracts/'+name for name in CONTRACTS)}

def record(path,relative):
    data=path.read_bytes();return {'file':relative,'sha256':inc.digest(data),'bytes':len(data)}

def check_inventory(root,manifest):
    for row in manifest['outputs']:
        path=inc.contained_path(root,row['file'])
        actual=record(path,row['file'])
        if any(actual[key]!=row[key] for key in ('sha256','bytes')):raise ValueError('Baseline inventory mismatch: '+str(path))

def check_ui(root,manifest):
    from PIL import Image
    files={}
    for row in [*manifest['buffIcons'].values(),*manifest['pieces'].values()]:
        path=inc.contained_path(root,row['file']);actual=record(path,row['file'])
        if actual['sha256']!=row['sha256']:raise ValueError('Baseline UI PNG mismatch: '+str(path))
        with Image.open(path) as image:
            if inc.digest(image.convert('RGBA').tobytes())!=row['rgbaSha256']:raise ValueError('Baseline UI pixels mismatch: '+str(path))
        files[row['file']]=actual
    return files

def verify_paths(root,indexes):
    names=set();paths=set()
    for index in indexes:
        if names&index['templates'].keys():raise ValueError('Duplicate runtime visual template')
        names.update(index['templates'])
        for template in index['templates'].values():
            for key in ('glb','poseData'):
                if template.get(key):paths.add(template[key])
            paths.update(row['file'] for row in template.get('textures',{}).values())
    for file in paths:
        if not inc.contained_path(root,file).is_file():raise ValueError('Missing runtime visual resource '+file)
    return {'templates':len(names),'distinctResourcePaths':len(paths)}

def frozen_baseline_templates(frozen,baseline,delta):
    """Accept contracts merged before resources, verifying both namespaces."""
    added=delta['effectTemplates'];kept={name:row for name,row in baseline.items() if name not in added}
    declared={name:row for name,row in frozen.items() if name not in added}
    if kept!=declared:raise ValueError('Frozen baseline visual metadata differs')
    for name in frozen.keys()&added.keys():
        if frozen[name]!=added[name]:raise ValueError('Frozen Add visual metadata differs: '+name)
    return kept

def prepare(baseline,target,increment,output):
    baseline,target,increment,output=[path.resolve() for path in (baseline,target,increment,output)]
    if any(output.is_relative_to(path) or path.is_relative_to(output) for path in (baseline,target,increment)):
        raise ValueError('Stage must be independent of all read-only inputs')
    if output.exists() and any(output.iterdir()):raise ValueError('Use an empty private staging directory')
    old=inc.read(target/'contracts/common-buff-catalog.json');base=inc.read(baseline/'artifacts/common-buffs/catalog.json')
    delta=inc.read(increment/'delta-catalog.json');expected=inc.merge_catalog(old,delta)
    base_index=inc.read(baseline/'artifacts/common-buffs/fx/index.json')
    frozen_index=inc.read(target/'contracts/common-buff-display-fx-index.json')
    for group in GROUPS:
        inc.merge_entries(old[group],base[group],group);inc.merge_entries(base[group],delta[group],group)
        if not set(old[group])<=(set(base[group])|set(delta[group])):raise ValueError('Baseline/increment lacks frozen declarations: '+group)
        if not set(base[group])<=set(expected[group]):raise ValueError('Unreviewed baseline declaration: '+group)
    if set(base_index['templates'])!=set(expected['effectTemplates']):raise ValueError('Baseline visual declaration union differs')
    if base_index.get('meshFailures') or base_index.get('missingTemplates'):raise ValueError('Baseline contains conversion failures')
    # A metadata filter is safe only when the retained 123 full records are
    # byte-for-byte JSON-equivalent to the frozen nine-profession contract.
    kept=frozen_baseline_templates(frozen_index['templates'],base_index['templates'],delta)
    inventories=[];ui_sources=[]
    for source in (target,baseline):
        manifest=inc.read(source/'artifacts/common-buffs/manifest.json');check_inventory(source/'artifacts/common-buffs',manifest)
        ui=inc.read(source/'artifacts/ui/buffs/manifest.json');ui_sources.append((source,ui,check_ui(source/'artifacts/ui/buffs',ui)))
        inventories.append((source,manifest))
    merged_ui=inc.merge_icons(ui_sources[0][1],ui_sources[1][1])
    stage=output/'stage';stage.mkdir(parents=True)
    copied={}
    def add_file(source,relative):
        data=source.read_bytes();signature=inc.digest(data)
        if relative in copied:
            if copied[relative]!=signature and relative not in METADATA:raise ValueError('Read-only unions disagree on resource bytes: '+relative)
            if copied[relative]==signature:return
        destination=inc.contained_path(stage,relative);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(data);copied[relative]=signature
    for source,manifest in inventories:
        for row in manifest['outputs']:add_file(source/'artifacts/common-buffs'/row['file'],'artifacts/common-buffs/'+row['file'])
    for source,ui,files in ui_sources:
        for file in files:add_file(source/'artifacts/ui/buffs'/file,'artifacts/ui/buffs/'+file)
    for name in CONTRACTS:add_file(target/'contracts'/name,'contracts/'+name)
    # Runtime b11e already has the 31 Add template names. Publish its old
    # nine-profession part as the baseline so mergeVisualEffectIndexes never
    # sees two different path/provenance records for the same Add name.
    filtered={**base_index,'templates':kept}
    inc.write_json(stage/'artifacts/common-buffs/fx/index.json',filtered)
    inc.write_json(stage/'artifacts/common-buffs/catalog.json',old)
    inc.write_json(stage/'artifacts/ui/buffs/manifest.json',merged_ui)
    manifest=copy.deepcopy(inventories[1][1]);manifest['visualEffectIndexes']=['fx/index.json']
    manifest['outputs']=[record(path,path.relative_to(stage/'artifacts/common-buffs').as_posix())
        for path in sorted((stage/'artifacts/common-buffs').rglob('*')) if path.is_file()]
    inc.write_json(stage/'artifacts/common-buffs/manifest.json',manifest)
    inc.merge(increment,stage)
    common=stage/'artifacts/common-buffs';manifest=inc.read(common/'manifest.json')
    check_inventory(common,manifest)
    visual=verify_paths(common,[inc.read(common/file) for file in manifest['visualEffectIndexes']])
    catalog=inc.read(common/'catalog.json')
    if catalog!=inc.read(stage/'contracts/common-buff-catalog.json'):raise ValueError('Runtime/Git catalog diverged after stage')
    if [len(catalog[group]) for group in GROUPS]!=[107,120,68,154]:raise ValueError('Unexpected final union counts')
    check_ui(stage/'artifacts/ui/buffs',inc.read(stage/'artifacts/ui/buffs/manifest.json'))
    rows=[]
    for path in sorted(stage.rglob('*')):
        if not path.is_file():continue
        relative=path.relative_to(stage).as_posix();row=record(path,relative);previous=inc.contained_path(target,relative)
        row['previousSha256']=inc.digest(previous.read_bytes()) if previous.exists() else None
        rows.append(row)
    report={'schemaVersion':1,'readOnlyInputs':[str(baseline),str(increment)],'destination':str(target),
        'baselineCatalogCounts':{group:len(base[group]) for group in GROUPS},
        'missingFromBaseline':{group:sorted(set(delta[group])-set(base[group])) for group in GROUPS},
        'finalCounts':{group:len(catalog[group]) for group in GROUPS},'visual':visual,
        'filteredDuplicateAddTemplates':sorted(set(base_index['templates'])-set(kept)),
        'baselineManifest':record(baseline/'artifacts/common-buffs/manifest.json','common-buffs/manifest.json'),
        'baselineUiManifest':record(baseline/'artifacts/ui/buffs/manifest.json','ui/buffs/manifest.json'),
        'incrementReceiptSha256':inc.digest((increment/'receipt.json').read_bytes()),
        'preservedLegacyInventoryFiles':sorted(set(row['file'] for row in inventories[0][1]['outputs'])-set(row['file'] for row in inventories[1][1]['outputs'])),
        'outputs':rows,'limits':['No target or source files modified during prepare.','Existing target files absent from this plan remain untouched.',
            'Formation helper-only slash trace remains an unimplemented consumer; source pose/texture retained.']}
    inc.write_json(output/'copy-receipt.json',report)
    print(json.dumps({'stage':str(stage),'counts':report['finalCounts'],'files':len(rows),'bytes':sum(row['bytes'] for row in rows),'visual':visual}));return report

def apply(prepared,destination):
    prepared,destination=prepared.resolve(),destination.resolve();report=inc.read(prepared/'copy-receipt.json');stage=prepared/'stage'
    if str(destination)!=report['destination']:raise ValueError('Receipt belongs to a different destination')
    if any(destination.is_relative_to(Path(path)) for path in report['readOnlyInputs']):raise ValueError('Refusing to overwrite read-only source')
    plan=[]
    for row in report['outputs']:
        file=row['file']
        if not (file.startswith('artifacts/common-buffs/') or file.startswith('artifacts/ui/buffs/') or file in {'contracts/'+name for name in CONTRACTS}):
            raise ValueError('Copy plan outside buff namespaces')
        source=inc.contained_path(stage,file);target=inc.contained_path(destination,file);actual=record(source,file)
        if any(actual[key]!=row[key] for key in ('sha256','bytes')):raise ValueError('Prepared resource changed: '+file)
        before=inc.digest(target.read_bytes()) if target.exists() else None
        if before not in (row['previousSha256'],row['sha256']):raise ValueError('Destination changed since audit: '+file)
        if before!=row['sha256']:
            temporary=target.with_name(target.name+'.add-buff-stage-tmp')
            if temporary.exists():raise ValueError('Staging temporary already exists: '+str(temporary))
            plan.append((source,target,temporary))
    # All checks above complete before creating destination directories/files.
    for source,target,temporary in plan:
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary.write_bytes(source.read_bytes());os.replace(temporary,target)
    print(json.dumps({'copied':len(plan),'verified':len(report['outputs'])}));return len(plan)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='mode',required=True)
    p=sub.add_parser('prepare')
    for name in ('baseline-root','target-root','increment','output'):p.add_argument('--'+name,type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('--prepared',type=Path,required=True);p.add_argument('--destination-root',type=Path,required=True)
    args=parser.parse_args()
    if args.mode=='prepare':prepare(args.baseline_root,args.target_root,args.increment,args.output)
    else:apply(args.prepared,args.destination_root)
