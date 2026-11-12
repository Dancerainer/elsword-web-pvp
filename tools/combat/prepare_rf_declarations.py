"""Regenerate declaration caches from read-only, hash-checked target KL82 files."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

from kl82_static import read_declarations


def prepare(source, output):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source):
        raise ValueError("Declaration output must stay outside upstream assets")
    names = {"enum": "Enum.lua", "raven": "RAVEN_FIGHTER.lua",
             "skill": "NewSkillTempletVer2.lua", "damage": "DamageEffect.lua", "effect": "EffectSet.lua"}
    globals_in = None
    with sqlite3.connect((source / "catalog.sqlite").as_uri() + "?mode=ro", uri=True) as catalog:
        catalog.row_factory = sqlite3.Row
        output.mkdir(parents=True, exist_ok=True)
        for key, name in names.items():
            rows = list(catalog.execute("SELECT raw_path, sha256 FROM assets WHERE status='ok' AND name=? COLLATE NOCASE", (name,)))
            if not rows or len({row["sha256"] for row in rows}) != 1:
                raise ValueError("Missing or ambiguous target declaration: " + name)
            path = (source / rows[0]["raw_path"]).resolve()
            if not path.is_relative_to(source / "raw"):
                raise ValueError("Catalog path escapes raw inputs")
            if hashlib.sha256(path.read_bytes()).hexdigest() != rows[0]["sha256"]:
                raise ValueError("Source differs from catalog: " + name)
            value = read_declarations(path, globals_in, capture_calls=key in ("skill", "damage", "effect"),
                                      capture_unresolved=key in ("damage", "effect"))
            (output / (key + "-declarations.json")).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", "utf-8")
            if key == "enum":
                globals_in = value["globals"]
            print(json.dumps({"file": name, "globals": len(value["globals"]), "sha256": value["source"]["sha256"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path("asset_work"))
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / ".cache")
    args = parser.parse_args()
    prepare(args.source_root, args.output)
