"""Extract only reachable 2016 effect declarations, textures and meshes.

The DSL is parsed as data; arbitrary expressions stay unsupported. No Lua or
client executable runs. Hash-frozen shipped D3DX GetKeys results may supply
offline animation conversion. Originals and reference caches remain read-only.
"""
from pathlib import Path
import argparse
import json
import math
import re
from PIL import Image
from build_rf import Catalog, build_effect, digest, write_json

ROOT = Path(__file__).resolve().parents[3]
NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?'
# Fixed KTDGParticleSystem.cpp: ProcessParticleType/ProcessMeshRenderType/
# ProcessBillboardType and m_BlendingModes/m_CullModes. Uppercasing is only
# tokenization; the original consumers still reject values outside these sets.
PARTICLE_ENUM_FIELDS = {
    'particleType': frozenset(('PT_3D_PLANE', 'PT_2D_PLANE', 'PT_MESH', 'PT_SKINMESH')),
    'meshRenderType': frozenset(('RT_REAL_COLOR', 'RT_CARTOON', 'RT_CARTOON_BLACK_EDGE', 'RT_CARTOON_COLOR_EDGE')),
    'BillBoardType': frozenset(('BT_ALL', 'BT_NONE', 'BT_X', 'BT_Y', 'BT_Z')),
    'CullMode': frozenset(('D3DCULL_NONE', 'D3DCULL_CW', 'D3DCULL_CCW', 'D3DCULL_FORCE_DWORD')),
}
PARTICLE_BLEND_MODES = frozenset('D3DBLEND_' + suffix for suffix in (
    'ZERO', 'ONE', 'SRCCOLOR', 'INVSRCCOLOR', 'SRCALPHA', 'INVSRCALPHA',
    'DESTALPHA', 'INVDESTALPHA', 'DESTCOLOR', 'INVDESTCOLOR', 'SRCALPHASAT',
    'BOTHSRCALPHA', 'BOTHINVSRCALPHA', 'BLENDFACTOR', 'INVBLENDFACTOR'))
PARTICLE_ENUM_FIELDS.update(SourceBlendMode=PARTICLE_BLEND_MODES, DestBlendMode=PARTICLE_BLEND_MODES)
# The same parser also reads minor XMesh declarations (notably DropDown).
# These literal members come from KTDGXMeshPlayer.cpp ProcessLifeType,
# ProcessMeshType, ProcessRenderType and ProcessCartoonTexType.
MESH_ENUM_TOKENS = frozenset(('LT_PLAY_COUNT', 'LT_TIME', 'LT_MANUAL', 'X_MESH', 'X_SKIN_MESH',
    'CTT_NORMAL', 'CTT_RED', 'RT_CARTOON_FADE', 'RT_CARTOON_FADE_NONTEX', 'RT_BLACK_EDGE', 'RT_COLOR_EDGE')) | frozenset(
        'RT_LIGHT_FLOW_' + space + '_' + axis for space in ('WORLD', 'LOCAL') for axis in ('X', 'Y', 'Z', 'POINT'))
NATIVE_ENUM_TOKENS = frozenset().union(*PARTICLE_ENUM_FIELDS.values(), MESH_ENUM_TOKENS)
PARTICLE_NUMERIC_FIELDS = frozenset(('NumParticles', 'Lifetime', 'Emitrate', 'TriggerCount',
    'TriggerTime', 'DrawCount', 'Layer', 'LandPos', 'ScrewValue', 'ScrewRotateSpeed',
    'SphericalEmitRadius', 'SphericalEmitAzimuth', 'SphericalEmitPolar'))

def split_arguments(value):
    parts, depth, start = [], 0, 0
    for i, char in enumerate(value):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth < 0:
                raise ValueError('Unbalanced expression')
        elif char == ',' and depth == 0:
            parts.append(value[start:i].strip())
            start = i + 1
    if depth:
        raise ValueError('Unbalanced expression')
    parts.append(value[start:].strip())
    return parts

def expression(value, casefold_tokens=False):
    value = value.strip()
    if re.fullmatch(NUMBER, value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('Non-finite expression')
        return result
    if re.fullmatch(r'"[^"\r\n]*"', value):
        return value[1:-1]
    # Native DetermineTokenType uppercases every unquoted token before Bool.
    if value.upper() in ('TRUE', 'FALSE'):
        return value.upper() == 'TRUE'
    call = re.fullmatch(r'(XYZ|RGBA|UV|XY|random)\((.*)\)', value, re.I)
    if call:
        name = call[1].lower()
        args = [expression(part, casefold_tokens) for part in split_arguments(call[2])]
        expected = {'xyz': 3, 'rgba': 4, 'uv': 2, 'xy': 2, 'random': 2}[name]
        numeric = lambda a: type(a) in (float, int) or isinstance(a, dict) and set(a) == {'random'}
        if len(args) != expected or not all(numeric(a) for a in args):
            raise ValueError('Invalid vector/random arity: ' + value)
        if name == 'random':
            # Native ProcessNumber stores first/second into m_Min/m_Max without
            # ordering/rejection. Preserve author order; RNG consumer separate.
            return {'random': args}
        return args
    # The native tokenizer uppercases unquoted symbols. Keep this opt-in for
    # the source families whose tokenizer contract has been established; names
    # inside quotes have already returned unchanged above. Non-finite numeric
    # spellings must never become apparently supported symbolic values.
    if casefold_tokens:
        if value.upper() in NATIVE_ENUM_TOKENS:
            return value.upper()
    elif value.lower() not in ('nan', 'inf', 'infinity') and re.fullmatch(r'[A-Z][A-Z0-9_]*', value):
        return value
    raise ValueError('Unsupported expression: ' + value)

MINOR_FIELD_TOKENS = {name.lower(): name for name in (
    'particleType', 'meshRenderType', 'CullMode', 'Layer', 'SourceBlendMode', 'DestBlendMode', 'NumParticles',
    'Gravity', 'Emitradius', 'Lifetime', 'Emitrate', 'TriggerTime', 'TriggerCount',
    'Trace', 'BillBoardType', 'ApplyUnitScale', 'UseLand', 'LandPosition',
    'SphericalEmitRadius', 'SphericalEmitAzimuth', 'SphericalEmitPolar')}
EVENT_TOKENS = {name.lower(): name for name in (
    'Texture', 'Texture1', 'Texture2', 'Color', 'Size', 'Velocity', 'EventTimer',
    'AniName', 'Scale', 'Stretch', 'AniSpeed', 'DirSpeed', 'Rotate', 'Position',
    'TexUV', 'Tex1UV', 'Tex2UV', 'SlashTrace', 'SlashTraceTip')}

def declaration(body, casefold_tokens=False):
    fields, events, repeated, unknown = {}, [], {}, []
    for line in body.replace('\r', '').splitlines():
        # Comments in the DSL start outside quoted asset names.
        quoted = False
        for i, char in enumerate(line):
            if char == '"':
                quoted = not quoted
            elif not quoted and line[i:i + 2] == '//':
                line = line[:i]
                break
        line = line.strip()
        if not line:
            continue
        if '=' not in line:
            unknown.append(line)
            continue
        key, literal = [v.strip() for v in line.split('=', 1)]
        try:
            flags = re.I if casefold_tokens else 0
            animation = re.fullmatch(r'"([^"\r\n]+)"\s*,\s*(XAP_\w+)', literal, flags) if key.lower().endswith('aniname') else None
            if casefold_tokens and animation and animation[2].upper() not in ('XAP_LOOP', 'XAP_ONE', 'XAP_ONE_WAIT'):
                raise ValueError('Unsupported animation playback token')
            value = {'animation': animation[1], 'playback': animation[2].upper()} if animation else expression(literal, casefold_tokens)
            event = re.fullmatch(r'(?:Global\s+)?(Initial|Fade\s+so\s+From\s+(' + NUMBER + r')\s+to\s+(' + NUMBER + r')|(?:at|At)\s+(' + NUMBER + r'))\s+(\w+)', key, flags)
            final = re.fullmatch(r'Fade\s+so\s+final\s+(\w+)', key, flags)
            if final:
                # Particle ProcessTime receives seq.GetLifeTime().m_Max as
                # FinalTime, then sets [InitialTime=0, FinalTime]. Mesh-player
                # Final has another consumer and is deliberately not inferred.
                lifetime = fields.get('Lifetime')
                if isinstance(lifetime, dict) and set(lifetime) == {'random'}:
                    lifetime = lifetime['random'][1]
                if type(lifetime) not in (int, float) or not math.isfinite(lifetime) or lifetime <= 0:
                    raise ValueError('Particle final fade requires a preceding positive Lifetime')
                event = re.fullmatch(r'(Fade\s+so\s+From\s+(' + NUMBER + r')\s+to\s+(' + NUMBER + r')|Initial|(?:at|At)\s+(' + NUMBER + r'))\s+(\w+)',
                    'Fade so From 0 to ' + str(lifetime) + ' ' + final[1])
            if event:
                prop = event[5]
                if casefold_tokens:
                    prop = EVENT_TOKENS.get(prop.lower(), prop)
                numeric = lambda v: type(v) in (float, int) or isinstance(v, dict) and set(v) == {'random'}
                if prop in ('Size', 'Rotate', 'Velocity', 'Color'):
                    length = 4 if prop == 'Color' else 3
                    if not isinstance(value, list) or len(value) != length or not all(numeric(v) for v in value):
                        raise ValueError('Invalid ' + prop + ' event value')
                elif prop in ('Scale', 'Stretch', 'AniSpeed', 'DirSpeed') and not numeric(value):
                    raise ValueError('Invalid scalar event value')
                elif prop == 'Texture' and not isinstance(value, str):
                    raise ValueError('Invalid texture event value')
                elif prop == 'AniName' and not isinstance(value, dict):
                    raise ValueError('Missing animation playback declaration')
                start, end = float(event[2] or event[4] or 0), float(event[3] or event[4] or 0)
                if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
                    raise ValueError('Invalid event interval')
                events.append({'property': prop, 'start': start,
                    'end': end, 'fade': event[1].lower().startswith('fade'), 'value': value})
            else:
                key = ''.join(key.split())
                if casefold_tokens:
                    key = MINOR_FIELD_TOKENS.get(key.lower(), key)
                    if key in PARTICLE_ENUM_FIELDS and (not isinstance(value, str) or value not in PARTICLE_ENUM_FIELDS[key]):
                        raise ValueError('Invalid ' + key + ' enum value')
                    if key in PARTICLE_NUMERIC_FIELDS and not (type(value) in (float, int) or isinstance(value, dict) and set(value) == {'random'}):
                        raise ValueError('Invalid ' + key + ' numeric value')
                if key in fields:
                    repeated.setdefault(key, [fields[key]]).append(value)
                else:
                    fields[key] = value
        except ValueError as error:
            unknown.append({'line': line, 'reason': str(error)})
    return {'fields': fields, 'events': events, 'repeated': repeated, 'unsupported': unknown}

def strings(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)
    elif isinstance(value, str):
        yield value


def explicit_template_references(value):
    """Only source fields that refer to templates, not sounds/enums/labels."""
    if isinstance(value, dict):
        # Target enum ET_MESH_PLAYER_* (2..5) / ET_PARTICLE_* (6..9).
        # NAME on an EffectSet entry is an actual resource, unlike the set's
        # own NAME. Include it in the missing-resource audit too.
        effect_type = value.get('EFFECT_TYPE')
        if type(effect_type) in (int, float) and 2 <= effect_type <= 9:
            for key in ('NAME', 'NAME_HYPER'):
                if isinstance(value.get(key), str):
                    yield value[key]
        for key, child in value.items():
            if key in ('PARTICLE_NAME', 'MAIN_EFFECT_NAME', 'TraceParticleList', 'FinalParticleList', 'ParticleList'):
                yield from strings(child)
            else:
                yield from explicit_template_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from explicit_template_references(child)


def typed_template_references(value):
    """Preserve the independent native mesh-player and particle registries."""
    if isinstance(value, dict):
        effect_type = value.get('EFFECT_TYPE')
        if type(effect_type) in (int, float) and 2 <= effect_type <= 9:
            for key in ('NAME', 'NAME_HYPER'):
                if isinstance(value.get(key), str):
                    yield value[key], 'mesh' if effect_type <= 5 else 'particle'
        for key, child in value.items():
            if key in ('PARTICLE_NAME', 'TraceParticleList', 'FinalParticleList', 'ParticleList'):
                for name in strings(child):
                    yield name, 'particle'
            elif key == 'MAIN_EFFECT_NAME' and isinstance(child, str):
                yield child, 'mesh'
            else:
                yield from typed_template_references(child)
    elif isinstance(value, list):
        for child in value:
            yield from typed_template_references(child)


def select_templates(definitions, profile, defaults=()):
    resource_only = set(profile.get('resourceOnlyTemplates', []))
    seeds = set(strings(profile.get('effectSets', {}))) | set(strings(profile.get('damageEffects', {}))) | set(defaults) | resource_only
    seeds.update(n for n in profile.get('sourceLiteralResources', []) if n in definitions)
    expected = set(explicit_template_references(profile.get('effectSets', {}))) | set(explicit_template_references(profile.get('damageEffects', {}))) | set(defaults) | resource_only
    required_kinds, selected, processed_kinds, pending = {}, {}, {}, sorted(seeds)
    def add_kinds(value):
        for name, kind in typed_template_references(value):
            if name in selected and kind not in required_kinds.get(name, set()):
                pending.append(name)
            required_kinds.setdefault(name, set()).add(kind)
    add_kinds(profile.get('effectSets', {}))
    add_kinds(profile.get('damageEffects', {}))
    missing = set(expected - definitions.keys())
    while pending:
        name = pending.pop()
        kinds = required_kinds.get(name, set())
        if name not in definitions or name in selected and kinds == processed_kinds.get(name):
            continue
        record = definitions[name]
        if record.get('ambiguousSourceFamilies'):
            raise ValueError('Ambiguous major/minor effect template requires an explicit namespace: ' + name)
        alternatives = record.get('alternateKindDeclarations', [])
        chosen = [record]
        if alternatives:
            if not kinds:
                raise ValueError('Ambiguous mesh/particle template requires an explicit namespace: ' + name)
            candidates = [r for r in [record, *alternatives] if r['kind'] in kinds]
            if len(candidates) != len(kinds) or {r['kind'] for r in candidates} != kinds:
                raise ValueError('Missing unique typed template declaration: ' + name)
            chosen = []
            for index, original in enumerate(candidates):
                variant = dict(original)
                variant.pop('alternateKindDeclarations', None)
                variant['typedNamespaceEvidence'] = {'requestedKind': original['kind'],
                    'otherDeclarations': [{'kind': r['kind'], 'source': r['source'],
                        'declarationSha256': r['declarationSha256']}
                        for r in [record, *alternatives] if r['kind'] != original['kind']]}
                if index:
                    variant['sourceName'] = name
                    variant['name'] = original['kind']+'::'+name
                chosen.append(variant)
        processed_kinds[name] = set(kinds)
        for record in chosen:
            selected[record['name']] = record
            add_kinds(record['fields'])
            add_kinds(record['repeated'])
            children = set(explicit_template_references(record['fields'])) | set(explicit_template_references(record['repeated']))
            missing.update(children - definitions.keys())
            pending.extend(sorted(children))
    return selected, sorted(missing)


def read_definitions(catalog, additional_particle_scripts=()):
    definitions = {}
    for filename in ['GameMajorXMeshPlayer.txt'] + ['GameMajorParticle' + (str(i) if i > 1 else '') + '.txt' for i in range(1, 54)] + list(additional_particle_scripts):
        path = catalog.path(filename)
        text = path.read_bytes().decode('latin1')
        keyword = 'TEMPLET' if filename == 'GameMajorXMeshPlayer.txt' else 'eventsequence'
        for match in re.finditer(keyword + r'\s+"([^"\r\n]+)"\s*\{([^{}]*)\}', text):
            record = declaration(match[2], casefold_tokens=filename in additional_particle_scripts)
            record.update({'name': match[1], 'kind': 'mesh' if keyword == 'TEMPLET' else 'particle',
                'source': {**catalog.evidence(path), 'byteOffset': match.start(), 'line': text.count('\n', 0, match.start()) + 1},
                'declarationSha256': digest(match[0].encode('latin1'))})
            if filename in additional_particle_scripts:
                record['sourceFamily'] = 'game-minor' if filename.startswith('GameMinor') else filename
                record['sourceTokenNormalization'] = 'reference-V5 native uppercase unquoted tokens; original quoted names and source hash retained'
            if match[1] in definitions and definitions[match[1]]['declarationSha256'] != record['declarationSha256']:
                if filename in additional_particle_scripts:
                    previous = definitions[match[1]]
                    previous['ambiguousSourceFamilies'] = [previous['source'], record['source']]
                    continue
                record['duplicateDeclaration'] = definitions[match[1]]['source']
                previous = definitions[match[1]]
                alternatives = list(previous.get('alternateKindDeclarations', []))
                if previous['kind'] != record['kind']:
                    alternatives.append({k: v for k, v in previous.items() if k != 'alternateKindDeclarations'})
                alternatives = [r for r in alternatives if r['kind'] != record['kind']]
                if alternatives:
                    record['alternateKindDeclarations'] = alternatives
            definitions[match[1]] = record
    return definitions

def build(output, profile_path, source_root=Path('asset_work'), index_output=ROOT / 'contracts/rf-fx-index.json', additional_particle_scripts=()):
    catalog = Catalog(source_root)
    output.mkdir(parents=True, exist_ok=True)
    profile = json.loads(profile_path.read_text('utf-8'))
    definitions = read_definitions(catalog, additional_particle_scripts)
    # V5 core mesh uses these declared particle attachments; no synthetic flare.
    defaults = ['raven_beed_hit_01', 'raven_beed_hit_02', 'raven_beed_hit_03', 'raven_beed_hit_04']
    # X2GURaven.cpp:5117-5142 maps common native reaction IDs to these names;
    # X2GUUser.cpp:13006-13039 supplies their trigger/rate overrides.
    defaults += ['DamageImpact', 'DamageImpactCore', 'DamageImpactSlash', 'DamageImpactRed',
        'DamageImpactRingRed', 'DamageImpactCoreRed', 'DamageImpactSlashRed']
    selected, missing_templates = select_templates(definitions, profile, defaults)
    converted, mesh_failures = {}, []
    for record in selected.values():
        textures = set()
        for event in record['events']:
            if 'Texture' in event['property'] and isinstance(event['value'], str):
                textures.add(event['value'])
        record['textures'] = {}
        for name in sorted(textures):
            try:
                path = catalog.path(name)
                filename = 'textures/' + Path(name).stem + '-' + digest(path.read_bytes())[:10] + '.png'
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
                    converted[mesh.casefold()] = build_effect(catalog, output / 'meshes', mesh)
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
    write_json(output / 'index.json', result)
    if index_output is not None:
        write_json(index_output, result)
    print(json.dumps({'templates': len(selected), 'meshes': len(converted), 'textures': len(set(v['file'] for r in selected.values() for v in r['textures'].values())), 'meshFailures': mesh_failures}))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/rf/fx')
    parser.add_argument('--profile', type=Path, default=ROOT / 'packages/combat-core/rf-profile.json')
    parser.add_argument('--index-output', type=Path, default=ROOT / 'contracts/rf-fx-index.json',
        help='Separate tracked snapshot for an independent resource closure')
    parser.add_argument('--additional-particle-script', action='append', default=[],
        help='Original particle family outside the major script list, e.g. GameMinorParticle.txt')
    options = parser.parse_args()
    build(options.output, options.profile, options.source_root, options.index_output, options.additional_particle_script)
