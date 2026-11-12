import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("camera_line_source_v2", ROOT / "tools/combat/audit_camera_line_source_v2.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
SOURCE = Path(os.environ.get("ELSWORD_CAMERA_SOURCE_ROOT", ROOT / ".cache/native-source-runtime"))


class CameraLineSourceTests(unittest.TestCase):
    def test_original_line_unit_and_camera_consumers_match_recorded_contract(self):
        expected = json.loads((ROOT / "contracts/rf-camera-line-source-v2.json").read_text(encoding="utf-8"))
        actual = AUDIT.audit(SOURCE)
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual["files"]), 4)
        self.assertEqual(len(actual["consumerSpans"]), 5)
        self.assertFalse(actual["targetClientMeasured"])

    def test_corrupted_source_is_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in AUDIT.FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((SOURCE / name).read_bytes())
            target = root / "KTDXLIB/KTDGLineMap.cpp"
            target.write_bytes(target.read_bytes() + b"\n// corrupt source input\n")
            with self.assertRaisesRegex(ValueError, "differs from pinned"):
                AUDIT.audit(root)


if __name__ == "__main__":
    unittest.main()
