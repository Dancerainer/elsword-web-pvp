"""Complete ADD hit audio from independently decoded target DamageSound.lua.

Only copies original WAV/OGG bytes to a new task-local overlay. Existing source,
baseline assets and combat declarations remain read-only.
"""
from pathlib import Path
import argparse, hashlib, io, json, sqlite3, sys, wave
ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path[:0] = [str(ROOT / 'tools/combat'), str(ROOT / 'tools/assets')]
from kl82_static import read_declarations
from audio import inspect_ogg


def sha(data):
    return hashlib.sha256(data).hexdigest()


def records(value, path=''):
    if isinstance(value, dict):
        if isinstance(value.get('REACT_TYPE'), int):
            yield path, value
        for key, child in value.items():
            yield from records(child, path + '.' + key)
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from records(child, path + '[' + str(i) + ']')


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)


def build(source_root, assets_root, output):
    source_root, assets_root, output = map(lambda p: Path(p).resolve(), (source_root, assets_root, output))
    if not output.is_relative_to(ROOT / 'runtime') or output.exists():
        raise ValueError('Expected new output within this task runtime')
    db = sqlite3.connect((source_root / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    sources = {}

    def original(name):
        rows = [dict(r) for r in db.execute("SELECT * FROM assets WHERE status='ok' AND lower(name)=lower(?)", (name,))]
        if not rows or len({r['sha256'] for r in rows}) != 1:
            raise ValueError('Missing or ambiguous original input: ' + name)
        row = sorted(rows, key=lambda r: (r['archive'], r['ordinal']))[0]
        path = (source_root / row['raw_path']).resolve()
        if not path.is_relative_to(source_root / 'raw'):
            raise ValueError('Source escaped raw directory')
        data = path.read_bytes()
        if sha(data) != row['sha256'].lower():
            raise ValueError('Original source SHA mismatch: ' + name)
        sources[name] = {k: row[k] for k in ('archive', 'ordinal', 'name', 'sha256', 'raw_path')}
        sources[name]['bytes'] = len(data)
        return path, data

    enum = read_declarations(original('Enum.lua')[0])['globals']
    sounds = read_declarations(original('DamageSound.lua')[0])['globals']
    table = {enum['HIT_TYPE'][name]: {enum['HITTED_TYPE'][key]: value for key, value in row.items()}
             for name, row in sounds.items() if name in enum['HIT_TYPE']}
    frozen = json.loads((ROOT / 'contracts/rf-hit-audio-source-v17.json').read_bytes())['bindings']
    if table != {int(k): {int(a): b for a, b in v.items()} for k, v in frozen['damageSoundTables'].items()}:
        raise ValueError('Original sound lookup differs from runtime source contract')
    profile_bytes = {name: (ROOT / f'packages/combat-core/{name.lower()}-profile.json').read_bytes()
                     for name in ('RF', 'LK', 'VC', 'RS', 'BM', 'IS', 'GM', 'BH', 'CA', 'LP', 'MM', 'DE')}
    profiles = {name: json.loads(data) for name, data in profile_bytes.items()}
    victims = {p['components']['HITTED_TYPE'] for p in profiles.values()}
    victims.update(s['raw']['HITTED_TYPE_AT_STATE'] for p in profiles.values() for s in p['states'].values()
                   if isinstance(s['raw'].get('HITTED_TYPE_AT_STATE'), int) and s['raw']['HITTED_TYPE_AT_STATE'] != -1)
    common_bytes = (assets_root / 'audio/manifest.json').read_bytes()
    common = json.loads(common_bytes)['files']
    pending, report = {}, {'schemaVersion': 1, 'targetClientMeasured': False,
        'classification': 'original target declarations and unchanged audio bytes; playback verified separately',
        'victimTypes': sorted(victims), 'professions': {}, 'sources': sources,
        'profileSha256': {name: sha(data) for name, data in profile_bytes.items()},
        'commonManifestSha256': sha(common_bytes)}
    for job in ('LP', 'MM', 'DE'):
        path = assets_root / job.lower() / 'audio/manifest.json'
        base = path.read_bytes()
        manifest = json.loads(base)
        required, unsupported = {}, []
        for identity, data in records(profiles[job]):
            hit, react = data.get('HIT_TYPE', 0), data['REACT_TYPE']
            if hit == -1 or react in (enum['REACT_TYPE']['RT_NO_DAMAGE'], enum['REACT_TYPE']['RT_SENSOR']):
                continue
            if not isinstance(hit, int):
                unsupported.append({'path': identity, 'hitType': hit})
                continue
            for victim in victims:
                row = table.get(hit, {})
                name = row.get(victim) or row.get(0) or table.get(0, {}).get(0)
                if name:
                    required.setdefault(name, []).append({'path': identity, 'hitType': hit, 'hittedType': victim})
        missing = sorted(set(required) - set(manifest['files']) - set(common))
        for name in missing:
            _, data = original(name)
            if name.lower().endswith('.wav'):
                with wave.open(io.BytesIO(data), 'rb') as wav:
                    if wav.getcomptype() != 'NONE' or not wav.getnframes():
                        raise ValueError('Expected original nonempty PCM WAV')
                    metadata = {'codec': 'PCM', 'channels': wav.getnchannels(), 'sampleRate': wav.getframerate(),
                                'sampleWidthBytes': wav.getsampwidth(), 'frames': wav.getnframes()}
                    if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
                        raise ValueError('Truncated original WAV')
            elif name.lower().endswith('.ogg'):
                metadata = inspect_ogg(data)
            else:
                raise ValueError('Unexpected source audio extension')
            rel = job.lower() + '/audio/' + name
            pending[rel] = data
            manifest['files'][name] = {'file': '../' + rel, 'sha256': sha(data), 'bytes': len(data),
                'mimeType': 'audio/wav' if name.lower().endswith('.wav') else 'audio/ogg',
                'source': sources[name], 'format': metadata}
        manifest['addHitAudioContract'] = 'contracts/add-hit-audio-v58.json'
        pending[job.lower() + '/audio/manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
        report['professions'][job] = {'baseManifestSha256': sha(base), 'required': required, 'missingBefore': missing, 'unsupportedHitTypes': unsupported,
                                      'missingAfter': sorted(set(required) - set(manifest['files']) - set(common))}
        for name in required:
            entry = manifest['files'].get(name) or common.get(name)
            if not entry:
                raise ValueError('Missing required hit audio binding: ' + name)
            existing = (assets_root / 'audio' / entry['file']).resolve()
            if not existing.is_relative_to(assets_root):
                raise ValueError('Hit audio binding escaped asset snapshot: ' + name)
            relative = existing.relative_to(assets_root).as_posix()
            data = pending.get(relative)
            if data is None:
                data = existing.read_bytes()
            if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
                raise ValueError('Hit audio bytes do not match manifest: ' + name)
        hurt = sorted({name for name in strings(profiles[job]['states']) if name.startswith('AddVoice_DamageScream')})
        report['professions'][job]['hurtVoices'] = {name: {'alreadyPresent': name in manifest['files'] or name in common,
            'file': (manifest['files'].get(name) or common.get(name) or {}).get('file')} for name in hurt}
        for name in hurt:
            entry = manifest['files'].get(name) or common.get(name)
            if not entry:
                raise ValueError('Missing original hurt voice: ' + name)
            existing = (assets_root / 'audio' / entry['file']).resolve()
            if not existing.is_relative_to(assets_root):
                raise ValueError('Existing hurt voice escaped asset snapshot: ' + name)
            data = existing.read_bytes()
            if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
                raise ValueError('Existing hurt voice bytes do not match manifest: ' + name)
    report['outputs'] = {}
    for relative, data in pending.items():
        baseline = assets_root / relative
        old = baseline.read_bytes() if baseline.exists() else None
        report['outputs'][relative] = {'sha256': sha(data), 'bytes': len(data),
            'baselineSha256': sha(old) if old is not None else None, 'baselineBytes': len(old) if old is not None else None}
    for rel, data in pending.items():
        target = output / 'assets' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / 'source.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    contract = {**report, 'professions': {name: {**row, 'required': sorted(row['required'])}
                for name, row in report['professions'].items()}}
    (output / 'contract.json').write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    db.close()
    return {'output': str(output), 'missingBefore': {k: v['missingBefore'] for k, v in report['professions'].items()},
            'filesWritten': len(pending), 'sourceCount': len(sources)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', default='asset_work')
    parser.add_argument('--assets-root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source_root, args.assets_root, args.output), ensure_ascii=False))
