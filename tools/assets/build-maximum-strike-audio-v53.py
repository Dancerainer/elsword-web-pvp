"""Restore the source-authored Maximum Strike HT_PLASMA_1 hit WAV.

Reads target catalog/KL/WAV and the frozen runtime audio manifest only. Writes
an isolated overlay; the caller explicitly integrates its two asset files.
"""
from pathlib import Path
import argparse, hashlib, io, json, sqlite3, sys, wave
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
from kl82_static import read_declarations


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(source_root, base_artifacts, output_root):
    source_root, base_artifacts, output_root = [Path(p).resolve() for p in (source_root, base_artifacts, output_root)]
    if not output_root.is_relative_to(ROOT / 'runtime'):
        raise ValueError('Maximum audio output must be inside this task runtime')
    connection = sqlite3.connect((source_root / 'catalog.sqlite').as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    sources = []

    def source(name):
        rows = [dict(r) for r in connection.execute("SELECT * FROM assets WHERE status='ok' AND lower(name)=lower(?)", (name,))]
        if not rows or len({r['sha256'] for r in rows}) != 1:
            raise ValueError('Missing or ambiguous original input: ' + name)
        row = sorted(rows, key=lambda r: (r['archive'], r['ordinal']))[0]
        path = (source_root / row['raw_path']).resolve()
        if not path.is_relative_to(source_root / 'raw'):
            raise ValueError('Source escaped raw directory')
        data = path.read_bytes()
        if digest(data) != row['sha256'].lower():
            raise ValueError('Original source SHA mismatch: ' + name)
        record = {k: row[k] for k in ('archive', 'ordinal', 'name', 'sha256', 'raw_path')}
        record['bytes'] = len(data)
        sources.append(record)
        return path, data, record

    enum_path, _, _ = source('Enum.lua')
    sound_path, _, _ = source('DamageSound.lua')
    enum = read_declarations(enum_path)['globals']
    sounds = read_declarations(sound_path)['globals']
    if enum['HIT_TYPE']['HT_PLASMA_1'] != 43 or sounds['HT_PLASMA_1']['HTD_MEAT'] != 'HitPlasma1.wav':
        raise ValueError('Original Maximum hit sound mapping differs')
    path, data, original = source('HitPlasma1.wav')
    with wave.open(io.BytesIO(data), 'rb') as wav:
        metadata = {'codec': 'PCM', 'channels': wav.getnchannels(), 'sampleRate': wav.getframerate(),
                    'sampleWidthBytes': wav.getsampwidth(), 'frames': wav.getnframes(),
                    'durationSeconds': wav.getnframes() / wav.getframerate()}
        if not wav.getnframes() or wav.getcomptype() != 'NONE':
            raise ValueError('Expected nonempty original PCM hit sound')
        if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
            raise ValueError('Truncated original PCM frames')
    manifest_path = base_artifacts / 'de/audio/manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    name = 'HitPlasma1.wav'
    manifest['files'][name] = {'file': '../de/audio/' + name, 'sha256': digest(data), 'bytes': len(data),
        'mimeType': 'audio/wav', 'source': original, 'format': metadata}
    manifest['maximumStrikeHitAudioContract'] = 'contracts/add-maximum-strike-native-v53.json'
    overlay = output_root / 'assets/de/audio'
    overlay.mkdir(parents=True, exist_ok=True)
    (overlay / name).write_bytes(data)
    encoded = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    (overlay / 'manifest.json').write_bytes(encoded)
    report = {'schemaVersion': 1, 'classification': 'original-file-data; no audible/native-client playback measurement',
        'sourceInputs': sources, 'baseAudioManifestSha256': digest(manifest_bytes), 'hitType': 43,
        'hittedType': enum['HITTED_TYPE']['HTD_MEAT'], 'file': name, 'wave': metadata,
        'outputs': {'de/audio/manifest.json': {'sha256': digest(encoded), 'bytes': len(encoded)},
                    'de/audio/' + name: {'sha256': digest(data), 'bytes': len(data)}}}
    (output_root / 'audio-source.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', default='asset_work')
    parser.add_argument('--base-artifacts', required=True)
    parser.add_argument('--output-root', default=str(ROOT / 'runtime/fixes1017-maximum'))
    args = parser.parse_args()
    print(json.dumps(build(args.source_root, args.base_artifacts, args.output_root), ensure_ascii=False))
