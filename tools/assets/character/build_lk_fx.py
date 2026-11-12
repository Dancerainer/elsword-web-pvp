"""Convert LK target2016 state/effect/damage resource closure with shared verified parsers.
No arbitrary Lua execution or RF mechanism defaults. Unsupported DSL fields
and missing meshes remain explicit evidence.
"""
from pathlib import Path
import argparse
import copy
import json
from PIL import Image
from build_rf import Catalog, build_effect, digest, write_json
from build_rf_fx import read_definitions, select_templates
from lk_presentation_roots import PRESENTATION_ROOTS, ARMAGEDDON_CAST_ROOTS, minor_declarations, reuse_dropdown
from runtime_path_case import canonicalize_effect_paths
ROOT=Path(__file__).resolve().parents[3]
def build(output, profile_path, source_root=Path('asset_work'), index_output=ROOT / 'contracts/lk-fx-index.json', additional_particle_scripts=(), landing_conversion_source=None, shared_indexes=(), additional_definitions=None, presentation_roots=()):
    catalog = Catalog(source_root)
    output.mkdir(parents=True, exist_ok=True)
    profile = json.loads(profile_path.read_text('utf-8'))
    definitions = read_definitions(catalog, additional_particle_scripts)
    for name, record in (additional_definitions or {}).items():
        if name in definitions and definitions[name]['declarationSha256'] != record['declarationSha256']:
            raise ValueError('Explicit effect definition collides with original major namespace: '+name)
        definitions[name] = copy.deepcopy(record)
    defaults = list(presentation_roots)
    is_lk = profile.get('professionId') == 'lk'
    is_elsword = profile.get('professionId') in ('lk', 'rs', 'is')
    if is_elsword:
        # Shared constructors and callbacks are bound to SwordMan explicitly.
        # Do not extend the separate display-only common-buff catalog.
        defaults = PRESENTATION_ROOTS if is_lk else tuple(n for n in PRESENTATION_ROOTS if n not in ARMAGEDDON_CAST_ROOTS)
        if profile.get('professionId') == 'rs':
            defaults = (*defaults, 'RevengeImpactSlashCW', 'RevengeImpactSlashCCW', 'RevengeImpact', 'RevengeImpactTick')
        # RS elemental sword-enchant Buff DISPLAYERS refer to these original
        # minor templates, outside the major particle namespace.
        extra_minor = ('UnitCold', 'UnitPoison', 'RevengeImpactTick') if profile.get('professionId') == 'rs' else ()
        for name, record in minor_declarations(catalog, extra_minor).items():
            if name in definitions:
                if profile.get('professionId') == 'rs' and name == 'RevengeImpactTick':
                    # The reflection consumer explicitly calls GetMinorParticle;
                    # preserve the other declaration's identity, never guess by
                    # the shared spelling of major/minor template names.
                    record['shadowedMajorDeclarationSha256'] = definitions[name]['declarationSha256']
                    record['namespaceChoiceEvidence'] = 'contracts/rs-reflection-source-v1.json'
                else:
                    raise ValueError('LK minor display root collides with major namespace: '+name)
            definitions[name] = record
    if profile.get('professionId') in ('vc', 'bm', 'gm', 'bh', 'ca'):
        # Common GUUser DamageAirDownLanding callbacks run for all Raven jobs.
        # These are explicit GameMinor roots, outside every skill EffectSet.
        defaults = ['DropDown', 'GroundShockWave', 'AirDownTick', 'DownSmoke']
        for name, record in minor_declarations(catalog).items():
            if name == 'SwordFireTip' or name in defaults or profile.get('professionId') in ('gm', 'bh', 'ca'):
                definitions[name] = record
    if profile.get('professionId') == 'bm':
        # Shared Raven hit/core callbacks and GUUser landing/critical consumers
        # are literal roots outside BM's active skill state declarations.
        defaults += ['raven_beed_hit_01', 'raven_beed_hit_02', 'raven_beed_hit_03', 'raven_beed_hit_04',
            'DamageImpact', 'DamageImpactCore', 'DamageImpactSlash', 'DamageImpactRed',
            'DamageImpactRingRed', 'DamageImpactCoreRed', 'DamageImpactSlashRed',
            'CriticalHit01', 'MonsterAngryWind', 'Counter_Particle01', 'SwordFireTip']
    selected, missing_templates = select_templates(definitions, profile, defaults)
    meshes_by_stem = {}
    for record in selected.values():
        mesh = record['fields'].get('MeshName') or record['fields'].get('Mesh')
        if mesh:
            meshes_by_stem.setdefault(Path(mesh).stem.casefold(), set()).add(mesh.casefold())
    colliding_stems = {stem for stem,names in meshes_by_stem.items() if len(names) > 1}
    shared = {}
    for path, prefix in shared_indexes:
        for name, record in json.loads(Path(path).read_text('utf8'))['templates'].items():
            shared.setdefault((name, record['declarationSha256']), (record, prefix, path))
    reused = []
    converted, mesh_failures, texture_outputs = {}, [], {}
    for record in selected.values():
        existing = shared.get((record['name'], record['declarationSha256']))
        mesh = record['fields'].get('MeshName') or record['fields'].get('Mesh')
        if mesh and Path(mesh).stem.casefold() in colliding_stems:
            existing = None  # Older indexes may have overwritten X/Y with the same stem.
        if existing:
            original, prefix, source_index = existing
            for key in ('glb', 'poseData', 'animationMissingTickRate', 'animationClips', 'animationRequiresUnconfirmedRate', 'textures',
                        'meshMaterialClosure', 'convertedArtifactReuse'):
                if key in original:
                    record[key] = copy.deepcopy(original[key])
            for key in ('glb', 'poseData'):
                if record.get(key): record[key] = prefix + record[key]
            for texture in record.get('textures', {}).values():
                texture['file'] = prefix + texture['file']
            record['sharedResourceEvidence'] = {'index': str(Path(source_index).relative_to(ROOT)), 'declarationSha256': record['declarationSha256']}
            canonicalize_effect_paths({'templates': {record['name']: record}}, output.parent)
            reused.append(record['name'])
            continue
        textures = set()
        for event in record['events']:
            if 'Texture' in event['property'] and isinstance(event['value'], str):
                textures.add(event['value'])
        record['textures'] = {}
        for name in sorted(textures):
            try:
                path = catalog.path(name)
                texture_hash = digest(path.read_bytes())[:10]
                # Original declarations reuse textures with differing letter case.
                # Emit one spelling per source identity on both Windows and Linux.
                filename = texture_outputs.setdefault((name.casefold(), texture_hash),
                    'textures/' + Path(name).stem + '-' + texture_hash + '.png')
                (output / filename).parent.mkdir(parents=True, exist_ok=True)
                image = Image.open(path).convert('RGBA')
                image.save(output / filename)
                record['textures'][name] = {'file': 'fx/' + filename, 'width': image.width, 'height': image.height, 'source': catalog.evidence(path)}
            except (OSError, ValueError) as error:
                record['unsupported'].append({'texture': name, 'reason': str(error)})
        if record['kind'] == 'mesh' or record['fields'].get('Mesh'):
            mesh = record['fields'].get('MeshName') or record['fields'].get('Mesh')
            if not mesh:
                record['unsupported'].append('Missing mesh name')
                continue
            if mesh.casefold() not in converted:
                try:
                    converted[mesh.casefold()] = reuse_dropdown(catalog, output/'meshes', record, landing_conversion_source) if (
                        is_lk and record['name'] == 'DropDown' and landing_conversion_source is not None) else build_effect(catalog, output / 'meshes', mesh,
                            output_name=Path(mesh).stem+'_'+Path(mesh).suffix[1:].lower() if Path(mesh).stem.casefold() in colliding_stems else None)
                except (OSError, ValueError, IndexError) as error:
                    converted[mesh.casefold()] = {'glb': None, 'reason': str(error)}
                    mesh_failures.append({'mesh': mesh, 'reason': str(error)})
            data = converted[mesh.casefold()]
            record['glb'] = 'fx/meshes/' + Path(data['glb']).name if data.get('glb') else None
            record['poseData'] = 'fx/meshes/' + Path(data['poseData']).name if data.get('poseData') else None
            record['animationMissingTickRate'] = data.get('missingExplicitTickRate', True)
            record['animationClips'] = data.get('animations', [])
            record['animationRequiresUnconfirmedRate'] = any('missing tick rate for time-varying source' in error.get('reason', '')
                for error in data.get('unsupportedPoseTracks', []))
            if data.get('reason'):
                record['unsupported'].append(data['reason'])
    result = {'schemaVersion': 1, 'referenceVersion': 'Steam-NA-2016-V6.0420.5', 'clientMeasured': False,
        'templates': selected, 'sourceFiles': list(catalog.used.values()),
        'runtimeDefaultsEvidence': 'reference-V5 KTDGParticleSystem.h CParticle::Init; .cpp CParticleEventSequence constructor; native runtime not measured',
        'limits': ['Unsupported DSL fields are retained, not interpreted by guesswork.',
            'Native RNG, composite emission timing and GPU blend remain target-client acceptance items.'], 'meshFailures': mesh_failures,
        'missingTemplates': missing_templates, 'profileSha256': digest(profile_path.read_bytes())}
    if shared_indexes:
        result['sharedTemplates'] = reused
    if is_elsword:
        result['presentationRoots'] = list(defaults)
        result['presentationRootsEvidence'] = 'contracts/'+('is' if profile.get('professionId') == 'is' else 'lk')+'-presentation-roots.json'
        if profile.get('professionId') == 'rs':
            result['reflectionRootsEvidence'] = 'contracts/rs-reflection-source-v1.json'
    write_json(output / 'index.json', result)
    if index_output is not None:
        write_json(index_output, result)
    print(json.dumps({'templates': len(selected), 'meshes': len(converted), 'textures': len(set(v['file'] for r in selected.values() for v in r['textures'].values())), 'meshFailures': mesh_failures}))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root',type=Path,default=Path('asset_work'))
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/lk/fx')
    p.add_argument('--profile',type=Path,default=ROOT/'packages/combat-core/lk-profile.json')
    p.add_argument('--index-output',type=Path,default=ROOT/'contracts/lk-fx-index.json')
    p.add_argument('--landing-conversion-source',type=Path,default=ROOT/'artifacts/lk-presentation-prerequisites/landing-fx',
        help='Read-only DropDown conversion matching tracked integrity GLB/pose/index hashes; omit missing path to require original native keys')
    a=p.parse_args()
    if a.output.resolve().is_relative_to(a.source_root.resolve()):raise ValueError('Output must stay outside inputs')
    build(a.output,a.profile,a.source_root,a.index_output,landing_conversion_source=a.landing_conversion_source if a.landing_conversion_source.is_dir() else None)
