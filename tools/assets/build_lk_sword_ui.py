"""Read original 2016 sword HUD declarations and pixels without executing Lua."""
import argparse
import math
import hashlib
from pathlib import Path
import sys
from PIL import Image
from ui import read_tet, crop_piece
sys.path.insert(0, str(Path(__file__).resolve().parent/'character'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'combat'))
from build_rf import Catalog, digest, write_json
from kl82_static import parse, declarations
ROOT = Path(__file__).resolve().parents[2]


def read_flicker_sources(evidence_root=None):
    """Read independently pinned source bytes from an explicit evidence directory."""
    evidence_root = Path(evidence_root or ROOT / '.cache/sword-ui-v2/KTDXLIB')
    result = {}
    for name, blob in [('KTDGUIControl.cpp', '73d6efcbbce8331b783a0a8c3a7dca43b237f139'),
                       ('KTDGUIControl.h', '8429e92202a03508eaa26d7d71ccd18f98a7f761')]:
        data = (evidence_root / name).read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if actual != blob:
            raise ValueError('Pinned UI flicker source differs')
        result[name] = (data, blob)
    return result


def inspect_picture_groups(data):
    _, _, calls = declarations(parse(data), capture_calls=True, capture_unresolved=True)
    objects, pictures, vectors, colors, slot_points = {}, {}, {}, {}, {}
    def symbol(value):
        if not isinstance(value, dict) or '$symbol' not in value:
            raise ValueError('Expected captured original UI object')
        return value['$symbol']
    for index, call in enumerate(calls):
        target, args = call['target'], call['args']
        if target in ('D3DXVECTOR2', 'D3DXCOLOR'):
            count = 2 if target == 'D3DXVECTOR2' else 4
            if len(args) != count or any(type(v) not in (int,float) or not math.isfinite(v) for v in args):
                raise ValueError('Unsupported original UI vector/color')
            (vectors if count == 2 else colors)[f'call@{index}.return0'] = args
        elif target == 'script-prototype@0' and len(args)==4:
            slot_points[f'call@{index}.return0']={'target':target,'args':args,'instruction':call['instruction']}
        elif target.endswith('.SetName'):
            objects[symbol(args[0])] = args[1]
        elif target.endswith('.AddPicture'):
            pictures.setdefault(symbol(args[1]), {})['owner'] = symbol(args[0])
        elif target.endswith('.SetTex'):
            pictures.setdefault(symbol(args[0]), {}).update(atlas=args[1],piece=args[2])
        elif target.endswith('.SetPoint'):
            row = pictures.setdefault(symbol(args[0]), {})
            row['position'] = vectors.get(symbol(args[1]['LEFT_TOP']))
            row['color'] = colors.get(symbol(args[1]['COLOR'])) if 'COLOR' in args[1] else [1,1,1,1]
            row['instruction'] = call['instruction']
            if symbol(args[1]['LEFT_TOP']) in slot_points:
                row['slotPoint']=slot_points[symbol(args[1]['LEFT_TOP'])]
                row['sizeDelta']=[args[1].get('ADD_SIZE_X',0),args[1].get('ADD_SIZE_Y',0)]
    groups = {}
    for row in pictures.values():
        name = objects.get(row.get('owner'))
        if name:
            groups.setdefault(name, []).append({k:v for k,v in row.items() if k!='owner'})
    return groups


def inspect_layout(data):
    all_groups=inspect_picture_groups(data)
    groups={name:all_groups[name] for name in ('g_pStatic_EL_BLUE','g_pStatic_EL_RED') if name in all_groups}
    if any(row['position'] is None or row['color'] is None for rows in groups.values() for row in rows):
        raise ValueError('Unresolved original HUD placement')
    if [[r['piece'] for r in groups.get(name,[])] for name in ('g_pStatic_EL_BLUE','g_pStatic_EL_RED')] != [
        ['EL_BG','EL_BLUE','EL_EFFECT','EL_BLUE_NORMAL','EL_BLUE_FULL','EL_GRAY'],
        ['EL_BG','EL_RED','EL_EFFECT','EL_RED_NORMAL','EL_RED_FULL']]:
        raise ValueError('Original sword UI declaration changed')
    return groups


def build(source, native, output, project=ROOT, evidence_root=None):
    source,native,output,project = map(lambda p:Path(p).resolve(),(source,native,output,project))
    if output.is_relative_to(source) or output.is_relative_to(native):
        raise ValueError('Output overlaps read-only source')
    frozen_flicker = read_flicker_sources(evidence_root)
    catalog = Catalog(source)
    groups = inspect_layout(catalog.path('DLG_Elsword_WayOfSword.lua').read_bytes())
    atlas = 'DLG_UI_Common_Texture16_NEW'
    pieces = read_tet(catalog.path(atlas+'.tet').read_bytes())
    with Image.open(catalog.path(atlas+'.tga')) as original:
        pixels = original.convert('RGBA')
    output.mkdir(parents=True,exist_ok=True)
    for rows in groups.values():
        for row in rows:
            if row['atlas'].casefold() != (atlas+'.tga').casefold():
                raise ValueError('Unexpected sword HUD atlas')
            image,bounds = crop_piece(pixels,pieces[row['piece']])
            original_hash=digest(image.tobytes())
            if row['color'] != [1,1,1,1]:
                image=Image.merge('RGBA',tuple(channel.point([int(v*factor+.5) for v in range(256)])
                    for channel,factor in zip(image.split(),row['color'])))
            filename = row['piece'].lower() + ('-blue' if row['color'][0] < 1 else '-red' if row['color'][1] < 1 else '')+'.png'
            image.save(output/filename)
            row.update(file=filename,size=[image.width,image.height],bounds=bounds,sourceRgbaSha256=original_hash,
                       rgbaSha256=digest(image.tobytes()),sha256=digest((output/filename).read_bytes()))
    consumer=native/'X2Lib/X2GageUI.cpp'
    flicker_sources=[]
    for name,(data,blob) in frozen_flicker.items():
        flicker_sources.append({'path':'KTDXLIB/'+name,'gitBlob':blob,'sha256':digest(data),'bytes':len(data)})
    result={'schemaVersion':1,'targetVersion':'Steam-NA-2016-V6.0420.5','nativeClientMeasured':False,
        'groups':groups,'sources':list(catalog.used.values()),
        'consumer':{'path':'X2Lib/X2GageUI.cpp','sha256':digest(consumer.read_bytes()),'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
                    'classification':'fixed-V5-source-reference','methods':['UIFrameMoveElswordWSP','UpdateUIElswordWSP','PlayUIEffectVigor','PlayUIEffectDestruction']},
        'flickerSources':flicker_sources,
        'presentation':{'fill':'clip original pixels and width by signed point / signed threshold',
            'effectTint':'multiply original target D3DXCOLOR; PNG rounding is a browser pixel adapter',
            'activeFlickerArguments':[.4,1,.1],'flickerConsumer':'CPictureData::SetFlicker + FrameMove; original float / strict bounds; browser clamps alpha'},
        'limits':['Original 2016 client GPU/trace not measured','Fixed V5 consumer is a version reference','Responsive HUD scaling is a web adaptation']}
    write_json(output/'index.json',result)
    write_json(project/'contracts/lk-sword-ui-source-v2.json',result)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('asset_work'))
    parser.add_argument('--native-source',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/ui/way-of-sword')
    parser.add_argument('--evidence-root',type=Path,help='Read-only directory containing the two pinned KTDGUIControl source files')
    args=parser.parse_args()
    result=build(args.source,args.native_source,args.output,evidence_root=args.evidence_root)
    print('Original sword HUD:',sum(map(len,result['groups'].values())),'pictures')
