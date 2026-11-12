"""Add only the original common landing closure to VC, reusing RF bytes.

The source minor declarations and the existing frozen RF conversion must agree.
No skill/profile rules, texture bytes or mesh conversions are regenerated.
"""
import copy
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]

NAMES = ('DropDown', 'GroundShockWave', 'AirDownTick', 'DownSmoke')
REUSE_FIELDS = ('glb', 'poseData', 'animationMissingTickRate', 'animationClips',
                'animationRequiresUnconfirmedRate', 'textures', 'meshMaterialClosure',
                'convertedArtifactReuse')


def read_json(path):
    return json.loads(path.read_text('utf8'))


def json_bytes(value):
    # Path.write_text uses CRLF on Windows. Profile seals use UTF-8 LF on every
    # host, as do the shared asset writer and the deployment manifest.
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)+'\n').encode('utf8')


def sealed_documents(profile_bytes, manifest, index, report):
    normalized = profile_bytes.decode('utf8').replace('\r\n', '\n').encode('utf8')
    profile = json.loads(normalized)
    if profile.get('professionId') != 'vc' or not profile.get('profileId'):
        raise ValueError('Expected an identified VC profile')
    for document in (manifest, report):
        seal = document.get('profile', {})
        if seal.get('hashNormalization') != 'UTF-8 LF':
            raise ValueError('Expected UTF-8 LF profile hash normalization')
        if seal.get('profileId') != profile['profileId']:
            raise ValueError('Profile identity differs from sealed metadata')
    if index.get('schemaVersion') != 1 or not isinstance(index.get('templates'), dict):
        raise ValueError('Expected versioned VC FX index')
    manifest, index, report = copy.deepcopy((manifest, index, report))
    sha = hashlib.sha256(normalized).hexdigest()
    manifest['profile']['sha256'] = sha
    index['profileSha256'] = sha
    report['profile'] = copy.deepcopy(manifest['profile'])
    return normalized, manifest, index, report


def write_profile_with_seals(profile, index, root=ROOT):
    output = root/'artifacts/vc'
    # Parse and validate every document before writing any of them. A malformed
    # index/manifest must not leave a newly written profile with its old seal.
    data, manifest, index, report = sealed_documents(
        json_bytes(profile), read_json(output/'manifest.json'), index,
        read_json(root/'reports/vc-assets-runtime.json'))
    writes = {
        root/'packages/combat-core/vc-profile.json': data,
        output/'manifest.json': json_bytes(manifest),
        output/'fx/index.json': json_bytes(index),
        root/'contracts/vc-fx-index.json': json_bytes(index),
        root/'reports/vc-assets-runtime.json': json_bytes(report),
    }
    for path, data in writes.items():
        path.write_bytes(data)
    return index['profileSha256']


def refresh_runtime_inventory(reuse, root=ROOT):
    output = (root/'artifacts/vc').resolve()
    manifest = read_json(output/'manifest.json')
    index = read_json(output/'fx/index.json')
    report = read_json(root/'reports/vc-assets-runtime.json')
    profile_bytes = (root/'packages/combat-core/vc-profile.json').read_bytes()
    _, expected_manifest, expected_index, expected_report = sealed_documents(profile_bytes, manifest, index, report)
    if (manifest['profile'] != expected_manifest['profile'] or
            index['profileSha256'] != expected_index['profileSha256'] or
            report['profile'] != expected_report['profile'] or
            index != read_json(root/'contracts/vc-fx-index.json')):
        raise ValueError('VC profile seal or FX contract changed during packing')
    inventory = copy.deepcopy(reuse)
    seen = set()
    for row in inventory['outputs']:
        relative = row['file']
        path = (output/relative).resolve()
        if (relative in seen or not path.is_relative_to(output) or
                path.is_relative_to(output/'source-proof')):
            raise ValueError('Invalid or duplicated runtime inventory path: '+relative)
        seen.add(relative)
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    actual = {path.relative_to(output).as_posix() for path in output.rglob('*')
              if path.is_file() and not path.is_relative_to(output/'source-proof')}
    if seen != actual:
        raise ValueError('VC runtime inventory does not cover the packed directory')
    inventory.update(runtimeFiles=len(seen), runtimeBytes=sum(row['bytes'] for row in inventory['outputs']))
    report.update(outputs=inventory['outputs'], profile=manifest['profile'], missingTemplates=index['missingTemplates'])
    report['summary'].update(files=inventory['runtimeFiles'], bytes=inventory['runtimeBytes'],
                             fxTemplates=len(index['templates']), missingTemplates=len(index['missingTemplates']),
                             fxTextures=len({r['file'] for t in index['templates'].values() for r in t['textures'].values()}))
    (root/'reports/vc-resource-reuse-v1.json').write_bytes(json_bytes(inventory))
    (root/'reports/vc-assets-runtime.json').write_bytes(json_bytes(report))
    return report


def add_landing():
    sys.path.insert(0, str(ROOT/'tools/assets/character'))
    from build_rf import Catalog
    from lk_presentation_roots import minor_declarations
    read = read_json
    raw = minor_declarations(Catalog(Path('asset_work')))
    shared = read(ROOT/'artifacts/rf/landing-fx/index.json')
    frozen = read(ROOT/'contracts/rf-landing-fx-index-v1.json')
    index = read(ROOT/'artifacts/vc/fx/index.json')
    profile_path = ROOT/'packages/combat-core/vc-profile.json'
    profile = read(profile_path)
    without = lambda p: {**p, 'effectTemplates': {k:v for k,v in p['effectTemplates'].items() if k not in NAMES}}
    stable = lambda v: json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8')
    unchanged_before = stable(without(profile))
    file_evidence = []
    for name in NAMES:
        original = shared['templates'][name]
        if original != frozen['templates'][name]:
            raise ValueError('RF landing conversion differs from frozen contract: '+name)
        for key in ('fields', 'events', 'repeated', 'source', 'declarationSha256', 'unsupported'):
            if raw[name][key] != original[key]:
                raise ValueError('Original minor declaration differs: '+name+'/'+key)
        record = copy.deepcopy(raw[name])
        for key in REUSE_FIELDS:
            if key in original:
                record[key] = copy.deepcopy(original[key])
        for key in ('glb', 'poseData'):
            if record.get(key):
                record[key] = '../rf/'+record[key]
        for texture in record.get('textures', {}).values():
            texture['file'] = '../rf/'+texture['file']
        record['sharedResourceEvidence'] = {
            'index': 'artifacts/rf/landing-fx/index.json',
            'declarationSha256': record['declarationSha256'],
        }
        for relative in [record.get('glb'), record.get('poseData'),
                         *(texture['file'] for texture in record.get('textures', {}).values())]:
            if relative:
                path = (ROOT/'artifacts/vc'/relative).resolve()
                if not path.is_relative_to(ROOT/'artifacts/rf/landing-fx'):
                    raise ValueError('Landing reuse escaped original shared asset directory')
                data = path.read_bytes()
                file_evidence.append({'file': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        index['templates'][name] = record
        if name not in index.setdefault('sharedTemplates', []):
            index['sharedTemplates'].append(name)
        initial = {e['property']:e['value'] for e in record['events'] if e['start'] == 0 and not e['fade']}
        profile['effectTemplates'][name] = {
            **copy.deepcopy(record), 'initialSize': initial.get('Size'), 'initialVelocity': initial.get('Velocity'),
            'initialDirSpeed': initial.get('DirSpeed'),
            'initialAnimation': {'name':initial['AniName']['animation'], 'playback':initial['AniName']['playback']} if 'AniName' in initial else None,
            'missingExplicitTickRate': record.get('animationMissingTickRate', False),
        }
    if stable(without(profile)) != unchanged_before:
        raise ValueError('Non-landing profile contents changed')
    index['missingTemplates'] = [name for name in index.get('missingTemplates', []) if name not in NAMES]
    profile_sha = write_profile_with_seals(profile, index)
    proof = {'schema':1, 'evidenceClass':'original target2016 GameMinor definitions + frozen shared RF conversion; no full-client runtime measurement',
             'templates':list(NAMES), 'sourceContract':'contracts/rf-landing-fx-index-v1.json',
             'consumer':'apps/web/landing-effects.mjs; fixed-V5 GUUser DamageAirDownLandingStart/FrameMove',
             'nonLandingProfileCanonicalSha256':hashlib.sha256(unchanged_before).hexdigest(),
             'resourceCopies':0, 'resourceConversions':0, 'sharedFiles':file_evidence}
    (ROOT/'contracts/vc-landing-reuse-v3.json').write_bytes(json_bytes(proof))
    print(json.dumps({'templates':len(NAMES), 'resourceCopies':0, 'resourceConversions':0,
                      'profileSha256':profile_sha,
                      'nonLandingProfileCanonicalSha256':proof['nonLandingProfileCanonicalSha256']}))


if __name__ == '__main__':
    add_landing()
    # pack() mutates only the task-local VC directory. Validate every potential
    # move target before allowing its existing source-proof compaction pass.
    output = (ROOT/'artifacts/vc').resolve()
    proof = (output/'source-proof').resolve()
    if not output.is_relative_to(ROOT.resolve()) or not proof.is_relative_to(output):
        raise ValueError('VC packing directory escaped the task workspace')
    for path in output.rglob('*'):
        if path.is_file() and not path.is_relative_to(proof):
            if not path.resolve().is_relative_to(output) or not (proof/path.relative_to(output)).resolve().is_relative_to(proof):
                raise ValueError('VC packing path escaped task-local outputs')
    from pack_vc_runtime import pack
    report = refresh_runtime_inventory(pack())
    print(json.dumps({'profile':report['profile'], 'summary':report['summary']}))
