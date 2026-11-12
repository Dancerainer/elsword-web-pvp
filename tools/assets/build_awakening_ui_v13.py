"""Read-only source audit and exact copy of the NA client's HUD font."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
FONT_SHA = '08f45bf539954d3252df97a2ae563362ed2ad5ebe05f2d1f2bc54b931e4d0550'
LUA_SHA = '84fc0f0d865738c2b6306ab148e3d9389f11189ec4856eae0ab8cb18af00158c'
CPP_SHA = '2e3a631f62ba5b2f4a6854989d2432ec96e00973f88852a5fdc1b224ae6805a8'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, expected):
    data = path.read_bytes()
    if sha(data) != expected:
        raise ValueError('Source hash changed: ' + str(path))
    return data


def inspect_lua(path):
    checked(path, LUA_SHA)
    sys.path.insert(0, str(ROOT / 'tools/combat'))
    from kl82_static import read_declarations
    document = read_declarations(path, capture_calls=True, capture_unresolved=True)
    calls = document['nativeCalls']
    owner = next(call['args'][0]['$symbol'] for call in calls
                 if call['target'].endswith('.SetName') and call['args'][1] == 'Static_HyperMode_Time')
    string = next(call for call in calls if call['target'] == owner + '.AddString')
    properties = string['args'][1]
    symbols = {key: properties[key]['$symbol'] for key in ('FONT_INDEX', 'SORT_FLAG', 'FONT_STYLE')}
    if symbols != {'FONT_INDEX': 'XUF_DODUM_13_SEMIBOLD', 'SORT_FLAG': 'DRAW_TEXT.DT_CENTER', 'FONT_STYLE': 'FONT_STYLE.FS_SHELL'}:
        raise ValueError('Target countdown font/style changed')
    point_symbol = properties['POS']['$symbol']
    color_symbol = properties['OUTLINE_COLOR']['$symbol']
    point = calls[int(point_symbol.split('@')[1].split('.')[0])]['args']
    color = calls[int(color_symbol.split('@')[1].split('.')[0])]['args']
    if point != [77, 46] or color != [0, 0, 0, 1]:
        raise ValueError('Target countdown geometry/color changed')
    return {'fontSymbol': symbols['FONT_INDEX'], 'alignment': symbols['SORT_FLAG'], 'style': symbols['FONT_STYLE'],
            'position': point, 'outlineColor': color, 'instruction': string['instruction']}


def build(client, source, reference, output):
    font = client / 'data/tahoma.ttf'
    font_data = checked(font, FONT_SHA)
    lua = source / 'raw/data/data034.kom/DLG_PVP_Game_My_State_NEW.lua'
    declaration = inspect_lua(lua)
    cpp = reference / 'X2Lib/X2GageUI.cpp'
    cpp_data = checked(cpp, CPP_SHA)
    start = cpp_data.index(b'void CX2MyGageUI::UpdateHyperModeRemainTime()')
    end = cpp_data.index(b'void CX2MyGageUI::UpdatePartyLeaderUI()', start)
    body = cpp_data[start:end]
    for token in (b'static_cast<UINT>( fRemainTime )', b'++uiHyperModeTime', b'uiHyperModeTime < 8', b'#CFF0000%ld%s'):
        if token not in body:
            raise ValueError('Reference countdown rule changed')
    output.mkdir(parents=True, exist_ok=True)
    destination = output / 'tahoma.ttf'
    shutil.copyfile(font, destination)
    report = {'schema': 'elsword.rf-ui-v13.source.v1', 'targetClientMeasured': False,
              'targetDeclaration': {'path': str(lua), 'sha256': LUA_SHA, **declaration},
              'font': {'path': str(font), 'sha256': FONT_SHA, 'bytes': len(font_data),
                       'output': destination.relative_to(ROOT).as_posix(), 'outputSha256': sha(destination.read_bytes())},
              'countdown': {'evidence': 'fixed-V5-reference', 'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
                            'path': 'X2Lib/X2GageUI.cpp', 'sha256': CPP_SHA, 'functionBodySha256': sha(body),
                            'rule': 'positive remaining => trunc(remaining)+1; zero/nonpositive => empty',
                            'redBelowSeconds': 8},
              'adaptation': {'unit': 'seconds', 'fontWeight': 600, 'fontSizePx': 13,
                             'mapping': 'Original NA Tahoma font candidate; XUF_DODUM_13_SEMIBOLD regional mapping unverified'},
              'pending': ['Native 2016 font registration mapping and glyph rasterization', 'Original 2016 countdown runtime comparison']}
    (ROOT / 'contracts/rf-ui-source-v13.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', type=Path, default=Path('asset_sources/client'))
    parser.add_argument('--source', type=Path, default=Path('asset_work'))
    parser.add_argument('--reference', type=Path, default=ROOT / '.cache/native-reference')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/ui/fonts')
    args = parser.parse_args()
    report = build(args.client, args.source, args.reference, args.output)
    print(json.dumps({'fontBytes': report['font']['bytes'], 'fontSha256': report['font']['sha256'],
                      'targetClientMeasured': False}))
