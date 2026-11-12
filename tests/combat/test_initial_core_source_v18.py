"""Source-block extraction rejects ambiguous and damaged inputs."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
from check_rf_initial_core_source_v18 import block


class InitialCoreBlockExtraction(unittest.TestCase):
    def test_exact_block_preserves_original_bytes(self):
        expected = b'\tif (own)\r\n\t{\r\n\t\tif (gauge > 100) { gauge = 100; }\r\n\t}'
        source = b'void Unit() {\r\n' + expected + b'\r\n}\r\n'
        self.assertEqual(block(source, 'if (own)'), expected)

    def test_missing_duplicate_truncated_block_rejected(self):
        for source in [b'if(other) {}', b'if(own) {}\nif(own) {}', b'if(own) {if(true) {}']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                block(source, 'if(own)')


if __name__ == '__main__':
    unittest.main()
