"""Extract the two original RF limb aura sequences; never run the client."""
from pathlib import Path
import argparse
import json
import re
from PIL import Image
from build_rf import Catalog, digest, write_json
from build_rf_fx import declaration

ROOT = Path(__file__).resolve().parents[3]
NAMES = ('HyperBoostRightBlack', 'HyperBoostLeftBlack')
INDEX = ROOT / 'contracts/rf-awakening-fx-index.json'


def build(source_root=Path('asset_work'), output=ROOT / 'artifacts/rf/awakening-fx'):
    output = output.resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(source_root.resolve()):
        raise ValueError('Awakening output must remain inside this task repository')
    catalog = Catalog(source_root)
    source = catalog.path('GameMinorParticle.txt')
    text = source.read_bytes().decode('latin1')
    templates = {}
    for name in NAMES:
        matches = list(re.finditer(r'eventsequence\s+"' + name + r'"\s*\{([^{}]*)\}', text))
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous original awakening sequence: ' + name)
        match = matches[0]
        t = declaration(match[1], casefold_tokens=True)
        if t['unsupported'] or t['fields'].get('particleType') != 'PT_3D_PLANE':
            raise ValueError('Unsupported original awakening declaration: ' + name)
        t.update(name=name, kind='particle', sourceFamily='game-minor',
            source={**catalog.evidence(source), 'byteOffset': match.start(), 'line': text.count('\n', 0, match.start()) + 1},
            declarationSha256=digest(match[0].encode('latin1')),
            sourceTokenNormalization='reference-V5 uppercase unquoted tokens; original names/hash retained')
        t['textures'] = {}
        for event in t['events']:
            if event['property'] != 'Texture':
                continue
            name_texture = event['value']
            path = catalog.path(name_texture)
            destination = 'textures/' + Path(name_texture).stem + '-' + digest(path.read_bytes())[:10] + '.png'
            image = Image.open(path).convert('RGBA')
            (output / destination).parent.mkdir(parents=True, exist_ok=True)
            image.save(output / destination)
            t['textures'][name_texture] = {'file': 'awakening-fx/' + destination,
                'width': image.width, 'height': image.height, 'source': catalog.evidence(path)}
        templates[name] = t
    index = {'schemaVersion': 1, 'referenceVersion': 'Steam-NA-2016-V6.0420.5',
        'clientMeasured': False, 'templates': templates, 'sourceFiles': list(catalog.used.values()),
        'runtimeDefaultsEvidence': 'reference-V5 CParticleEventSequence constructor: BT_ALL, TriggerCount=-1, TriggerTime=-1; Raven startup and GameUnit aura frame callbacks',
        'limits': ['Original client is unmeasured; fixed V5 routing is a reference candidate.',
            'No generic glow or replacement particle texture is generated.'],
        'missingTemplates': [], 'meshFailures': []}
    write_json(output / 'index.json', index)
    write_json(INDEX, index)
    references = []
    manifests = [json.loads((ROOT / p).read_text('utf-8')) for p in
        ('contracts/rf-native-reference.json', 'contracts/rf-native-runtime-sources.json')]
    for path, functions in (
            ('X2Lib/X2GURaven.cpp', ['HyperModeBuffEffectStart', 'SetInvisibility']),
            ('X2Lib/X2GameUnit.cpp', ['HyperModeBuffEffectOnFrameMove', 'HyperModeBuffEffectEnd']),
            ('KTDXLIB/KTDGParticleSystem.cpp', ['CParticleEventSequence::CParticleEventSequence',
                'CParticleEmitterTokenizer::ProcessTime', 'DestroyInstanceHandle'])):
        data = (ROOT / '.cache/native-reference' / path).read_bytes()
        frozen = next((row for manifest in manifests for row in manifest['files']
            if row.get('relativePath', row.get('path', '')).endswith('/' + path)
            or row.get('relativePath') == path), None)
        if not frozen or digest(data) != frozen['sha256']:
            raise ValueError('Pinned V5 reference changed: ' + path)
        references.append({'relativePath': path, 'sha256': digest(data), 'bytes': len(data), 'functions': functions})
    write_json(ROOT / 'reports/rf-awakening-fx-v8.json', {
        'schema': 'elsword.rf-awakening-fx.v8', 'targetClientMeasured': False,
        'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'rootCause': 'The previous closure contained the three-bead electric field but omitted the four Raven limb aura emitters and their minor-particle declarations.',
        'references': references, 'targetSources': list(catalog.used.values()),
        'resourceIndex': INDEX.relative_to(ROOT).as_posix(), 'resourceIndexSha256': digest(INDEX.read_bytes()),
        'bindings': {'oneTwoThreeBeads': 'All active awakening counts own four limb emitters; the electric field remains three-bead only.',
            'rightFacingBones': ['Bip01_R_Foot', 'Bip01_L_Foot', 'Bip01_R_UpperArm', 'Bip01_L_UpperArm'],
            'leftFacingBones': ['Bip01_L_Foot', 'Bip01_R_Foot', 'Bip01_L_UpperArm', 'Bip01_R_UpperArm'],
            'emitRates': [[15,20], [20,30], [30,40]], 'thresholds': ['remaining < MAX_HYPER_MODE_TIME/3', 'remaining < MAX_HYPER_MODE_TIME/2', 'otherwise'],
            'trace': True, 'end': 'DestroyInstanceHandle: immediate deletion, rather than retaining a detached tail'},
        'outputInventory': [{'path': p.relative_to(ROOT).as_posix(), 'sha256': digest(p.read_bytes()), 'bytes': p.stat().st_size}
            for p in sorted(output.rglob('*')) if p.is_file()],
        'limits': ['2016 full-client rendering, RNG order and GPU blend remain unverified.',
            'Babylon batching and four native bone samples are web presentation adapters; combat is unchanged.']})
    print(json.dumps({'templates': len(templates), 'textures': 1, 'output': str(output)}))
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/rf/awakening-fx')
    args = parser.parse_args()
    build(args.source_root, args.output)
