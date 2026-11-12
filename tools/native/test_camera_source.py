import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("camera_source", HERE / "run_camera_source.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CameraExtractionTests(unittest.TestCase):
    def test_preserves_comments_strings_and_raw_line_endings(self):
        data = b'prefix\r\nvoid Foo()\r\n{ // }\r\n const char* s="}"; /* { */\r\n if(1){return;}\r\n}\r\ntail'
        body, first, last = MODULE.extract(data, b"void Foo()")
        self.assertEqual(body, data[data.index(b"void Foo()"):data.index(b"\r\ntail")])
        self.assertEqual((first, last), (2, 6))

    def test_struct_keeps_semicolon(self):
        body, _, _ = MODULE.extract(b"struct X { X(){ } };\n", b"struct X")
        self.assertEqual(body, b"struct X { X(){ } };")

    def test_duplicate_or_unbalanced_declarations_rejected(self):
        for data in (b"void Foo(){} void Foo(){}", b"void Foo(){"):
            with self.assertRaises(ValueError):
                MODULE.extract(data, b"void Foo()")

    def test_corrupt_source_hash_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "KTDXLIB").mkdir()
            data = b"fixed source"
            (root / "KTDXLIB/test.h").write_bytes(data)
            record = {"path": MODULE.PREFIX + "KTDXLIB/test.h", "sha256": MODULE.sha(data),
                      "gitBlob": MODULE.git_blob(data)}
            self.assertEqual(MODULE.source([root], record), data)
            for field in ("sha256", "gitBlob"):
                corrupt = dict(record, **{field: "0" * len(record[field])})
                with self.assertRaises(ValueError):
                    MODULE.source([root], corrupt)

    def test_conflicting_copies_and_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "test.h").write_bytes(b"a")
            other = root / MODULE.PREFIX
            other.mkdir(parents=True)
            (other / "test.h").write_bytes(b"b")
            with self.assertRaises(ValueError):
                MODULE.source([root], {"path": MODULE.PREFIX + "test.h"})
            with self.assertRaises(ValueError):
                MODULE.source([root], {"path": MODULE.PREFIX + "../test.h"})

    def test_real_fixed_methods_preserved(self):
        # Real sources are ignored inputs; the test must not silently skip them.
        manifest = json.loads((MODULE.REPO / "contracts/rf-native-execution-source.json").read_text())
        caches = [MODULE.REPO / ".cache/native-source-runtime", MODULE.REPO / ".cache/collected-camera-trails-v5",
                  MODULE.REPO / ".cache/native-camera-execution/source"]
        with tempfile.TemporaryDirectory() as tmp:
            generated = MODULE.generate(caches, Path(tmp), manifest)
            self.assertTrue(generated["originalMethodsUnchanged"])
            self.assertEqual(len(generated["extractions"]), 8)
            by_path = {r["path"]: r for r in manifest["files"]}
            for selection in generated["extractions"]:
                raw = MODULE.source(caches, by_path[selection["path"]])
                body, _, _ = MODULE.extract(raw, selection["signature"].encode())
                self.assertEqual(MODULE.sha(body), selection["sha256"])
                group = next(g for p, s, g in MODULE.SELECTIONS if s.decode() == selection["signature"])
                self.assertIn(body, (Path(tmp) / f"original_camera_{group}.inc").read_bytes())
            corrupt = copy.deepcopy(manifest)
            corrupt["extractions"][0]["sha256"] = "0" * 64
            with self.assertRaises(ValueError):
                MODULE.generate(caches, Path(tmp), corrupt)


if __name__ == "__main__":
    unittest.main()
