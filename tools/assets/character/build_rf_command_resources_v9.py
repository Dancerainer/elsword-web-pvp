"""Extract target 668X and unbound XXX resources, preserving original declarations.

This is an asset closure, not a combat binding. Original DLL GetKeys evidence
for the existing DummyAttackBox is consumed by build_rf_fx without a new clock.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from build_rf import Catalog, digest, write_json
from build_rf_fx import build as build_fx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audio import inspect_ogg

ROOT = Path(__file__).resolve().parents[3]
ROOTS = ROOT / "contracts/rf-command-resource-roots-v9.json"
INDEX = ROOT / "contracts/rf-command-fx-index-v9.json"
BASE_INDEX = ROOT / "contracts/rf-fx-index.json"
REPORT = ROOT / "reports/rf-command-assets-v9.json"


def sounds(value):
    if isinstance(value, dict):
        for child in value.values():
            yield from sounds(child)
    elif isinstance(value, list):
        for child in value:
            yield from sounds(child)
    elif isinstance(value, str) and value.casefold().endswith(".ogg"):
        if value != Path(value).name or any(c in value for c in ("/", "\\", "\0")):
            raise ValueError("Unsafe literal sound filename")
        yield value


def build(source_root=Path("asset_work"),
          output=ROOT / "artifacts/rf-command-v9", merge_contract=False):
    source_root, output = Path(source_root).resolve(), Path(output).resolve()
    if not output.is_relative_to(ROOT) or output.is_relative_to(source_root):
        raise ValueError("Output must remain in this task repository")
    roots = json.loads(ROOTS.read_bytes())
    for source in roots["declarationSources"]:
        if digest(Path(source["path"]).read_bytes()) != source["sha256"]:
            raise ValueError("Frozen target declaration source changed")
    index = build_fx(output / "fx", ROOTS, source_root, INDEX)
    if index["missingTemplates"] or index["meshFailures"]:
        raise ValueError("Incomplete original resource closure")
    unsupported = [{"name": name, "fields": row["unsupported"]}
                   for name, row in index["templates"].items() if row["unsupported"]]
    if unsupported:
        raise ValueError("Unsupported resource declaration: " + str(unsupported))
    catalog, audio = Catalog(source_root), {}
    for name in sorted(set(sounds(roots))):
        source = catalog.path(name)
        data = source.read_bytes()
        metadata = inspect_ogg(data)
        destination = output / "audio" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        audio[name] = {"file": name, "sha256": digest(data), "bytes": len(data),
                       "mimeType": 'audio/ogg; codecs="vorbis"',
                       "source": catalog.evidence(source), **metadata}
    write_json(output / "audio/manifest.json", {"schemaVersion": 1,
        "clientMeasured": False, "files": audio, "unsupported": [],
        "evidence": "Exact original DamageEffect SOUND literals; callback ownership remains separate."})
    merged = json.loads(BASE_INDEX.read_bytes())
    added, retained = [], []
    for name, template in index["templates"].items():
        previous = merged["templates"].get(name)
        if previous is not None:
            if previous["declarationSha256"] != template["declarationSha256"]:
                raise ValueError("Effect name collides with a different source declaration: " + name)
            retained.append(name)
        else:
            merged["templates"][name] = template
            added.append(name)
    existing_sources = {s["sha256"] for s in merged["sourceFiles"]}
    merged["sourceFiles"] += [s for s in index["sourceFiles"] if s["sha256"] not in existing_sources]
    closure = {"roots": ROOTS.relative_to(ROOT).as_posix(), "rootsSha256": digest(ROOTS.read_bytes()),
               "index": INDEX.relative_to(ROOT).as_posix(), "indexSha256": digest(INDEX.read_bytes()),
               "resourceOnlyEffectSets": ["EffectSet_A_RF_XXX"], "newTemplates": sorted(added)}
    closures = merged.setdefault("additionalResourceClosures", [])
    # Rebuilding is idempotent; the same closure keeps its original new-template list.
    prior = next((c for c in closures if c.get("roots") == closure["roots"]), None)
    if prior:
        closure["newTemplates"] = prior["newTemplates"]
        closures[closures.index(prior)] = closure
    else:
        closures.append(closure)
    write_json(output / "merged-index.json", merged)
    if merge_contract:
        write_json(BASE_INDEX, merged)
    inventory = [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
                  "sha256": digest(p.read_bytes())} for p in sorted(output.rglob("*")) if p.is_file()]
    attackbox = index["templates"]["RRF_DASHJUMP_X"]
    pose = json.loads((output / attackbox["poseData"]).read_bytes())
    report = {"schema": "elsword.rf-command-assets.v9", "targetVersion": roots["targetVersion"],
        "targetClientMeasured": False, "fullClientExecuted": False,
        "roots": closure["roots"], "rootsSha256": closure["rootsSha256"],
        "index": closure["index"], "indexSha256": closure["indexSha256"],
        "newTemplates": closure["newTemplates"], "existingTemplatesRetained": sorted(retained),
        "counts": {"effectSets": 2, "damageEffectDeclarations": 2, "templatesIncludingReactionDefaults": len(index["templates"]),
                   "textures": len({t["file"] for r in index["templates"].values() for t in r["textures"].values()}),
                   "audioFiles": len(audio)},
        "missingTemplates": index["missingTemplates"], "meshFailures": index["meshFailures"],
        "unsupportedDsl": unsupported,
        "damageMesh": {"template": "RRF_DASHJUMP_X", "sourceMesh": attackbox["fields"]["MeshName"],
                       "poseData": attackbox["poseData"], "animationRequiresUnconfirmedRate": attackbox["animationRequiresUnconfirmedRate"],
                       "poseSchemaVersion": pose["schemaVersion"], "observedClock": pose["observedClock"],
                       "nativeAnimationClips": [{"name": c["name"], "durationSeconds": c["durationSeconds"],
                                                 "nativeD3dxKeys": c["nativeD3dxKeys"], "tracks": len(c["tracks"])} for c in pose["clips"]],
                       "unsupportedPoseTracks": pose["unsupportedTracks"],
                       "meshInvisibleInSource": attackbox["fields"].get("DrawCount") == 0},
        "originalDllEvidence": {"sourceRegistry": "reports/rf-full-skill-d3dx-sources.json",
            "execution": "reports/rf-full-skill-d3dx-execution.json", "keyframes": "reports/rf-full-skill-d3dx-keyframes.json"},
        "additionalAudioSources": list(catalog.used.values()), "outputInventory": inventory,
        "copyInstructions": {"fxFiles": "Copy fx/meshes and fx/textures into artifacts/rf/fx preserving names.",
            "fxIndex": "Merge tracked contracts/rf-fx-index.json into served artifacts/rf/fx/index.json after any root profile build.",
            "audioFiles": "Copy literal audio files into artifacts/audio and merge these manifest files entries; retain existing entries.",
            "xxx": "Resource-only EffectSet_A_RF_XXX; no runtime dispatch or damage implementation supplied."},
        "limits": ["Original declarations and original DLL animation keys are resource evidence; no original-client combat trace was acquired.",
            "Native .26 callback dispatch and damage execution are root integration work; this task does not bind any combo.",
            "DamageEffect_RF_XXX owner callback, lock-on and exact spawn timing are unverified; assets do not imply implementation.",
            "Particle emission RNG, blend output and source lifetime consumer still require independent target acceptance."]}
    write_json(REPORT, report)
    print(json.dumps({"newTemplates": closure["newTemplates"], "counts": report["counts"], "outputFiles": len(inventory)}))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("asset_work"))
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/rf-command-v9")
    parser.add_argument("--merge-contract", action="store_true")
    args = parser.parse_args()
    build(args.source_root, args.output, args.merge_contract)
