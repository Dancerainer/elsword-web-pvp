"""Audio overlay provenance and failure-atomicity checks with tiny PCM fixtures."""
import hashlib
from contextlib import closing
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import wave

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('profession_audio_v61', REPO / 'tools/assets/build-profession-audio-v61.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf8')


def pcm():
    data = io.BytesIO()
    with wave.open(data, 'wb') as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(8000)
        sound.writeframes(b'\x00\x00' * 80)
    return data.getvalue()


class OverlayTests(unittest.TestCase):
    def setUp(self):
        parent = REPO / 'runtime/audio-v61-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.root = Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(parent.resolve()))
        self.addCleanup(self.temp.cleanup)
        old_root = builder.ROOT
        builder.ROOT = self.root
        self.addCleanup(setattr, builder, 'ROOT', old_root)
        self.assets, self.source = self.root / 'baseline', self.root / 'original'
        self.output = self.root / 'runtime/audio-v61/overlay'
        self.audit = self.root / 'audit.json'
        self.trigger_audit = self.root / 'trigger-audit.json'
        write_json(self.trigger_audit, {'schemaVersion': 1, 'unreachableBindings': []})
        self.data = {'schemaVersion': 1, 'professions': {job: {'repairBindings': []} for job in builder.JOBS}}
        self.source.mkdir()
        with closing(sqlite3.connect(self.source / 'catalog.sqlite')) as db, db:
            db.execute('CREATE TABLE assets (status TEXT, name TEXT, archive TEXT, ordinal INTEGER, sha256 TEXT, raw_path TEXT)')
        for job in builder.JOBS:
            write_json(self.root / 'packages/combat-core' / (job.lower() + '-profile.json'), {'job': job})
            write_json(self.assets / ('audio/manifest.json' if job == 'RF' else job.lower() + '/audio/manifest.json'),
                       {'schemaVersion': 1, 'files': {}, 'retainedMetadata': job})
        write_json(self.assets / 'rf/core-shield-audio/manifest.json', {'schemaVersion': 1, 'files': {}})

    def original(self, name, data=None, archive='source', reported_hash=None):
        data = pcm() if data is None else data
        rel = 'raw/' + archive + '/' + name
        path = self.source / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        with closing(sqlite3.connect(self.source / 'catalog.sqlite')) as db, db:
            db.execute('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)',
                       ('ok', name, archive, 1, reported_hash or hashlib.sha256(data).hexdigest(), rel))
        return path

    def request(self, job, name):
        self.data['professions'][job]['repairBindings'].append({'name': name})

    def run_builder(self):
        write_json(self.audit, self.data)
        return builder.build(self.audit, self.assets, self.source, self.output, self.trigger_audit)

    def test_unreachable_binding_requires_current_hashed_evidence(self):
        self.request('DE', 'Unused.wav')
        evidence_path = 'packages/combat-core/de-profile.json'
        report = {'schemaVersion': 1, 'unreachableBindings': [{'profession': 'DE', 'name': 'Unused.wav',
            'reason': 'fixture unreachable definition', 'evidence': [evidence_path]}],
            'reachabilityInputs': [{'path': evidence_path, 'sha256': builder.file_hash(self.root / evidence_path)}]}
        write_json(self.trigger_audit, report)
        result = self.run_builder()
        self.assertEqual(result['filesWritten'], 0)
        self.assertEqual(result['unresolved'], [])
        contract = json.loads((self.output / 'contract.json').read_bytes())
        self.assertEqual(contract['excludedBindings'], report['unreachableBindings'])
        (self.root / evidence_path).write_text('{}', encoding='utf8')
        self.output = self.root / 'runtime/audio-v61/stale'
        with self.assertRaisesRegex(ValueError, 'Stale reachability'):
            self.run_builder()
        self.assertFalse(self.output.exists())

    def test_preserves_original_bytes_and_all_baseline_files(self):
        original = self.original('Cue.wav')
        self.request('RF', 'Cue.wav')
        self.request('LK', 'Cue.wav')
        before = {p.relative_to(self.root): p.read_bytes() for base in (self.source, self.assets) for p in base.rglob('*') if p.is_file()}
        result = self.run_builder()
        self.assertEqual(result['unresolved'], [])
        self.assertEqual(result['filesWritten'], 4)
        for rel in ('audio/Cue.wav', 'lk/audio/Cue.wav'):
            self.assertEqual((self.output / 'assets' / rel).read_bytes(), original.read_bytes())
        for rel, data in before.items():
            self.assertEqual((self.root / rel).read_bytes(), data)
        contract = json.loads((self.output / 'contract.json').read_bytes())
        self.assertEqual(contract['outputs']['audio/Cue.wav']['baselineSha256'], None)
        self.assertEqual(len(contract['profileSha256']), 12)
        manifest = json.loads((self.output / 'assets/lk/audio/manifest.json').read_bytes())
        self.assertEqual(manifest['retainedMetadata'], 'LK')
        self.assertEqual(manifest['files']['Cue.wav']['file'], '../lk/audio/Cue.wav')

    def test_missing_or_ambiguous_original_is_reported_without_substitution(self):
        self.original('Ambiguous.wav')
        self.original('Ambiguous.wav', pcm() + b'other', archive='different')
        self.request('LK', 'Missing.wav')
        self.request('LK', 'Ambiguous.wav')
        result = self.run_builder()
        self.assertEqual(result['filesWritten'], 0)
        self.assertEqual({r['reason'] for r in result['unresolved']}, {'missing', 'ambiguous'})
        self.assertFalse((self.output / 'assets').exists())

    def test_catalog_digest_mismatch_does_not_create_partial_overlay(self):
        self.original('Cue.wav', reported_hash='0' * 64)
        self.request('RF', 'Cue.wav')
        with self.assertRaisesRegex(ValueError, 'Original source SHA mismatch'):
            self.run_builder()
        self.assertFalse(self.output.exists())

    def test_unbound_existing_original_is_reused_but_conflicting_file_is_rejected(self):
        original = self.original('Cue.wav')
        self.request('RF', 'Cue.wav')
        (self.assets / 'audio/Cue.wav').write_bytes(original.read_bytes())
        self.assertEqual(self.run_builder()['filesWritten'], 1)
        self.output = self.root / 'runtime/audio-v61/conflict'
        (self.assets / 'audio/Cue.wav').write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError, 'conflicts with original'):
            self.run_builder()
        self.assertFalse(self.output.exists())

    def test_rejects_source_only_audit_path_escape_and_overwrite(self):
        self.data['professions']['RF'].pop('repairBindings')
        with self.assertRaisesRegex(ValueError, 'repairBindings'):
            self.run_builder()
        self.data['professions']['RF']['repairBindings'] = [{'name': '../Cue.wav'}]
        with self.assertRaisesRegex(ValueError, 'Invalid original sound filename'):
            self.run_builder()
        self.data['professions']['RF']['repairBindings'] = []
        self.output = self.assets / 'new-directory'
        with self.assertRaisesRegex(ValueError, 'runtime/audio-v61'):
            self.run_builder()
        self.output = self.root / 'runtime/audio-v61/already-exists'
        self.output.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, 'new directory'):
            self.run_builder()


if __name__ == '__main__':
    unittest.main()
