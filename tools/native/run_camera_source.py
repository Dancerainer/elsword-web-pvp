"""Extract unchanged pinned C++ camera bodies, then build and execute them.

All third-party source, generated translation units, binaries and compiler caches
stay in --output-dir. No SDK/client/upstream files are modified or executed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

REPO = Path(__file__).resolve().parents[2]
COMMIT = "a8438f3ed18dd6f0944793de6c0d8bb9334e9633"
PREFIX = "JP_TW_EU_CN_US/Trunk/"
EXPORTS = ("camera_init", "camera_point", "camera_set_tracking", "camera_advance",
           "camera_translate", "camera_test_upside_down", "camera_output_ptr", "camera_output_count")
SELECTIONS = (
    ("KTDXLIB/KTDGCamera.cpp", b"void CKTDGCamera::Point(", "methods"),
    ("KTDXLIB/KTDGCamera.cpp", b"void CKTDGCamera::MoveRel( float", "methods"),
    ("KTDXLIB/KTDGCamera.cpp", b"void CKTDGCamera::LookAtRel( float", "methods"),
    ("KTDXLIB/KTDGCamera.cpp", b"void CKTDGCamera::SetTracking(", "methods"),
    ("KTDXLIB/KTDGCamera.cpp", b"void CKTDGCamera::UpdateCamera(", "methods"),
    ("KTDXLIB/KTDGCamera.h", b"struct CameraData", "members"),
    ("KTDXLIB/KTDGCamera.h", b"struct UpSideDownCameraData", "members"),
    ("KTDXLIB/KTDXCommonFunc.h", b"inline bool IsSamef(", "math"),
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def source(cache_paths: list[Path], record: dict) -> bytes:
    relative = record["path"].removeprefix(PREFIX)
    if relative == record["path"] or ".." in Path(relative).parts:
        raise ValueError("Source path must be a safe fixed Trunk path")
    candidates = []
    for root in cache_paths:
        for path in (root / relative, root / record["path"]):
            if path.is_file() and path not in candidates:
                candidates.append(path)
    if not candidates:
        raise FileNotFoundError(record["path"])
    data = candidates[0].read_bytes()
    if any(path.read_bytes() != data for path in candidates[1:]):
        raise ValueError(f"Conflicting input copies: {record['path']}")
    if sha(data) != record["sha256"] or git_blob(data) != record["gitBlob"]:
        raise ValueError(f"Source hash mismatch: {record['path']}")
    return data


def extract(data: bytes, signature: bytes) -> tuple[bytes, int, int]:
    """Preserve original bytes; balance braces outside strings and comments."""
    if data.count(signature) != 1:
        raise ValueError(f"Expected one pinned declaration: {signature!r}")
    start = data.index(signature)
    pos = data.index(b"{", start)
    depth = 0
    mode = None
    while pos < len(data):
        char = data[pos:pos + 1]
        pair = data[pos:pos + 2]
        if mode == "line":
            if char == b"\n":
                mode = None
        elif mode == "block":
            if pair == b"*/":
                mode = None
                pos += 1
        elif mode in (b'"', b"'"):
            if char == b"\\":
                pos += 1
            elif char == mode:
                mode = None
        elif pair == b"//":
            mode = "line"
            pos += 1
        elif pair == b"/*":
            mode = "block"
            pos += 1
        elif char in (b'"', b"'"):
            mode = char
        elif char == b"{":
            depth += 1
        elif char == b"}":
            depth -= 1
            if depth == 0:
                end = pos + 1
                if signature.startswith(b"struct "):
                    if data[end:end + 1] != b";":
                        raise ValueError("Expected original struct terminator")
                    end += 1
                return data[start:end], data[:start].count(b"\n") + 1, data[:end].count(b"\n") + 1
        pos += 1
    raise ValueError("Unbalanced source declaration")


def generate(cache_paths: list[Path], output: Path, manifest: dict) -> dict:
    if manifest["referenceCommit"] != COMMIT:
        raise ValueError("Wrong source reference commit")
    required = {path for path, _, _ in SELECTIONS} | {"KTDXLIB/Always.h"}
    records = {r["path"].removeprefix(PREFIX): r for r in manifest["files"]}
    verified = {p: source(cache_paths, records[p]) for p in sorted(required)}
    if b"#define KEYFRAME_CAMERA" not in verified["KTDXLIB/Always.h"].splitlines():
        raise ValueError("Fixed source does not enable KEYFRAME_CAMERA")
    if any(output == p.resolve() or output in p.resolve().parents or
           p.resolve() in output.parents for p in cache_paths):
        raise ValueError("Generated output and input source caches must not overlap")
    output.mkdir(parents=True, exist_ok=True)
    groups = {"members": bytearray(), "math": bytearray(), "methods": bytearray()}
    functions = []
    expected = {r["signature"]: r for r in manifest["extractions"]}
    for path, signature, group in SELECTIONS:
        body, start_line, end_line = extract(verified[path], signature)
        evidence = {"path": PREFIX + path, "signature": signature.decode("ascii"),
                    "sha256": sha(body), "bytes": len(body), "lines": [start_line, end_line]}
        if evidence != expected[signature.decode("ascii")]:
            raise ValueError(f"Original method extraction changed: {signature!r}")
        functions.append(evidence)
        groups[group].extend(f'#line {start_line} "{PREFIX + path}"\n'.encode())
        groups[group].extend(body)
        groups[group].extend(b"\n\n")
    generated = []
    for group, data in groups.items():
        dest = output / f"original_camera_{group}.inc"
        dest.write_bytes(data)
        generated.append({"file": dest.name, "sha256": sha(data), "bytes": len(data)})
    for name in ("camera_source_adapter.cpp", "camera_source_harness.cpp"):
        data = (REPO / "tools/native" / name).read_bytes()
        (output / name).write_bytes(data)
        generated.append({"file": name, "sha256": sha(data), "bytes": len(data), "ownedAdapter": True})
    return {"referenceCommit": COMMIT, "evidenceClass": "reference-V5-not2016",
            "originalMethodsUnchanged": True, "targetClientMeasured": False,
            "files": [records[p] for p in sorted(required)], "extractions": functions,
            "generated": generated}


def execute(command: list[str], cwd: Path, env: dict) -> dict:
    try:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                                timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": command, "success": False, "error": str(error)}
    return {"command": command, "success": result.returncode == 0,
            "exitCode": result.returncode,
            "stdout": result.stdout.decode("utf-8", errors="replace"),
            "stderr": result.stderr.decode("utf-8", errors="replace")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=REPO / "contracts/rf-native-execution-source.json")
    parser.add_argument("--zig", type=Path)
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    evidence = generate(args.source_cache, output, manifest)
    evidence["platformBoundary"] = {
        "matrixAndView": "disabled sinks, no D3D renderer/matrix equivalence claim",
        "shakeAndImpact": "disabled sinks, user disabled dynamic camera/shake",
        "math": "fabs compiler builtin; binary32 original state and FLT_EPSILON",
    }
    evidence["builds"] = []
    if not args.prepare_only:
        zig = str(args.zig.resolve()) if args.zig else shutil.which("zig") or "zig"
        env = dict(os.environ, ZIG_LOCAL_CACHE_DIR=str(output / "zig-local-cache"),
                   ZIG_GLOBAL_CACHE_DIR=str(output / "zig-global-cache"))
        version = execute([zig, "version"], output, env)
        evidence["compiler"] = version
        if Path(zig).is_file():
            evidence["compiler"]["sha256"] = sha(Path(zig).read_bytes())
        base = [zig, "c++", "-std=c++17", "-O2", "-fno-fast-math",
                "-Wno-extra-tokens", "-Wno-invalid-source-encoding"]
        builds = (
            ("native", base + ["camera_source_harness.cpp", "-o", "camera-harness.exe"],
             [str(output / "camera-harness.exe")], "camera-harness.exe"),
            ("wasi", base + ["-target", "wasm32-wasi", "camera_source_harness.cpp",
                             "-o", "camera-harness-wasi.wasm"],
             ["node", str(REPO / "tools/native/run_camera_wasi.mjs"), str(output / "camera-harness-wasi.wasm")],
             "camera-harness-wasi.wasm"),
            ("freestanding", base + ["-target", "wasm32-freestanding", "-nostdlib", "-fno-exceptions",
                "-fno-rtti", "camera_source_adapter.cpp", "-Wl,--no-entry", "-Wl,--export-memory"] +
                [f"-Wl,--export={name}" for name in EXPORTS] + ["-o", "camera-source.wasm"],
             ["node", str(REPO / "tools/native/test_camera_wasm.mjs"), str(output / "camera-source.wasm")],
             "camera-source.wasm"),
        )
        for name, command, run_command, artifact in builds:
            build = {"target": name, "compile": execute(command, output, env)}
            if build["compile"]["success"]:
                data = (output / artifact).read_bytes()
                build["artifact"] = {"file": artifact, "sha256": sha(data), "bytes": len(data)}
                build["execute"] = execute(run_command, output, env)
            evidence["builds"].append(build)
    evidence["success"] = bool(evidence["builds"]) and all(
        b["compile"]["success"] and b.get("execute", {}).get("success", False)
        for b in evidence["builds"])
    (output / "execution.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"prepared": True, "success": evidence["success"], "output": str(output),
        "builds": [{"target": b["target"], "compile": b["compile"]["success"],
                    "execute": b.get("execute", {}).get("success", False)} for b in evidence["builds"]]}))
    return 0 if args.prepare_only or evidence["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
