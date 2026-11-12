"""Extract 2016 buff/keyboard pixels and static UI evidence from read-only inputs.

Only the initial straight-line UI declaration prefix is inspected; branches
remain unsupported. No Lua/native callback is executed or inferred.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from PIL import Image
from ui import read_tet, crop_piece

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'combat'))
from kl82_static import parse, declarations, read_declarations, OPS

def sha(data): return hashlib.sha256(data).hexdigest()

def layout_prefix(data):
    chunk = parse(data)
    p = chunk['prototypes'][-1]
    # The prefix is retained explicitly as partial evidence. Appending RET0 is
    # a static-reader terminator, not a transformation of the game script.
    end = next((i for i, word in enumerate(p['instructions'])
                if word & 255 not in OPS or word & 255 == 0x47), len(p['instructions']))
    total = len(p['instructions'])
    unsupported = p['instructions'][end] & 255 if end < total else None
    p['instructions'] = p['instructions'][:end] + [0x47]
    _, _, calls = declarations(chunk, capture_calls=True, capture_unresolved=True)
    return {'instructionPrefixEnd': end, 'totalInstructions': total,
            'nextOpcode': unsupported, 'branchExecution': 'unsupported',
            'calls': [r for r in calls if r['target'].endswith(('.SetName', '.SetPos', '.SetSize', '.SetTex', '.SetNormalTex', '.SetPoint', '.SetNormalPoint'))]}

def build(source, native, output, project):
    source, native, output, project = [Path(p).resolve() for p in (source, native, output, project)]
    if output.is_relative_to(source) or output.is_relative_to(native): raise ValueError('Output overlaps read-only inputs')
    output.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect((source/'catalog.sqlite').as_uri()+'?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    sources = {}
    def find(name):
        rows = con.execute('select * from assets where name=? collate nocase and status=?', (name, 'ok')).fetchall()
        if not rows or len({r['sha256'] for r in rows}) != 1: raise ValueError('Missing/ambiguous original input '+name)
        row = dict(rows[0]); path = (source/row['raw_path']).resolve()
        if not path.is_relative_to(source/'raw'): raise ValueError('Source path outside raw input')
        data = path.read_bytes()
        if sha(data) != row['sha256']: raise ValueError('Original hash changed '+name)
        sources[name] = {'name': row['name'], 'rawPath': row['raw_path'], 'sha256': row['sha256']}
        return path, data
    enum_path, _ = find('Enum.lua')
    enum = read_declarations(enum_path)['globals']
    catalog = []
    for filename in ('BattleFieldBuffTemplet.lua', 'BattleFieldBuffTemplet_INT.lua'):
        path, _ = find(filename)
        calls = read_declarations(path, enum, capture_calls=True, capture_unresolved=True)['nativeCalls']
        for call in calls:
            if not call['target'].endswith('AddBuffTemplet_LUA'): continue
            raw = call['args'][-1]
            if not isinstance(raw, dict): raise ValueError('Non-table buff declaration')
            catalog.append({'id': raw.get('BUFF_TEMPLET_ID'), 'iconName': raw.get('BUFF_ICON_TEXTURE_NAME'), 'iconKey': raw.get('BUFF_ICON_TEXTURE_KEY'),
                            'isDebuff': raw.get('IS_DEBUF'), 'isWorldBuff': raw.get('IS_WORLD_BUFF'), 'accumulationLimit': raw.get('ACCUMULATION_LIMIT'),
                            'nameString': raw.get('BUFF_NAME'), 'descriptionString': raw.get('BUFF_DESC'), 'source': filename, 'instruction': call['instruction']})
    profile_path = project/'packages/combat-core/rf-profile.json'
    profile = json.loads(profile_path.read_text('utf-8'))
    current = {str(k): {key: value for key, value in row['raw'].items() if key in ('BUFF_TEMPLET_ID', 'BUFF_ICON_TEXTURE_NAME', 'BUFF_ICON_TEXTURE_KEY', 'IS_DEBUF', 'IS_WORLD_BUFF', 'ACCUMULATION_LIMIT', 'BUFF_NAME', 'BUFF_DESC')}
               for k, row in profile['buffTemplates'].items()}
    wanted = {row['BUFF_ICON_TEXTURE_KEY'] for row in current.values() if 'BUFF_ICON_TEXTURE_KEY' in row}
    wanted.add('Buff_Icon_PVP_Revenge')
    assets = {'schemaVersion': 1, 'targetVersion': 'Steam-NA-2016-V6.0420.5', 'nativeClientMeasured': False, 'pieces': {}, 'buffIcons': {}, 'sources': sources}
    def atlas(name, prefix, pieces=None):
        _, tet = find(name+'.tet'); _, pixels = find(name+'.tga')
        records = read_tet(tet)
        import io
        with Image.open(io.BytesIO(pixels)) as original: image = original.convert('RGBA')
        for key in (pieces if pieces is not None else records):
            candidates = [actual for actual in records if actual.casefold() == key.casefold()]
            if len(candidates) != 1: raise ValueError('Original icon absent/ambiguous '+key)
            actual = candidates[0]
            cropped, bounds = crop_piece(image, records[actual]); file = prefix+'-'+key.lower()+'.png'; cropped.save(output/file)
            assets['pieces'][prefix+':'+key] = {'file': file, 'width': cropped.width, 'height': cropped.height, 'atlas': name, 'piece': actual, 'declarationPiece': key,
                'bounds': bounds, 'rgbaSha256': sha(cropped.tobytes()), 'sha256': sha((output/file).read_bytes())}
    atlas('DLG_UI_Common_Texture_Buff', 'buff', sorted(wanted))
    atlas('DLG_UI_KEYSETTING', 'keysetting', ['TITLE','KEY_BG_W_LEFT','KEY_BG_W_CENTER','KEY_BG_W_RIGHT','KEY_BG_G_LEFT','KEY_BG_G_CENTER','KEY_BG_G_RIGHT','DEFAULT_NORMAL','DEFAULT_OVER','CANCEL_NORMAL','CANCEL_OVER','SAVE_NORMAL','SAVE_OVER'])
    atlas('DLG_UI_KEY', 'key', ['KEY_1'])
    atlas('DLG_UI_KeyboardConfig', 'keyboardconfig', ['KEYBOARDCONFIG_TITLE','KEYBOARDCONFIG_BUTTON_KEY_NORMAL','KEYBOARDCONFIG_BUTTON_KEY_CHECK','KEYBOARDCONFIG_TAB_BASICCONTROL_CHECK','KEYBOARDCONFIG_TAB_QUICKSLOT_NORMAL'])
    atlas('DLG_UI_Common_Texture65_NEW', 'pvp', ['PVP_SCORE_BG','PVP_SCORE_BG_2']+[f'{color}_NUM_{i}' for color in ('RED','BLUE') for i in range(10)])
    for label in ('Fight','Win','Lose','Drawing'):
        path, pixels = find(f'DLG_UI_PVP_Score_{label}.tga')
        with Image.open(path) as original: image = original.convert('RGBA')
        file = 'pvp-'+label.lower()+'.png'; image.save(output/file)
        assets['pieces']['pvp:'+label.upper()] = {'file':file,'width':image.width,'height':image.height,'source':path.name,'rgbaSha256':sha(image.tobytes()),'sha256':sha((output/file).read_bytes())}
    for key, raw in current.items():
        if raw.get('BUFF_ICON_TEXTURE_KEY'): assets['buffIcons'][key] = assets['pieces']['buff:'+raw['BUFF_ICON_TEXTURE_KEY']]
    for key in ('130','131','132'): assets['buffIcons'][key] = assets['pieces']['buff:Buff_Icon_PVP_Revenge']
    layouts = {}
    for filename in ('DLG_UI_KEY_SETTING.LUA', 'DLG_UI_Option_KeyBoardConfig.lua', 'DLG_BuffManager.lua'):
        _, data = find(filename); layouts[filename] = layout_prefix(data)
    native_sources = []
    for name in ('X2Lib/X2GageUI.cpp','X2Lib/X2GameUnit.cpp','X2Lib/X2GageManager.cpp'):
        data = (native/name).read_bytes();native_sources.append({'path': name, 'sha256': sha(data), 'evidenceClass': 'fixed-V5-source-reference'})
    buff_contract = {'schemaVersion': 1, 'targetVersion': assets['targetVersion'], 'nativeClientMeasured': False, 'profileSha256': sha(profile_path.read_bytes()),
                     'sources': {k:v for k,v in sources.items() if 'BUFF' in k.upper() or 'PVP' in k.upper() or 'Texture65' in k or k == 'Enum.lua'}, 'referenceSources': native_sources, 'currentTemplates': current,
                     'pixelAssets': {k:v for k,v in assets['pieces'].items() if k.startswith(('buff:', 'pvp:'))},
                     'inventory': catalog, 'inventoryCount': len(catalog), 'pvpRevengeIds': {k:v for k,v in enum['BUFF_TEMPLET_ID'].items() if k.startswith('BTI_BUFF_PVP_REVENGE_MODE_')},
                     'presentation': {'iconSize': [24,24], 'stride': 25, 'debuffRowY': 29, 'flow': 'insertion-order-right-to-left', 'identity': 'template-ID', 'stackPresentation': 'one icon per template; web stack badge when count supplied',
                                      'fadeInSeconds': 1.2, 'flickerReferenceArgumentSeconds': .4, 'webFlickerHalfPeriodSeconds': .4, 'flickerThresholdSeconds': 5, 'durationIntegerRangeExclusive': [0,999], 'fractionalTimeConversion': 'web ceil candidate; upstream buff producer not acquired', 'lobbyHidden': True},
                     'limits': ['Target2016 client runtime/GPU has not been measured', 'Fixed V5 UI consumer is a version reference', 'Catalog describes icons only and does not enable unimplemented effects', 'The original duration producer and accumulation-number UI were not acquired']}
    key_contract = {'schemaVersion':1, 'targetVersion':assets['targetVersion'], 'nativeClientMeasured':False, 'sources': {k:v for k,v in sources.items() if 'KEY' in k.upper() or 'OPTION' in k.upper()},
                    'layouts': layouts, 'pixelAssets': {k:v for k,v in assets['pieces'].items() if k.startswith(('key:', 'keysetting:', 'keyboardconfig:'))}, 'webActions': ['up','down','left','right','z','x','awaken','skill1','skill2','skill3','skill4','skill5','skill6','skill7','skill8','special'],
                    'adaptations': ['Only project combat actions are exposed', 'Default QWER/ASDC is the current user preset', 'KeyboardEvent.code replaces Win32/DI scan codes', 'Esc/Tab/system/function keys remain reserved', 'Conflict checking and transactional save/cancel are shared web rules'],
                    'limits': ['Conditional UI code is not executed; only the recorded prefix is read', 'Original Win32 input configuration manager is not ported', 'Original title/keyboard/key button pixels retain hashes; web layout is responsive adaptation']}
    assets['sources'] = sources
    (output/'manifest.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2)+'\n','utf-8')
    (project/'contracts/rf-buff-bar-source-v1.json').write_text(json.dumps(buff_contract,ensure_ascii=False,indent=2)+'\n','utf-8')
    (project/'contracts/rf-key-bindings-source-v1.json').write_text(json.dumps(key_contract,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps({'buffDeclarations':len(catalog),'currentBuffs':len(current),'pieces':len(assets['pieces']),'output':str(output)}))
    return assets

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=Path('asset_work'));p.add_argument('--native-source',type=Path,default=Path('.cache/native-source-runtime'));p.add_argument('--output',type=Path,default=Path('artifacts/ui/online'));p.add_argument('--project',type=Path,default=Path('.'));a=p.parse_args();build(a.source,a.native_source,a.output,a.project)
