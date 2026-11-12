import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("collect_native_v5_sources", ROOT / "tools/combat/collect_native_v5_sources.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)
CONTENT = b"static const float FAR_CAMERA = 1500.f;\r\n"
GIT_PATH = "JP_TW_EU_CN_US/Trunk/X2Lib/Camera.cpp"


def record(path=GIT_PATH, data=CONTENT):
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(),
            "gitBlob": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "input"
        self.cache.mkdir()
        self.file = self.cache / "X2Lib/Camera.cpp"
        self.file.parent.mkdir()
        self.file.write_bytes(CONTENT)
        self.manifest = self.root / "source.json"
        self.out = self.root / "output"
        self.manifest_out = self.root / "collected.json"
        self.write_manifest([record()])

    def write_manifest(self, rows, key="files", path=None, commit=None):
        path = path or self.manifest
        path.write_text(json.dumps({"commit": commit or collector.REFERENCE_COMMIT, key: rows}), "utf-8")
        return path

    def collect(self, manifests=None, caches=None):
        return collector.collect_sources(manifests or [self.manifest], caches or [self.cache], self.out, self.manifest_out)

    def test_multiple_manifest_keys_merge_identical_bytes_without_normalizing_newlines(self):
        other = self.write_manifest([record()], "referenceFiles", self.root / "other.json")
        third = self.write_manifest([record()], "sources", self.root / "third.json")
        before = self.file.read_bytes()
        result = self.collect([self.manifest, other, third])
        self.assertEqual(len(result["files"]), 1)
        self.assertEqual(len(result["files"][0]["manifests"]), 3)
        self.assertEqual((self.out / "X2Lib/Camera.cpp").read_bytes(), CONTENT)
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(result["evidenceClass"], "reference-V5-not2016")
        self.assertEqual(json.loads(self.manifest_out.read_text("utf-8"))["commit"], collector.REFERENCE_COMMIT)

    def test_flat_and_full_git_caches_both_verified(self):
        flat = self.root / "flat"
        full = self.root / "full"
        flat.mkdir()
        (flat / "Camera.cpp").write_bytes(CONTENT)
        target = full / GIT_PATH
        target.parent.mkdir(parents=True)
        target.write_bytes(CONTENT)
        result = self.collect(caches=[self.cache, flat, full])
        self.assertEqual(len(result["files"][0]["verifiedInputs"]), 3)

    def test_sha256_and_git_blob_are_independently_required(self):
        for field, bad in [("sha256", "0"*64), ("gitBlob", "0"*40)]:
            with self.subTest(field=field):
                r = record()
                r[field] = bad
                self.write_manifest([r])
                with self.assertRaisesRegex(collector.SourceCollectionError, "mismatch"):
                    self.collect()
                self.assertFalse(self.out.exists())
                self.assertFalse(self.manifest_out.exists())

    def test_all_existing_candidates_must_match_not_just_one(self):
        bad = self.root / "stale"
        bad.mkdir()
        (bad / "Camera.cpp").write_bytes(b"another version")
        with self.assertRaisesRegex(collector.SourceCollectionError, "mismatch"):
            self.collect(caches=[self.cache, bad])
        self.assertEqual((bad / "Camera.cpp").read_bytes(), b"another version")

    def test_conflicting_path_and_windows_case_collision_rejected_before_copy(self):
        for path in [GIT_PATH, GIT_PATH.replace("Camera.cpp", "camera.cpp")]:
            with self.subTest(path=path):
                other = self.write_manifest([record(path, b"different")], "sources", self.root / "other.json")
                with self.assertRaisesRegex(collector.SourceCollectionError, "Conflicting"):
                    self.collect([self.manifest, other])
                self.assertFalse(self.out.exists())

    def test_unsafe_git_paths_rejected(self):
        for path in ["JP/Trunk/../../outside.cpp", "JP/Trunk/..\\outside.cpp", "C:/JP/Trunk/file.cpp", "/JP/Trunk/file.cpp", "JP/Trunk//file.cpp", "JP/Trunk/X2Lib/Camera.cpp.", "JP/Trunk/NUL", "JP/Trunk/other/Trunk/file.cpp", "JP/not-trunk/file.cpp"]:
            with self.subTest(path=path):
                self.write_manifest([record(path)])
                with self.assertRaises(collector.SourceCollectionError):
                    self.collect()
                self.assertFalse(self.out.exists())

    def test_no_output_if_later_file_is_missing(self):
        self.write_manifest([record(), record("JP/Trunk/X2Lib/Missing.cpp")])
        with self.assertRaisesRegex(collector.SourceCollectionError, "Missing source"):
            self.collect()
        self.assertFalse(self.out.exists())

    def test_cache_overlap_and_manifest_overwrite_rejected(self):
        with self.assertRaisesRegex(collector.SourceCollectionError, "overlap"):
            collector.collect_sources([self.manifest], [self.cache], self.cache / "out", self.manifest_out)
        with self.assertRaisesRegex(collector.SourceCollectionError, "overwrite an input"):
            collector.collect_sources([self.manifest], [self.cache], self.out, self.manifest)

    def test_other_commit_and_malformed_record_rejected(self):
        self.write_manifest([record()], commit="another-commit")
        with self.assertRaisesRegex(collector.SourceCollectionError, "another source commit"):
            self.collect()
        self.write_manifest([{"path": GIT_PATH, "sha256": record()["sha256"]}])
        with self.assertRaisesRegex(collector.SourceCollectionError, "requires path"):
            self.collect()

    def test_existing_output_drift_rejected_and_identical_output_idempotent(self):
        self.collect()
        output = self.out / "X2Lib/Camera.cpp"
        before = output.stat().st_mtime_ns
        self.collect()
        self.assertEqual(output.stat().st_mtime_ns, before)
        output.write_bytes(b"drift")
        with self.assertRaisesRegex(collector.SourceCollectionError, "different source bytes"):
            self.collect()
        self.assertEqual(output.read_bytes(), b"drift")


if __name__ == "__main__":
    unittest.main()
