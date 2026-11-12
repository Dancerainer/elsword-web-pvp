"""Add four original Elesis costume sets while preserving frozen existing sets."""
import argparse
import json
from pathlib import Path
import build_costumes as common
from build_costumes import Catalog, CostumeKim, write_json, ROOT, read_declarations

SELECTIONS = {
    'officer': {'body': [81942,81943,81944,81945,81948], 'weapon': 81941, 'accessories': [81947,89192]},
    'nasod': {'body': [85689,85690,85691,85692,85693], 'weapon': 85688, 'accessories': [85694]},
    'royal': {'body': [133539,133540,133541,133542,133543], 'weapon': 133538, 'accessories': [133544,82161]},
    'solace': {'body': [85721,85722,85723,85724,85725], 'weapon': 85720, 'accessories': [85726,85727]},
}


def record(catalog):
    kp = catalog.path('item.kim'); kim = CostumeKim(kp.read_bytes()); items = {}
    for selection in SELECTIONS.values():
        for item_id in [*selection['body'], selection['weapon'], *selection['accessories']]:
            row = kim.visual(item_id)
            if row['unitType'] != 8 or not row['models'][0] or row['textureChange'] or row['animationXet']:
                raise ValueError('Unsupported source costume record '+str(item_id))
            row['sourceModels'] = []
            for name in filter(None, row['models']):
                sources = {'normal': catalog.evidence(catalog.path(name))}
                if row['canHyperMode']: sources['awakened'] = catalog.evidence(catalog.path('Hyper_'+name))
                row['sourceModels'].append(sources)
            for attached in row['attachedMeshes']:
                if attached['jiggle']: raise ValueError('Unsupported source jiggle attachment')
                try: attached['source'] = catalog.evidence(catalog.path(attached['name']))
                except FileNotFoundError: attached['unsupported'] = 'Referenced original mesh absent from target2016 catalog'
            items[str(item_id)] = row
    up = catalog.path('UnitTemplet.lua')
    units = read_declarations(up, capture_calls=True, capture_unresolved=True)
    professions = {}
    for call in units['nativeCalls']:
        if call['target'] != 'g_pUnitManager.AddUnitTemplet': continue
        value = call['args'][1]
        for job, symbol in [('GM','GRAND_MASTER'),('BH','BLAZING_HEART'),('CA','CRIMSON_AVENGER')]:
            if value.get('unitClass',{}).get('$symbol') == 'UNIT_CLASS.UC_ELESIS_'+symbol:
                professions[job] = {'unitType': 'UNIT_TYPE.UT_ELESIS', 'instruction': call['instruction'],
                    'faceItem': kim.visual(value['basicFaceItemID']), 'leftArmItem': None}
    if len(professions) != 3: raise ValueError('Missing original Elesis unit identity')
    return {'schemaVersion': 1, 'id': 'elesis-costumes-target2016-v1', 'clientMeasured': False,
        'sets': SELECTIONS, 'professions': professions, 'items': items,
        'inputs': [catalog.evidence(kp),catalog.evidence(up)],
        'selectionNotes': ['Original Elesis officer hat, Nasod, Blue Moon Royal Maid and Solace item identities.',
            'Cosmetic geometry only; preserve each profession face and original combat body helpers.',
            'Common material policy is a Web adaptation; target2016 full-client pixels are not measured.']}


def main(record_only):
    catalog = Catalog(Path('asset_work')); contract = record(catalog)
    write_json(ROOT/'contracts/elesis-costumes-source-v1.json', contract)
    if record_only:
        print({'items': len(contract['items'])}); return
    output = ROOT/'artifacts/costumes'
    previous = json.loads((output/'manifest.json').read_text('utf8'))
    particles = json.loads((output/'particles.json').read_text('utf8'))
    common.CHARACTERS = {'elesis': {'unitType': 8, 'motion': 'Motion_EL.x', 'weaponMount': 'Dummy3_Weapon',
        'weaponFrameRenames': {name: 'Costume_Weapon_'+name for name in ('Object01','Object02','Object04','Sphere01')}}}
    common.SETS = {key: {'name': common.SETS[key]['name'], 'elesis': value} for key, value in SELECTIONS.items()}
    added = common.build(catalog, contract, output)
    previous['characters']['elesis'] = added['characters']['elesis']
    previous['sourceEvidence'].extend(added['sourceEvidence'])
    write_json(output/'manifest.json', previous)
    added_particles = json.loads((output/'particles.json').read_text('utf8'))
    particles['templates'].update(added_particles['templates']); write_json(output/'particles.json', particles)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--record-only', action='store_true')
    main(parser.parse_args().record_only)
