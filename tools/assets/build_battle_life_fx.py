"""Original revival / guild display closure, with explicit minor namespaces.

Read-only 2016 declarations supply every texture/mesh. Fixed V5 callbacks
justify trigger timing; shipped DLL measurements supply the two skin clocks.
No combat rule, guild proc or hidden buff is enabled by this resource build.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'tools/assets/character'), str(ROOT/'tools/combat')]
from build_rf import Catalog, build_effect, digest, write_json
from build_rf_fx import read_definitions, declaration, select_templates
from build_landing_fx import parse, mesh_material_closure
from kl82_static import read_declarations
from prepare_lk_declarations import EnumTable

VERSION = 'Steam-NA-2016-V6.0420.5'
RESPAWN = ('RespawnLanding01', 'RespawnLanding02', *(f'RespawnLanding_P0{i}' for i in range(1, 5)))
SETS = ('EffectSet_ChanceToReverse', 'EffectSet_SacrificeOfHero')
REFERENCE_SHA = 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38'


def load_roots(cat, reference):
    enum = read_declarations(cat.path('Enum.lua'))
    effects = read_declarations(cat.path('EffectSet.lua'), EnumTable(enum['globals']), capture_calls=True, capture_unresolved=True)
    sets = {row['args'][-1]['NAME']: {'raw': row['args'][-1], 'source': effects['source'],
        'sourcePc': {'prototype': row['prototype'], 'instruction': row['instruction']}}
        for row in effects['nativeCalls'] if row['target'].endswith('AddEffectSetTemplet_LUA')
        and isinstance(row['args'][-1], dict) and row['args'][-1].get('NAME') in SETS}
    if set(sets) != set(SETS):
        raise ValueError('Original battle life EffectSet closure missing')
    # The callback says MinorParticle explicitly. MajorParticle3 contains the
    # same names with different fields, so silently choosing a duplicate fails.
    definitions = read_definitions(cat)
    for name in RESPAWN:
        mesh = name in RESPAWN[:2]
        path = cat.path('GameMinorXMeshPlayer.txt' if mesh else 'GameMinorParticle.txt')
        text = path.read_bytes().decode('latin1')
        if mesh:
            record, match = parse(text, name, 'TEMPLET')
        else:
            matches = list(re.finditer(r'eventsequence\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}', text))
            if len(matches) != 1:
                raise ValueError('Unique original minor respawn declaration required: '+name)
            match = matches[0]
            record = declaration(match[1], casefold_tokens=True)
            if record['unsupported']:
                raise ValueError('Unsupported original minor respawn declaration: '+name)
        record.update(name=name, kind='mesh' if mesh else 'particle', sourceFamily='game-minor',
            source={**cat.evidence(path), 'byteOffset': match.start(), 'line': text.count('\n', 0, match.start())+1},
            declarationSha256=digest(match[0].encode('latin1')))
        definitions[name] = record
    raw = reference.read_bytes()
    if digest(raw) != REFERENCE_SHA:
        raise ValueError('Battle life callback reference SHA256 differs from the frozen V5 source')
    text = raw.decode('latin1')
    required = ('RespawnLanding01', 'RespawnLanding02', 'RespawnLanding_P01', 'RespawnLanding_P02',
        'RespawnLanding_P03', 'RespawnLanding_P04', 'EffectSet_SacrificeOfHero')
    if any('"'+name+'"' not in text for name in required):
        raise ValueError('Missing frozen reference callback literal')
    callbacks = {'respawn': {'initialTemplates': list(RESPAWN[:5]), 'forwardOffset': 10,
        'ringTemplate': RESPAWN[5], 'ringTimes': [.1, .26, .39, .52], 'ringHeights': [50, 100, 150, 200],
        'referenceLines': [25413, 25488], 'state': ['RSI_START_INTRUDE', 'ESSI_START_INTRUDE']},
        'heroSacrifice': {'event': 'guildHeroSacrifice', 'effectSet': SETS[1], 'referenceLines': [30537, 30625]},
        'chanceToReverse': {'buffTemplateId': 57, 'effectSet': SETS[0], 'source': 'guild-catalog.json Template57 DISPLAYER'}}
    roots = {'schemaVersion': 1, 'targetVersion': VERSION, 'clientMeasured': False,
        'scope': 'battle life presentation only; no combat/guild trigger changes', 'resourceOnlyTemplates': list(RESPAWN),
        'effectSets': sets, 'callbacks': callbacks, 'reference': {'kind': 'fixed-V5 source reference',
            'file': 'X2Lib/X2GUUser.cpp', 'sha256': digest(raw)}, 'sourceFiles': list(cat.used.values())}
    selected, missing = select_templates(definitions, roots)
    if missing:
        raise ValueError('Original battle life resource closure incomplete: '+str(missing))
    return roots, selected


def build(source, reference, output):
    source, reference, output = map(lambda p: Path(p).resolve(), (source, reference, output))
    if not output.is_relative_to(ROOT/'artifacts') or output.is_relative_to(source):
        raise ValueError('Battle life output must remain in task artifacts')
    cat = Catalog(source)
    roots, selected = load_roots(cat, reference)
    output.mkdir(parents=True, exist_ok=True)
    converted = {}
    for record in selected.values():
        record['textures'] = {}
        for name in sorted({e['value'] for e in record['events'] if e['property'] == 'Texture'}):
            path = cat.path(name)
            file = 'fx/textures/'+Path(name).stem+'-'+digest(path.read_bytes())[:10]+'.png'
            (output/file).parent.mkdir(parents=True, exist_ok=True)
            with Image.open(path) as image:
                rgba = image.convert('RGBA')
                rgba.save(output/file)
                record['textures'][name] = {'file': file, 'width': rgba.width, 'height': rgba.height, 'source': cat.evidence(path)}
        mesh = record['fields'].get('MeshName') or record['fields'].get('Mesh')
        if mesh:
            record['meshMaterialClosure'] = mesh_material_closure(cat, mesh)
            if mesh.casefold() not in converted:
                converted[mesh.casefold()] = build_effect(cat, output/'fx/meshes', mesh)
            data = converted[mesh.casefold()]
            if not data['glb'] or data['unsupportedPoseTracks'] or data['missingExplicitTickRate']:
                raise ValueError('Incomplete original battle life mesh conversion: '+mesh)
            record.update(glb='fx/meshes/'+Path(data['glb']).name, poseData='fx/meshes/'+Path(data['poseData']).name,
                animationClips=data['animations'], animationMissingTickRate=False, animationRequiresUnconfirmedRate=False)
            initial = next((e['value'] for e in record['events'] if e['property'] == 'AniName' and e['start'] == 0), None)
            if initial:
                record['initialAnimation'] = {'name': initial['animation'], 'playback': initial['playback']}
    roots['sourceFiles'] = list(cat.used.values())
    write_json(ROOT/'contracts/battle-life-display-roots-v1.json', roots)
    index = {'schemaVersion': 1, 'referenceVersion': VERSION, 'clientMeasured': False,
        'templates': selected, 'effectSets': roots['effectSets'], 'callbacks': roots['callbacks'],
        'sourceFiles': roots['sourceFiles'], 'reference': roots['reference'], 'meshFailures': [], 'missingTemplates': [],
        'limits': ['Fixed-V5 timing reference, target2016 original declarations, original DLL skin key measurements are distinct evidence.',
            'No full original client or GPU trace; camera shake remains disabled under the existing web presentation policy.',
            'Template57 display follows an existing active buff; the unresolved guild 509 Miss producer is not substituted.']}
    write_json(output/'fx/index.json', index)
    write_json(ROOT/'contracts/battle-life-fx-index-v1.json', index)
    files = [{'file': p.relative_to(output).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p.read_bytes())}
        for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'manifest.json']
    write_json(output/'manifest.json', {'schemaVersion': 1, 'id': 'battle-life', 'visualEffectIndexes': ['fx/index.json'],
        'scope': roots['scope'], 'outputs': files})
    print(json.dumps({'templates': len(selected), 'meshes': len(converted), 'outputs': len(files), 'output': str(output)}))
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--reference', type=Path, default=ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp')
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/battle-life')
    args = parser.parse_args()
    build(args.source_root, args.reference, args.output)
