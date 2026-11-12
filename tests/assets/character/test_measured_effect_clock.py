"""Real target-DLL clock evidence and corrupted provenance, independent of exporter."""
from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/assets/character"))
from build_rf import measured_effect_tick_rate, load_x
from directx_animation import decode_animations


class OriginalEffectClockTests(unittest.TestCase):
    def test_actual_original_black_spear_uses_observed_dll_clock(self):
        path = Path(os.environ.get("ELSWORD_2016_ASSET_ROOT", "asset_work")) / "raw/data/data002.kom/Raven_Iron_Attack01.X"
        observed = measured_effect_tick_rate(path)
        self.assertEqual(observed["ticksPerSecond"], 4800)
        self.assertEqual(observed["report"], "reports/rf-native-d3dx-execution.json")
        self.assertEqual(observed["sourceSha256"], "19c642c08554e16546fdee6a639152e8fd3df15d83f7b18ea8af2d2b446dfa4f")
        clips = decode_animations(load_x(path), default_ticks_per_second=observed["ticksPerSecond"])
        self.assertEqual(clips[0]["maximum_tick"], 3680)
        self.assertAlmostEqual(clips[0]["duration_seconds"], 0.7666666507720947, places=6)

    def test_no_other_asset_inherits_a_measured_clock(self):
        self.assertIsNone(measured_effect_tick_rate(Path("not-measured.X"), evidence={
            "dll": {"sha256": "0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f"}, "traces": []}))

    def test_eight_additional_original_assets_point_to_their_actual_dll_report(self):
        report = json.loads((ROOT / "reports/rf-native-d3dx-effects.json").read_text(encoding="utf-8"))
        asset_root = Path(os.environ.get("ELSWORD_2016_ASSET_ROOT", "asset_work"))
        self.assertEqual(len(report["sourceFiles"]), 8)
        for source in report["sourceFiles"]:
            observed = measured_effect_tick_rate(asset_root / source["rawPath"])
            self.assertEqual(observed["report"], "reports/rf-native-d3dx-effects.json")
            self.assertEqual(observed["sourceSha256"], source["sha256"])
            self.assertTrue(any(t["label"] == observed["trace"] for t in report["traces"]))

    def test_changed_original_bytes_or_dll_are_rejected(self):
        report = json.loads((ROOT / "reports/rf-native-d3dx-execution.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "Raven_Iron_Attack01.X"
            path.write_bytes(b"corrupted input")
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                measured_effect_tick_rate(path, report)
            report["dll"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "frozen 2016 D3DX DLL"):
                measured_effect_tick_rate(path, report)


if __name__ == "__main__":
    unittest.main()
