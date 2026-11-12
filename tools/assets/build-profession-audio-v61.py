"""Build a private audio-only overlay from the all-profession missing-binding audit.

Catalog, original bytes and published assets are read-only. No transcoding,
guessed substitute sounds, or changes to combat declarations are performed.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import shutil
import sqlite3
import sys
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio import inspect_ogg

JOBS = ('RF', 'LK', 'VC', 'RS', 'BM', 'IS', 'GM', 'BH', 'CA', 'LP', 'MM', 'DE')
SHARED_RAVEN_ATTACK = frozenset(('Raven_NasodCore_Attack.ogg', 'Raven_NasodCore_Trans_Attack.ogg'))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf8')


def safe_name(name):
    if (not isinstance(name, str) or not name or name in ('.', '..')
            or any(c in name for c in '/\\:\0?#')
            or Path(name).suffix.lower() not in ('.ogg', '.wav')):
        raise ValueError('Invalid original sound filename: ' + repr(name))
    return name


def physical(path):
    for part in (path, *path.parents):
        if part.exists() and (part.is_symlink() or part.is_junction()):
            raise ValueError('Physical output path required: ' + str(part))


def inspect_sound(data, name):
    if name.lower().endswith('.ogg'):
        return inspect_ogg(data)
    with wave.open(io.BytesIO(data), 'rb') as source:
        if source.getcomptype() != 'NONE' or not source.getnframes():
            raise ValueError('Expected nonempty original PCM WAV: ' + name)
        metadata = {'codec': 'PCM', 'channels': source.getnchannels(),
                    'sampleRate': source.getframerate(), 'sampleWidthBytes': source.getsampwidth(),
                    'frames': source.getnframes(),
                    'durationSeconds': source.getnframes() / source.getframerate()}
        expected = source.getnframes() * source.getnchannels() * source.getsampwidth()
        if len(source.readframes(source.getnframes())) != expected:
            raise ValueError('Truncated original PCM WAV: ' + name)
        return metadata


def build(audit_path, assets_root, source_root, output, trigger_audit_path):
    physical(Path(output).absolute())
    audit_path, assets_root, source_root, output = (
        Path(p).resolve() for p in (audit_path, assets_root, source_root, output))
    physical(output)
    if not output.is_relative_to(ROOT / 'runtime/audio-v61') or output.exists():
        raise ValueError('Output must be a new directory in this task runtime/audio-v61')
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    if audit.get('schemaVersion') != 1 or set(audit.get('professions', {})) != set(JOBS):
        raise ValueError('Expected the complete twelve-profession audit')
    trigger_bytes = Path(trigger_audit_path).read_bytes()
    trigger_audit = json.loads(trigger_bytes)
    if trigger_audit.get('schemaVersion') != 1 or 'unreachableBindings' not in trigger_audit:
        raise ValueError('Expected an explicit current-runtime reachability audit')
    exclusions = {}
    for row in trigger_audit['unreachableBindings']:
        if row['profession'] not in JOBS or not row.get('reason') or not row.get('evidence'):
            raise ValueError('Unsupported reachability exclusion')
        exclusions[(row['profession'], safe_name(row['name']))] = row
    if exclusions and not trigger_audit.get('reachabilityInputs'):
        raise ValueError('Reachability exclusion requires hashed source evidence')
    for row in trigger_audit.get('reachabilityInputs', []):
        path = (ROOT / row['path']).resolve()
        if not path.is_relative_to(ROOT) or file_hash(path) != row['sha256']:
            raise ValueError('Stale reachability source evidence: ' + row['path'])
    contract = {'schemaVersion': 1, 'targetClientMeasured': False,
                'classification': 'original audio bytes; current runtime binding audit; playback verified separately',
                'auditSha256': digest(audit_bytes), 'triggerAuditSha256': digest(trigger_bytes),
                'reachabilityInputs': trigger_audit.get('reachabilityInputs', []),
                'excludedBindings': list(exclusions.values()), 'profileSha256': {}, 'professions': {},
                'sources': {}, 'outputs': {}, 'unresolved': []}
    pending = {}
    original_cache = {}
    manifest_edits = {}

    def manifest_for(relative):
        if relative not in manifest_edits:
            data = (assets_root / relative).read_bytes()
            manifest_edits[relative] = {'baseline': data, 'value': json.loads(data), 'changed': False}
        return manifest_edits[relative]
    db = sqlite3.connect((source_root / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        for job in JOBS:
            contract['profileSha256'][job] = file_hash(ROOT / 'packages/combat-core' / (job.lower() + '-profile.json'))
            if 'repairBindings' not in audit['professions'][job]:
                raise ValueError('Audit must distinguish repairBindings from source-only literals')
            missing = audit['professions'][job]['repairBindings']
            manifest_rel = 'audio/manifest.json' if job == 'RF' else job.lower() + '/audio/manifest.json'
            own = manifest_for(manifest_rel)
            manifest_bytes = own['baseline']
            names = sorted({safe_name(item['name']) for item in missing
                            if (job, safe_name(item['name'])) not in exclusions})
            record = {'manifest': manifest_rel, 'baseManifestSha256': digest(manifest_bytes),
                      'missingBefore': names, 'added': [], 'addedBindings': [], 'unresolved': []}
            contract['professions'][job] = record
            for name in names:
                target_manifest = 'rf/core-shield-audio/manifest.json' if name in SHARED_RAVEN_ATTACK else manifest_rel
                edit = manifest_for(target_manifest)
                manifest = edit['value']
                if name in manifest['files']:
                    raise ValueError('Stale audit: binding already exists: ' + job + '/' + name)
                if name not in original_cache:
                    rows = [dict(r) for r in db.execute(
                        "SELECT * FROM assets WHERE status='ok' AND lower(name)=lower(?)", (name,))]
                    if not rows or len({r['sha256'].lower() for r in rows}) != 1:
                        original_cache[name] = None
                        contract['sources'][name] = {'status': 'missing' if not rows else 'ambiguous',
                            'candidates': [{k: r[k] for k in ('archive', 'ordinal', 'name', 'sha256', 'raw_path')} for r in rows]}
                    else:
                        row = sorted(rows, key=lambda r: (r['archive'], r['ordinal']))[0]
                        original = (source_root / row['raw_path']).resolve()
                        if not original.is_relative_to(source_root / 'raw'):
                            raise ValueError('Original path escaped raw directory: ' + name)
                        data = original.read_bytes()
                        if digest(data) != row['sha256'].lower():
                            raise ValueError('Original source SHA mismatch: ' + name)
                        metadata = inspect_sound(data, name)
                        source = {k: row[k] for k in ('archive', 'ordinal', 'name', 'sha256', 'raw_path')}
                        source.update(bytes=len(data), status='verified')
                        contract['sources'][name] = source
                        original_cache[name] = (original, len(data), digest(data), metadata, source)
                original = original_cache[name]
                if original is None:
                    record['unresolved'].append(name)
                    contract['unresolved'].append({'profession': job, 'name': name,
                        'reason': contract['sources'][name]['status']})
                    continue
                source_path, length, sha, metadata, source = original
                shared_raven = name in SHARED_RAVEN_ATTACK
                rel = ('rf/core-shield-audio/' if shared_raven else 'audio/' if job == 'RF' else job.lower() + '/audio/') + name
                if (assets_root / rel).exists():
                    existing = assets_root / rel
                    if existing.stat().st_size != length or file_hash(existing) != sha:
                        raise ValueError('Unbound existing path conflicts with original: ' + rel)
                else:
                    pending[rel] = {'source': source_path, 'bytes': length, 'sha256': sha,
                                    'baselineSha256': None, 'baselineBytes': None}
                entry = {'file': name if shared_raven or job == 'RF' else '../' + rel,
                         'sha256': sha, 'bytes': length,
                         'mimeType': 'audio/ogg' if name.lower().endswith('.ogg') else 'audio/wav',
                         'source': {k: v for k, v in source.items() if k not in ('status', 'bytes')},
                         **metadata}
                manifest['files'][name] = entry
                edit['changed'] = True
                record['added'].append(name)
                record['addedBindings'].append({'name': name, 'manifest': target_manifest, 'assetPath': rel})
        for manifest_rel, edit in manifest_edits.items():
            if not edit['changed']:
                continue
            edit['value']['allProfessionAudioContract'] = 'contracts/all-profession-audio-v61.json'
            data = json_bytes(edit['value'])
            pending[manifest_rel] = {'data': data, 'bytes': len(data), 'sha256': digest(data),
                'baselineSha256': digest(edit['baseline']), 'baselineBytes': len(edit['baseline'])}
        # Verify everything before creating the output; never overwrite a published asset.
        for rel, row in pending.items():
            target = output / 'assets' / rel
            physical(target)
            contract['outputs'][rel] = {k: row[k] for k in ('bytes', 'sha256', 'baselineSha256', 'baselineBytes')}
        output.mkdir(parents=True)
        for rel, row in pending.items():
            target = output / 'assets' / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as destination:
                if 'data' in row:
                    destination.write(row['data'])
                else:
                    with row['source'].open('rb') as original:
                        shutil.copyfileobj(original, destination, 1024 * 1024)
            if target.stat().st_size != row['bytes'] or file_hash(target) != row['sha256']:
                raise ValueError('Output differs from verified original: ' + rel)
        (output / 'contract.json').write_bytes(json_bytes(contract))
    finally:
        db.close()
    return {'output': str(output), 'filesWritten': len(pending),
            'added': {job: row['added'] for job, row in contract['professions'].items()},
            'unresolved': contract['unresolved']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True)
    parser.add_argument('--trigger-audit', required=True)
    parser.add_argument('--assets-root', required=True)
    parser.add_argument('--source-root', default='asset_work')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.audit, args.assets_root, args.source_root, args.output, args.trigger_audit), ensure_ascii=False))
