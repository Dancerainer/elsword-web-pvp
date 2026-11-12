"""Read selected NA2016 costume records and export shared cosmetic geometry.

KIM208 offsets are target-specific. V5 only supplies the named Hyper_ resource
consumer and attachment policy. No item stats or gameplay profile is changed.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from extract_equipment_2016 import Kim208
from kl82_static import read_declarations
from build_rf import Catalog, load_x, walk, node, to_tree, parse_ksm, Exporter, asset_metadata, write_json, build_effect

SETS = {
    'officer': {'name': 'El Search Party Officer',
        'elsword': {'body': [130555,130556,130557,130558,130717], 'weapon': 130550, 'accessories': [130646,89185]},
        'raven': {'body': [130570,130571,130572,130573,130720], 'weapon': 130553, 'accessories': [130649,89188]}},
    'nasod': {'name': 'Nasod Battle Suit',
        'elsword': {'body': [130938,130939,130940,130941,130942], 'weapon': 130892, 'accessories': [131010]},
        'raven': {'body': [130953,130954,130955,130956,130957], 'weapon': 130895, 'accessories': [131013]}},
    'royal': {'name': 'Royal Servant',
        'elsword': {'body': [132547,132548,132549,132550,132551], 'weapon': 132546, 'accessories': [132763,82154]},
        'raven': {'body': [132565,132566,132567,132568,132569], 'weapon': 132564, 'accessories': [132766,82157]}},
    'solace': {'name': 'Salvatore Solace',
        'elsword': {'body': [131773,131774,131775,131776,131777], 'weapon': 131646, 'accessories': [131835,88402]},
        'raven': {'body': [131788,131789,131790,131791,131792], 'weapon': 131649, 'accessories': [131841,88405]}},
}
CHARACTERS = {'elsword': {'unitType': 1, 'motion': 'Motion_Elsword.x'},
              'raven': {'unitType': 4, 'motion': 'Motion_Raven.x'}}
PROFESSIONS = {'LK': 'UC_ELSWORD_LORD_KNIGHT', 'RF': 'UC_RAVEN_RECKLESS_FIST', 'VC': 'UC_RAVEN_VETERAN_COMMANDER', 'BM': 'UC_RAVEN_BLADE_MASTER', 'RS': 'UC_ELSWORD_RUNE_SLAYER', 'IS': 'UC_ELSWORD_INFINITY_SWORD'}
REFERENCE_COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
REFERENCE_FILES = {'X2Eqip.cpp': [(223,255),(1130,1194),(1722,1769),(2278,2346)],
                   'X2Eqip.h': [], 'X2GUUser.cpp': [(33249,33272)]}


def sha(data):
    return hashlib.sha256(data).hexdigest()


class CostumeKim(Kim208):
    def attached(self, pointer, mesh=False):
        if not pointer:
            return []
        count = struct.unpack('<I', self.blob_bytes(pointer, 4))[0]
        if not 0 < count <= 256:
            raise ValueError('Invalid costume attachment count')
        rows = []
        for name, bone in struct.iter_unpack('<II', self.blob_bytes(pointer+4, count*8)):
            if not mesh and name & 0x80000000:
                raise ValueError('Invalid particle name flag')
            row = {'name': self.string(name & 0x7fffffff), 'bone': self.string(bone)}
            if not row['name'] or not row['bone']:
                raise ValueError('Empty costume attachment name/bone')
            if mesh:
                row['jiggle'] = bool(name & 0x80000000)
            rows.append(row)
        return rows

    def string(self, pointer):
        if pointer == 0:
            return ''
        count = struct.unpack('<H', self.blob_bytes(pointer, 2))[0]
        if not 0 < count <= 4096:
            raise ValueError('Invalid costume string length')
        value = self.blob_bytes(pointer+2, count*2).decode('utf-16le')
        if '\0' in value or self.blob_bytes(pointer+2+count*2, 2) != b'\0\0':
            raise ValueError('Invalid costume string terminator')
        return value

    def visual(self, item_id):
        p = self.records[item_id]
        # These selected costumes have no unit-specific offset/scale/rotation
        # overrides. Refuse new extended records until those fields are decoded.
        if any(self.data[p+202:p+207]):
            raise ValueError('Unsupported extended costume transforms')
        extra, traces = self.uint(p+172), self.data[p+207]
        if bool(extra) != bool(traces):
            raise ValueError('Invalid costume extra pointer/count')
        slash = [struct.unpack('<II', self.blob_bytes(extra+8*i,8)) for i in range(traces)]
        string = lambda offset: self.string(self.uint(p+offset))
        flags = self.uint(p+4)
        return {'itemId': item_id, 'name': string(56), 'unitType': self.data[p+194],
            'slot': self.data[p+197], 'useType': (flags >> 8) & 15,
            'canHyperMode': bool(flags & 64), 'attachFrames': [string(68+4*i) for i in range(8)],
            'models': [string(100+4*i) for i in range(6)],
            'textureChange': string(124), 'animationXet': string(128), 'animationName': string(132),
            'attachedParticles': self.attached(self.uint(p+164)),
            'attachedMeshes': self.attached(self.uint(p+168), mesh=True),
            'cosmeticSlashTraceRaw': slash, 'recordOffset': p, 'recordSha256': sha(self.data[p:p+208])}


def record(catalog):
    kim_path = catalog.path('item.kim'); kim = CostumeKim(kim_path.read_bytes())
    unit_path = catalog.path('UnitTemplet.lua')
    units = read_declarations(unit_path, capture_calls=True, capture_unresolved=True)
    professions = {}
    for call in units['nativeCalls']:
        if call['target'] != 'g_pUnitManager.AddUnitTemplet':
            continue
        row = call['args'][1]
        for id, symbol in PROFESSIONS.items():
            if row.get('unitClass', {}).get('$symbol') == 'UNIT_CLASS.'+symbol:
                professions[id] = {'unitType': row['unitType']['$symbol'], 'instruction': call['instruction'],
                    'faceItem': kim.visual(row['basicFaceItemID']),
                    'leftArmItem': kim.visual(row['m_RavenLeftArmItemID']) if 'm_RavenLeftArmItemID' in row else None}
    if set(professions) != set(PROFESSIONS):
        raise ValueError('Missing original profession template')
    items = {}
    for definition in SETS.values():
        for character, info in CHARACTERS.items():
            selection = definition[character]
            for id in [*selection['body'], selection['weapon'], *selection['accessories']]:
                row = kim.visual(id)
                if row['unitType'] != info['unitType']:
                    raise ValueError('Costume item belongs to another character')
                if not row['models'][0] or row['textureChange'] or row['animationXet']:
                    raise ValueError('Unsupported selected costume model/texture animation')
                row['sourceModels'] = []
                for name in filter(None, row['models']):
                    modes = {'normal': catalog.evidence(catalog.path(name))}
                    if row['canHyperMode']:
                        modes['awakened'] = catalog.evidence(catalog.path('Hyper_'+name))
                    row['sourceModels'].append(modes)
                items[str(id)] = row
    references = []
    for name, ranges in REFERENCE_FILES.items():
        path = ROOT / '.cache/costume-source-v1' / name
        if name == 'X2GUUser.cpp':
            path = ROOT / '.cache/native-source-runtime/X2Lib' / name
        references.append({'path': 'JP_TW_EU_CN_US/Trunk/X2Lib/'+name, 'sha256': sha(path.read_bytes()), 'lines': ranges})
    result = {'schemaVersion':1, 'id':'costumes-2016-v1', 'clientMeasured':False,
        'sourceBuild':'NA2016 V6.0420.5', 'sets':SETS, 'characters':CHARACTERS, 'professions':professions,
        'items':items, 'kimLayout':{'recordBytes':208,'count':kim.count,'nameOffset':56,'modelOffset':100,
            'attachFrameOffset':68,'unitTypeOffset':194,'slotOffset':197,'checkedAllRecordIds':True},
        'inputs':[catalog.evidence(kim_path),catalog.evidence(unit_path)],
        'consumerReference':{'evidenceClass':'fixed-V5-reference-not-target2016','commit':REFERENCE_COMMIT,'files':references,
            'hyperPolicy':'bit6 enables Hyper_ model; awakening start/end toggles mode; original animations loop',
            'attachment':'source bone name; these selected records declare no offset/scale/rotation overrides'},
        'selectionNotes':['Officer uses the original hat hairstyle; Royal uses Crimson Guard for Elsword and Abyss Crow for Raven.',
            'Keep the current profession face and Raven mechanical left arm; no costume statistics or collision changes.',
            'Shared Elsword/Raven geometry, original item identities, and V5 consumers are distinct from original-client execution.']}
    return result


def body(catalog, destination, character, selected, items):
    primary = catalog.path(CHARACTERS[character]['motion'])
    motion = parse_ksm(primary)
    pose_names = {f['name'] for f in motion['frames']}
    skeleton = to_tree(motion)
    for frame, _ in walk(skeleton):
        frame.children = [child for child in frame.children if child.kind != 'Mesh']
    frames = {n.name:n for n,_ in walk(skeleton) if n.kind == 'Frame'}
    for id in selected['body']:
        item = items[str(id)]
        if item['useType'] != 1 or item['canHyperMode']:
            raise ValueError('Unsupported costume body consumer')
        for filename in filter(None, item['models']):
            tree = load_x(catalog.path(filename)); attached = 0
            for mesh, ancestry in walk(tree):
                if mesh.kind != 'Mesh' or not mesh.children_of('SkinWeights'):
                    continue
                holder = ancestry[-1]
                if holder.name not in frames:
                    added = node('Frame', name='Costume_'+holder.name)
                    added.children.append(copy.deepcopy(holder.child('FrameTransformMatrix')))
                    frames['Scene_Root'].children.append(added); frames[holder.name] = added
                frames[holder.name].children.append(copy.deepcopy(mesh)); attached += 1
            if not attached:
                raise ValueError('No original skinned costume geometry: '+filename)
    weapon = items[str(selected['weapon'])]
    weapon_bone = CHARACTERS[character].get('weaponMount', 'Dummy1_Rhand')
    if weapon['attachFrames'][0] != weapon_bone or weapon['canHyperMode']:
        raise ValueError('Unsupported costume weapon attachment')
    tree = load_x(catalog.path(weapon['models'][0]))
    mount = copy.deepcopy(next(n for n,_ in walk(tree) if n.kind == 'Frame' and n.name == weapon_bone))
    mount.name = 'Costume_SwordMount'; frames[weapon_bone].children.append(mount)
    for child, _ in walk(mount):
        if child.kind == 'Frame' and child.name in CHARACTERS[character].get('weaponFrameRenames', {}):
            child.name = CHARACTERS[character]['weaponFrameRenames'][child.name]
    # No duplicated profession animation streams: copy the already sampled
    # actor bone transforms at runtime, preserving this model's skin offsets.
    exporter = Exporter('body', texture_lookup=catalog, asset_root=catalog.root)
    exporter.add(primary, destination, tree=skeleton, clips_override=[])
    if exporter.missing_textures:
        raise ValueError('Missing costume textures: '+str(exporter.missing_textures))
    exporter.doc['extensionsUsed'] = ['KHR_materials_unlit']
    for material in exporter.doc['materials']:
        material['extensions'] = {'KHR_materials_unlit':{}}
        material['doubleSided'] = False
    for entry in exporter.doc['nodes']:
        entry['name'] = entry['name'].removeprefix(primary.stem+'/')
    summary = asset_metadata(exporter,destination,exporter.save(destination))
    return {'glb':'body.glb','sourceMotion':catalog.evidence(primary),'meshCount':summary['meshes'],
        'poseFrames':[{'name':n.name,'parent':ancestry[-2].name if len(ancestry)>1 else None}
                      for n,ancestry in walk(skeleton) if n.kind=='Frame' and n.name in pose_names],
        'keptProfessionParts':['face']+(['leftArm'] if character=='raven' else [])}


def build(catalog, contract, output):
    from costume_effects import build_attachment, render_profile, build_particles
    manifest = {'schemaVersion':1,'id':'costumes-2016-v1','clientMeasured':False,'characters':{}}
    for character in CHARACTERS:
        choices = {}; manifest['characters'][character] = choices
        for id, definition in SETS.items():
            selected = definition[character]; destination = output/character/id; destination.mkdir(parents=True,exist_ok=True)
            entry = {'id':id,'name':definition['name'],**body(catalog,destination,character,selected,contract['items']),'accessories':[], 'attachments':[], 'particles':[]}
            for item_id in selected['accessories']:
                item = contract['items'][str(item_id)]; accessory = {'itemId':item_id,'models':[]}
                if item['useType'] not in (2,3):
                    raise ValueError('Unsupported accessory consumer')
                for index, filename in enumerate(item['models']):
                    if not filename:
                        continue
                    profile = render_profile(item_id)
                    model = {'bone':item['attachFrames'][index], 'normal':build_effect(catalog,destination/'effects',filename, render_profile=profile)}
                    if not model['bone']:
                        raise ValueError('Missing source accessory bone')
                    if item['canHyperMode']:
                        model['awakened'] = build_effect(catalog,destination/'effects','Hyper_'+filename, render_profile=profile)
                    for mode in ('normal','awakened'):
                        if mode not in model:
                            continue
                        data = model[mode]
                        if data['unsupportedPoseTracks'] or (data['animations'] and len(data['animations']) != 1):
                            raise ValueError('Unsupported accessory animation '+filename)
                        model[mode] = {'glb':data['glb'],'poseData':data['poseData'], 'animations':data['animations'], 'renderProfile':profile}
                    accessory['models'].append(model)
                entry['accessories'].append(accessory)
            for item_id in [*selected['body'], selected['weapon'], *selected['accessories']]:
                item = contract['items'][str(item_id)]
                owner = 'body' if item_id == selected['weapon'] or item['useType'] == 1 else item_id
                for attached in item['attachedMeshes']:
                    if attached.get('unsupported'):
                        entry.setdefault('unsupported', []).append({'itemId':item_id, **attached})
                    else:
                        entry['attachments'].append(build_attachment(catalog, destination, item, attached, owner))
                for attached in item['attachedParticles']:
                    entry['particles'].append({**attached, 'owner':owner, 'template':'costume:'+attached['name']})
            choices[id] = entry
            print(json.dumps({'built':character+'/'+id,'meshes':entry['meshCount'],'accessories':len(entry['accessories'])}),flush=True)
    manifest['visualRevision'] = 'costume-effects-v2'
    manifest['particleIndex'] = build_particles(catalog, contract, output)
    manifest['sourceEvidence'] = sorted(catalog.used.values(),key=lambda r:r['rawPath'])
    write_json(output/'manifest.json',manifest)
    return manifest


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--source-root',type=Path,default=Path('asset_work'))
    cli.add_argument('--output',type=Path,default=ROOT/'artifacts/costumes')
    cli.add_argument('--record-only',action='store_true')
    args=cli.parse_args();output=args.output.resolve()
    if output.is_relative_to(args.source_root.resolve()):
        raise ValueError('Output must stay outside read-only source inputs')
    catalog=Catalog(args.source_root);contract=record(catalog)
    from costume_effects import write_attachment_request
    write_attachment_request(catalog, contract)
    write_json(ROOT/'contracts/costumes-2016-source-v1.json',contract)
    sources={}
    for item in contract['items'].values():
        if item['slot'] in (2,6,8,9,10,11):
            continue
        for row in item['sourceModels']:
            for source in row.values():
                path=catalog.root/source['rawPath']
                if path.read_bytes()[:4]==b'xof ':
                    sources[source['sha256']]={'source':str(path),'sourceSha256':source['sha256'],'sourceBytes':source['bytes']}
    receipt = ROOT/'reports/costumes-d3dx-execution-v1.json'
    if receipt.is_file():
        for trace in json.loads(receipt.read_bytes())['traces']:
            source = sources.get(trace.get('sourceSha256'))
            if source is not None and 'hresult' in trace:
                source.update(actualLoaderHresult=trace['hresult'], nativeAnimations=[
                    {key:animation[key] for key in ('index','name','period','ticksPerSecond','playbackType')}
                    for animation in trace.get('animations',[])])
    write_json(ROOT/'reports/costumes-d3dx-sources-v1.json',{'schema':'elsword.native-d3dx-source-request.v1',
        'dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'scope':'Selected original costume accessories; read-only inputs; full client not executed','sources':list(sources.values())})
    if args.record_only:
        print(json.dumps({'items':len(contract['items']),'dllSources':len(sources)}));return
    build(catalog,contract,output)


if __name__ == '__main__':
    main()
