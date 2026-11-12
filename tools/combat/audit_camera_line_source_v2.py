"""Record the fixed V5 authored-line/normal-camera consumers, without executing the client."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/native"))
from run_camera_source import COMMIT, PREFIX, extract, git_blob, sha

FILES = ("KTDXLIB/KTDGLineMap.cpp", "X2Lib/X2GUUser.cpp", "X2Lib/X2GUUser.h", "X2Lib/X2Camera.cpp")
METHODS = (
    ("KTDXLIB/KTDGLineMap.cpp", b"/*static*/ void CKTDGLineMap::MakeLine( LineData*", "normalize END_POS-START_POS; derive line yaw with atan2 after inverse LookAtLH"),
    ("X2Lib/X2GUUser.cpp", b"void CX2GUUser::PhysicProcess()", "remember last touched authored line; use its direction and yaw, plus180 when facing left"),
    ("X2Lib/X2GUUser.cpp", b"HRESULT CX2GUUser::OnCameraMove()", "disabled dynamic camera still requests normal tracking"),
    ("X2Lib/X2Camera.cpp", b"void CX2Camera::NomalTrackingCamera( CX2GameUnit*", "normal eye/look points consume focus unit yaw and direction"),
    ("X2Lib/X2GUUser.cpp", b"void CX2GUUser::CommonFrameMove()", "character SkinAnim world matrix and unit matrix both consume Now position/dirDegree"),
)


def audit(source_root: Path) -> dict:
    original = json.loads((ROOT / "contracts/rf-native-runtime-sources.json").read_text(encoding="utf-8"))
    expected = {entry["path"].removeprefix(PREFIX): entry for entry in original["files"]}
    inputs, files = {}, []
    for name in FILES:
        raw = (source_root / name).read_bytes()
        record = expected[name]
        if sha(raw) != record["sha256"] or git_blob(raw) != record["gitBlob"]:
            raise ValueError(f"Source input differs from pinned manifest: {name}")
        inputs[name] = raw
        files.append({"path": PREFIX + name, "sha256": sha(raw), "gitBlob": git_blob(raw), "bytes": len(raw)})
    spans = []
    bodies = {}
    for name, signature, purpose in METHODS:
        body, first, last = extract(inputs[name], signature)
        bodies[signature] = body
        spans.append({"path": PREFIX + name, "signature": signature.decode("ascii"), "sha256": sha(body),
                      "bytes": len(body), "lines": [first, last], "purpose": purpose})
    make_line = bodies[METHODS[0][1]]
    physics = bodies[METHODS[1][1]]
    normal = bodies[METHODS[3][1]]
    for token in (b"pLineData->endPos - pLineData->startPos", b"atan2f( -matRotationOrth._31, matRotationOrth._33 )"):
        if token not in make_line:
            raise ValueError("Pinned authored-line orientation consumer missing")
    for token in (b"m_FrameDataFuture.unitCondition.dirVector = pLineData->dirVector;",
                  b"pLineMap->GetLineData( m_FrameDataFuture.syncData.lastTouchLineIndex )",
                  b"dirDegree.y = pLineData->dirDegree.y + 180.0f;"):
        if token not in physics:
            raise ValueError("Pinned remembered-line/facing consumer missing")
    for token in (b"GetYRotateDegree() + angleDegree", b"GetYRotateDegree() + 180.0f - angleDegree", b"pFocusUnit->GetDirVector()"):
        if token not in normal:
            raise ValueError("Pinned normal-camera orientation consumer missing")
    world = bodies[METHODS[4][1]]
    for token in (b"m_pXSkinAnim->GetMatrix().Move( m_FrameDataNow.syncData.position );",
                  b"m_pXSkinAnim->GetMatrix().RotateDegree( m_FrameDataNow.unitCondition.dirDegree );",
                  b"GetMatrix().RotateDegree( m_FrameDataNow.unitCondition.dirDegree );"):
        if token not in world:
            raise ValueError("Pinned character world placement consumer missing")
    header = inputs["X2Lib/X2GUUser.h"]
    for token in (b"GetYRotateDegree()", b"return m_FrameDataNow.unitCondition.dirDegree.y;", b"GetDirVector()", b"return m_FrameDataNow.unitCondition.dirVector;"):
        if token not in header:
            raise ValueError("Pinned camera unit accessor missing")
    return {
        "schema": "rf-camera-line-source-v2", "referenceCommit": COMMIT,
        "evidenceClass": "fixed-V5-source-consumers-not-target2016", "targetClientMeasured": False,
        "files": files, "consumerSpans": spans,
        "adapter": {
            "lineSelection": "actor.lineId ?? actor.lastTouchLineId; remembered line in air; missing/vertical/zero basis rejected",
            "direction": "normalize authored END_POS-START_POS in native XYZ",
            "yawDegrees": "atan2(-direction.z,direction.x)*180/pi + (left ?180:0)",
            "rendererYawRadians": "negative native yaw, consistent with native [x,y,z] -> renderer [x,y,-z]",
            "characterWorld": "shared authored yaw quaternion for displayed character, actor helper spheres/lines and named bone world positions; actor cache includes quaternion",
            "mapSource": "browser map getter follows selected practice/match map; server createRuntime freezes selected scene map; omitted map only retains standalone straight-lane fixture compatibility",
            "normalCamera": "line yaw/direction into existing normalTrackingPoints; unchanged native camera.wasm tracking",
            "distance": 1500, "trackingSeconds": .3, "targetTrackingSeconds": 0,
            "unchanged": ["camera WASM bytes", "map geometry/collision assets", "scripted state/line camera remains disabled", "auto zoom/shake/cut-in remain disabled"],
        },
        "pending": ["matching target2016 camera/unit consumer", "original-client corner movement/camera trace",
                    "D3D and browser rasterization equivalence", "complete along-lane combat/movement/attachment adaptation"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "contracts/rf-camera-line-source-v2.json")
    args = parser.parse_args()
    result = audit(args.source_root.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"files": len(result["files"]), "consumers": len(result["consumerSpans"]),
                      "targetClientMeasured": False}))


if __name__ == "__main__":
    main()
