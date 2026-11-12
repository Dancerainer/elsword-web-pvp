"""Literal LK display roots justified by shared fixed-source consumers.

Only the target2016 declarations supply fields. The reference consumers justify
resource reachability, not measured 2016 gameplay or GPU behavior.
"""
import json
import re
from pathlib import Path
from build_rf import digest
from build_landing_fx import parse, mesh_material_closure
from build_rf_fx import declaration

ROOT = Path(__file__).resolve().parents[3]
SMALL_HIT_ROOTS = ('DamageImpact', 'DamageImpactCore', 'DamageImpactSlash')
WAY_OF_SWORD_UI_ROOTS = tuple('elswrod_'+kind+'_UI_0'+str(i)
    for kind in ('vitality', 'demolition') for i in range(1, 4))
MINOR_PARTICLE_ROOTS = ('GroundShockWave', 'AirDownTick', 'DownSmoke', 'HyperBoostRight', 'HyperBoostLeft', 'STR_KAAng', 'SwordFireTip', *WAY_OF_SWORD_UI_ROOTS)
ARMAGEDDON_CAST_ROOTS = ('Light_Knight_ArmageddonBlade01', 'Light_Knight_ArmageddonBlade02', 'Flare_MagicKnight_WindBlade01')
PRESENTATION_ROOTS = (*SMALL_HIT_ROOTS, *MINOR_PARTICLE_ROOTS, 'DropDown', 'CriticalHit01', 'MonsterAngryWind', 'Counter_Particle01', *ARMAGEDDON_CAST_ROOTS)


def minor_declarations(catalog, extra_particle_roots=()):
    result = {}
    for name in (*MINOR_PARTICLE_ROOTS, 'DropDown', *extra_particle_roots):
        mesh = name == 'DropDown'
        path = catalog.path('GameMinorXMeshPlayer.txt' if mesh else 'GameMinorParticle.txt')
        text = path.read_bytes().decode('latin1')
        if mesh:
            record, match = parse(text, name, 'TEMPLET')
        else:
            matches = list(re.finditer(r'eventsequence\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}', text))
            if len(matches) != 1: raise ValueError('Unique original LK minor declaration required: '+name)
            match = matches[0]
            # Native DetermineTokenType uppercases unquoted tokens, including
            # target BT_All. Quoted file/template names remain byte-for-byte.
            body = re.sub(r'(=\s*)([A-Za-z_][A-Za-z_0-9]*)(\s*(?://[^\r\n]*)?$)',
                lambda m:m[1]+m[2].upper()+m[3], match[1], flags=re.M)
            record = declaration(body, casefold_tokens=True)
            if record['unsupported']: raise ValueError('Unsupported original LK minor declaration: '+name)
            expected = 'PT_2D_PLANE' if name in WAY_OF_SWORD_UI_ROOTS or name == 'STR_KAAng' else 'PT_3D_PLANE'
            if record['fields'].get('particleType') != expected:
                raise ValueError('Unexpected original LK minor geometry: '+name)
        record.update(name=name, kind='mesh' if mesh else 'particle', sourceFamily='game-minor',
            source={**catalog.evidence(path), 'byteOffset':match.start(), 'line':text.count('\n', 0, match.start())+1},
            declarationSha256=digest(match[0].encode('latin1')),
            sourceTokenNormalization='reference-V5 unquoted tokens; original byte hash retained')
        result[name] = record
    return result


def reuse_dropdown(catalog, destination, declaration, source):
    """Reuse just one hash-frozen conversion, never RF combat data or a clock guess.

    A missing or altered prerequisite fails closed. The caller may alternatively
    rebuild using the original measured native keys required by build_effect.
    """
    source, destination = Path(source).resolve(), Path(destination).resolve()
    proof_path = ROOT/'reports/medium-skills-integrity-v6.json'
    proof = json.loads(proof_path.read_text('utf8'))['productionVisual']
    index_path = source/'index.json'
    index_hash = proof['assetInputHashes']['artifacts/rf/landing-fx/index.json']
    if digest(index_path.read_bytes()) != index_hash:
        raise ValueError('DropDown converted index SHA256 differs from tracked integrity evidence')
    record = json.loads(index_path.read_text('utf8'))['templates']['DropDown']
    for key in ('fields', 'events', 'repeated', 'source', 'declarationSha256', 'unsupported'):
        if record[key] != declaration[key]:
            raise ValueError('DropDown original declaration differs: '+key)
    closure = mesh_material_closure(catalog, declaration['fields']['MeshName'])
    if closure != record['meshMaterialClosure']:
        raise ValueError('DropDown original mesh/texture closure differs')
    registry = json.loads((ROOT/'reports/rf-landing-d3dx-keyframes-v1.json').read_text('utf8'))
    measured = registry['sources'][0]
    mesh = catalog.path(declaration['fields']['MeshName'])
    if digest(mesh.read_bytes()) != measured['sourceSha256']:
        raise ValueError('DropDown original animation source SHA256 differs')
    clip, native = record['animationClips'][0], measured['animations'][0]
    if (clip['name'], clip['durationSeconds'], clip['ticksPerSecond'], clip['nativePlaybackField']) != (
            native['name'], native['period'], native['ticksPerSecond'], native['playbackType']):
        raise ValueError('DropDown converted animation metadata differs from original DLL measurement')
    if record['animationMissingTickRate'] or record['animationRequiresUnconfirmedRate']:
        raise ValueError('DropDown measured conversion contains unconfirmed animation')
    files = []
    # Verify every prerequisite before writing, so damaged input cannot leave a
    # partially accepted conversion in the task output.
    for key, hashes, prefix in (
        ('glb', proof['glbHashes'], ''),
        ('poseData', proof['assetInputHashes'], 'artifacts/rf/')):
        path = (source.parent/record[key]).resolve()
        if not path.is_relative_to(source):
            raise ValueError('DropDown converted file escapes prerequisite directory')
        raw = path.read_bytes(); expected = hashes[prefix+record[key]]
        if digest(raw) != expected:
            raise ValueError('DropDown converted '+key+' SHA256 differs from tracked integrity evidence')
        files.append((path, raw, expected))
    destination.mkdir(parents=True, exist_ok=True)
    for path, raw, _ in files:
        (destination/path.name).write_bytes(raw)
    declaration['meshMaterialClosure'] = closure
    declaration['convertedArtifactReuse'] = {
        'evidenceReport':'reports/medium-skills-integrity-v6.json',
        'originalKeyManifest':'reports/rf-landing-d3dx-keyframes-v1.json',
        'indexSha256':index_hash,
        'files':[{'file':p.name, 'sha256':sha, 'bytes':len(raw)} for p, raw, sha in files],
        'scope':'One original common minor display conversion; no RF combat profile or attack catalog'}
    return {'glb':files[0][0].name, 'poseData':files[1][0].name,
        'animations':record['animationClips'], 'missingExplicitTickRate':False, 'unsupportedPoseTracks':[]}
