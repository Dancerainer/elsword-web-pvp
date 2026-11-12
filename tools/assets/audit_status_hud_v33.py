"""Freeze target2016 HUD coordinates from existing static parsers; no Lua execution."""
from pathlib import Path
import json
import sys
import hashlib
import argparse
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/assets'), str(ROOT / 'tools/assets/character')]
from build_rf import Catalog
from build_lk_sword_ui import inspect_picture_groups
from kl82_static import parse, declarations
from ui import read_tet, crop_piece


def name_strings(data):
    """Read the target NAME string declarations; do not execute their Lua."""
    _, _, calls = declarations(parse(data), capture_calls=True, capture_unresolved=True)
    values, names, rows = {}, {}, []
    symbol = lambda value: value['$symbol']
    for index, call in enumerate(calls):
        target, args = call['target'], call['args']
        if target in ('D3DXVECTOR2', 'D3DXCOLOR'):
            values[f'call@{index}.return0'] = args
        elif target.endswith('.SetName'):
            names[symbol(args[0])] = args[1]
        elif target.endswith('.AddString') and names.get(symbol(args[0])) == 'NAME':
            value = args[1]
            rows.append({'index': len(rows), 'position': values[symbol(value['POS'])],
                         'color': values[symbol(value['COLOR'])],
                         'outlineColor': values[symbol(value['OUTLINE_COLOR'])],
                         'fontIndex': symbol(value['FONT_INDEX']),
                         'fontStyle': symbol(value['FONT_STYLE']),
                         'alignment': symbol(value['SORT_FLAG']), 'instruction': call['instruction']})
    if len(rows) != 3:
        raise ValueError('Original NAME must declare three strings')
    return rows


def audit(source=Path('asset_work')):
    catalog = Catalog(source)
    add_path = catalog.path('DLG_Add_DP_And_Mutation.lua')
    status_path = catalog.path('DLG_PVP_Game_My_State_NEW.lua')
    add = inspect_picture_groups(add_path.read_bytes())
    status = inspect_picture_groups(status_path.read_bytes())
    dp = add['g_pStatic_DP_Gage']
    mutations = add['g_pStatic_Mutation_Gage']
    indicators = add['FormationModeCoolTime']
    def offset(point, origin):
        return [point[i] - origin[i] for i in range(2)]
    return {'schemaVersion': 1, 'displayOnly': True, 'nativeClientMeasured': False,
            'sourceDialog': catalog.evidence(add_path),
            'statusSourceDialog': catalog.evidence(status_path),
            'nameStrings': name_strings(status_path.read_bytes()),
            'dpOrigin': dp[0]['position'],
            'dpFillOffset': offset(dp[1]['position'], dp[0]['position']),
            'dpLabelOffset': offset(indicators[-1]['position'], dp[0]['position']),
            'dpCooldownOffset': offset(indicators[0]['position'], dp[0]['position']),
            'mutationOrigin': mutations[0]['position'],
            'mutationOffsets': [offset(row['position'], mutations[0]['position']) for row in mutations[1:]],
            'awakeningBackgrounds': [row['position'] for row in status['StaticPVPGameStateWakeSlot'][:3]],
            'awakeningBeads': [row['position'] for row in status['StaticPVPGameStateWakeOrb'][:3]],
            'ravenThirdBackground': status['StaticPVPGameStateWakeSlot'][4]['position'],
            'ravenThirdBead': status['StaticPVPGameStateWakeOrb'][4]['position']}


def verify_pixels(assets, source=Path('asset_work')):
    """Compare existing runtime PNG pixels directly against fresh target TET crops."""
    catalog = Catalog(source)
    common = json.loads((assets / 'ui/manifest.json').read_text('utf8'))
    add = json.loads((assets / 'ui/add/index.json').read_text('utf8'))
    records = []
    for key in ['GAGE_BG', 'HP', 'MP', 'MP_ACTIVE', 'MP_100_BAR', 'RAGE', 'RAGE_BG', 'RAGE_BEAD', 'RAVEN_3', 'RAVEN_3_BG', 'R_FIST_STATE']:
        row = common['pieces'][key]
        records.append((Path('ui') / row['file'], key, row['atlas'] + '.tga', row['atlas'] + '.tet'))
    for profession in ['lk', 'rs', 'is', 'bm', 'vc', 'gm', 'bh', 'ca', 'lp', 'mm', 'de']:
        row = json.loads((assets / profession / 'ui/manifest.json').read_text('utf8'))['pieces']['state']
        records.append((Path(profession) / row['file'], row['piece'], row['atlasSource']['name'], row['tetSource']['name']))
    for key in ['BG_DPSYSTEM_BACK', 'BG_DPSYSTEM_GAUGE', 'BG_MSYSTEM_BACK', 'BG_MSYSTEM_ACTIVE', 'BG_DP', *['BG_DP_0'+str(i) for i in range(1, 6)]]:
        row = add['pieces'][key]
        records.append((Path('ui/add') / row['file'], key, row['atlasSource']['name'], row['tetSource']['name']))
    result = []
    for relative, key, atlas, table in records:
        image_path, table_path = catalog.path(atlas), catalog.path(table)
        pieces = read_tet(table_path.read_bytes())
        exact_key = next(name for name in pieces if name.casefold() == key.casefold())
        expected, bounds = crop_piece(Image.open(image_path).convert('RGBA'), pieces[exact_key])
        actual = Image.open(assets / relative).convert('RGBA')
        if actual.size != expected.size or actual.tobytes() != expected.tobytes():
            raise ValueError('Runtime image differs from original pixels: ' + str(relative))
        result.append({'file': relative.as_posix(), 'piece': exact_key, 'size': list(actual.size), 'bounds': bounds,
                       'sha256': hashlib.sha256((assets / relative).read_bytes()).hexdigest(),
                       'rgbaSha256': hashlib.sha256(actual.tobytes()).hexdigest(),
                       'atlasSource': catalog.evidence(image_path), 'tetSource': catalog.evidence(table_path)})
    return {'evidenceClass': 'target2016-static-pixel-comparison', 'nativeClientMeasured': False,
            'resourceChanges': 0, 'imagesVerified': len(result), 'images': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path)
    args = parser.parse_args()
    output = ROOT / 'contracts/status-hud-source-v33.json'
    output.write_text(json.dumps(audit(), ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(output)
    if args.assets:
        proof = ROOT / 'reports/status-hud-pixels-v33.json'
        proof.write_text(json.dumps(verify_pixels(args.assets), ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        print(proof)
