"""Extract a deliberately narrow NA2016 KIM208 equipment contract, never run client code.

The 196-byte V5 KimTool is NOT used as a 2016 decoder. Target names are at
56 (not 44), stat pointers at 148, relative-level pointers at 180, and use
level/unit/slot at 193/194/197. Check every indexed record before selection.
Other target fields remain unsupported. Full client inputs stay outside Git.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
from kl82_static import read_declarations, parse

FIELDS = ['hpMax', 'physicalAttack', 'magicAttack', 'physicalDefence', 'magicDefence']
IDS = [30388, 30397, 30507, 30516, 153795, 153796, 153797, 153798]


class Kim208:
    def __init__(self, data):
        self.data = data
        if len(data) < 16 or data[:4] != b'KIM ' or self.uint(4) != 0x1201:
            raise ValueError('Expected NA2016 KIM 0x1201')
        self.count = self.uint(8)
        self.start = 16 + self.count * 4
        self.blob = self.start + self.count * 208
        if not 0 < self.count <= 1000000 or self.blob > len(data):
            raise ValueError('Truncated KIM208 record region')
        self.records = {}
        for i in range(self.count):
            item_id, offset = self.uint(16 + 4*i), self.start + 208*i
            if item_id in self.records or item_id != self.uint(offset):
                raise ValueError('KIM208 index/record mismatch or duplicate')
            self.records[item_id] = offset

    def uint(self, offset):
        if offset < 0 or offset + 4 > len(self.data):
            raise ValueError('Truncated uint32')
        return struct.unpack_from('<I', self.data, offset)[0]

    def blob_bytes(self, offset, count):
        if offset < self.blob or offset + count > len(self.data):
            raise ValueError('Invalid KIM208 blob pointer')
        return self.data[offset:offset+count]

    def item(self, item_id):
        p = self.records[item_id]
        name_p = self.uint(p+56)
        count = struct.unpack('<H', self.blob_bytes(name_p, 2))[0]
        if not 0 < count < 4096:
            raise ValueError('Invalid equipment name length')
        name = self.blob_bytes(name_p+2, count*2).decode('utf-16le').rstrip('\0')
        relative = self.blob_bytes(self.uint(p+180), 5)
        if self.uint(p+148) != 0:
            raise ValueError('This contract only supports selected relative-level equipment')
        flags = self.uint(p+4)
        return dict(itemId=item_id, name=name, grade=(flags >> 20)&15,
                    itemType=(flags >> 16)&15, itemLevel=self.uint(p+12),
                    useLevel=self.data[p+193], unitType=self.data[p+194], slot=self.data[p+197],
                    relativeLevels=dict(zip(FIELDS, relative)), recordOffset=p,
                    recordSha256=hashlib.sha256(self.data[p:p+208]).hexdigest())


def extract(raw_dir):
    raw_dir = Path(raw_dir)
    enum = read_declarations(raw_dir/'Enum.lua')['globals']
    stat = read_declarations(raw_dir/'CharacterStatTable.lua')['globals']
    kim = Kim208((raw_dir/'item.kim').read_bytes())
    def rows(table, symbols):
        result = {}
        for row in stat[table].values():
            symbol = row[1]['$symbol'].split('.')[-1]
            if symbol in symbols:
                result[symbol] = dict(zip(FIELDS, (row[n] for n in (6,2,4,3,5))))
        if set(result) != set(symbols):
            raise ValueError('Missing character/slot source row')
        return result
    result = dict(schemaVersion=1, version='na2016-perkisas-mk4-base-v1',
        evidenceClass='static-target2016-config', sourceBuild='NA2016 V6.0420.5',
        inputs={name:dict(sha256=hashlib.sha256((raw_dir/name).read_bytes()).hexdigest())
                for name in ['item.kim','CharacterStatTable.lua','Enum.lua']},
        kimLayout=dict(recordSize=208, indexedRecords=kim.count, allRecordIdsMatch=True,
                       unsupported='All fields outside the explicit selected equipment schema'),
        items={str(n):kim.item(n) for n in IDS},
        character=rows('CHARACTER_RELATIVE_STAT_TABLE',['UT_RAVEN','UT_ELSWORD']),
        career=rows('SECOND_CLASS_RELATIVE_STAT_TABLE',['UC_RAVEN_RECKLESS_FIST','UC_ELSWORD_LORD_KNIGHT','UC_RAVEN_VETERAN_COMMANDER','UC_ELSWORD_RUNE_SLAYER','UC_RAVEN_BLADE_MASTER','UC_ELSWORD_INFINITY_SWORD']),
        slots=rows('EQIP_POSITION_RELATIVE_STAT_TABLE',['EP_WEAPON_HAND','EP_DEFENCE_BODY','EP_DEFENCE_LEG','EP_DEFENCE_HAND','EP_DEFENCE_FOOT']),
        enums={k:enum[k] for k in ['ITEM_GRADE','EQIP_POSITION']},
        formulaPrototypes=parse((raw_dir/'CharacterStatTable.lua').read_bytes())['prototypes'][:2],
        exclusions=['socket options','random identification','set bonuses','special effects','accessories','titles'],
        unresolved=['target2016 enhancement consumer','target2016 server naked stats at level85','target2016 server PvP normalization'])
    for n in IDS:
        item=result['items'][str(n)]
        if item['grade'] != (6 if n < 100000 else 1):
            raise ValueError('Unexpected target equipment grade')
    return result


if __name__ == '__main__':
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('raw_dir',type=Path)
    cli.add_argument('--output',type=Path,required=True)
    args=cli.parse_args()
    output=extract(args.raw_dir)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(recordsChecked=output['kimLayout']['indexedRecords'], selectedItems=len(output['items']))))
