"""Record fixed V5 reference hashes and independently cross-check naked growth.

The table stops at 80. Agreement there does NOT recover the target2016 level85
server table. Run against a task-local bare checkout, never the shared upstream.
"""
import argparse
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
BASE = 'JP_TW_EU_CN_US/Trunk/'
FILES = {
    'KncWX2Server/GameServer/GSUserFunction.cpp': [12164, 12252],
    'KncWX2Server/GameServer/Inventory.cpp': [2290, 2364],
    'KncWX2Server/ServerResource/EnchantTable.lua': [288, 303],
    'KncWX2Server/Common/CommonPacket.h': [1006, 1034],
    'KncWX2Server/GameServer/UserSkillTree.cpp': [930, 969],
    'KncWX2Server/Common/X2Data/XSLSkillTree.cpp': [1065, 1070],
    'KncWX2Server/Common/X2Data/XSLCharacterStatTable.cpp': [246, 327],
    'X2Lib/X2ItemStatCalculator.cpp': [190, 389],
    'KncWX2Server/ServerResource/StatTable.lua': [1294, 1957],
    'KncWX2Server/GameServer/StatTable.cpp': [82, 104],
}


def audit(repo, contract):
    def git(*args):
        return subprocess.check_output(['git', '--git-dir='+str(repo), *args])
    records, contents = [], {}
    for name, lines in FILES.items():
        path = BASE+name
        data = git('show', COMMIT+':'+path)
        contents[Path(name).name] = data.decode('utf-8', errors='replace')
        records.append(dict(path=path, sha256=hashlib.sha256(data).hexdigest(),
                            gitBlob=git('rev-parse', COMMIT+':'+path).decode().strip(), lines=lines))
    stat_rows = re.findall(r'StatTable:SetUnitStat\(\s*(\d+),\s*(\d+),\s*\{([^}]+)\}', contents['StatTable.lua'])
    fields = dict(AtkPhysic='physicalAttack', AtkMagic='magicAttack',
                  DefPhysic='physicalDefence', DefMagic='magicDefence', HP='hpMax')
    verified, differences = [], []
    for career, level, body in stat_rows:
        if career not in ('100', '107'):
            continue
        level = int(level)
        unit, job = ('UT_ELSWORD', 'UC_ELSWORD_LORD_KNIGHT') if career == '100' else ('UT_RAVEN', 'UC_RAVEN_RECKLESS_FIST')
        rows = dict(re.findall(r'(\w+)\s*=\s*([\d.]+)', body))
        for field, key in fields.items():
            B, A = contract['character'][unit][key], contract['career'][job][key]
            if level == 1:
                value = A if key == 'hpMax' else math.floor(A*.8+.5)
            else:
                value = B*(1+.15*(level-1)) if key == 'hpMax' else math.floor(B*(.8+.0225*(level-1))+.5)
            if abs(float(rows[field])-value) > 1e-7:
                differences.append(dict(career=int(career), level=level, field=key,
                                        reference=float(rows[field]), inferred=value))
        verified.append((int(career), level))
    if set(verified) != {(career, level) for career in (100, 107) for level in range(1, 81)}:
        raise ValueError('Expected exactly two complete 1..80 tables')
    rates = dict(re.findall(r'SetEnchantRate\(\s*(\d+),\s*([\d.]+)\s*\)', contents['EnchantTable.lua']))
    if float(rates['9']) != 1.75 or float(rates['11']) != 2.55:
        raise ValueError('Unexpected enhancement rates')
    return dict(schemaVersion=1, evidenceClass='fixed-V5-reference-not-target2016',
                repository='reference-v5', commit=COMMIT,
                files=records, enhancementRates={'9': 1.75, '11': 2.55},
                pvpChannel='PCC_PLAY; not PCC_FREE or PCC_TOURNAMENT',
                growthCrossCheck=dict(careers=[100, 107], levels=[1, 80], statValuesChecked=800,
                                     matches=800-len(differences), differences=differences,
                                     maxAbsoluteDifference=max((abs(r['reference']-r['inferred']) for r in differences), default=0),
                                     level85Present=False,
                                     note='HP table retains .5; server integer conversion truncates. Requested level85 HP is integral.'),
                userAcceptedPolicies=['target-table-growth-inference-v1', 'fixed-v5-enhance-ranked-pvp-v1'],
                originalClientRuntimeMeasurements=0)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('bare_git_dir', type=Path)
    cli.add_argument('contract', type=Path)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    result = audit(args.bare_git_dir, json.loads(args.contract.read_text(encoding='utf-8')))
    args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    check = result['growthCrossCheck']
    print(f"Fixed V5 hashes verified; {check['matches']}/800 naked values match, max difference {check['maxAbsoluteDifference']} (85 remains inference)")
