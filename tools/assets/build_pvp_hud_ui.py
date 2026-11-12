"""Crop target2016 PvP HUD pixels; retain static and fixed-reference evidence.

No client/Lua UI is executed. RankBox_NEW is read only through its supported
straight-line prefix; its conditional remainder stays unsupported.
"""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from PIL import Image
from ui import read_tet, crop_piece, extract_other_hud_layout

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'combat'))
from kl82_static import parse, declarations, OPS


def sha(data):
    return hashlib.sha256(data).hexdigest()


def static_layout(data):
    chunk = parse(data)
    prototype = chunk['prototypes'][-1]
    words = prototype['instructions']
    end = next((i for i, word in enumerate(words) if word & 255 not in OPS or word & 255 == 0x47), len(words))
    total, next_opcode = len(words), words[end] & 255 if end < len(words) else None
    prototype['instructions'] = words[:end] + [0x47]
    _, _, calls = declarations(chunk, capture_calls=True, capture_unresolved=True)
    vectors, pictures, objects = {}, {}, {}
    symbol = lambda value: value.get('$symbol') if isinstance(value, dict) else None
    for index, call in enumerate(calls):
        target, args = call['target'], call['args']
        owner = symbol(args[0]) if args else None
        if target == 'D3DXVECTOR2':
            vectors[f'call@{index}.return0'] = args
        elif target.endswith('.SetName'):
            objects[owner] = args[1]
        elif target.endswith('.AddPicture'):
            pictures.setdefault(symbol(args[1]), {})['owner'] = owner
        elif target.endswith('.SetTex'):
            pictures.setdefault(owner, {}).update(atlas=args[1], piece=args[2], textureInstruction=call['instruction'])
        elif target.endswith('.SetPoint'):
            row = pictures.setdefault(owner, {})
            for corner in ['LEFT_TOP', 'RIGHT_BOTTOM']:
                if corner in args[1]:
                    point = vectors.get(symbol(args[1][corner]))
                    if point is None:
                        raise ValueError('Unresolved target UI coordinate')
                    row[corner] = point
            row['positionInstruction'] = call['instruction']
    return {'instructionPrefixEnd': end, 'totalInstructions': total, 'nextOpcode': next_opcode,
            'conditionalRemainder': 'none' if next_opcode in (None, 0x47) else 'unsupported-not-executed',
            'pictures': [dict(row, control=objects.get(row.get('owner'))) for row in pictures.values() if 'piece' in row]}


def build(source, pvp_reference, gauge_reference, output, project):
    source, pvp_reference, gauge_reference, output, project = [Path(p).resolve() for p in (source, pvp_reference, gauge_reference, output, project)]
    if any(output.is_relative_to(path) for path in (source, pvp_reference, gauge_reference)):
        raise ValueError('Output overlaps read-only inputs')
    with closing(sqlite3.connect((source / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True)) as con:
        con.row_factory = sqlite3.Row
        sources = {}

        def find(name):
            rows = con.execute('SELECT * FROM assets WHERE name=? COLLATE NOCASE AND status=?', (name, 'ok')).fetchall()
            if not rows or len({row['sha256'] for row in rows}) != 1:
                raise ValueError('Missing/ambiguous original input ' + name)
            row = dict(rows[0])
            path = (source / row['raw_path']).resolve()
            if not path.is_relative_to(source / 'raw'):
                raise ValueError('Original input outside raw source')
            data = path.read_bytes()
            if sha(data) != row['sha256']:
                raise ValueError('Original input hash changed ' + name)
            sources[name] = {'name': row['name'], 'rawPath': row['raw_path'], 'sha256': row['sha256'], 'evidenceClass': 'target2016-static'}
            return path, data

        reference_catalog = json.loads((project / 'contracts/rf-pvp-rules-source-v1.json').read_text('utf-8'))['v5']
        gauge_catalog = json.loads((project / 'reports/rf-presentation-ui-native-reference.json').read_text('utf-8'))
        buff_catalog = json.loads((project / 'contracts/rf-buff-bar-source-v1.json').read_text('utf-8'))
        expected = {row['path'].split('/')[-1]: row for row in reference_catalog['files'] + gauge_catalog['files'] + buff_catalog['referenceSources']}
        references = []
        for root, filename, lines in [(pvp_reference, 'X2GUUser.cpp', [22136, 22205]),
                                      (pvp_reference, 'X2PVPGame.cpp', [179, 197]),
                                      (pvp_reference, 'X2PVPGameTeamDeath.cpp', [259, 460]),
                                      (pvp_reference, 'X2StatePVPGame.cpp', [782, 1731]),
                                      (gauge_reference, 'X2GageUI.cpp', [3165, 3196]),
                                      (gauge_reference, 'X2GageManager.cpp', [3750, 3795])]:
            path = root / 'X2Lib' / filename
            data = path.read_bytes()
            row = expected[filename]
            if sha(data) != row['sha256']:
                raise ValueError('Fixed reference hash changed ' + filename)
            references.append(dict(row, sourcePath=str(path), relevantLines=lines, evidenceClass='fixedV5-primary-reference'))

        output.mkdir(parents=True, exist_ok=True)
        manifest = {'schemaVersion': 1, 'targetVersion': 'Steam-NA-2016-V6.0420.5', 'nativeClientMeasured': False, 'pieces': {}, 'sources': sources}
        # All supported professions can receive each other's source-owned buffs.
        # Only extract declared icon pixels; this catalog never activates effects.
        icon_templates, icon_profiles = {}, []
        for profession in ['rf', 'lk', 'vc']:
            relative = f'packages/combat-core/{profession}-profile.json'
            profile_data = (project / relative).read_bytes()
            profile = json.loads(profile_data)
            icon_profiles.append({'path': relative, 'sha256': sha(profile_data), 'evidenceClass': 'project-extracted-target2016-declarations'})
            for template_id, row in profile['buffTemplates'].items():
                raw = row['raw']
                if not raw.get('BUFF_ICON_TEXTURE_NAME') or not raw.get('BUFF_ICON_TEXTURE_KEY') or raw.get('USE_BUFF_ICON') in (0, False):
                    continue
                if raw['BUFF_ICON_TEXTURE_NAME'].casefold() != 'dlg_ui_common_texture_buff.tga':
                    raise ValueError('Unsupported original status icon atlas')
                key = raw['BUFF_ICON_TEXTURE_KEY']
                if template_id in icon_templates and icon_templates[template_id] != key:
                    raise ValueError('Conflicting original status icon identity')
                icon_templates[template_id] = key
        groups = {
            'DLG_UI_Common_Texture65_NEW': ['PVP_SCORE_BG', 'PVP_SCORE_BG_2', 'PVP_RED', 'PVP_BLUE', 'PVP_BLUE_LEFT', 'PVP_RED_RIGHT', 'VS'] + [f'{team}_NUM_{i}' for team in ['RED', 'BLUE'] for i in range(10)],
            'DLG_UI_Common_Texture64_NEW': ['PVP_SCORE_TOP', 'PVP_SCORE_MIDDLE', 'PVP_SCORE_BOTTOM', 'PVP_SCORE_LINE', 'PVP_SCORE_RED', 'PVP_SCORE_BLUE', 'PVP_SCORE_TAB'],
            'DLG_UI_Common_Texture63_NEW': ['PARTY_GAGE_BG', 'PARTY_HP', 'PARTY_MP', 'PARTY_BLACK'],
            'DLG_UI_Common_Texture25_NEW': ['R_FIST_PARTY'],
            # The screenshot's TIME/KILL panel is a separate target2016 atlas,
            # not the older TeamDeath_Score_NEW Lua layout retained below.
            'DLG_UI_PVP_Score_01': ['BG_PVP', 'BG_PVPSCORE_RED', 'BG_PVPSCORE_BLUE', 'TEXT_KILL']
                + [f'{prefix}_{i}' for prefix in ['LSCORE', 'RSCORE', 'TIMENUM', 'KILLNUM'] for i in range(10)],
            'DLG_UI_Common_Texture_Buff': sorted(set(icon_templates.values())),
        }
        for atlas, wanted in groups.items():
            _, tet = find(atlas + '.tet')
            path, _ = find(atlas + '.tga')
            records = read_tet(tet)
            with Image.open(path) as original:
                pixels = original.convert('RGBA')
            for key in wanted:
                keys = [actual for actual in records if actual.casefold() == key.casefold()]
                if len(keys) != 1:
                    raise ValueError('Missing/ambiguous target piece ' + key)
                record = records[keys[0]]
                mapping = 'original-integer-rectangle'
                # This original blue row is a 1px trapezoid, not a rectangle.
                # Preserve the quad and make its web resampling explicit; do not
                # silently crop/round it or claim the unknown native GPU sampler.
                if key == 'PVP_SCORE_BLUE' and record['points'] == [[224.0, 163.0], [462.0, 184.0], [224.0, 184.0], [461.0, 163.0]] and record['size'] == [237.0, 21.0]:
                    points = record['points']
                    cropped = pixels.transform((237, 21), Image.Transform.QUAD, tuple(value for i in [0, 2, 1, 3] for value in points[i]), Image.Resampling.BILINEAR)
                    bounds = [224, 163, 462, 184]
                    mapping = 'original-trapezoid-to-237x21-bilinear-web-candidate'
                else:
                    cropped, bounds = crop_piece(pixels, record)
                file = key.lower() + '.png'
                cropped.save(output / file)
                manifest['pieces'][key] = {'file': file, 'width': cropped.width, 'height': cropped.height, 'atlas': atlas,
                                           'piece': keys[0], 'bounds': bounds, 'originalPoints': record['points'], 'pixelMapping': mapping,
                                           'rgbaSha256': sha(cropped.tobytes()), 'sha256': sha((output / file).read_bytes())}
        manifest['buffIcons'] = {template_id: manifest['pieces'][key] for template_id, key in icon_templates.items()}
        layouts = {}
        for name in ['DLG_PVP_Game_State_TeamDeath_Score_NEW.lua', 'DLG_PVP_Game_State_RankBox_NEW.lua']:
            _, data = find(name)
            layouts[name] = static_layout(data)
        path, _ = find('DLG_PVP_Game_Other_State_NEW.lua')
        layouts[path.name] = extract_other_hud_layout(path)
        contract = {'schema': 'elsword.rf-pvp-hud-source.v1', 'nativeClientMeasured': False, 'originalClientRuntimeTrajectories': 0,
                    'target': {'evidenceClass': 'target2016-static', 'version': manifest['targetVersion'], 'sources': sources, 'layouts': layouts},
                    'reference': {'evidenceClass': 'fixedV5-primary-reference', 'commit': reference_catalog['commit'], 'files': references,
                                  'note': 'Pinned primary source contains 2026 reconstruction patches; target2016 macro selection and runtime remain unverified.'},
                    'presentation': {'coordinateBasis': [1024, 768], 'nameAnchor': 'unit GetPos projected; no head-bone offset',
                                     'nameColors': {'red': '#ffaa77', 'blue': '#54ddff'}, 'nameOutline': {'red': '#ff0000', 'blue': '#0000ff'},
                                     'allyOrigin': [6, 121], 'enemyOrigin': [868, 77], 'memberRowStride': 44,
                                     'enemyMp': 'empty unless local uiAbilities.showOpponentMp === true',
                                     'scoreDialogOffset': [0, 17], 'scoreOrder': 'own team left; opponent right (MODIFY_PVP_SCORE_UI reference branch)',
                                     'time': {'position': [516, 127], 'conversion': 'nonnegative trunc remaining seconds; no minutes formatting', 'color': '#ffff00'},
                                     'board': {'right': 5, 'bottom': 28, 'width': 245, 'rowHeight': 21, 'topHeight': 30, 'bottomHeight': 10,
                                               'collapsed': 'local row only', 'expanded': 'all supplied players', 'localTextColor': '#ffff00'}},
                    'pixelAssets': manifest['pieces'],
                    'adaptations': ['Frozen 1v1/2v2/3v3 roster with stable server order; original eight-row client sorting is not ported',
                                    'K/A/D only; omit the original 3K+2 maximum-damage-kill-D score column because web assists have different ownership',
                                    'Member HP/MP numbers are the user-requested web addition', 'Disconnected roster slots remain visible with empty gauges',
                                    'English labels, browser font rasterization and narrow viewport scaling are web presentation adaptations'],
                    'limits': ['No original client execution or GPU comparison', 'Conditional RankBox Lua remainder remains unsupported',
                               'Original font symbol mapping, native text outline rasterization and target2016 macro set are unverified',
                               'Original blue statistics row has a one-pixel trapezoid; web bilinear resampling is explicit and native GPU sampling is unverified']}
        contract['redrawPresentation'] = {
            'evidenceClass': 'target2016-pixels-with-user-requested-web-layout',
            'scoreAtlas': 'DLG_UI_PVP_Score_01', 'scoreSize': [388, 81],
            'scoreOrder': 'own team left; opponent right', 'scoreDigitsMinimum': 2,
            'timeDigitsMinimum': 4, 'goalDigitsMinimum': 2,
            'timeMeaning': 'nonnegative truncated remaining seconds; TIME title is in the original background',
            'killMeaning': 'current match scoreLimit, not local player kills',
            'duel': 'BG_PVP with time only; omit team scores and KILL target',
            'memberRowStride': 44, 'memberLevel': 'actual actor formula combatLevel, then actor level; omit when unknown',
            'memberGeometry': 'native portrait crop; 108x28 frame at (37,9), HP 95x8 at (48,17), MP 93x8 at (46,27); scale the whole row',
            'topAnchors': 'local portrait left/top 0; score centered at top 0 at every width; responsive scale keeps both in the top band',
            'gaugeNumbers': 'local, member and practice target HP and MP right aligned, normal font weight',
            'status': 'local actor only; viewport top right, buff row then debuff row; enemy rows below both',
            'allyBuffs': False, 'skillScale': {'previous': 2, 'current': 1.7, 'relative': 0.85},
            'statusIconProfiles': icon_profiles, 'statusIconIds': sorted(icon_templates, key=int),
            'layoutBoundary': 'Score01 crop sizes/pixels are original. Placement and responsive scaling follow the user reference; no matching target2016 dynamic layout consumer or client execution was acquired.'}
        (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        (project / 'contracts/rf-pvp-hud-source-v1.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        print(json.dumps({'pieces': len(manifest['pieces']), 'output': str(output), 'nativeClientMeasured': False}))
        return manifest, contract


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('asset_work'))
    parser.add_argument('--pvp-reference', type=Path, required=True)
    parser.add_argument('--gauge-reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('artifacts/ui/pvp-hud'))
    parser.add_argument('--project', type=Path, default=Path('.'))
    args = parser.parse_args()
    build(args.source, args.pvp_reference, args.gauge_reference, args.output, args.project)
