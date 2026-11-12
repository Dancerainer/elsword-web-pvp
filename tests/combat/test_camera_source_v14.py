import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("camera_audit_v14", ROOT / "tools/combat/audit_camera_source_v14.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)
CACHE = Path(os.environ.get("ELSWORD_CAMERA_SOURCE_ROOT", ROOT / ".cache/native-source-runtime"))

class CameraSourceTests(unittest.TestCase):
    def test_actual_pinned_consumers_and_all_eight_existing_method_spans(self):
        expected = json.loads((ROOT / "contracts/rf-camera-source-v14.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            actual = AUDIT.audit(CACHE, Path(temporary))
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual["files"]), 8)
        self.assertEqual(len(actual["compiledMethodSpans"]), 8)
        self.assertEqual(len(actual["consumerSpans"]), 4)
        self.assertFalse(actual["targetClientMeasured"])

    def test_corrupted_consumer_input_rejected_before_recording_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            copied = folder / "source"
            shutil.copytree(CACHE, copied)
            target = copied / "X2Lib/X2GUUser.cpp"
            target.write_bytes(target.read_bytes() + b"\n// corrupted test input\n")
            with self.assertRaisesRegex(ValueError, "Source input differs from pinned manifest"):
                AUDIT.audit(copied, folder / "generated")

if __name__ == "__main__":
    unittest.main()
