"""Read pinned client projects and source tree; never execute build scripts."""
import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import xml.etree.ElementTree as ET

PREFIX = "JP_TW_EU_CN_US/Trunk/"
NS = {"m": "http://schemas.microsoft.com/developer/msbuild/2003"}
FIELDS = {"AdditionalDependencies", "AdditionalIncludeDirectories", "AdditionalLibraryDirectories",
          "PreprocessorDefinitions", "RuntimeLibrary", "ConfigurationType", "PlatformToolset",
          "IncludePath", "LibraryPath", "TargetMachine", "UseOfMfc", "Command"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_project(path, root, tree_paths):
    document = ET.parse(path).getroot()
    relative = path.relative_to(root).as_posix()
    groups = []
    for group in document:
        if "US_SERVICE|Win32" not in group.get("Condition", ""):
            continue
        entries = [{"field": e.tag.split("}")[-1], "value": e.text}
                   for e in group.iter() if e.tag.split("}")[-1] in FIELDS]
        if entries:
            groups.append({"condition": group.get("Condition"), "entries": entries})
    references = []
    active_compiles = []
    for tag in ("ClCompile", "ClInclude", "ProjectReference"):
        for node in document.findall(f".//m:{tag}", NS):
            include = node.get("Include")
            if not include:
                continue
            resolved = PREFIX + posixpath.normpath(posixpath.join(posixpath.dirname(relative), include.replace("\\", "/")))
            excluded = any("US_SERVICE|Win32" in e.get("Condition", "") and e.text == "true"
                           for e in node if e.tag.endswith("ExcludedFromBuild"))
            # Win32 builds resolve case-insensitively; Dxut vs DXUT is not a
            # missing Windows source. Preserve that portability issue separately.
            matched = tree_paths.get(resolved.casefold()) if "$" not in resolved else None
            present = matched is not None if "$" not in resolved else None
            item = {"kind": tag, "include": include, "path": resolved,
                    "presentInFixedTree": present, "excludedUSService": excluded,
                    "caseMismatch": matched != resolved if matched else False}
            references.append(item)
            if tag == "ClCompile" and not excluded:
                active_compiles.append(item)
    return {"path": PREFIX + relative, "sha256": sha(path),
            "toolsVersion": document.get("ToolsVersion"),
            "configurations": [e.get("Include") for e in document.findall(".//m:ProjectConfiguration", NS)],
            "usService": groups, "references": len(references),
            "activeUSCompileReferences": len(active_compiles),
            "caseMismatchedReferences": [r for r in references if r["caseMismatch"]],
            "missingReferences": [r for r in references if r["presentInFixedTree"] is False],
            "missingActiveUSCompileReferences": [r for r in active_compiles if r["presentInFixedTree"] is False]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, required=True)
    parser.add_argument("--tree", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    tree = json.loads(args.tree.read_text(encoding="utf-8-sig"))
    paths = {r["path"].casefold(): r["path"] for r in tree}
    projects = [audit_project(args.source_cache / p, args.source_cache, paths) for p in
                ("KTDXLIB/KTDXLIB_2010.vcxproj", "X2Lib/X2Lib_2010.vcxproj", "X2/X2_2010.vcxproj")]
    result = {"referenceCommit": "a8438f3ed18dd6f0944793de6c0d8bb9334e9633",
              "evidenceClass": "static-build-reference-V5-not2016", "fullClientBuilt": False,
              "tree": {"sha256": sha(args.tree), "records": len(tree)}, "projects": projects}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"projects": [{"path": p["path"], "activeUS": p["activeUSCompileReferences"],
          "missingActiveUS": p["missingActiveUSCompileReferences"]} for p in projects]}))


if __name__ == "__main__":
    main()
