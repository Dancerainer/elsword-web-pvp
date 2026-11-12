"""Add three target2016 cosmetic sets; preserve every existing costume entry.

Read-only catalog inputs, isolated output, original item/model SHA evidence.
No client execution and no equipment stats imported into combat.
"""
import argparse
import copy
import json
import shutil
from pathlib import Path
import build_costumes as shared
import build_add_costumes as add
from build_costumes import Catalog, CostumeKim, ROOT, write_json


def selection(weapon, accessories):
    return {'body': list(range(weapon+1, weapon+6)), 'weapon': weapon, 'accessories': accessories}


SETS = {
    'imperial': {'name': 'Royal Iron Guard',
        'elsword': selection(132059, [132089,132207,88408]),
        'raven': selection(132077, [132092,132210,88411]),
        'elesis': selection(85695, [85701,85702,85703]),
        'add': selection(82428, [82434,82435,82436])},
    'denif': {'name': 'Salvatore Denif',
        'elsword': selection(133429, [81000,81006]),
        'raven': selection(133447, [81003,81009]),
        'elesis': selection(85704, [85710,85711]),
        'add': selection(88905, [88911,88912])},
    'evilTracer1': {'name': 'Evil Tracer 1',
        'elsword': selection(132848, [133240]),
        'raven': selection(132866, [133243]),
        'elesis': selection(82106, [82112]),
        'add': selection(82507, [82513])},
}
CHARACTERS = {
    **shared.CHARACTERS,
    'elesis': {'unitType':8, 'motion':'Motion_EL.x', 'weaponMount':'Dummy3_Weapon',
        'weaponFrameRenames': {name:'Costume_Weapon_'+name for name in ('Object01','Object02','Object04','Sphere01')}},
    'add': {'unitType':9, 'motion':'Motion_ADD.x'},
}
# These dangling declarations also exist on old source sets. Preserve the
# absence as evidence; never substitute a similarly named later model.
MISSING_ATTACHMENTS = {
    (132059,'Mesh_Elsword_Event_Weapon08Effect_Sorted.x'),
    (132077,'Mesh_Raven_Event_Weapon08Effect_Sorted.x'),
    (132848,'Mesh_Elsword_Event_Weapon09Effect_Sorted.x'),
    (132866,'Mesh_Raven_Event_Weapon09Effect_Sorted.x'),
}


def record(catalog):
    path=catalog.path('item.kim'); kim=CostumeKim(path.read_bytes()); items={}
    for definition in SETS.values():
        for character, spec in CHARACTERS.items():
            chosen=definition[character]
            for item_id in [*chosen['body'],chosen['weapon'],*chosen['accessories']]:
                row=kim.visual(item_id)
                if row['unitType']!=spec['unitType'] or not row['models'][0] or row['textureChange'] or row['animationXet']:
                    raise ValueError('Unsupported selected item '+str(item_id))
                row['sourceModels']=[]
                for name in filter(None,row['models']):
                    modes={'normal':catalog.evidence(catalog.path(name))}
                    if row['canHyperMode']: modes['awakened']=catalog.evidence(catalog.path('Hyper_'+name))
                    row['sourceModels'].append(modes)
                for attached in row['attachedMeshes']:
                    if attached['jiggle']: raise ValueError('Unsupported jiggle attachment')
                    try: attached['source']=catalog.evidence(catalog.path(attached['name']))
                    except FileNotFoundError:
                        if (item_id,attached['name']) not in MISSING_ATTACHMENTS: raise
                        attached['unsupported']='Referenced original mesh absent from target2016 catalog'
                items[str(item_id)]=row
    return {'schemaVersion':1,'id':'three-costumes-target2016-v1','clientMeasured':False,
        'evidenceClass':'static-target2016-config-and-original-models',
        'sets':SETS,'characters':CHARACTERS,'items':items,'inputs':[catalog.evidence(path)],
        'selectionNotes':[
            'Evil Tracer first series: Berthe / Spriggan / Cutty Sark / Teach the Tyrant. ADD Shadow Master belongs to a different series.',
            'Display names use English item terminology.',
            'ADD imperial item82428 declares Dummy1_Rhand but original model contains Weapon01; existing six-dynamo Web adapter retained.',
            'Four original extra weapon-effect references are absent. Body, weapon and selected accessories must all resolve.',
            'Existing qualified V5 material/attachment adapter reused. No target full-client pixel measurement or 1:1 claim.']}


def build(catalog, contract, output):
    manifest=json.loads((output/'manifest.json').read_bytes())
    particles=json.loads((output/'particles.json').read_bytes())
    before=copy.deepcopy(manifest['characters'])
    original_body=shared.body
    original_sets,original_characters=shared.SETS,shared.CHARACTERS
    try:
        for character,spec in CHARACTERS.items():
            shared.CHARACTERS={character:spec}
            shared.SETS={key:{'name':row['name'],character:row[character]} for key,row in SETS.items()}
            shared.body=add.body if character=='add' else original_body
            result=shared.build(catalog,contract,output)
            choices=result['characters'][character]
            if character=='add':
                for entry in choices.values():
                    if entry['attachments']: raise ValueError('New ADD attachment requires explicit six-dynamo policy')
            manifest['characters'][character].update(choices)
            particles['templates'].update(json.loads((output/'particles.json').read_bytes())['templates'])
    finally:
        shared.body=original_body; shared.SETS=original_sets; shared.CHARACTERS=original_characters
    for character,choices in before.items():
        for key,entry in choices.items():
            if key not in SETS and manifest['characters'][character][key]!=entry:
                raise ValueError('Existing costume changed')
    evidence={row['rawPath']:row for row in manifest['sourceEvidence']}
    evidence.update({row['rawPath']:row for row in catalog.used.values()})
    manifest['sourceEvidence']=sorted(evidence.values(),key=lambda row:row['rawPath'])
    write_json(output/'manifest.json',manifest);write_json(output/'particles.json',particles)
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/costumes')
    parser.add_argument('--record-only',action='store_true')
    parser.add_argument('--prepare-native',action='store_true')
    args=parser.parse_args(); output=args.output.resolve(); baseline=args.baseline.resolve()
    if output==baseline or output.is_relative_to(args.source_root.resolve()) or not output.is_relative_to(ROOT):
        raise ValueError('Output must be independent and within this worktree')
    catalog=Catalog(args.source_root);contract=record(catalog)
    write_json(ROOT/'contracts/three-costumes-source-v1.json',contract)
    if args.prepare_native:
        sources={}
        for item in contract['items'].values():
            rows=([s for modes in item['sourceModels'] for s in modes.values()]
                if item['slot'] not in (2,6,8,9,10,11) else [])
            rows += [a['source'] for a in item['attachedMeshes'] if 'source' in a]
            for source in rows:
                path=catalog.root/source['rawPath']
                if path.read_bytes()[:4]==b'xof ':
                    sources[source['sha256']]={'source':str(path),'sourceSha256':source['sha256'],'sourceBytes':source['bytes']}
        receipt=ROOT/'reports/three-costumes-d3dx-execution-v1.json'
        if receipt.exists():
            for trace in json.loads(receipt.read_bytes())['traces']:
                row=sources.get(trace.get('sourceSha256'))
                if row is not None and 'hresult' in trace:
                    row.update(actualLoaderHresult=trace['hresult'],nativeAnimations=[
                        {k:a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace.get('animations',[])])
        write_json(ROOT/'reports/three-costumes-d3dx-sources-v1.json',{
            'schema':'elsword.native-d3dx-source-request.v1','dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
            'scope':'Original selected costume accessories and attached hand models; full client not executed','sources':list(sources.values())})
        print(json.dumps({'nativeSources':len(sources)})); return
    if args.record_only: print(json.dumps({'items':len(contract['items'])}));return
    # Copy instead of linking: build writes manifests and generated textures.
    shutil.copytree(baseline,output,dirs_exist_ok=True)
    manifest=build(catalog,contract,output)
    write_json(ROOT/'runtime/three-costumes-build.json',{'items':len(contract['items']),
        'choices':{k:list(v) for k,v in manifest['characters'].items()},
        'sourceEvidenceCount':len(manifest['sourceEvidence']),
        'unsupported':[{ 'itemId':i['itemId'],**a} for i in contract['items'].values()
            for a in i['attachedMeshes'] if a.get('unsupported')]})


if __name__=='__main__': main()
