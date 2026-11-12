"""Build and package original-source WASM into this task's authenticated assets."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "a8438f3ed18dd6f0944793de6c0d8bb9334e9633"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args):
    result = subprocess.run([sys.executable, *args], cwd=ROOT,
        capture_output=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    print(result.stdout.strip(), flush=True)


def retain_rebuild_history(previous, current, module):
    """Keep validated publication history when a bounded base module is resealed."""
    if previous is None or not previous.get('seal'):
        return current
    if set(previous['modules']) != set(current['modules']):
        raise ValueError('Bounded rebuild changed module inventory')
    for name in previous['modules']:
        if name != module and previous['modules'][name] != current['modules'][name]:
            raise ValueError('Bounded rebuild changed retained module: ' + name)
    result = copy.deepcopy(current)
    for key in ('republishedSourceContracts', 'republishHistory', 'moduleAdditionHistory', 'boundedRebuildHistory'):
        if key in previous['seal']:
            result['seal'][key] = copy.deepcopy(previous['seal'][key])
    if previous['modules'][module] != current['modules'][module]:
        result['seal'].setdefault('boundedRebuildHistory', []).append({
            'module': module,
            'previousManifestContentSha256': previous['seal']['manifestContentSha256'],
            'previousSha256': previous['modules'][module]['sha256'],
            'sha256': current['modules'][module]['sha256'],
            'reason': 'Explicit bounded original-source rebuild; other module records and bytes retained'})
    return result


def retain_published_history(manifest_path, previous, module):
    current = json.loads(manifest_path.read_text(encoding='utf-8'))
    current = retain_rebuild_history(previous, current, module)
    manifest_path.write_text(json.dumps(current, indent=2) + '\n', encoding='utf-8')
    run(['tools/native/seal_v11_runtime.py', '--check-only'])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--zig", type=Path, required=True)
    p.add_argument("--source-cache", type=Path, default=ROOT / ".cache/native-source-runtime")
    p.add_argument("--effect-random-source-cache", type=Path, default=ROOT / ".cache/native-effect-random-source")
    p.add_argument("--geometry-only", action="store_true", help="Rebuild/publish geometry while retaining every other module byte and hash")
    p.add_argument("--commands-only", action="store_true", help="Rebuild/publish commands retaining the other module bytes")
    p.add_argument("--skills-only", action="store_true", help="Rebuild/publish skills retaining the other module bytes")
    args = p.parse_args()
    if sum((args.geometry_only,args.commands_only,args.skills_only))>1:
        p.error("Select at most one partial rebuild")
    cache = args.source_cache.resolve()
    provenance = json.loads((ROOT / "contracts/rf-native-runtime-sources.json").read_text(encoding="utf-8"))
    if provenance["commit"] != COMMIT:
        raise ValueError("Wrong native source commit")
    for record in provenance["files"]:
        path = (cache / record["relativePath"]).resolve()
        if not path.is_relative_to(cache):
            raise ValueError("Native source escapes task cache")
        data = path.read_bytes()
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if sha(data) != record["sha256"] or blob != record["gitBlob"]:
            raise ValueError("Native source drift: " + record["relativePath"])
    zig = str(args.zig.resolve())
    previous_manifest = ROOT / "artifacts/native/manifest.json"
    if previous_manifest.is_file() and json.loads(previous_manifest.read_text(encoding="utf-8")).get("seal"):
        run(["tools/native/seal_v11_runtime.py", "--check-only"])
    previous_runtime=json.loads(previous_manifest.read_text(encoding="utf-8")) if previous_manifest.is_file() else None
    if previous_runtime and previous_runtime.get('runtimeVersion')=='original-source-functions-v11':
        raise ValueError('The v11 ten-module release is sealed; generic rebuild paths do not preserve its reviewed Arc pairing. Prepare an independent candidate and use a reviewed bounded publication path.')
    if previous_runtime and previous_runtime.get('runtimeVersion') in ('original-source-functions-v9','original-source-functions-v10') and not (args.skills_only or args.commands_only or args.geometry_only):
        raise ValueError('Full rebuild of a ten-module runtime is not supported; use a bounded rebuild to retain the independent Mana Break pair')
    if args.skills_only:
        output = ROOT / ".cache/native-skills-generated"
        run(["tools/native/build_skill_callbacks.py", "--source-cache", str(cache), "--output-dir", str(output), "--zig", zig])
        manifest_path = ROOT / "artifacts/native/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("referenceCommit") != COMMIT or manifest.get("schemaVersion") != 1:
            raise ValueError("Invalid retained manifest")
        for name, record in manifest["modules"].items():
            if name != "skills" and sha((manifest_path.parent / record["file"]).read_bytes()) != record["sha256"]:
                raise ValueError("Retained native module drift: " + name)
        binary = (output / "skills.wasm").read_bytes()
        contract = json.loads((output / "source-contract.json").read_text(encoding="utf-8"))
        (manifest_path.parent / "skills.wasm").write_bytes(binary)
        manifest["modules"]["skills"] = {"file":"skills.wasm", "sha256":sha(binary), "bytes":len(binary), "originalFunctions":contract["functions"]+contract.get("extraFunctions",[]), "evidenceClass":"mixed-fixed-V5-and-2026-reconstructed-reference-not2016"}
        manifest["runtimeVersion"] = previous_runtime['runtimeVersion'] if previous_runtime and previous_runtime['runtimeVersion']=='original-source-functions-v10' else "original-source-functions-v9" if 'mana-break' in manifest['modules'] else "original-source-functions-v8"
        manifest["boundaries"]["skills"] = contract["hostBoundary"]
        manifest.pop("seal", None)  # Explicit rebuild after validating the old seal.
        manifest_path.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
        run(["tools/native/seal_v11_runtime.py"])
        retain_published_history(manifest_path, previous_runtime, 'skills')
        print(json.dumps({"skills":contract["wasm"],"retainedOtherModules":True}))
        return
    if args.commands_only:
        commands = ROOT / "artifacts/native/commands"
        run(["tools/native/commands-build.py", "--source-cache", str(cache), "--out-dir", str(commands), "--zig", zig])
        manifest_path = ROOT / "artifacts/native/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("referenceCommit") != COMMIT or manifest.get("schemaVersion") != 1:
            raise ValueError("Invalid retained manifest")
        for name, record in manifest["modules"].items():
            if name != "commands" and sha((manifest_path.parent / record["file"]).read_bytes()) != record["sha256"]:
                raise ValueError("Retained native module drift: " + name)
        binary = (commands / "commands.wasm").read_bytes()
        contract = json.loads((commands / "source-contract.json").read_text(encoding="utf-8"))
        (manifest_path.parent / "commands.wasm").write_bytes(binary)
        manifest["modules"]["commands"] = {"file":"commands.wasm", "sha256":sha(binary), "bytes":len(binary), "originalFunctions":contract["functions"], "evidenceClass":"reference-V5-not2016"}
        manifest["runtimeVersion"] = manifest["runtimeVersion"] if manifest["runtimeVersion"] in ("original-source-functions-v8","original-source-functions-v9","original-source-functions-v10") else "original-source-functions-v7"
        manifest["boundaries"]["commands"] = contract["boundaries"] + contract["unverified"]
        manifest.pop("seal", None)
        manifest_path.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
        run(["tools/native/seal_v11_runtime.py"])
        retain_published_history(manifest_path, previous_runtime, 'commands')
        print(json.dumps({"commands":contract["wasm"],"retainedOtherModules":True}))
        return
    geometry = ROOT / "artifacts/native/geometry"
    camera = ROOT / ".cache/native-camera-generated"
    run(["tools/native/geometry-build.py", "--source-dir", str(cache / "KTDXLIB"),
        "--out-dir", str(geometry), "--zig", zig, "--native"])
    if args.geometry_only:
        manifest_path = ROOT / "artifacts/native/manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != 1 or manifest.get("runtimeVersion") not in {"original-source-functions-v5","original-source-functions-v6","original-source-functions-v7","original-source-functions-v8","original-source-functions-v9","original-source-functions-v10"} or manifest.get("referenceCommit") != COMMIT:
            raise ValueError("Geometry-only rebuild needs the current frozen native manifest")
        # Retained binaries must already agree with their existing provenance;
        # a geometry update must not silently cover an unrelated module drift.
        for name, record in manifest["modules"].items():
            if name != "geometry" and sha((manifest_path.parent / record["file"]).read_bytes()) != record["sha256"]:
                raise ValueError("Retained native module drift: " + name)
        contract = json.loads((geometry / "source-contract.json").read_text(encoding="utf-8"))
        binary = (geometry / "geometry.wasm").read_bytes()
        (manifest_path.parent / "geometry.wasm").write_bytes(binary)
        manifest["modules"]["geometry"] = {"file": "geometry.wasm", "sha256": sha(binary), "bytes": len(binary),
            "originalFunctions": contract["functions"], "evidenceClass": "reference-V5-not2016"}
        manifest["boundaries"]["geometry"] = contract["unverified"]
        manifest.pop("seal", None)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        run(["tools/native/seal_v11_runtime.py"])
        retain_published_history(manifest_path, previous_runtime, 'geometry')
        print(json.dumps({"geometry": {key: manifest["modules"]["geometry"][key] for key in ("file", "sha256", "bytes")},
            "originalFunctions": len(contract["functions"]), "retainedOtherModules": True}))
        return
    run(["tools/native/run_camera_source.py", "--source-cache", str(cache),
        "--output-dir", str(camera), "--zig", zig])
    commands = ROOT / "artifacts/native/commands"
    run(["tools/native/commands-build.py", "--source-cache", str(cache),
        "--out-dir", str(commands), "--zig", zig])
    skills = ROOT / ".cache/native-skills-generated"
    run(["tools/native/build_skill_callbacks.py", "--source-cache", str(cache),
        "--output-dir", str(skills), "--zig", zig])
    values = ROOT / ".cache/native-skill-values-generated"
    run(["tools/native/build_skill_values.py", "--source-cache", str(ROOT / ".cache/native-skills-source"),
        "--output-dir", str(values), "--zig", zig])
    random_source=args.effect_random_source_cache.resolve()
    random_contract=json.loads((ROOT / "contracts/rf-native-effect-random.json").read_text(encoding="utf-8"))
    if random_contract["commit"]!=COMMIT:
        raise ValueError("Wrong effect-random source commit")
    for record in random_contract["referenceFiles"]:
        path=(random_source / record["relativePath"]).resolve()
        if not path.is_relative_to(random_source):
            raise ValueError("Effect-random source escapes task cache")
        data=path.read_bytes()
        blob=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
        if sha(data)!=record["sha256"] or blob!=record["gitBlob"]:
            raise ValueError("Effect-random source drift: "+record["relativePath"])
    random_output=ROOT / ".cache/native-effect-random-generated"
    run(["tools/native/build_effect_random.py", "--source-cache", str(random_source),
         "--output-dir", str(random_output), "--zig", zig])
    g = json.loads((geometry / "source-contract.json").read_text(encoding="utf-8"))
    c = json.loads((camera / "execution.json").read_text(encoding="utf-8"))
    r = json.loads((commands / "source-contract.json").read_text(encoding="utf-8"))
    s = json.loads((skills / "source-contract.json").read_text(encoding="utf-8"))
    v = json.loads((values / "execution.json").read_text(encoding="utf-8"))
    er = json.loads((random_output / "execution.json").read_text(encoding="utf-8"))
    if not v["success"]:
        raise ValueError("Original skill-value execution failed")
    if not er["success"]:
        raise ValueError("Original effect-random execution failed")
    destination = ROOT / "artifacts/native"
    modules = {}
    for name, binary, functions in [("geometry", geometry / "geometry.wasm", g["functions"]),
                                   ("camera", camera / "camera-source.wasm", c["extractions"]),
                                   ("commands", commands / "commands.wasm", r["functions"]),
                                   ("skills", skills / "skills.wasm", s["functions"]+s.get("extraFunctions",[])),
                                   ("skill-values", values / "skill-values-source.wasm", v["extractions"]),
                                   ("effect-random", random_output / "effect-random-source.wasm", er["extractions"])]:
        data = binary.read_bytes()
        (destination / (name + ".wasm")).write_bytes(data)
        modules[name] = {"file": name + ".wasm", "sha256": sha(data), "bytes": len(data),
            "originalFunctions": functions, "evidenceClass": s["evidenceClass"] if name == "skills" else "reference-V5-not2016"}
    manifest = {"schemaVersion": 1, "runtimeVersion": "original-source-functions-v8",
        "referenceCommit": COMMIT, "fullTargetClientExecuted": False,
        "modules": modules, "boundaries": {
            "geometry": g["unverified"], "camera": c["platformBoundary"],
            "commands": r["boundaries"] + r["unverified"],
            "skills": s["hostBoundary"], "skill-values": v["compatibilityBoundary"],
            "effect-random": er["hostBoundary"],
            "remainingRuntime": "RF state executor and renderer still contain source-informed JS"}}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    run(["tools/native/build_command_recovery.py", "--source-cache", str(cache), "--zig", zig])
    recovery = json.loads((destination / "commands-recovery/source-contract.json").read_text(encoding="utf-8"))
    authority_path = ROOT / "contracts/rf-combo-recovery-source-v11.json"
    authority = json.loads(authority_path.read_text(encoding="utf-8"))
    for key in ("sourceCommit", "sourcePath", "sourceSha256", "sourceGitBlob", "sourceBytes", "functions"):
        if recovery[key] != authority[key]:
            raise ValueError("Recovered command source drift: " + key)
    authority.update(recovery)  # Retain independently pinned baseline sections and target evidence.
    authority_path.write_bytes((json.dumps(authority, indent=2) + "\n").encode("utf-8"))
    (destination / "commands-recovery.wasm").write_bytes((destination / "commands-recovery/commands-recovery.wasm").read_bytes())
    run(["tools/native/build_nasod_callbacks.py", "--source-cache", str(cache), "--zig", zig])
    run(["tools/native/build_critical.py", "--source-cache", str(cache), "--output-dir", str(ROOT / ".cache/native-critical-generated"), "--zig", zig])
    run(["tools/native/seal_v11_runtime.py"])
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    modules = manifest["modules"]
    print(json.dumps({"modules": {k: {n: v[n] for n in ("file", "sha256", "bytes")}
                                 for k, v in modules.items()}, "fullTargetClientExecuted": False}))


if __name__ == "__main__":
    main()
