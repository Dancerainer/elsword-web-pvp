"""Decode exact 2016 binary TET rectangle pieces, never execute UI bytecode."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sqlite3
import struct
import sys
from PIL import Image

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read_tet(data):
    if len(data) < 12 or data[:4] != b'TET ':
        raise ValueError('Unsupported TET signature')
    version, count = struct.unpack_from('<II', data, 4)
    if version != 256 or count > 10000 or 12 + count * 44 > len(data):
        raise ValueError('Unsupported TET layout or truncated table')
    records_start = 12 + 4 * count
    names_start = records_start + 40 * count
    result = {}
    for i in range(count):
        offset = struct.unpack_from('<I', data, 12 + 4*i)[0]
        if not names_start <= offset <= len(data)-2:
            raise ValueError('Name offset outside TET string table')
        size = struct.unpack_from('<H', data, offset)[0]
        end = offset + 2 + 2*size
        if end + 2 > len(data) or data[end:end+2] != b'\0\0':
            raise ValueError('Truncated or unterminated TET name')
        name = data[offset+2:end].decode('utf-16le')
        values = struct.unpack_from('<10f', data, records_start + i*40)
        if not all(math.isfinite(v) for v in values):
            raise ValueError('Nonfinite TET coordinate')
        points = [list(values[j:j+2]) for j in range(0, 8, 2)]
        if name in result:
            raise ValueError('Duplicate TET piece')
        result[name] = {'points': points, 'size': list(values[8:10]), 'index': i}
    return result

def crop_piece(image, piece):
    p = piece['points']
    box = [min(v[0] for v in p), min(v[1] for v in p), max(v[0] for v in p), max(v[1] for v in p)]
    x0,y0,x1,y1 = box
    if sorted(p) != sorted([[x0,y0],[x1,y0],[x0,y1],[x1,y1]]):
        raise ValueError('Nonrectangular or degenerate TET quad')
    if any(v != int(v) for v in box) or x0 < 0 or y0 < 0 or x1 > image.width or y1 > image.height:
        raise ValueError('Nonintegral or out-of-bounds TET crop')
    if piece['size'] != [x1-x0,y1-y0]:
        raise ValueError('TET display size differs; requires explicit transform support')
    crop = image.crop(box)
    # First two vertices encode original orientation, including horizontal/vertical mirroring.
    if p[0][0] > p[1][0]:
        crop = crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if p[0][1] > p[2][1]:
        crop = crop.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return crop, box

def extract_other_hud_layout(path):
    """Recover only literal vectors/picture bindings; never call the UI or Lua VM."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'combat'))
    from kl82_static import read_declarations
    document = read_declarations(path, capture_calls=True)
    vectors, objects, pictures = {}, {}, {}
    dialog_size = None
    def symbol(value):
        if not isinstance(value, dict) or '$symbol' not in value:
            raise ValueError('Expected a captured UI object symbol')
        return value['$symbol']
    for index, call in enumerate(document['nativeCalls']):
        target, args = call['target'], call['args']
        if target == 'D3DXVECTOR2':
            if len(args) != 2 or any(type(x) not in (int, float) or not math.isfinite(x) for x in args):
                raise ValueError('Unsupported UI vector')
            vectors[f'call@{index}.return0'] = args
        elif target == 'g_pUIDialog.SetSize':
            dialog_size = args[1:]
        elif target.endswith('.SetName') and target != 'g_pUIDialog.SetName':
            objects.setdefault(symbol(args[0]), {})['name'] = args[1]
        elif target.endswith('.AddPicture'):
            pictures.setdefault(symbol(args[1]), {})['owner'] = symbol(args[0])
        elif target.endswith('.SetTex'):
            pictures.setdefault(symbol(args[0]), {}).update(atlas=args[1], piece=args[2])
        elif target.endswith('.SetShow'):
            objects.setdefault(symbol(args[0]), {})['initialShow'] = args[1]
            pictures.setdefault(symbol(args[0]), {})['initialShow'] = args[1]
        elif target.endswith('.SetPoint'):
            item = pictures.setdefault(symbol(args[0]), {})
            for key in ('LEFT_TOP', 'RIGHT_BOTTOM'):
                if key in args[1]:
                    vector = vectors.get(symbol(args[1][key]))
                    if vector is None:
                        raise ValueError('Unresolved UI layout vector')
                    item[key] = vector
            item['instruction'] = call['instruction']
    controls = {}
    for picture in pictures.values():
        name = objects.get(picture.get('owner'), {}).get('name')
        if name and 'piece' in picture:
            controls[name] = {k: v for k, v in picture.items() if k != 'owner'}
    required = {'StaticOtherPlayerPVPState': [37, 9], 'OtherPlayerHP': [48, 17],
                'OtherPlayerMP': [46, 27], 'StaticPVPStateFace': [2, 0]}
    if dialog_size != [140, 35] or any(controls.get(k, {}).get('LEFT_TOP') != v for k, v in required.items()):
        raise ValueError('Target HUD layout changed; review original declarations')
    return {'source': document['source'], 'evidence': 'static-2016-declarations',
            'nativeClientMeasured': False, 'dialogSize': dialog_size, 'controls': controls,
            'positionReference': {'version': 'V5 pinned reference', 'resolution': [1024, 768],
                                  'firstOpponent': [868, 77], 'rowStride': 44},
            'portraitOverride': {'atlas': 'DLG_UI_Common_Texture25_NEW', 'piece': 'R_FIST_PARTY',
                                 'evidence': 'V5 X2Data.cpp CIT_Party RF index22 + target2016 pixels'}}

def build(source, output):
    con = sqlite3.connect((source/'catalog.sqlite').resolve().as_uri()+'?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    def find(name):
        rows = con.execute('select * from assets where lower(name)=lower(?)', (name,)).fetchall()
        if not rows or len({r['sha256'] for r in rows}) != 1:
            raise ValueError('Missing or ambiguous resource: '+name)
        row = dict(rows[0]); path = source/row['raw_path']
        if sha(path.read_bytes()) != row['sha256']:
            raise ValueError('Source hash changed: '+name)
        return row, path
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 1, 'reference': 'Steam-NA-V6.0420.5', 'evidence': 'static-2016',
                'layoutVerified': False, 'pieces': {}, 'atlases': {}}
    groups = {
        'DLG_PVP_State_Info0': ['MYSTATE','MYHP','MYMP','100MP_BAR','MYANGER_GAUGE','OTHERPLAYERPVPSTATE','OTHERPLAYERHP','OTHERPLAYERMP'],
        'DLG_UI_Common_Texture24': ['R_FIST','R_FIST_SMALL'],
        'DLG_UI_Common_Texture11': ['SKILL_SLOT2'],
        'DLG_UI_Common_Texture64_NEW': ['SKILL_SLOT','LOCK'],
        'DLG_UI_Common_Texture63_NEW': ['GAGE_BG','HP','MP','MP_ACTIVE','MP_100_BAR','RAGE','RAGE_BG','RAGE_BEAD','PARTY_GAGE_BG','PARTY_HP','PARTY_MP','PARTY_BLACK'],
        'DLG_UI_Common_Texture25_NEW': ['R_FIST_STATE','R_FIST_SMALL','R_FIST_PARTY','RAVEN_3','RAVEN_3_BG'],
    }
    for atlas, wanted in groups.items():
        tet_row,tet_path = find(atlas+'.tet'); image_row,image_path = find(atlas+'.tga')
        records = read_tet(tet_path.read_bytes())
        with Image.open(image_path) as original:
            image = original.convert('RGBA')
        manifest['atlases'][atlas] = {'imageSource': image_row, 'tetSource': tet_row, 'size': list(image.size), 'availablePieces': list(records)}
        for name in wanted:
            if name not in records:
                manifest['pieces'][name] = {'unsupported': 'Piece absent from target atlas', 'atlas': atlas}
                continue
            crop,box = crop_piece(image, records[name]); filename=name.lower()+'.png';crop.save(output/filename)
            manifest['pieces'][name] = {'file': filename, 'width':crop.width,'height':crop.height,
                'bounds': box,'tetPoints':records[name]['points'],'atlas':atlas,'rgbaSha256':sha(crop.tobytes()),'sha256':sha((output/filename).read_bytes())}
    _, layout_path = find('DLG_PVP_Game_Other_State_NEW.lua')
    manifest['otherPlayerLayout'] = extract_other_hud_layout(layout_path)
    (output/'manifest.json').write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf-8'))
    print(json.dumps({'output':str(output),'pieces':len(manifest['pieces']), 'layoutVerified': False}))
    return manifest

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=Path('asset_work'));p.add_argument('--output',type=Path,default=Path('artifacts/ui'))
    a=p.parse_args();build(a.source,a.output)
