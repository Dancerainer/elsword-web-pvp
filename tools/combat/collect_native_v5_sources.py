"""Collect hash-checked fixed V5 snapshots without touching input caches.

The manifest's ``path`` is a Git path containing /Trunk/. Output preserves the
relative path after Trunk. Inputs may contain that layout, a full Git layout,
or legacy flat filenames; every existing candidate must match both hashes.
No Git command, network access, native program or Lua execution is involved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import tempfile

REFERENCE_COMMIT = "a8438f3ed18dd6f0944793de6c0d8bb9334e9633"
EVIDENCE_CLASS = "reference-V5-not2016"
ARRAY_KEYS = ("files", "referenceFiles", "sources")
_DEVICE_NAME = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)


class SourceCollectionError(ValueError):
    """Invalid provenance, unsafe paths or conflicting source bytes."""


def _hashes(data: bytes) -> tuple[str, str]:
    return (hashlib.sha256(data).hexdigest(),
            hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest())


def _git_path(value: object) -> tuple[str, Path]:
    if not isinstance(value, str) or not value:
        raise SourceCollectionError("Source path must be a nonempty Git path")
    path = value.replace("\\", "/")
    if path.startswith("/") or ntpath.splitdrive(path)[0] or ":" in path or "\0" in path:
        raise SourceCollectionError("Absolute/drive source path is forbidden: " + repr(value))
    parts = path.split("/")
    if any(p in ("", ".", "..") or p.endswith((".", " ")) or _DEVICE_NAME.match(p) for p in parts):
        raise SourceCollectionError("Unsafe source path component: " + repr(value))
    if parts.count("Trunk") != 1:
        raise SourceCollectionError("Source Git path must have exactly one /Trunk/: " + repr(value))
    index = parts.index("Trunk")
    if index == 0 or index == len(parts)-1:
        raise SourceCollectionError("Source path must have a prefix and a file after /Trunk/")
    return "/".join(parts), Path(*parts[index+1:])


def _hex(value: object, length: int, name: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{"+str(length)+r"}", value):
        raise SourceCollectionError("Invalid " + name)
    return value.lower()


def _inside(path: Path, root: Path, name: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(root):
        raise SourceCollectionError(name + " escapes its cache root: " + str(path))
    return resolved


def _manifest_records(path: Path) -> tuple[dict, list[dict]]:
    data = path.read_bytes()
    try:
        manifest = json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SourceCollectionError("Invalid JSON manifest: " + str(path)) from exc
    if not isinstance(manifest, dict):
        raise SourceCollectionError("Manifest must be an object: " + str(path))
    for key in ("commit", "referenceCommit"):
        if key in manifest and manifest[key] != REFERENCE_COMMIT:
            raise SourceCollectionError("Manifest has another source commit: " + str(path))
    records = []
    for key in ARRAY_KEYS:
        rows = manifest.get(key)
        if rows is None or isinstance(rows, dict):
            continue  # Some target-resource manifests use an unrelated sources object.
        if not isinstance(rows, list):
            raise SourceCollectionError("Manifest " + key + " must be an array")
        for row in rows:
            if not isinstance(row, dict) or not all(k in row for k in ("path", "sha256", "gitBlob")):
                raise SourceCollectionError("Source record requires path + sha256 + gitBlob in " + str(path))
            git_path, relative = _git_path(row["path"])
            records.append({"path": git_path, "relative": relative,
                            "sha256": _hex(row["sha256"], 64, "sha256"),
                            "gitBlob": _hex(row["gitBlob"], 40, "gitBlob")})
    if not records:
        raise SourceCollectionError("No source records in manifest: " + str(path))
    return {"path": str(path), "sha256": hashlib.sha256(data).hexdigest()}, records


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".native-v5-", delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def collect_sources(manifests, input_caches, output_cache, output_manifest) -> dict:
    manifest_paths = [Path(p).resolve() for p in manifests]
    caches = [Path(p).resolve() for p in input_caches]
    out = Path(output_cache).resolve()
    manifest_out = Path(output_manifest).resolve()
    if not manifest_paths or not caches:
        raise SourceCollectionError("At least one manifest and input cache are required")
    for cache in caches:
        if not cache.is_dir():
            raise SourceCollectionError("Input cache is not a directory: " + str(cache))
        if out.is_relative_to(cache) or cache.is_relative_to(out):
            raise SourceCollectionError("Output cache must not overlap a read-only input cache")
        if manifest_out.is_relative_to(cache):
            raise SourceCollectionError("Output manifest must not be inside a read-only input cache")
    if manifest_out in manifest_paths:
        raise SourceCollectionError("Output manifest would overwrite an input manifest")
    if out.exists() and not out.is_dir():
        raise SourceCollectionError("Output cache is not a directory")

    # Windows destination names are case-insensitive. Two Git source namespaces
    # that map to one relative destination must also agree on both byte hashes.
    merged = {}
    manifest_provenance = []
    for manifest in manifest_paths:
        metadata, rows = _manifest_records(manifest)
        manifest_provenance.append(metadata)
        for row in rows:
            key = row["relative"].as_posix().casefold()
            previous = merged.get(key)
            if previous and (previous["sha256"], previous["gitBlob"]) != (row["sha256"], row["gitBlob"]):
                raise SourceCollectionError("Conflicting source path: " + row["path"])
            if not previous:
                merged[key] = {**row, "manifests": [str(manifest)], "gitPaths": [row["path"]]}
            else:
                if str(manifest) not in previous["manifests"]:
                    previous["manifests"].append(str(manifest))
                if row["path"] not in previous["gitPaths"]:
                    previous["gitPaths"].append(row["path"])

    prepared = []
    for row in sorted(merged.values(), key=lambda r: r["relative"].as_posix().casefold()):
        candidates = []
        for cache in caches:
            # The normalized Trunk-relative layout is preferred. Legacy selected
            # source caches are flat, and full checkouts preserve the Git prefix.
            for candidate in (cache / row["relative"], cache / row["path"], cache / row["relative"].name):
                if not candidate.exists():
                    continue
                resolved = _inside(candidate, cache, "Input source")
                if not resolved.is_file():
                    raise SourceCollectionError("Input source is not a file: " + str(candidate))
                if resolved not in candidates:
                    candidates.append(resolved)
        if not candidates:
            raise SourceCollectionError("Missing source bytes: " + row["relative"].as_posix())
        data = None
        for candidate in candidates:
            current = candidate.read_bytes()
            sha256, blob = _hashes(current)
            if sha256 != row["sha256"] or blob != row["gitBlob"]:
                raise SourceCollectionError("SHA256/Git blob mismatch: " + str(candidate))
            data = current
        destination = _inside(out / row["relative"], out, "Output source")
        if destination == manifest_out:
            raise SourceCollectionError("Output source would overwrite the output manifest")
        if destination.exists() and destination.read_bytes() != data:
            raise SourceCollectionError("Existing output contains different source bytes: " + str(destination))
        prepared.append((row, destination, data, candidates))

    # No output is changed until every record, input candidate and destination
    # has passed validation. Existing identical bytes are left untouched.
    files = []
    for row, destination, data, candidates in prepared:
        if not destination.exists():
            _atomic_write(destination, data)
        files.append({"path": row["path"], "relativePath": row["relative"].as_posix(),
                      "sha256": row["sha256"], "gitBlob": row["gitBlob"], "bytes": len(data),
                      "gitPaths": row["gitPaths"], "manifests": row["manifests"],
                      "verifiedInputs": [str(p) for p in candidates]})
    result = {"schemaVersion": 1, "commit": REFERENCE_COMMIT,
              "evidenceClass": EVIDENCE_CLASS, "targetClientMeasured": False,
              "verification": "manifest SHA256 and Git blob vs unchanged source bytes; no remote Git membership lookup",
              "inputManifests": manifest_provenance, "files": files}
    _atomic_write(manifest_out, (json.dumps(result, ensure_ascii=False, indent=2)+"\n").encode("utf-8"))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", type=Path, required=True)
    parser.add_argument("--input-cache", action="append", type=Path, required=True)
    parser.add_argument("--output-cache", type=Path, required=True)
    parser.add_argument("--output-manifest", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = collect_sources(args.manifest, args.input_cache, args.output_cache, args.output_manifest)
    except (SourceCollectionError, OSError) as exc:
        parser.exit(1, "Source collection failed: " + str(exc) + "\n")
    print(json.dumps({"commit": result["commit"], "evidenceClass": result["evidenceClass"],
                      "files": len(result["files"]), "bytes": sum(r["bytes"] for r in result["files"]),
                      "outputCache": str(args.output_cache.resolve()),
                      "outputManifest": str(args.output_manifest.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
