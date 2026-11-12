"""Evaluate only the two audited straight-line target stat prototypes.

This is an independent source-bytecode oracle, not the JS implementation.
No general Lua, external callback, branch or client execution is supported.
"""
import json
import math
import struct
from pathlib import Path
from kl82_static import OPS


def evaluate(prototype, args):
    if prototype['params'] != 5 or prototype['upvalues'] or len(args) != 5:
        raise ValueError('Expected audited five-argument pure prototype')
    regs = list(args) + [None] * prototype['frame_size']
    gc = list(reversed(prototype['gc']))
    nums = prototype['numbers']
    for pc, word in enumerate(prototype['instructions']):
        opcode, a, b, c, d = word & 255, (word >> 8) & 255, word >> 24, (word >> 16) & 255, word >> 16
        op=OPS.get(opcode)
        if op == 'MOV': regs[a]=regs[d]
        elif op == 'GGET':
            if gc[d]!='math': raise ValueError('Only math allowed')
            regs[a]='math'
        elif op == 'TGETS':
            if regs[b]!='math' or gc[c]!='floor': raise ValueError('Only math.floor allowed')
            regs[a]='math.floor'
        elif op and op.endswith(('VN','NV','VV')):
            left,right=(regs[b],nums[c]) if op.endswith('VN') else (nums[c],regs[b]) if op.endswith('NV') else (regs[b],regs[c])
            if op.startswith('ADD'): regs[a]=left+right
            elif op.startswith('SUB'): regs[a]=left-right
            elif op.startswith('MUL'): regs[a]=left*right
            elif op.startswith('DIV'): regs[a]=left/right
            else: raise ValueError('Unsupported arithmetic')
        elif opcode==0x2e and pc==len(prototype['instructions'])-1 and d==2 and regs[a]=='math.floor':
            return math.floor(regs[a+1])
        else: raise ValueError(f'Unsupported stat opcode {opcode} at {pc}')
    raise ValueError('Missing audited tail return')


def source_cases(contract, professions=('RF','LK','VC')):
    f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
    cases=[]
    for profession,unit,career in [('RF','UT_RAVEN','UC_RAVEN_RECKLESS_FIST'),('LK','UT_ELSWORD','UC_ELSWORD_LORD_KNIGHT'),('VC','UT_RAVEN','UC_RAVEN_VETERAN_COMMANDER'),('RS','UT_ELSWORD','UC_ELSWORD_RUNE_SLAYER'),('BM','UT_RAVEN','UC_RAVEN_BLADE_MASTER'),('IS','UT_ELSWORD','UC_ELSWORD_INFINITY_SWORD')]:
        if profession not in professions: continue
        for item_id,item in contract['items'].items():
            if item['unitType'] not in (0,1 if unit=='UT_ELSWORD' else 4): continue
            slot=next(k for k,v in contract['enums']['EQIP_POSITION'].items() if v==item['slot'])
            expected={}
            for field,e in item['relativeLevels'].items():
                args=[f(contract['career'][career][field]),f(contract['character'][unit][field]),
                      f(contract['slots'][slot][field]),item['useLevel'],e]
                expected[field]=evaluate(contract['formulaPrototypes'][1 if field=='hpMax' else 0],args)
            cases.append(dict(profession=profession,itemId=int(item_id),expected=expected))
    return dict(evidenceClass='target2016-static-bytecode-evaluation',
                originalClientRuntimeMeasurements=0,sourceSha256=contract['inputs']['CharacterStatTable.lua']['sha256'],cases=cases)


if __name__=='__main__':
    import argparse
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('contract',type=Path);cli.add_argument('--output',type=Path,required=True)
    args=cli.parse_args()
    evidence=source_cases(json.loads(args.contract.read_text(encoding='utf-8')))
    args.output.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(f"{len(evidence['cases'])} source-bytecode item cases")
