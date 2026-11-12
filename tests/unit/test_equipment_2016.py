import copy
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from extract_equipment_2016 import Kim208
from equipment_formula_evidence import evaluate,source_cases


def sample():
    # Synthetic legal KIM208 sample, not a copy of the whole client database.
    data=bytearray(250)
    struct.pack_into('<4sIII',data,0,b'KIM ',0x1201,1,0)
    struct.pack_into('<I',data,16,30516)
    struct.pack_into('<IIII',data,20,30516,(6<<20)|(1<<16),0,117)
    struct.pack_into('<I',data,20+56,228)
    struct.pack_into('<I',data,20+180,238)
    data[20+193:20+195]=bytes([85,4]);data[20+197]=2
    struct.pack_into('<H',data,228,4);data[230:238]='Test'.encode('utf-16le')
    data[238:243]=bytes([28,28,28,0,0])
    return data


class EquipmentSourceTests(unittest.TestCase):
    def test_legal_sample(self):
        item=Kim208(sample()).item(30516)
        self.assertEqual((item['name'],item['useLevel'],item['grade'],item['slot']),('Test',85,6,2))
        self.assertEqual(item['relativeLevels']['physicalAttack'],28)

    def test_bad_headers_and_truncation(self):
        data=sample()
        for cut in [0,4,15,16,100,227]:
            with self.assertRaises(ValueError): Kim208(data[:cut])
        for offset,value in [(0,0),(4,0x1202),(8,1000001),(16,123)]:
            bad=bytearray(data);struct.pack_into('<I',bad,offset,value)
            with self.assertRaises(ValueError): Kim208(bad)

    def test_bad_pointers(self):
        for field,offset in [(56,10),(56,249),(180,249),(148,230)]:
            bad=sample();struct.pack_into('<I',bad,20+field,offset)
            with self.assertRaises(ValueError): Kim208(bad).item(30516)

    def test_bytecode_oracle_reproduces_evidence(self):
        contract=json.loads((ROOT/'contracts/equipment-2016-source-v1.json').read_text(encoding='utf-8'))
        expected=json.loads((ROOT/'reports/equipment-2016-formula-evidence-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(source_cases(contract,('RF','LK','VC','RS','BM')),expected)

    def test_oracle_rejects_unrecognized_instructions(self):
        contract=json.loads((ROOT/'contracts/equipment-2016-source-v1.json').read_text(encoding='utf-8'))
        p=copy.deepcopy(contract['formulaPrototypes'][0]);p['instructions'][0]=0x49
        with self.assertRaises(ValueError):evaluate(p,[470,430,1,85,28])

    def test_is_source_bytecode_cases_remain_independent(self):
        contract=json.loads((ROOT/'contracts/equipment-2016-source-v1.json').read_text(encoding='utf-8'))
        expected=json.loads((ROOT/'reports/is-equipment-bytecode-v1.json').read_text(encoding='utf-8'))
        self.assertEqual(source_cases(contract, ('IS',)),expected)
        self.assertEqual(len(expected['cases']),6)


if __name__=='__main__': unittest.main()
