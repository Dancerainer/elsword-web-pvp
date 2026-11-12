"""Read-only target script inventory for the two unresolved MM attack drivers.

This is a literal/callback audit, not proof that packed native code lacks them.
The catalog, extracted original data and executable are inputs only. Nothing
is run or unpacked. Output must be a task-private path.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from kl82_static import parse

TERMS = ("shooting_chaser", "shootingchaser", "star_fall", "starfall")


def audit(catalog, asset_root):
    connection = sqlite3.connect(catalog.resolve().as_uri() + "?mode=ro", uri=True)
    rows = connection.execute("SELECT archive,ordinal,name,raw_path,sha256 FROM assets WHERE lower(extension) IN ('.lua','.txt') ORDER BY archive,ordinal").fetchall()
    out = {"schemaVersion": 1, "evidenceClass": "target2016 static literal inventory; no native execution",
           "terms": list(TERMS), "registered": len(rows), "scanned": 0, "missing": [], "matches": []}
    for archive, ordinal, name, raw_path, expected in rows:
        path = asset_root / raw_path
        if not path.is_file():
            out["missing"].append({"archive": archive, "ordinal": ordinal, "name": name})
            continue
        data = path.read_bytes()
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected:
            raise ValueError(f"Catalog hash mismatch: {archive}/{name}")
        out["scanned"] += 1
        folded = data.lower()
        hits = {term: folded.count(term.encode("ascii")) for term in TERMS if term.encode("ascii") in folded}
        if not hits:
            continue
        row = dict(archive=archive, ordinal=ordinal, name=name, sha256=actual, bytes=len(data), hits=hits)
        if data.startswith(b"\x1bKL\x82"):
            chunk = parse(data)
            row["prototypes"] = [{"index": i, "instructions": len(p["instructions"]),
                "matchingConstants": [{"gcIndex": j, "value": value} for j, value in enumerate(p["gc"])
                    if any(term in json.dumps(value, ensure_ascii=True).lower() for term in TERMS)]}
                for i, p in enumerate(chunk["prototypes"])]
        out["matches"].append(row)
    connection.close()
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--asset-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.catalog, args.asset_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"registered": result["registered"], "scanned": result["scanned"], "missing": len(result["missing"]), "matches": len(result["matches"])}))
