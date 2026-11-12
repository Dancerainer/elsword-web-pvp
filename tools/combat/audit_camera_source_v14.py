"""Hash the fixed camera consumers and unchanged compiled method spans.

This audit reads a task-private source cache. It does not execute the client,
copy source into Git, or turn web observations into original-client evidence.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/native"))
from run_camera_source import extract, sha, git_blob, generate, PREFIX, COMMIT

CONSUMERS = (
    ("X2Lib/X2Camera.cpp", b"HRESULT CX2Camera::OnFrameMove("),
    ("X2Lib/X2Camera.cpp", b"void CX2Camera::NomalTrackingCamera( CX2GameUnit*"),
    ("X2Lib/X2GUUser.cpp", b"HRESULT CX2GUUser::OnCameraMove("),
    ("X2Lib/X2Game.cpp", b"HRESULT\tCX2Game::OnFrameMove("),
)

def audit(cache: Path, generated: Path) -> dict:
    native = json.loads((REPO / "contracts/rf-native-execution-source.json").read_text(encoding="utf-8"))
    fixed = json.loads((REPO / "contracts/rf-native-runtime-sources.json").read_text(encoding="utf-8"))
    expected = {r["path"].removeprefix(PREFIX): r for r in fixed["files"]}
    execution = generate([cache], generated, native)
    names = {r["path"].removeprefix(PREFIX) for r in execution["files"]}
    names.update(p for p, _ in CONSUMERS)
    names.add("X2Lib/X2Camera.h")
    files, inputs = [], {}
    for name in sorted(names):
        raw = (cache / name).read_bytes()
        declaration = expected[name]
        if sha(raw) != declaration["sha256"] or git_blob(raw) != declaration["gitBlob"]:
            raise ValueError(f"Source input differs from pinned manifest: {name}")
        files.append({"path": PREFIX + name, "sha256": sha(raw), "gitBlob": git_blob(raw), "bytes": len(raw)})
        inputs[name] = raw
    consumers = []
    for name, signature in CONSUMERS:
        body, first, last = extract(inputs[name], signature)
        consumers.append({"path": PREFIX + name, "signature": signature.decode("ascii"),
                          "sha256": sha(body), "bytes": len(body), "lines": [first, last]})
    gu = inputs["X2Lib/X2GUUser.cpp"]
    game = inputs["X2Lib/X2Game.cpp"]
    on_camera, _, _ = extract(gu, CONSUMERS[2][1])
    assert b"m_bDynamicCamera == false" in on_camera
    assert b"NomalTrackingCamera( this, g_pMain->GetGameOption().GetCameraDistance() );" in on_camera
    focus = game.index(b"m_optrFocusUnit->OnCameraMove();")
    update = game.index(b"m_pCamera->OnFrameMove( fTime, fElapsedTime );", focus)
    assert focus < update
    camera_header = inputs["X2Lib/X2Camera.h"]
    assert b"float trackingTime = 0.3f, float trackingAtTime = 0.0f" in camera_header
    manifest = json.loads((REPO / "artifacts/native/manifest.json").read_text(encoding="utf-8"))
    wasm = (REPO / "artifacts/native/camera.wasm").read_bytes()
    assert sha(wasm) == manifest["modules"]["camera"]["sha256"]
    return {"schema": "rf-camera-source-v14", "referenceCommit": COMMIT,
            "evidenceClass": "fixed-V5-source-consumers-not-target2016", "targetClientMeasured": False,
            "files": files, "compiledMethodSpans": execution["extractions"], "consumerSpans": consumers,
            "module": {"file": "native/camera.wasm", "sha256": sha(wasm), "bytes": len(wasm), "changed": False},
            "normalTracking": {"seconds": .3, "targetSeconds": 0, "distance": 1500,
                "sourceCallOrder": ["GUUser::OnCameraMove requests normal track", "CX2Camera::OnFrameMove", "CKTDGCamera::UpdateCamera"],
                "pointUsage": "Initialization/reset only; no Point after UpdateCamera",
                "renderInput": "Same actorRenderClock.sample result as the character; browser display adapter",
                "disabled": ["dynamic state camera", "line scripted camera", "auto zoom", "shake", "impact", "cut-in"]},
            "history": {"v12": "All axes use native tracking", "v13": "Direct X Point override after native advance; Point clears both track timers",
                        "v14": "Restore unchanged native all-axis tracking; no new smoothing constant"},
            "pending": ["Matching target2016 native consumer/compile macros", "Original-client movement and camera trace",
                        "D3D matrix/rasterization equivalence", "Full original variable-frame dispatch rather than browser fixed60/display interpolation"]}

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-cache", type=Path, required=True)
    p.add_argument("--generated-dir", type=Path, required=True)
    p.add_argument("--output", type=Path, default=REPO / "contracts/rf-camera-source-v14.json")
    a = p.parse_args()
    result = audit(a.source_cache.resolve(), a.generated_dir.resolve())
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(result["files"]), "compiledSpans": len(result["compiledMethodSpans"]),
                      "consumers": len(result["consumerSpans"]), "moduleSha256": result["module"]["sha256"]}))

if __name__ == "__main__":
    main()
