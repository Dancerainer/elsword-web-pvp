"""Extract exact 2016 skill window pieces and literal layout evidence, read only."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from PIL import Image
from ui import read_tet, crop_piece

GROUPS = {
    'DLG_UI_Common_Texture_NewSkill_02': [
        'BG_TOP', 'BG_MIDDLE', 'BG_BOTTOM', 'BG1_TOP', 'BG1_MIDDLE', 'BG1_BOTTOM',
        'BG_SKILL', 'SKILL_BG_ACTIVE', 'SKILL_BG_PASSIVE',
        'SKILL_BG_ACTIVE_BUFF', 'SKILL_BG_ACTIVE_SPECIAL',
        'MEMO_OPEN', 'MEMO_SELECT', 'MEMO_LOCK', 'MEMO_DISABLE', 'LINE'],
}
SCRIPTS = ['DLG_UI_Skill_Tree_New2015.lua', 'DLG_UI_Skill_Icon_New2015.lua']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def extract_layout(path):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'combat'))
    from kl82_static import read_declarations
    document = read_declarations(path, capture_calls=True, capture_unresolved=True)
    vectors, controls, pictures = {}, {}, {}
    def symbol(value):
        if not isinstance(value, dict) or '$symbol' not in value:
            raise ValueError('Unresolved UI object')
        return value['$symbol']
    for index, call in enumerate(document['nativeCalls']):
        target, args = call['target'], call['args']
        if target == 'D3DXVECTOR2':
            if len(args) == 2 and all(type(v) in (int, float) for v in args):
                vectors[f'call@{index}.return0'] = args
        elif target.endswith('.SetName') and len(args) == 2:
            controls[symbol(args[0])] = args[1]
        elif target.endswith('.AddPicture') and len(args) == 2:
            pictures.setdefault(symbol(args[1]), {})['owner'] = symbol(args[0])
        elif target.endswith('.SetTex') and len(args) == 3:
            pictures.setdefault(symbol(args[0]), {}).update(atlas=args[1], piece=args[2])
        elif target.endswith('.SetPoint') and len(args) == 2 and isinstance(args[1], dict):
            item = pictures.setdefault(symbol(args[0]), {})
            for key, value in args[1].items():
                if key in ('LEFT_TOP', 'RIGHT_BOTTOM'):
                    vector = vectors.get(symbol(value))
                    if vector is not None:
                        item[key] = vector
                elif type(value) in (int, float, bool):
                    item[key] = value
            item['instruction'] = call['instruction']
    resolved = []
    for item in pictures.values():
        if 'piece' in item and 'LEFT_TOP' in item:
            resolved.append({**{k: v for k, v in item.items() if k != 'owner'},
                             'control': controls.get(item.get('owner'))})
    if path.name == 'DLG_UI_Skill_Icon_New2015.lua':
        expected = {'BG_SKILL': [45, -10], 'SKILL_BG_ACTIVE': [50, -7]}
        if any(not any(p['piece'] == key and p['LEFT_TOP'] == point for p in resolved)
               for key, point in expected.items()):
            raise ValueError('2016 skill icon layout changed or truncated')
        for point in ([46, 48], [76, 48]):
            if not any(p['piece'] == 'MEMO_OPEN' and p['LEFT_TOP'] == point for p in resolved):
                raise ValueError('Original two memo positions missing')
    elif not any(p['piece'] == 'BG_TOP' and p['LEFT_TOP'] == [0, 0] for p in resolved):
        raise ValueError('2016 skill tree background missing')
    return {'source': path.name, 'sha256': sha(path.read_bytes()),
            'evidence': 'static-target-2016-literal-UI-calls', 'pictures': resolved,
            'unresolvedCallArguments': 'preserved by KL parser; never executed'}


def build(source, output):
    con = sqlite3.connect((source / 'catalog.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    def find(name):
        rows = con.execute('select * from assets where lower(name)=lower(?)', (name,)).fetchall()
        if not rows or len({r['sha256'] for r in rows}) != 1:
            raise ValueError('Missing or ambiguous resource: ' + name)
        row = dict(rows[0]); path = source / row['raw_path']
        if sha(path.read_bytes()) != row['sha256']:
            raise ValueError('Source hash changed: ' + name)
        return row, path
    manifest = {'schemaVersion': 1, 'reference': 'Steam-NA-V6.0420.5',
                'evidence': 'static-target-2016', 'nativeClientMeasured': False,
                'pieces': {}, 'sources': {}, 'layouts': [],
                'webAdaptations': ['Five original tree columns and fourteen rows; responsive scroll viewport',
                                  'Fixed highest nodes with eight simultaneous keyboard slots',
                                  'Memo labels enlarged into two direct selection buttons']}
    output.mkdir(parents=True, exist_ok=True)
    for atlas, wanted in GROUPS.items():
        image_row, image_path = find(atlas + '.tga'); tet_row, tet_path = find(atlas + '.tet')
        manifest['sources'][atlas] = {'image': image_row, 'tet': tet_row}
        records = read_tet(tet_path.read_bytes())
        with Image.open(image_path) as original:
            image = original.convert('RGBA')
        for name in wanted:
            if name not in records:
                raise ValueError('Missing source piece: ' + name)
            crop, bounds = crop_piece(image, records[name]); filename = name.lower() + '.png'
            crop.save(output / filename)
            manifest['pieces'][name] = {'file': filename, 'atlas': atlas, 'bounds': bounds,
                'width': crop.width, 'height': crop.height, 'tetPoints': records[name]['points'],
                'rgbaSha256': sha(crop.tobytes()), 'sha256': sha((output / filename).read_bytes())}
    for script in SCRIPTS:
        row, path = find(script); manifest['sources'][script] = row
        manifest['layouts'].append(extract_layout(path))
    (output / 'manifest.json').write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'output': str(output), 'pieces': len(manifest['pieces']), 'nativeClientMeasured': False}))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/ui/skill-picker'))
    args = parser.parse_args(); build(args.source, args.output)
