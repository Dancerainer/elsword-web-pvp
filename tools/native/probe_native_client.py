"""Attempt bounded syntax builds of unchanged V5 TUs, using task-local headers.

These probes deliberately do not download SDKs or populate a complete checkout.
A missing local reference is not a claim that it is absent from the full Git tree.
"""
import argparse
import json
import os
from pathlib import Path

from run_camera_source import COMMIT, PREFIX, REPO, execute, sha, source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--zig", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=REPO / "contracts/rf-native-execution-source.json")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if any(output == root.resolve() or output in root.resolve().parents or
           root.resolve() in output.parents for root in args.source_cache):
        raise ValueError("Probe output must be disjoint from source inputs")
    manifest = json.loads(args.manifest.read_text())
    if manifest["referenceCommit"] != COMMIT:
        raise ValueError("Wrong source reference commit")
    files = {r["path"].removeprefix(PREFIX): r for r in manifest["files"]}
    names = ("X2/X2.cpp", "X2/Common/dxstdafx.h", "X2Lib/X2Main.h",
             "KTDXLIB/KTDGCamera.cpp", "KTDXLIB/KTDGCamera.h", "KTDXLIB/stdafx.h",
             "luajitLib/LuaJIT-2.0.2/src/lj_arch.h", "luajitLib/LuaJIT-2.0.2/src/lua.h",
             "luajitLib/LuaJIT-2.0.2/src/luaconf.h")
    for name in names:
        raw = source(args.source_cache, files[name])
        dest = output / "source" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
    env = dict(os.environ, ZIG_LOCAL_CACHE_DIR=str(output / "zig-local-cache"),
               ZIG_GLOBAL_CACHE_DIR=str(output / "zig-global-cache"))
    zig = str(args.zig.resolve())
    common = [zig, "c++", "-target", "x86-windows-gnu", "-fsyntax-only",
              "-DSERV_COUNTRY_US", "-DCLIENT_COUNTRY_US", "-D_SERVICE_", "-DNDEBUG",
              "-Wno-invalid-source-encoding", "-Wno-extra-tokens"]
    probes = []
    for name, includes in (("X2/X2.cpp", ("X2/Common", "X2Lib", "KTDXLIB")),
                            ("KTDXLIB/KTDGCamera.cpp", ("KTDXLIB",))):
        command = common + [arg for folder in includes for arg in ("-I", str(output / "source" / folder))]
        command += [str(output / "source" / name)]
        probes.append({"input": files[name], "sourceUnchanged": True,
                       "result": execute(command, output, env)})
    vm_probe = output / "probe_vm.c"
    vm_probe.write_text('#include "lj_arch.h"\n', encoding="ascii")
    command = [zig, "cc", "-target", "wasm32-freestanding", "-fsyntax-only",
               "-I", str(output / "source/luajitLib/LuaJIT-2.0.2/src"), str(vm_probe)]
    probes.append({"input": files["luajitLib/LuaJIT-2.0.2/src/lj_arch.h"],
                   "sourceUnchanged": True, "ownedProbeSha256": sha(vm_probe.read_bytes()),
                   "result": execute(command, output, env)})
    evidence = {"referenceCommit": COMMIT, "evidenceClass": "native-source-build-attempt-V5-not2016",
                "fullCheckoutOrSDKPrepared": False, "fullClientBuilt": False,
                "originalClientExecuted": False, "probes": probes}
    (output / "probe-results.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"probes": [{"input": p["input"]["path"], "success": p["result"]["success"],
        "diagnostic": p["result"].get("stderr", p["result"].get("error", ""))[:1200]} for p in probes]}))


if __name__ == "__main__":
    main()
