"""Line provenance is independent from source byte positions."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("add_audit", ROOT / "tools/combat/audit_add_sources.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AddSourceLineMetadata(unittest.TestCase):
    def test_lines_are_not_reinterpreted_as_byte_offsets(self):
        method = b"void CX2GUAdd::Example()\r\n{\r\n  const char* text = \"not } an end\";\r\n}\r\n"
        data = b"// " + b"long-padding-" * 40 + b"\r\n\r\n" + method
        rows, methods = audit.method_records(data)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["line"], 3)
        self.assertEqual(rows[0]["lastLine"], 6)
        self.assertEqual(rows[0]["sha256"], hashlib.sha256(method.rstrip(b"\r\n")).hexdigest())
        self.assertIn('const char* text', methods['Example'])

    def test_const_return_method_remains_discoverable_without_changing_body_hash(self):
        data = b"// metadata\nconst bool CX2GUAdd::Ready() const\n{\n return true;\n}\n"
        rows, _ = audit.method_records(data)
        self.assertEqual((rows[0]['line'], rows[0]['lastLine']), (2, 5))
        # Existing extraction starts at bool, preserving established hashes.
        self.assertEqual(rows[0]['sha256'], hashlib.sha256(data[data.index(b'bool'):].rstrip(b'\n')).hexdigest())


if __name__ == '__main__':
    unittest.main()
