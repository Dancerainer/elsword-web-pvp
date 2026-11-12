"""ValkNEW original-DLL request, source clock/key bytes, and fail-closed input.

The original request/key artifact is ignored input, never regenerated gold.
RF_SKILL_V11_EVIDENCE_ROOT allows a read-only integration-root check from an
independent worktree; no client or DLL is executed by these tests.
"""
from pathlib import Path
import base64
import copy
import hashlib
import importlib.util
import json
import os
import struct
import sys
import tempfile
import unittest

TASK_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("RF_SKILL_V11_EVIDENCE_ROOT", TASK_ROOT)).resolve()
# Importing an external integration tree must not write its __pycache__.
sys.dont_write_bytecode = True
character = ROOT / "tools/assets/character"
sys.path.insert(0, str(character))
spec = importlib.util.spec_from_file_location(
    "_rf_skill_v11_native_decoder", character / "native_d3dx_keys.py")
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)
from build_rf import load_x
from directx_animation import decode_animations

REQUEST = "artifacts/native-d3dx/skill-v11-sources-request.json"
READABLE_REQUEST = "reports/rf-skill-v11-d3dx-sources.json"
MANIFEST = "reports/rf-skill-v11-d3dx-keyframes.json"
REQUEST_SHA = "6cfca2ca5eef6e909622a03504eacf0c4158e04aa5f2578d778ac69b435b3503"
KEY_SHA = "854302401e238b7173a7fc2ea0b18e69b1209da871b0cd5acc4df17a54df0c58"
DLL_SHA = "0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f"
SOURCE_SHA = "84b901afb4a05ec6b165115135bcc0b66a39eff03c4d18d49ee414a5afd340ff"
SOURCE_NAME = "Raven_SI_SA_ROT_VKJ_Spear_Mesh01.X"
# SDK GetPeriod/GetSourceTicksPerSecond from the frozen actual-DLL manifest.
PERIOD = 2.2333333492279053
TICK_RATE = 4800


def digest(data):
    return hashlib.sha256(data).hexdigest()


class SkillV11NativeKeysTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request_bytes = (ROOT / REQUEST).read_bytes()
        cls.request = json.loads(cls.request_bytes)
        cls.manifest = json.loads((ROOT / MANIFEST).read_bytes())
        cls.key_bytes = (ROOT / cls.manifest["artifact"]["path"]).read_bytes()
        cls.keys = json.loads(cls.key_bytes)
        cls.source = Path(cls.request["sources"][0]["source"])
        cls.source_bytes = cls.source.read_bytes()
        cls.parsed = decode_animations(load_x(cls.source),
            default_ticks_per_second=TICK_RATE, include_native_matrices=True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.m = copy.deepcopy(self.manifest)
        self.a = copy.deepcopy(self.keys)
        request_path = self.repo / REQUEST
        request_path.parent.mkdir(parents=True, exist_ok=True)
        request_path.write_bytes(self.request_bytes)
        self.save()

    def save(self):
        # Repin only the outer test envelope so adversarial inner key cases
        # reach their validators. The frozen source request is never repinned.
        path = self.repo / self.m["artifact"]["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(self.a).encode("utf-8")
        path.write_bytes(raw)
        self.m["artifact"].update(sha256=digest(raw), bytes=len(raw))
        manifest_path = self.repo / MANIFEST
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(self.m), encoding="utf-8")

    def decode(self, source=None, parsed=None):
        return decoder.decode_measured_native_keys(
            self.source if source is None else source,
            self.parsed if parsed is None else parsed, self.repo)

    def group(self):
        return self.a["sources"][0]["animations"][0]["channels"][0]["translationKeys"]

    def replace_group_bytes(self, raw):
        group = self.group()
        group["keyBytesBase64"] = base64.b64encode(raw).decode("ascii")
        group["keyBytesSha256"] = digest(raw)
        self.m["sources"][0]["animations"][0]["channels"][0]["translationKeys"]["keyBytesSha256"] = digest(raw)
        self.save()

    def test_exact_original_request_and_git_lf_copy_have_equal_semantics(self):
        self.assertEqual(len(self.request_bytes), 9657)
        self.assertEqual(digest(self.request_bytes), REQUEST_SHA)
        self.assertEqual(decoder.SKILL_V11_REQUEST_SHA, REQUEST_SHA)
        readable = (ROOT / READABLE_REQUEST).read_bytes()
        self.assertNotIn(b"\r\n", readable)
        self.assertEqual(json.loads(readable), self.request)
        self.assertEqual(self.request["dllSha256"], DLL_SHA)
        self.assertEqual(self.request["sources"][0]["actualLoaderHresult"], "0x00000000")

    def test_actual_source_dll_manifest_and_key_artifact_are_frozen(self):
        self.assertEqual(self.source.name, SOURCE_NAME)
        self.assertEqual(len(self.source_bytes), 10063)
        self.assertEqual(digest(self.source_bytes), SOURCE_SHA)
        dll = Path(self.manifest["dll"]["path"]).read_bytes()
        self.assertEqual(len(dll), 1998168)
        self.assertEqual(digest(dll), DLL_SHA)
        self.assertEqual(self.manifest["dll"]["sha256"], DLL_SHA)
        self.assertEqual(self.keys["dllSha256"], DLL_SHA)
        self.assertEqual(digest(self.key_bytes), KEY_SHA)
        self.assertEqual(len(self.key_bytes), 79481)
        self.assertEqual(self.manifest["artifact"]["sha256"], KEY_SHA)
        self.assertEqual(self.manifest["artifact"]["bytes"], 79481)
        self.assertFalse(self.keys["fullClientExecuted"])
        self.assertFalse(self.manifest["fullClientExecuted"])

    def test_all_original_five_channels_fifteen_groups_keep_float32_bytes(self):
        # Expected values come directly from independent SDK key struct bytes,
        # not from our decoder or a saved result of the current simulation.
        result = decoder.decode_measured_native_keys(self.source, self.parsed, ROOT)
        self.assertEqual(len(result), 1)
        clip = result[0]
        self.assertEqual(clip["name"], "Normal")
        self.assertEqual(clip["ticks_per_second"], TICK_RATE)
        self.assertEqual(clip["duration_seconds"], PERIOD)
        self.assertEqual(clip["nativePlaybackField"], 0)
        self.assertEqual(clip["warnings"], [])
        self.assertTrue(clip["native_d3dx_keys"])
        self.assertEqual(clip["native_d3dx_evidence"]["dll_sha256"], DLL_SHA)
        tracks = {track["frame_name"]: track for track in clip["tracks"]}
        self.assertEqual(set(tracks), {"TRACE_START0", "TRACE_END0",
            "ATTACK_LINE_END0", "ATTACK_LINE_START0", "FlyingImpact"})
        native = self.keys["sources"][0]["animations"][0]
        self.assertEqual(native["period"], PERIOD)
        self.assertEqual(native["ticksPerSecond"], TICK_RATE)
        groups = 0
        for channel in native["channels"]:
            for key, property, width in (("translationKeys", "translation", 4),
                    ("scaleKeys", "scale", 4), ("rotationKeys", "rotation", 5)):
                group = channel[key]
                raw = base64.b64decode(group["keyBytesBase64"], validate=True)
                rows = list(struct.iter_unpack("<" + "f" * width, raw))
                output = tracks[channel["name"]][property]
                self.assertEqual(len(rows), group["count"])
                self.assertEqual(group["stride"], width)
                self.assertEqual(digest(raw), group["keyBytesSha256"])
                self.assertEqual(output["native_key_bytes_sha256"], group["keyBytesSha256"])
                self.assertEqual(output["ticks"], [row[0] for row in rows])
                self.assertEqual(output["times"], [row[0] / TICK_RATE for row in rows])
                restored = bytearray()
                for tick, values in zip(output["ticks"], output["values"]):
                    # Undo the one specified row-to-column conjugation only;
                    # repacking proves signed zero and all float32 bits survive.
                    original = [-v if property == "rotation" and i < 3 else v
                        for i, v in enumerate(values)]
                    restored.extend(struct.pack("<" + "f" * width, tick, *original))
                self.assertEqual(bytes(restored), raw)
                groups += 1
        self.assertEqual(groups, 15)

    def test_known_valk_request_missing_must_not_fall_back_to_approximate_keys(self):
        (self.repo / REQUEST).unlink()
        for name in (SOURCE_NAME, SOURCE_NAME.lower(), SOURCE_NAME.upper()):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "registry missing"):
                self.decode(self.repo / name)
        self.assertIsNone(self.decode(self.repo / "unmeasured.X", []))

    def test_corrupt_or_reformatted_original_request_is_rejected(self):
        for bad in (b"{", self.request_bytes[:-1], self.request_bytes + b" ",
                json.dumps(self.request, separators=(",", ":")).encode()):
            with self.subTest(bytes=len(bad)):
                (self.repo / REQUEST).write_bytes(bad)
                with self.assertRaisesRegex(ValueError, "registry hash mismatch"):
                    self.decode()

    def test_known_source_missing_or_changed_is_rejected(self):
        source = self.repo / SOURCE_NAME
        with self.assertRaisesRegex(ValueError, "source missing"):
            self.decode(source)
        source.write_bytes(self.source_bytes[:-1])
        with self.assertRaisesRegex(ValueError, "source hash mismatch"):
            self.decode(source)

    def test_missing_or_corrupt_key_artifact_is_rejected(self):
        path = self.repo / self.m["artifact"]["path"]
        path.unlink()
        with self.assertRaisesRegex(ValueError, "artifact missing"):
            self.decode()
        for bad in (b"{", self.key_bytes[:-1], self.key_bytes + b" "):
            path.write_bytes(bad)
            with self.subTest(bytes=len(bad)), self.assertRaisesRegex(ValueError, "artifact hash/size mismatch"):
                self.decode()

    def test_corrupt_inner_base64_truncated_nonfinite_and_unsorted_keys_fail(self):
        raw = base64.b64decode(self.group()["keyBytesBase64"])
        self.group()["keyBytesBase64"] = "not base64!"
        self.save()
        with self.assertRaisesRegex(ValueError, "key bytes"):
            self.decode()
        self.replace_group_bytes(raw[:-4])
        with self.assertRaisesRegex(ValueError, "Truncated"):
            self.decode()
        changed = bytearray(raw)
        struct.pack_into("<f", changed, 4, float("nan"))
        self.replace_group_bytes(changed)
        with self.assertRaisesRegex(ValueError, "Nonfinite"):
            self.decode()
        changed = bytearray(raw)
        struct.pack_into("<f", changed, 16, 0)
        self.replace_group_bytes(changed)
        with self.assertRaisesRegex(ValueError, "strictly sorted"):
            self.decode()

    def test_wrong_clock_dll_or_parsed_names_cannot_be_guessed(self):
        self.m["sources"][0]["animations"][0]["period"] = 2
        self.save()
        with self.assertRaisesRegex(ValueError, "metadata differs"):
            self.decode()
        self.m = copy.deepcopy(self.manifest)
        self.m["dll"]["sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "manifest"):
            self.decode()
        self.m = copy.deepcopy(self.manifest)
        self.save()
        with self.assertRaisesRegex(ValueError, "names differ"):
            self.decode(parsed=[{"name": "GuessedNormal"}])


if __name__ == "__main__":
    unittest.main()
