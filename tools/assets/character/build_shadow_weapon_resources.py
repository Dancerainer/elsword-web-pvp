"""Rebuild the independent target Shadow Buster / Weapon Break resource closure.

No callback binding or gameplay clock is inferred. Original GetKeys evidence
is consumed by build_rf_fx; the source registry and legacy proof stay separate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from PIL import Image

from build_rf import Catalog, digest, write_json
from build_rf_fx import build as build_fx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from audio import inspect_ogg

ROOT = Path(__file__).resolve().parents[3]
ROOTS = ROOT / "contracts/rf-shadow-weapon-resource-roots.json"
INDEX = ROOT / "contracts/rf-shadow-weapon-fx-index.json"
REPORT = ROOT / "reports/rf-shadow-weapon-assets.json"


def literal_sounds(value):
    if isinstance(value, str) and value.casefold().endswith(".ogg"):
        if value != Path(value).name or "/" in value or "\\" in value or "\0" in value:
            raise ValueError("Unsafe literal sound path")
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from literal_sounds(child)
    elif isinstance(value, list):
        for child in value:
            yield from literal_sounds(child)


def build(source_root=Path("asset_work"),
        output=ROOT / "artifacts/rf-shadow-weapon"):
    output = Path(output).resolve()
    source_root = Path(source_root).resolve()
    if output.is_relative_to(source_root) or not output.is_relative_to(ROOT):
        raise ValueError("Resource output must stay in this task repository")
    roots = json.loads(ROOTS.read_text("utf-8"))
    for source in roots["declarationSources"]:
        if digest(Path(source["path"]).read_bytes()) != source["sha256"]:
            raise ValueError("Frozen target declaration source changed")
    index = build_fx(output / "fx", ROOTS, source_root, INDEX)
    catalog = Catalog(source_root)
    audio = {}
    for name in sorted(set(literal_sounds(roots))):
        source = catalog.path(name)
        data = source.read_bytes()
        metadata = inspect_ogg(data)
        destination = output / "audio" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        audio[name] = {"file": name, "sha256": digest(data), "bytes": len(data),
            "mimeType": 'audio/ogg; codecs="vorbis"', "source": catalog.evidence(source), **metadata}
    write_json(output / "audio/manifest.json", {"schemaVersion": 1,
        "clientMeasured": False, "files": audio, "unsupported": [],
        "evidence": "Exact target DamageEffect SOUND / BattleFieldBuffTemplet BDT_SOUND literals; execution timing unmeasured"})
    ui = {}
    for buff in roots.get("buffTemplates", {}).values():
        raw = buff["raw"]
        name = raw.get("BUFF_ICON_TEXTURE_NAME")
        if not name:
            continue
        source = catalog.path(name)
        image = Image.open(source).convert("RGBA")
        destination = output / "ui" / (Path(name).stem + ".png")
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination)
        ui[name] = {"file": destination.relative_to(output).as_posix(),
            "width": image.width, "height": image.height, "source": catalog.evidence(source),
            "textureKeys": [raw["BUFF_ICON_TEXTURE_KEY"]], "cropCoordinates": None,
            "limits": "Atlas preserved; texture-key rectangle consumer not verified here."}
    write_json(output / "ui/manifest.json", {"schemaVersion": 1, "clientMeasured": False, "textures": ui})
    inventory = [{"path": p.relative_to(ROOT).as_posix(), "bytes": p.stat().st_size,
        "sha256": digest(p.read_bytes())} for p in sorted(output.rglob("*")) if p.is_file()]
    report = {"schema": "elsword.rf-shadow-weapon-assets.v1", "targetVersion": roots["targetVersion"],
        "targetClientMeasured": False, "fullClientExecuted": False,
        "roots": ROOTS.relative_to(ROOT).as_posix(), "rootsSha256": digest(ROOTS.read_bytes()),
        "index": INDEX.relative_to(ROOT).as_posix(), "indexSha256": digest(INDEX.read_bytes()),
        "counts": {"effectSets": len(roots["effectSets"]), "damageEffectDeclarations": len(roots["damageEffects"]),
            "totalTemplatesIncludingExistingReactionDefaults": len(index["templates"]),
            "distinctMeshSources": len({s["sha256"] for s in index["sourceFiles"] if Path(s["name"]).suffix.casefold() in (".x", ".y")}),
            "particleTextures": len({v["file"] for t in index["templates"].values() for v in t["textures"].values()}),
            "audioFiles": len(audio), "uiAtlases": len(ui)},
        "missing": {"templates": index["missingTemplates"], "meshConversions": index["meshFailures"]},
        "unsupportedDsl": [{"name": n, "values": t["unsupported"]} for n, t in index["templates"].items() if t["unsupported"]],
        "originalDllEvidence": {"sourceRegistry": "reports/rf-shadow-weapon-d3dx-sources.json",
            "execution": "reports/rf-shadow-weapon-d3dx-execution.json", "keyframes": "reports/rf-shadow-weapon-d3dx-keyframes.json"},
        "additionalSourceFiles": list(catalog.used.values()), "outputInventory": inventory,
        "limits": ["2016 state-to-native-callback binding remains a separate candidate audit.",
            "Original grenade UseLand, Gravity, and ElasticCoeff are retained; native effect physics execution is outside this resource task.",
            "WeaponBreak icon atlas key rectangle and original UI consumer remain unverified here.",
            "Original DLL resource loading/GetKeys execution does not mean the original client or a complete match executed."]}
    write_json(REPORT, report)
    print(json.dumps(report["counts"]))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("asset_work"))
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/rf-shadow-weapon")
    args = parser.parse_args()
    build(args.source_root, args.output)
