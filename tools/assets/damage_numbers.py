"""Extract target PicChar DSL and unchanged RGBA digit/prefix glyphs.

The four target event sequences remain data. Their native V5 width/alignment
bindings are independently hash-frozen and are not target-client measurements.
No font rendering, recoloring, Lua execution or client process is involved.
"""
from __future__ import annotations

import argparse
from io import BytesIO
import json
from pathlib import Path
import re
import struct
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/assets/character"))
from build_rf import Catalog, digest, write_json
from build_rf_fx import declaration
from task_output import checked_output

CONTRACT = ROOT / "contracts/rf-recovery-number-source-v17.json"
REPORT = ROOT / "reports/rf-recovery-number-assets-v17.json"
TEMPLATE_NAMES = ("PicCharDamage", "PicCharRed", "PicCharGreen", "PicCharBlue")
GLYPHS = "0123456789HPM+"


def verify_frozen_bytes(data: bytes, record: dict) -> None:
    if digest(data) != record["sha256"] or ("bytes" in record and len(data) != record["bytes"]):
        raise ValueError("Frozen source hash/size differs: " + record.get("name", record.get("path", "unknown")))


def extract_templates(data: bytes) -> dict:
    """The byte offset/hash describes the original declaration, not normalized DSL."""
    text = data.decode("latin1")
    result = {}
    for name in TEMPLATE_NAMES:
        matches = list(re.finditer(r'eventsequence\s+"' + re.escape(name) + r'"\s*\{([^{}]*)\}', text, re.I))
        if len(matches) != 1:
            raise ValueError("Missing, truncated or duplicate damage-number template: " + name)
        match = matches[0]
        parsed = declaration(match[1], casefold_tokens=True)
        if parsed["unsupported"] or parsed["repeated"]:
            raise ValueError("Damaged/unsupported damage-number DSL: " + name)
        fields = parsed["fields"]
        if fields.get("particleType") != "PT_3D_PLANE" or not all(key in fields for key in ("Lifetime", "Layer", "NumParticles")):
            raise ValueError("Incomplete damage-number template: " + name)
        for key in ("Lifetime", "Layer", "NumParticles"):
            if type(fields[key]) not in (float, int) or fields[key] < 0:
                raise ValueError("Invalid damage-number field: " + key)
        if not all(any(event["property"] == prop and event["start"] == 0 and not event["fade"] for event in parsed["events"])
                   for prop in ("Size", "Velocity", "Color")):
            raise ValueError("Missing initial damage-number events: " + name)
        parsed.update({"name": name, "kind": "particle", "sourceFamily": "ui-major",
            "byteOffset": match.start(), "line": text.count("\n", 0, match.start()) + 1,
            "declarationSha256": digest(match[0].encode("latin1")),
            "sourceTokenNormalization": "original unquoted token case folded; quoted names and original bytes preserved"})
        result[name] = parsed
    return result


def decode_glyph_rgba(data: bytes) -> Image.Image:
    if len(data) < 128 or data[:4] != b"DDS " or struct.unpack_from("<I", data, 4)[0] != 124:
        raise ValueError("Truncated or invalid DDS glyph")
    height, width = struct.unpack_from("<II", data, 12)
    if not (0 < width <= 4096 and 0 < height <= 4096):
        raise ValueError("Invalid DDS glyph dimensions")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != "DDS" or image.size != (width, height):
                raise ValueError("DDS glyph header/decode dimension mismatch")
            image.load()
            return image.convert("RGBA")
    except (OSError, SyntaxError, NotImplementedError) as error:
        raise ValueError("Corrupt DDS glyph: " + str(error)) from error


def build(source_root=Path("asset_work"), output=ROOT / "artifacts/ui/damage-numbers",
          report_path=REPORT, output_root=None) -> dict:
    source_root = Path(source_root).resolve()
    output = checked_output(output, source_root, ROOT, output_root, 'Damage-number')
    if output_root is not None and report_path is not None:
        report_path = checked_output(report_path, source_root, ROOT, output_root, 'Damage-number report')
    contract = json.loads(CONTRACT.read_text("utf-8"))
    for record in contract["cppSources"]:
        verify_frozen_bytes((ROOT / record["localPath"]).read_bytes(), record)
    catalog = Catalog(source_root)
    source = catalog.path("UIMajorParticle.txt")
    data = source.read_bytes()
    verify_frozen_bytes(data, contract["targetAssets"]["UIMajorParticle.txt"])
    templates = extract_templates(data)
    for template in templates.values():
        template["source"] = {**catalog.evidence(source), "byteOffset": template.pop("byteOffset"), "line": template.pop("line")}
    # Decode all input bytes before writing a partial resource set.
    glyphs, images = {}, {}
    for digit in GLYPHS:
        name = "PC_" + digit + ".dds"
        source = catalog.path(name); data = source.read_bytes()
        verify_frozen_bytes(data, contract["targetAssets"][name])
        image = decode_glyph_rgba(data); images[digit] = image
        glyphs[digit] = {"file": "PC_" + digit + ".png", "textureId": ord(digit),
            "width": image.width, "height": image.height, "format": "RGBA",
            "rgbaSha256": digest(image.tobytes()), "source": catalog.evidence(source)}
    output.mkdir(parents=True, exist_ok=True)
    for digit, image in images.items():
        file = output / glyphs[digit]["file"]; image.save(file)
        encoded = file.read_bytes()
        glyphs[digit].update({"sha256": digest(encoded), "bytes": len(encoded)})
        with Image.open(file) as published:
            if published.convert("RGBA").tobytes() != image.tobytes():
                raise ValueError("RGBA changed while encoding damage glyph: " + digit)
    bindings = contract["bindings"]
    manifest = {"schemaVersion": 1, "referenceVersion": contract["referenceVersion"],
        "nativeClientMeasured": False, "templates": templates, "glyphs": glyphs,
        "styles": bindings["styles"], "headOffsetY": bindings["headOffsetY"], "headBone": bindings["headBone"],
        "recovery": bindings["recovery"],
        "referenceDefaults": bindings["referenceDefaults"],
        "alignment": bindings["alignment"], "integerConversion": bindings["integerConversion"],
        "sourceContract": CONTRACT.relative_to(ROOT).as_posix(), "sourceContractSha256": digest(CONTRACT.read_bytes()),
        "sourceEvidence": {"cppSources": contract["cppSources"], "lineRanges": contract["lines"]},
        "limits": contract["limits"], "sourceFiles": list(catalog.used.values())}
    write_json(output / "manifest.json", manifest)
    if report_path is not None:
        write_json(Path(report_path), {"schema": "elsword.recovery-number-assets.v17", "nativeClientMeasured": False,
            "sourceContract": manifest["sourceContract"], "sourceContractSha256": manifest["sourceContractSha256"],
            "counts": {"templates": len(templates), "digitGlyphs": 10, "prefixGlyphs": len(glyphs)-10, "sourceFiles": len(catalog.used)},
            "output": output.relative_to(ROOT).as_posix(),
            "manifestSha256": digest((output / "manifest.json").read_bytes()),
            "files": {"manifest.json": {"sha256": digest((output / "manifest.json").read_bytes()),
                "bytes": (output / "manifest.json").stat().st_size},
                **{glyph["file"]: {"sha256": glyph["sha256"], "bytes": glyph["bytes"]} for glyph in glyphs.values()}},
            "templates": {name: {"source": record["source"], "declarationSha256": record["declarationSha256"],
                "unsupported": record["unsupported"], "events": len(record["events"]), "lifetime": record["fields"]["Lifetime"]}
                for name, record in templates.items()},
            "glyphs": glyphs, "bindings": bindings, "limits": contract["limits"]})
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("asset_work"))
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/ui/damage-numbers")
    parser.add_argument("--output-root", type=Path, help="Explicit physical task runtime directory for isolated rebuilds")
    parser.add_argument("--report", type=Path, default=REPORT)
    args = parser.parse_args()
    result = build(args.source_root, args.output, report_path=args.report, output_root=args.output_root)
    print(json.dumps({"templates": len(result["templates"]), "glyphs": len(result["glyphs"]), "nativeClientMeasured": False}))
