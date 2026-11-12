"""Actual shipped-DLL key bytes + independent GetSRT gold; corrupt inputs."""
from pathlib import Path
import base64
import bisect
import copy
import hashlib
import json
import math
import os
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/assets/character"))
from native_d3dx_keys import decode_measured_native_keys, MANIFEST, DLL_SHA, SOURCE_SHA
from build_rf import load_x
from directx_animation import decode_animations

SOURCE = Path(os.environ.get("ELSWORD_2016_ASSET_ROOT", "asset_work")) / "raw/data/data002.kom/Raven_Iron_Attack01.X"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sample(channel, time, quaternion=False):
    times, values = channel["times"], channel["values"]
    index = bisect.bisect_right(times, time)
    normalize = lambda v: [n / math.sqrt(sum(x*x for x in v)) for n in v]
    if index == 0 or index == len(times):
        value = values[0 if index == 0 else -1]
        return normalize(value) if quaternion else value
    a, b = values[index-1], values[index]
    if quaternion:
        a, b = normalize(a), normalize(b)
        if sum(x*y for x, y in zip(a, b)) < 0:
            b = [-n for n in b]
    weight = (time-times[index-1])/(times[index]-times[index-1])
    value = [x+(y-x)*weight for x, y in zip(a, b)]
    return normalize(value) if quaternion else value


class MeasuredNativeKeysTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parsed = decode_animations(load_x(SOURCE), default_ticks_per_second=4800, include_native_matrices=True)
        cls.manifest = json.loads((ROOT / MANIFEST).read_bytes())
        cls.artifact_bytes = (ROOT / cls.manifest["artifact"]["path"]).read_bytes()
        cls.artifact = json.loads(cls.artifact_bytes)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.m = copy.deepcopy(self.manifest)
        self.a = copy.deepcopy(self.artifact)
        self.save()

    def save(self):
        artifact_path = self.repo / self.m["artifact"]["path"]
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(self.a).encode()
        artifact_path.write_bytes(raw)
        self.m["artifact"]["sha256"] = digest(raw)
        self.m["artifact"]["bytes"] = len(raw)
        manifest_path = self.repo / MANIFEST
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(self.m), encoding="utf-8")

    def decode(self, parsed=None):
        return decode_measured_native_keys(SOURCE, self.parsed if parsed is None else parsed, self.repo)

    def channel(self, property="translationKeys"):
        return self.a["sources"][0]["animations"][0]["channels"][0][property]

    def set_key_bytes(self, data, property="translationKeys"):
        group = self.channel(property)
        group["keyBytesBase64"] = base64.b64encode(data).decode()
        group["keyBytesSha256"] = digest(data)
        self.m["sources"][0]["animations"][0]["channels"][0][property]["keyBytesSha256"] = digest(data)
        self.save()

    def test_actual_all_45_groups_preserve_raw_float32_and_60_independent_srt_poses(self):
        decoded = decode_measured_native_keys(SOURCE, self.parsed)[0]
        self.assertEqual(decoded["name"], self.parsed[0]["name"])
        self.assertEqual(decoded["duration_seconds"], 0.7666666507720947)
        self.assertEqual(decoded["warnings"], [])
        tracks = {t["frame_name"]: t for t in decoded["tracks"]}
        self.assertEqual(len(tracks), 15)
        self.assertIn("Nasod_Iron04", tracks)
        groups = 0
        for native in self.artifact["sources"][0]["animations"][0]["channels"]:
            track = tracks[native["name"]]
            for key, property in (("translationKeys", "translation"), ("scaleKeys", "scale"), ("rotationKeys", "rotation")):
                g = native[key]
                raw = base64.b64decode(g["keyBytesBase64"])
                rows = list(struct.iter_unpack("<"+"f"*g["stride"], raw))
                self.assertEqual(track[property]["ticks"], [r[0] for r in rows])
                for actual, row in zip(track[property]["values"], rows):
                    expected = [(-n if property == "rotation" and i < 3 else n) for i, n in enumerate(row[1:])]
                    self.assertEqual(actual, expected)
                    for n, original in zip(actual, expected):
                        if n == 0:
                            self.assertEqual(math.copysign(1, n), math.copysign(1, original))
                groups += 1
        self.assertEqual(groups, 45)
        report = json.loads((ROOT / "reports/rf-native-d3dx-execution.json").read_bytes())
        gold = next(t for t in report["traces"] if t["label"] == "original-X-loader-Raven_Iron_Attack01.X")
        comparisons = 0
        for native in gold["animations"][0]["channels"]:
            track = tracks[native["name"]]
            for pose in native["poses"]:
                for property in ("translation", "scale", "rotation"):
                    actual = sample(track[property], pose["timeSeconds"], property == "rotation")
                    expected = pose[property]
                    if property == "rotation" and sum(x*y for x, y in zip(actual, expected)) < 0:
                        actual = [-n for n in actual]
                    for n, expected_n in zip(actual, expected):
                        self.assertAlmostEqual(n, expected_n, delta=2e-6)
                comparisons += 1
        self.assertEqual(comparisons, 60)

    def test_unmeasured_and_missing_unmeasured_files_return_none(self):
        self.assertIsNone(decode_measured_native_keys(self.repo / "unknown.X", [], self.repo))
        unknown = self.repo / "unknown.X"
        unknown.write_bytes(b"synthetic unmeasured bytes")
        self.assertIsNone(decode_measured_native_keys(unknown, [], self.repo))

    def test_known_source_missing_or_changed_rejected(self):
        known = self.repo / SOURCE.name
        with self.assertRaisesRegex(ValueError, "source missing"):
            decode_measured_native_keys(known, self.parsed, self.repo)
        known.write_bytes(b"changed original")
        with self.assertRaisesRegex(ValueError, "source hash mismatch"):
            decode_measured_native_keys(known, self.parsed, self.repo)

    def test_missing_or_corrupt_artifact_and_manifest_rejected(self):
        artifact_path = self.repo / self.m["artifact"]["path"]
        artifact_path.unlink()
        with self.assertRaisesRegex(ValueError, "artifact missing"):
            self.decode()
        self.save()
        artifact_path.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.decode()
        (self.repo / MANIFEST).write_text("[]")
        with self.assertRaisesRegex(ValueError, "manifest schema"):
            self.decode()

    def test_dll_source_and_per_group_hash_rejected(self):
        for what in ("dll", "manifest_source", "artifact_source", "key"):
            with self.subTest(what=what):
                self.m, self.a = copy.deepcopy(self.manifest), copy.deepcopy(self.artifact)
                if what == "dll": self.m["dll"]["sha256"] = "0"*64
                if what == "manifest_source": self.m["sources"][0]["sourceSha256"] = "0"*64
                if what == "artifact_source": self.a["sources"][0]["sourceSha256"] = "0"*64
                if what == "key": self.channel()["keyBytesSha256"] = "0"*64
                self.save()
                with self.assertRaises(ValueError): self.decode()

    def test_negative_count_wrong_stride_and_truncated_bytes_rejected(self):
        for change in ("count", "stride", "truncate"):
            with self.subTest(change=change):
                self.m, self.a = copy.deepcopy(self.manifest), copy.deepcopy(self.artifact)
                if change == "count": self.channel()["count"] = -1
                if change == "stride": self.channel()["stride"] = 5
                if change == "truncate": self.set_key_bytes(base64.b64decode(self.channel()["keyBytesBase64"])[:-4])
                self.save()
                with self.assertRaises(ValueError): self.decode()

    def test_nonfinite_negative_or_unsorted_ticks_rejected_after_valid_hashes(self):
        for value, offset in ((float("nan"), 4), (float("inf"), 4), (-1, 0), (0, 16)):
            with self.subTest(value=value, offset=offset):
                self.m, self.a = copy.deepcopy(self.manifest), copy.deepcopy(self.artifact)
                raw = bytearray(base64.b64decode(self.channel()["keyBytesBase64"]))
                struct.pack_into("<f", raw, offset, value)
                self.set_key_bytes(raw)
                with self.assertRaises(ValueError): self.decode()

    def test_invalid_rate_period_and_multi_set_mapping_rejected(self):
        for field, value in (("ticksPerSecond", 0), ("ticksPerSecond", 4801), ("period", -1), ("period", float("nan"))):
            with self.subTest(field=field, value=value):
                self.m, self.a = copy.deepcopy(self.manifest), copy.deepcopy(self.artifact)
                self.a["sources"][0]["animations"][0][field] = value
                self.save()
                with self.assertRaises(ValueError): self.decode()
        with self.assertRaisesRegex(ValueError, "one parsed AnimationSet"):
            self.decode(self.parsed+self.parsed)

    def test_duplicate_channels_zero_quaternions_and_path_escape_rejected(self):
        self.a["sources"][0]["animations"][0]["channels"][1]["name"] = self.a["sources"][0]["animations"][0]["channels"][0]["name"]
        self.save()
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.decode()
        self.m, self.a = copy.deepcopy(self.manifest), copy.deepcopy(self.artifact)
        raw = bytearray(base64.b64decode(self.channel("rotationKeys")["keyBytesBase64"]))
        struct.pack_into("<4f", raw, 4, 0, 0, 0, 0)
        self.set_key_bytes(raw, "rotationKeys")
        with self.assertRaisesRegex(ValueError, "Zero native quaternion"):
            self.decode()
        self.m["artifact"]["path"] = "../escape.json"
        (self.repo / MANIFEST).write_text(json.dumps(self.m))
        with self.assertRaisesRegex(ValueError, "escapes"):
            self.decode()


if __name__ == "__main__":
    unittest.main()
