"""Append Elesis equipment evidence without rewriting the six-career source seal."""
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path
from extract_equipment_2016 import Kim208, FIELDS
from kl82_static import read_declarations
from equipment_formula_evidence import evaluate

ROOT = Path(__file__).resolve().parents[2]
CAREERS = {'GM': 'UC_ELESIS_GRAND_MASTER', 'BH': 'UC_ELESIS_BLAZING_HEART', 'CA': 'UC_ELESIS_CRIMSON_AVENGER'}
F = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]


def extract(raw):
    frozen = json.loads((ROOT/'contracts/equipment-2016-source-v1.json').read_text('utf8'))
    for name, row in frozen['inputs'].items():
        if hashlib.sha256((raw/name).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Original equipment input changed: '+name)
    enum = read_declarations(raw/'Enum.lua')['globals']
    tables = read_declarations(raw/'CharacterStatTable.lua')['globals']
    def rows(table, names):
        result = {}
        for row in tables[table].values():
            key = row[1]['$symbol'].split('.')[-1]
            if key in names:
                result[key] = dict(zip(FIELDS, (row[n] for n in (6,2,4,3,5))))
        if set(result) != set(names):
            raise ValueError('Missing original Elesis stat row')
        return result
    kim = Kim208((raw/'item.kim').read_bytes())
    unit = enum['UNIT_TYPE']['UT_ELESIS']
    # Match the same named legendary weapon family and levels as the frozen
    # baseline. Record selection is by original fields, never guessed IDs.
    weapons = {}
    for item_id in kim.records:
        p = kim.records[item_id]
        if kim.data[p+194] != unit or kim.data[p+197] != frozen['enums']['EQIP_POSITION']['EP_WEAPON_HAND']:
            continue
        if kim.data[p+193] not in (80,85) or (kim.uint(p+4)>>20)&15 != 6:
            continue
        try:
            item = kim.item(item_id)
        except ValueError:
            continue
        if item['name'].startswith('Perkisas:') and item['relativeLevels'] == frozen['items']['30388']['relativeLevels']:
            level = str(item['useLevel'])
            if level in weapons:
                raise ValueError('Ambiguous Elesis Perkisas weapon')
            weapons[level] = item
    if set(weapons) != {'80','85'}:
        raise ValueError('Missing Elesis Perkisas weapons')
    source = dict(schemaVersion=1, version='elesis-equipment-source-v1', evidenceClass='static-target2016-config',
        sourceBuild=frozen['sourceBuild'], inputs=frozen['inputs'], originalClientRuntimeMeasurements=0,
        character=rows('CHARACTER_RELATIVE_STAT_TABLE',['UT_ELESIS']),
        career=rows('SECOND_CLASS_RELATIVE_STAT_TABLE', list(CAREERS.values())),
        classes={id:enum['UNIT_CLASS'][name] for id,name in CAREERS.items()}, unitType=unit,
        weaponByLevel={level:row['itemId'] for level,row in weapons.items()},
        items={str(row['itemId']):row for row in weapons.values()},
        sharedSource='contracts/equipment-2016-source-v1.json',
        qualifications=['Target class and item fields are independent of copied equipment options.',
            'Level85 naked growth and ranked PvP normalization retain the accepted inference / fixed-V5 policy.',
            'No target2016 runtime measurements; passive and guild additions are separate.'])
    evidence = []
    for id, career in CAREERS.items():
        A, B = source['career'][career],source['character']['UT_ELESIS']
        anchor = {k:math.floor(A[k]*(1 if k=='hpMax' else .8)+.5) for k in FIELDS}
        naked = {k:math.floor(B[k]*(1+.15*84 if k=='hpMax' else .8+.0225*84)+.5) for k in FIELDS}
        items = []
        for item in [weapons['80'], *[frozen['items'][str(n)] for n in [153795,153796,153797,153798]]]:
            slot = next(k for k,v in frozen['enums']['EQIP_POSITION'].items() if v==item['slot'])
            base = {k:evaluate(frozen['formulaPrototypes'][1 if k=='hpMax' else 0],
                [F(A[k]),F(B[k]),F(frozen['slots'][slot][k]),item['useLevel'],item['relativeLevels'][k]]) for k in FIELDS}
            items.append(dict(itemId=item['itemId'],base=base,enhanced={k:int(F(v*F(1.75))) for k,v in base.items()}))
        totals = {k:sum(item['enhanced'][k] for item in items) for k in FIELDS}
        pvp = {k:anchor[k]+int(F(F(naked[k]-anchor[k])*F(.1)))+int(F(totals[k]*F(.1))) for k in FIELDS}
        pvp['hpMax'] = int(F(anchor['hpMax']*F(2.7)))+int(F(F(naked['hpMax']+totals['hpMax']-anchor['hpMax'])*F(.6)))
        evidence.append(dict(profession=id,items=items,character=dict(levelOne=anchor,naked=naked),equipment=totals,basePvp=pvp))
    return source,dict(schemaVersion=1,evidenceClass='original-target-bytecode-items-and-independent-reference-arithmetic',
        originalClientRuntimeMeasurements=0,sourceContract='contracts/elesis-equipment-source-v1.json',cases=evidence)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw',type=Path,required=True)
    args = parser.parse_args()
    source,evidence = extract(args.raw)
    for name,value in [('contracts/elesis-equipment-source-v1.json',source),('reports/elesis-equipment-evidence-v1.json',evidence)]:
        (ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps(dict(classes=source['classes'],weapons=source['weaponByLevel'],pvp={r['profession']:r['basePvp'] for r in evidence['cases']})))
