"""Convert only the newly recovered 2016 Injection Stigma buff display closure.

All originals and the installed baseline are read only. Outputs stay in this
task's ignored increment directory; the small source index is tracked.
"""
from pathlib import Path
import json, sys, hashlib, shutil
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'tools/assets/character')]
from build_lk_fx import build
from build_rf import write_json, Catalog
from build_rf_fx import read_definitions, select_templates

def calls(path, target):
    doc=json.loads(path.read_text('utf8'))
    rows={row['args'][1]['NAME']:row for row in doc['nativeCalls']
          if row['target']==target and len(row.get('args',[]))>1 and isinstance(row['args'][1],dict) and 'NAME' in row['args'][1]}
    return doc, rows

def main():
    own=ROOT/'runtime/presentation-v45/ca-shield'; own.mkdir(parents=True,exist_ok=True)
    catalog=Catalog(Path('asset_work'))
    blade=catalog.path('SDK_INJECTION_STIGMA_Blade01.X');data=blade.read_bytes()
    request_row={'source':str(blade),'sourceSha256':hashlib.sha256(data).hexdigest(),'sourceBytes':len(data)}
    executed=ROOT/'reports/ca-shield-d3dx-execution-v45.json'
    if executed.is_file():
        execution=json.loads(executed.read_text('utf8'))
        trace=next(row for row in execution['traces'] if row.get('sourceSha256')==request_row['sourceSha256'])
        if execution['dll']['sha256']!='0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f' or trace['hresult']!='0x00000000':raise ValueError('Unverified native shield source clock')
        request_row.update(actualLoaderHresult=trace['hresult'],nativeAnimations=[{k:a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace.get('animations',[])])
    write_json(ROOT/'reports/ca-shield-d3dx-sources-v45.json',{'schema':'elsword.native-d3dx-source-request.v1',
        'dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'sources':[request_row]})
    if '--prepare-native' in sys.argv:return
    source=ROOT/'.cache/elesis-v45/declarations'
    effects,sets=calls(source/'effect-declarations.json','g_pEffectSet.AddEffectSetTemplet_LUA')
    damages,damage=calls(source/'damage-declarations.json','g_pDamageEffect.AddDamageEffectTemplet_LUA')
    name='EffectSet_SI_A_SDK_INJECTION_STIGMA_BUFF'
    row=sets[name]; raw=row['args'][1]
    damage_names=[value['NAME'] for value in raw.values() if isinstance(value,dict) and value.get('EFFECT_TYPE')==1]
    profile={'professionId':'ca-feedback-shield-v45','effectSets':{name:{'raw':raw}},
             'states':{},'skillCatalog':[],'damageEffects':{n:{'raw':damages['globals'][n]} for n in damage_names}}
    frozen=own/'source-profile.json';write_json(frozen,profile)
    # Verified earlier conversions keep their exact public paths. Stage only
    # this narrow closure's referenced files under the private conversion root
    # so the converter's path/case audit never follows a shared junction.
    selected,_=select_templates(read_definitions(catalog,('GameMinorParticle.txt',)),profile)
    baseline=ROOT/'artifacts/ca/fx/index.json';old=json.loads(baseline.read_text('utf8'))['templates']
    reused_geometry=[]
    for name,row in selected.items():
        if name in old:continue
        mesh=row['fields'].get('MeshName') or row['fields'].get('Mesh')
        compatible=next((r for r in old.values() if mesh and mesh.casefold()==(r['fields'].get('MeshName') or r['fields'].get('Mesh') or '').casefold() and r.get('poseData')),None)
        if compatible:
            old[name]={**row,**{key:compatible[key] for key in ('glb','poseData','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate','textures') if key in compatible}}
            reused_geometry.append({'template':name,'sourceMesh':mesh,'baselineTemplate':compatible['name'],'baselineIndex':'ca/fx/index.json','baselineDeclarationSha256':compatible['declarationSha256']})
    reuse=own/'reuse-index.json';write_json(reuse,{'templates':old})
    for name,row in selected.items():
        previous=old.get(name)
        if not previous or previous['declarationSha256']!=row['declarationSha256']:continue
        files=[previous.get(key) for key in ('glb','poseData')]+[value['file'] for value in previous.get('textures',{}).values()]
        for file in filter(None,files):
            source_path=(ROOT/'artifacts/ca'/file).resolve();target_path=(own/'assets/ca'/file).resolve()
            if not target_path.is_relative_to((own/'assets').resolve()):raise ValueError('Private reuse path escapes increment')
            target_path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source_path,target_path)
    out=own/'assets/ca/feedback-v45';index=build(out,frozen,index_output=None,additional_particle_scripts=('GameMinorParticle.txt',),shared_indexes=[(reuse,'')])
    if index['missingTemplates'] or index['meshFailures']:
        raise ValueError('Unclosed original shield resources: '+str([index['missingTemplates'],index['meshFailures']]))
    # This increment has a new namespace; source-identical reused templates
    # keep their baseline paths. Only newly converted files are rebased.
    for template in index['templates'].values():
        if template.get('sharedResourceEvidence'):
            geometry=next((r for r in reused_geometry if r['template']==template['name']),None)
            if geometry:
                template.pop('sharedResourceEvidence')
                template['convertedArtifactReuse']={**geometry,'originalMesh':catalog.evidence(catalog.path(geometry['sourceMesh'])),
                    'rule':'Identical original MeshName bytes; source declaration remains independently parsed.'}
            else:template['sharedResourceEvidence']['index']='contracts/ca-fx-index.json'
            continue
        for key in ('glb','poseData'):
            if template.get(key):template[key]=template[key].replace('fx/','feedback-v45/',1)
        for texture in template.get('textures',{}).values():
            texture['file']=texture['file'].replace('fx/','feedback-v45/',1)
    final=out
    write_json(final/'index.json',index)
    write_json(ROOT/'contracts/ca-shield-visual-v45.json',index)
    inventory=[]
    for path in sorted(final.rglob('*')):
        if path.is_file() and path.suffix not in ('.obj','.mtl','.animation.json'):
            inventory.append({'file':path.relative_to(own/'assets').as_posix(),'bytes':path.stat().st_size,
                              'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    write_json(own/'receipt.json',{'schemaVersion':1,'evidenceClass':'target2016-static-declaration-and-converted-source',
        'originalClientMeasured':False,'setSource':effects['source'],'damageSource':damages['source'],
        'templates':list(index['templates']),'reusedGeometry':reused_geometry,'outputs':inventory})
    print(json.dumps({'templates':len(index['templates']),'outputs':len(inventory),'output':str(own)}))

if __name__=='__main__':main()
