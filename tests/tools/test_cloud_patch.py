"""Pure deployment guards; never connects to SSH or changes a release."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/deploy-cloud-patch.py'
SPEC = importlib.util.spec_from_file_location('cloud_patch', SCRIPT)
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class CloudPatchTests(unittest.TestCase):
    def test_sparse_large_browser_change_reconstructs_with_bounded_literals(self):
        old = b'A' * 1_000_000 + 'old\r\n\uad00\uad09'.encode() + b'Z' * 1_000_000
        new = b'A' * 1_000_000 + 'new\n\uad03\uad02'.encode() + b'Z' * 1_000_000
        parts = PATCH.make_browser_delta(old, new)
        self.assertEqual(PATCH.apply_delta(old, parts), new)
        self.assertEqual(len(parts), 3)
        import base64
        self.assertLess(sum(len(base64.b64decode(p['data'])) for p in parts if 'data' in p), 100)

    def test_large_browser_insert_and_delete_at_boundaries(self):
        old = b'abc\n' * 100_000
        for new in [b'header\n' + old, old + b'tail', old[3:], old[:-3], old, b'']:
            with self.subTest(length=len(new)):
                parts = PATCH.make_browser_delta(old, new)
                self.assertEqual(PATCH.apply_delta(old, parts), new)

    def test_dense_large_browser_change_keeps_full_file_fallback(self):
        self.assertIsNone(PATCH.make_browser_delta(b'A' * 600_000, b'B' * 600_000))

    def test_utf8_crlf_and_unterminated_lines_use_byte_offsets(self):
        old = '\uad06\uad04\r\nold body\n\uad01\uad0f\uad0c\nlast'.encode('utf-8')
        new = 'new header\n\uad06\uad04\r\n\uad0a\uad08\uad0b\uad09\n\uad01\uad0f\uad0c\nlast\nnew tail'.encode('utf-8')
        parts = PATCH.make_delta(old, new)
        self.assertEqual(PATCH.apply_delta(old, parts), new)
        self.assertTrue(any('copy' in part for part in parts))
        self.assertTrue(any('data' in part for part in parts))
        self.assertEqual(PATCH.apply_delta(b'', PATCH.make_delta(b'', new)), new)
        self.assertEqual(PATCH.apply_delta(old, PATCH.make_delta(old, b'')), b'')

    def test_malformed_ranges_and_path_traversal_fail(self):
        for part in [{'copy': [-1, 2]}, {'copy': [0, 10]}, {'copy': [2, 1]}, {'other': 'x'}, {'data': '%%%'}]:
            with self.subTest(part=part), self.assertRaises((ValueError, TypeError)):
                PATCH.apply_delta(b'abc', [part])
        for name in ['/etc/passwd', '../runtime/accounts', 'apps/../../accounts', 'C:/temp', r'apps\server', 'apps//server', './dist/game.js']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                PATCH.relative_path(name)
        self.assertEqual(PATCH.relative_path('packages/online/owned-state.mjs'), 'packages/online/owned-state.mjs')

    def test_remote_and_local_canonical_hash_have_identical_scope(self):
        remote = {}
        exec(PATCH.REMOTE_HELPERS, remote)
        for data in [b'a\r\nb\n', '\uad00\uad09\r\n'.encode(), b'a\rb', b'']:
            self.assertEqual(remote['canonical'](data), PATCH.canonical_sha(data))
        self.assertEqual(PATCH.canonical_sha(b'a\r\nb\n'), PATCH.canonical_sha(b'a\nb\n'))
        self.assertNotEqual(PATCH.canonical_sha(b'a\rb'), PATCH.canonical_sha(b'a\nb'))
        compile(PATCH.activation_code('/tmp/web-pvp-patch-test.json.gz', 'a' * 64), 'remote-activation', 'exec')


if __name__ == '__main__':
    unittest.main()
