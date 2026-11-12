"""Extract the original Raven third-bead HUD particle; input stays read-only."""
import argparse
import json
from pathlib import Path
import re
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from build_rf import Catalog, digest, write_json
from build_rf_fx import declaration
from ui import read_tet

NAME = 'raven_powrUp_UI_01'
PARTICLE_SHA = 'a875c52daa5c9812fd8cc5d655b7cef61d941c48414649a66400a3aec9503ac2'

def inspect_layout(path, tet, piece_name='RAVEN_3', expected_left=(57, 59),
                   expected_size=(42, 34), owner_name='StaticPVPGameStateWakeOrb'):
    sys.path.insert(0, str(ROOT / 'tools/combat'))
    from kl82_static import read_declarations
    d = read_declarations(path, capture_calls=True, capture_unresolved=True)
    vectors, owners, pictures = {}, {}, {}
    def symbol(value): return value['$symbol']
    for i, call in enumerate(d['nativeCalls']):
        target, args = call['target'], call['args']
        if target == 'D3DXVECTOR2': vectors[f'call@{i}.return0'] = args
        elif target.endswith('.SetName') and target != 'g_pUIDialog.SetName': owners[symbol(args[0])] = args[1]
        elif target.endswith('.AddPicture'): pictures.setdefault(symbol(args[1]), {})['owner'] = symbol(args[0])
        elif target.endswith('.SetTex'): pictures.setdefault(symbol(args[0]), {}).update(atlas=args[1], piece=args[2])
        elif target.endswith('.SetPoint'):
            row = pictures.setdefault(symbol(args[0]), {})
            for key in ('LEFT_TOP', 'RIGHT_BOTTOM'):
                if key in args[1]: row[key] = vectors[symbol(args[1][key])]
            row['instruction'] = call['instruction']
    matches = [row for row in pictures.values() if row.get('piece', '').upper() == piece_name
        and owners.get(row.get('owner')) == owner_name]
    if len(matches) != 1: raise ValueError('Target third awakening bead layout missing or ambiguous')
    row = matches[0]
    size = read_tet(tet.read_bytes())[piece_name]['size']
    left = row['LEFT_TOP']; right = [left[i]+size[i] for i in range(2)]
    if left != list(expected_left) or size != list(expected_size):
        raise ValueError('Target Raven third bead layout changed')
    return {'path': str(path), 'sha256': digest(path.read_bytes()), 'instruction': row['instruction'],
        'tetSha256': digest(tet.read_bytes()), 'size': size,
        'leftTop': left, 'rightBottom': right, 'center': [(left[i]+right[i])/2 for i in range(2)] + [0]}

def parse(data):
    text = data.decode('latin1')
    matches = list(re.finditer(r'eventsequence\s+"' + NAME + r'"\s*\{([^{}]*)\}', text))
    if len(matches) != 1:
        raise ValueError('Missing or ambiguous original Raven HUD particle')
    match = matches[0]
    t = declaration(match[1])
    if t['unsupported'] or t['fields'].get('particleType') != 'PT_2D_PLANE':
        raise ValueError('Unsupported original Raven HUD declaration')
    if (t['fields']['Emitrate'], t['fields']['Lifetime'], t['fields']['DrawCount']) != (20, .2, 3):
        raise ValueError('Raven HUD source timing/draw count changed')
    return t, match

def build(source, reference, output, *, contract_path=None, report_path=None, adapt_layout=None):
    output = output.resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(source.resolve()):
        raise ValueError('HUD particle output must remain in this task repository')
    catalog = Catalog(source)
    path = catalog.path('GameMajorParticle7.txt')
    data = path.read_bytes()
    if digest(data) != PARTICLE_SHA:
        raise ValueError('Original Raven HUD particle source hash changed')
    t, match = parse(data)
    t.update(name=NAME, kind='particle', source={**catalog.evidence(path),
        'byteOffset': match.start(), 'line': data[:match.start()].count(b'\n') + 1},
        declarationSha256=digest(match[0].encode('latin1')), textures={})
    output.mkdir(parents=True, exist_ok=True)
    for event in t['events']:
        if event['property'] != 'Texture':
            continue
        texture = catalog.path(event['value'])
        filename = Path(event['value']).stem + '-' + digest(texture.read_bytes())[:10] + '.png'
        image = Image.open(texture).convert('RGBA')
        image.save(output / filename)
        t['textures'][event['value']] = {'file': filename, 'width': image.width, 'height': image.height,
            'source': catalog.evidence(texture), 'outputSha256': digest((output / filename).read_bytes())}
    cpp = reference / 'X2Lib/X2GageUI.cpp'
    original = cpp.read_bytes()
    expected = json.loads((ROOT / 'contracts/rf-ui-source-v13.json').read_text('utf-8'))['countdown']['sha256']
    if digest(original) != expected:
        raise ValueError('Pinned HUD source changed')
    start = original.index(b'void CX2RavenMyGageUI::UpdateHyperOrb()')
    # Balanced braces preserve exact original function bytes and line range.
    brace = original.index(b'{', start); depth = 1; cursor = brace + 1
    while depth:
        if original[cursor] == 123: depth += 1
        if original[cursor] == 125: depth -= 1
        cursor += 1
    body = original[start:cursor]
    for token in (b'GetHyperModeCount() == 3', b'raven_powrUp_UI_01', b'SetOverUI( true )', b'DestroyInstanceHandle(m_hSeqHyperBall)'):
        if token not in body:
            raise ValueError('Pinned Raven HUD consumer changed')
    layout = inspect_layout(catalog.path('DLG_PVP_Game_My_State_NEW.lua'), catalog.path('DLG_UI_Common_Texture25_NEW.tet'))
    index = {'schemaVersion': 1, 'referenceVersion': 'Steam-NA-2016-V6.0420.5', 'clientMeasured': False,
        'templates': {NAME: t}, 'sourceFiles': list(catalog.used.values()),
        'consumer': {'commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633', 'path': 'X2Lib/X2GageUI.cpp',
            'fileSha256': digest(original), 'functionSha256': digest(body),
            'range': [original[:start].count(b'\n') + 1, original[:cursor].count(b'\n') + 1],
            'active': 'available bead count == 3', 'exit': 'destroy sequence and particles immediately',
            'oldReferenceScreenPosition': [100, 120, 0]},
        'targetLayout': layout,
        'presentation': {'anchor': 'displayed target2016 third bead center', 'hudLocalPosition': layout['center'],
            'classification': 'NEW HUD layout adaptation; fixed V5 absolute old-layout point is not applied to NEW UI'},
        'limits': ['Original2016 GPU/frame/RNG comparison unavailable',
            'WebGL HUD offscreen alpha compositing differs from native drawing directly on the game framebuffer']}
    if adapt_layout is not None:
        adapt_layout(index, catalog)
    write_json(output / 'index.json', index)
    write_json(contract_path or ROOT / 'contracts/rf-awakening-bead-fx-v14.json', index)
    report = {'schemaVersion': 1, 'targetClientMeasured': False, 'originalTargetSources': list(catalog.used.values()),
        'inventory': [{'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p.read_bytes()), 'bytes': p.stat().st_size}
            for p in sorted(output.rglob('*')) if p.is_file()]}
    write_json(report_path or ROOT / 'reports/rf-awakening-bead-handover-v14.json', report)
    return report

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, default=Path('asset_work'))
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--output', type=Path, default=ROOT / 'artifacts/ui/awakening-bead')
    a = p.parse_args()
    print(json.dumps(build(a.source, a.reference, a.output), ensure_ascii=False))
