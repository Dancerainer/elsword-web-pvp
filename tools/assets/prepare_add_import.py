"""Prepare a hash-checked Add runtime import; this command never writes its target.

The emitted apply.py verifies every source and prior target before any copy.
Shared metadata is extended by source identity, never replaced by the old
six-profession snapshot shipped alongside the Add handoff.
"""
import argparse
import copy
import hashlib
import json
import posixpath
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'tools/assets/character'), str(ROOT/'tools/assets')]
from build_rf import Catalog
from build_rf_fx import read_definitions
from ui import read_tet, crop_piece
from localize_common_buff_assets import localize
from PIL import Image

def read(p): return json.loads(p.read_text('utf8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8', newline='\n')
def receipt(p): return {'sha256': sha(p), 'bytes': p.stat().st_size}
def strings(v):
    if isinstance(v,str): yield v
    elif isinstance(v,dict):
        for x in v.values(): yield from strings(x)
    elif isinstance(v,list):
        for x in v: yield from strings(x)
def rebase(template, prefix):
    result=copy.deepcopy(template)
    for key in ('glb','poseData'):
        if result.get(key): result[key]=posixpath.normpath(prefix+'/'+result[key])
    for row in result.get('textures',{}).values():row['file']=posixpath.normpath(prefix+'/'+row['file'])
    return result
def union_evidence(old,new):
    result=copy.deepcopy(old)
    for row in new:
        if not any(x.get('sha256')==row.get('sha256') and x.get('rawPath',x.get('path'))==row.get('rawPath',row.get('path')) for x in result):result.append(copy.deepcopy(row))
    return result

def prepare(source,target,repo,output):
    source,target,repo,output=[p.resolve() for p in (source,target,repo,output)]
    if output.is_relative_to(target) or output.is_relative_to(source):raise ValueError('Staging must be independent')
    stage=output/'metadata';operations={};inputs={};notes=[];unions={}
    def pin(path): inputs[str(path.resolve())]=receipt(path)
    def load(path):pin(path);return read(path)
    def add(name,path,kind='source-copy'):
        if Path(name).is_absolute() or '..' in Path(name).parts:raise ValueError('Unsafe target path')
        prior=target/name
        operations[name]={'file':name,'source':str(path.resolve()),'kind':kind,**receipt(path),
            'prior':receipt(prior) if prior.is_file() else None}
    def emit(name,value):
        path=stage/name;write(path,value);add(name,path,'metadata-union')
    for name in ('add-assets-handoff-v1.json','mm-apocalypse-assets-handoff-v1.json'):
        report=load(repo/'reports'/name)
        for row in report['files']:
            path=source/row['file']
            if receipt(path)!={k:row[k] for k in ('sha256','bytes')}:raise ValueError('Source handoff differs: '+row['file'])
            if row['file'] in operations:raise ValueError('Duplicate handoff path')
            if (target/row['file']).is_file() and receipt(target/row['file'])!=receipt(path):raise ValueError('Unreviewed binary collision: '+row['file'])
            add(row['file'],path)
    base_operations=copy.deepcopy(operations)
    # Keep already-known external dependencies pinned, including exact case.
    dependency_count=0
    for job in ('lp','mm','de'):
        report=load(repo/f'reports/{job}-assets-runtime.json')
        for row in report.get('dependencies',[]):
            name=posixpath.normpath(job+'/'+row['file']);path=source/name
            if sha(path)!=row['sha256'] or 'bytes' in row and path.stat().st_size!=row['bytes']:raise ValueError('Source dependency differs: '+name)
            if name not in operations:
                if not (target/name).is_file() or receipt(target/name)!=receipt(path):raise ValueError('Existing dependency differs: '+name)
                pin(target/name)
            dependency_count+=1
    # Costume source explicitly authorizes only characters.add plus provenance.
    costume_report=load(repo/'reports/add-assets-handoff-v1.json');frozen=costume_report['costumeManifest']
    frozen_path=source/frozen['file']
    if sha(frozen_path)!=frozen['sha256']:
        original=Path(costume_report['artifactRoot'])/frozen['file']
        if not original.is_file() or sha(original)!=frozen['sha256']:raise ValueError('Costume metadata is not frozen')
        if load(frozen_path)['characters']['add']!=load(original)['characters']['add']:raise ValueError('Add costume object differs from frozen handoff')
        frozen_path=original
    old=load(target/'costumes/manifest.json');incoming=load(frozen_path)
    if 'add' in old['characters'] and old['characters']['add']!=incoming['characters']['add']:raise ValueError('Different Add costume already installed')
    old['characters']['add']=incoming['characters']['add'];old['sourceEvidence']=union_evidence(old['sourceEvidence'],incoming['sourceEvidence'])
    emit('costumes/manifest.json',old)
    # UI source crops are individually hashed by the handoff.
    ui=load(repo/'contracts/add-ui-source-v1.json');lobby=load(target/'ui/lobby/manifest.json');loading=load(target/'ui/loading/manifest.json')
    for job in ('lp','mm','de'):
        row=copy.deepcopy(ui['pieces']['lobby/portraits/'+job+'.png']);row['file']='portraits/'+job+'.png'
        if job.upper() in lobby['portraits'] and lobby['portraits'][job.upper()]!=row:raise ValueError('Portrait collision')
        lobby['portraits'][job.upper()]=row
    avatar=copy.deepcopy(ui['pieces']['loading/add-avatar.png']);avatar['file']='add-avatar.png';avatar['size']=[avatar['width'],avatar['height']]
    loading['pieces']['add-avatar.png']=avatar;loading['characterAvatars']['add']={'professions':['LP','MM','DE'],'file':'add-avatar.png'}
    emit('ui/lobby/manifest.json',lobby);emit('ui/loading/manifest.json',loading)
    profiles={job:load(repo/f'packages/combat-core/{job}-profile.json') for job in ('lp','mm','de')}
    indexes={job:load(source/job/'fx/index.json') for job in profiles}
    # The independent NPC adds exactly its own converted declarations. Caster
    # files remain untouched; refs are rebased according to its handoff contract.
    npc=load(source/'mm/summons/apocalypse/fx/index.json');mm=indexes['mm']
    for name,row in npc['templates'].items():
        row=rebase(row,'summons/apocalypse')
        if name in mm['templates'] and mm['templates'][name]['declarationSha256']!=row['declarationSha256']:raise ValueError('NPC declaration collision: '+name)
        mm['templates'].setdefault(name,row)
    mm['sourceFiles']=union_evidence(mm['sourceFiles'],npc['sourceFiles'])
    emit('mm/fx/index.json',mm)
    assets=load(source/'mm/effect-assets.json');assets['templates']=mm['templates'];emit('mm/effect-assets.json',assets)
    manifest=load(source/'mm/manifest.json');manifest['effectTemplates']['templates']=mm['templates'];manifest['effectSourceEvidence']=mm['sourceFiles'];emit('mm/manifest.json',manifest)
    audio=load(source/'mm/audio/manifest.json');npc_audio=load(source/'mm/summons/apocalypse/audio/manifest.json')
    for name,row in npc_audio['files'].items():
        if name in audio['files'] and audio['files'][name]['sha256']!=row['sha256']:raise ValueError('NPC audio collision: '+name)
        audio['files'].setdefault(name,row)
    emit('mm/audio/manifest.json',audio)
    for job,p in profiles.items():
        missing=p['effectTemplates'].keys()-indexes[job]['templates'].keys()
        if missing:raise ValueError('Current profile resource closure missing: '+str(sorted(missing)))
        for name,row in p['effectTemplates'].items():
            if row['declarationSha256']!=indexes[job]['templates'][name]['declarationSha256']:raise ValueError('Profile declaration differs: '+name)
        current=hashlib.sha256((repo/f'packages/combat-core/{job}-profile.json').read_bytes().replace(b'\r\n',b'\n')).hexdigest()
        notes.append({'profession':job,'resourceProfileSha256':indexes[job]['profileSha256'],'currentProfileSha256':current,
            'verifiedTemplates':len(p['effectTemplates']),'status':'every current effect declaration SHA is represented; original resource profile bindings retained for explicit final sealing'})
    # Add source snapshot has only old six-profession common metadata. Extend
    # the current destination using only the newly imported profile declarations.
    catalog=load(target/'common-buffs/catalog.json');fx=load(target/'common-buffs/fx/index.json');icons=load(target/'ui/buffs/manifest.json')
    new_sets={};new_templates={};new_buff_ids=set();all_fx={}
    for job,index in indexes.items():
        for name,row in index['templates'].items():all_fx.setdefault(name,(job,row))
    for job,p in profiles.items():
        for kind,default_source in [('buffTemplates','battle-buff'),('buffFactors','buff-factor')]:
            added=[]
            for key,row in p[kind].items():
                if key in catalog[kind]:
                    a={k:v for k,v in catalog[kind][key]['raw'].items()if k not in ('BUFF_NAME','BUFF_DESC')};b={k:v for k,v in row['raw'].items()if k not in ('BUFF_NAME','BUFF_DESC')}
                    if a!=b:raise ValueError('Existing buff semantics differ: '+kind+key)
                    continue
                catalog[kind][key]={**copy.deepcopy(row),'source':p['sources'][row.get('sourceKey',default_source)]};added.append(key)
                if kind=='buffTemplates':new_buff_ids.add(key)
            unions[job+':'+kind]=added
        for buff in p['buffTemplates'].values():
            for name in buff['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET',{}).values():
                if isinstance(name,str) and name not in catalog['effectSets']:
                    row=p['effectSets'][name];new_sets[name]={**copy.deepcopy(row),'source':p['sources']['effect']}
        catalog['profiles'].append({'profileId':p['profileId'],'path':str(repo/f'packages/combat-core/{job}-profile.json'),
            'sha256':notes[list(profiles).index(job)]['currentProfileSha256'],'hashNormalization':'UTF-8 LF'})
    catalog['effectSets'].update(new_sets)
    pending={entry['NAME'] for row in new_sets.values()for key,entry in row['raw'].items()
        if key.startswith('EFFECT')and isinstance(entry,dict)and isinstance(entry.get('NAME'),str)and entry.get('EFFECT_TYPE')!=1}
    visited=set();native=Catalog(Path('asset_work'));definitions=None
    while pending:
        name=pending.pop()
        if name in visited:continue
        visited.add(name)
        if name in catalog['effectSets']:
            pending.update(entry['NAME']for key,entry in catalog['effectSets'][name]['raw'].items()if key.startswith('EFFECT')and isinstance(entry,dict)and entry.get('NAME')and entry.get('EFFECT_TYPE')!=1);continue
        if name not in all_fx and name in fx['templates']:continue
        if name not in all_fx:
            if definitions is None:definitions=read_definitions(native,('GameMinorParticle.txt',))
            if name not in definitions:raise ValueError('Missing original buff display declaration: '+name)
            row=copy.deepcopy(definitions[name])
            if row.get('unsupported') or row['fields'].get('MeshName') or row['fields'].get('Mesh'):raise ValueError('Missing buff resource needs separately audited mesh conversion: '+name)
            pin(native.root/row['source']['rawPath']);row['textures']={}
            for texture in sorted({e['value']for e in row['events']if e['property']=='Texture'}):
                path=native.path(texture);pin(path);relative='fx/textures/'+Path(texture).stem+'-'+sha(path)[:10]+'.png'
                converted=stage/'common-buffs'/relative;converted.parent.mkdir(parents=True,exist_ok=True)
                with Image.open(path)as image:image.convert('RGBA').save(converted)
                add('common-buffs/'+relative,converted,'original-source-texture')
                with Image.open(converted)as image:width,height=image.size
                row['textures'][texture]={'file':relative,'width':width,'height':height,'source':native.evidence(path)}
            all_fx[name]=('common-buffs',row)
        job,row=all_fx[name]
        if name in fx['templates']:
            if fx['templates'][name]['declarationSha256']!=row['declarationSha256']:raise ValueError('Buff visual identity collision: '+name)
        else:new_templates[name]=copy.deepcopy(row)if job=='common-buffs'else rebase(row,'../'+job)
        pending.update(set(strings(row))&all_fx.keys()-visited)
    fx['templates'].update(new_templates);catalog['effectTemplates'].update(new_templates)
    # Keep every destination template byte/object intact. Source file evidence
    # for added templates remains in each complete template's source record.
    fx['sourceFiles']=union_evidence(fx['sourceFiles'],[row['source']for row in new_templates.values()])
    fx['importEvidence']={'profiles':catalog['profiles'][-3:],'addedTemplates':sorted(new_templates),'preservedPriorProfileSha256':fx['profileSha256']}
    localized,local_inputs,local_changes=localize(fx,catalog,target,stage,source_root=source)
    inputs.update(local_inputs)
    for name,path in localized.items():add(name,path,'localized-common-resource')
    emit('common-buffs/catalog.json',catalog);emit('common-buffs/fx/index.json',fx)
    # Native atlas crops for newly represented buffs; no invented icon aliases.
    atlas_cache={}
    for key in sorted(new_buff_ids,key=int):
        raw=catalog['buffTemplates'][key]['raw'];atlas=raw.get('BUFF_ICON_TEXTURE_NAME');piece=raw.get('BUFF_ICON_TEXTURE_KEY')
        if not atlas or not piece:continue
        if atlas not in atlas_cache:
            a,t=native.path(atlas),native.path(Path(atlas).with_suffix('.tet').name);pin(a);pin(t)
            atlas_cache[atlas]=(Image.open(a).convert('RGBA'),read_tet(t.read_bytes()),native.evidence(a),native.evidence(t))
        image,rectangles,ae,te=atlas_cache[atlas];original=next(name for name in rectangles if name.casefold()==piece.casefold())
        cropped,bounds=crop_piece(image,rectangles[original]);name='ui/buffs/icons/'+piece.lower()+'.png';path=stage/name;path.parent.mkdir(parents=True,exist_ok=True);cropped.save(path)
        if (target/name).is_file() and sha(target/name)!=sha(path):raise ValueError('Existing icon pixels differ: '+name)
        add(name,path,'original-atlas-crop')
        row={'file':'icons/'+piece.lower()+'.png','width':cropped.width,'height':cropped.height,'atlas':atlas,'piece':original,'bounds':bounds,
            'rgbaSha256':hashlib.sha256(cropped.tobytes()).hexdigest(),'sha256':sha(path),'atlasSource':ae,'tetSource':te}
        icons['buffIcons'][key]=row;icons['pieces'].setdefault('buff:'+piece,row)
    emit('ui/buffs/manifest.json',icons)
    buff_manifest=load(target/'common-buffs/manifest.json');rows={r['file']:r for r in buff_manifest['outputs']}
    for name in ('catalog.json','fx/index.json'):
        rows[name]={'file':name,**receipt(stage/'common-buffs'/name)}
    for name,row in operations.items():
        if name.startswith('common-buffs/fx/'):
            relative=name[len('common-buffs/'):];rows[relative]={'file':relative,**{key:row[key]for key in ('sha256','bytes')}}
    # v28 shadow file was intentionally independent of the old buff builder.
    if (target/'common-buffs/native-shadow.png').is_file():
        pin(target/'common-buffs/native-shadow.png');rows['native-shadow.png']={'file':'native-shadow.png',**receipt(target/'common-buffs/native-shadow.png')}
    buff_manifest['outputs']=[rows[k]for k in sorted(rows)];emit('common-buffs/manifest.json',buff_manifest)
    # Validate all runtime refs against the planned overlay and pin dependencies.
    reference_count=0
    for base,index in [(job,indexes[job])for job in profiles]+[('common-buffs',fx)]:
        for row in index['templates'].values():
            refs=[row[k]for k in ('glb','poseData')if row.get(k)]+[t['file']for t in row.get('textures',{}).values()]
            for ref in refs:
                name=posixpath.normpath(base+'/'+ref)
                if name.startswith('../'):raise ValueError('Runtime reference escapes assets')
                path=Path(operations[name]['source'])if name in operations else target/name
                if not path.is_file():raise ValueError('Runtime reference absent: '+name)
                if name not in operations:pin(path)
                reference_count+=1
    for name in ('cast-display/manifest.json','cast-display/fx/index.json'):
        pin(target/name)
    for name,row in operations.items():
        if row['prior'] and row['kind']=='metadata-union':
            backup=output/'prior'/name;backup.parent.mkdir(parents=True,exist_ok=True);backup.write_bytes((target/name).read_bytes())
    plan={'schemaVersion':1,'targetRoot':str(target),'sourceRoot':str(source),'inputs':[{'path':p,**v}for p,v in sorted(inputs.items())],
        'files':[operations[k]for k in sorted(operations)],'unions':unions,'profileBindings':notes,
        'validation':{'externalDependencyRows':dependency_count,'runtimeReferences':reference_count,'newBuffTemplates':len(new_buff_ids),'newDisplaySets':len(new_sets),'newDisplayTemplates':len(new_templates),'localizedCommonReferences':len(local_changes)},
        'preserved':['All existing profession runtime files; whole cast-display metadata; original common-buff objects; v28 native-shadow bytes; all prior costume characters.'],
        'limits':['This import does not add an Apocalypse NPC renderer/controller. Its original NPC model and rebased FX/audio are available.',
                  'Add cast-display uses the separately implemented awakening fallback; the source snapshot has no Add cast-display profession records.',
                  'Original source missing templates/voices and resource profile binding differences remain recorded; no client 1:1 claim.']}
    write(output/'receipt.json',plan)
    base={'schemaVersion':1,'targetRoot':str(target),'sourceRoot':str(source),
        'inputs':[{'path':str(repo/'reports'/name),**receipt(repo/'reports'/name)}for name in ('add-assets-handoff-v1.json','mm-apocalypse-assets-handoff-v1.json')],
        'files':list(base_operations.values())}
    write(output/'base-receipt.json',base)
    union=copy.deepcopy(plan);union['files']=[];union['precondition']='Base1163 import completed first'
    for row in plan['files']:
        if row['kind']=='source-copy':continue
        row=copy.deepcopy(row)
        if row['file']in base_operations:row['prior']={key:base_operations[row['file']][key]for key in ('bytes','sha256')}
        union['files'].append(row)
    write(output/'union-receipt.json',union)
    (output/'apply.py').write_bytes(Path(__file__).with_name('apply_prepared_asset_import.py').read_bytes())
    print(json.dumps({'files':len(operations),'metadata':sum(r['kind']=='metadata-union'for r in operations.values()),**plan['validation']}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',type=Path,required=True);p.add_argument('--target-root',type=Path,required=True)
    p.add_argument('--repo-root',type=Path,required=True);p.add_argument('--output-root',type=Path,required=True);a=p.parse_args()
    prepare(a.source_root,a.target_root,a.repo_root,a.output_root)
