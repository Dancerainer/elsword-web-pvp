"""Hash-scoped original-DLL key extraction; no replacement matrix decomposition.

Author key bytes remain in ignored artifacts. Known measured files fail closed
when provenance or the extraction is missing/corrupt. Other files return None.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DLL_SHA = "0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f"
SOURCE_SHA = "19c642c08554e16546fdee6a639152e8fd3df15d83f7b18ea8af2d2b446dfa4f"
SOURCE_NAME = "Raven_Iron_Attack01.X"
SOURCE_BYTES = 14461
MANIFEST = "reports/rf-native-d3dx-keyframes.json"
FULL_REQUEST = "reports/rf-full-skill-d3dx-sources.json"
FULL_MANIFEST = "reports/rf-full-skill-d3dx-keyframes.json"
# Deliberate refresh required after another actual-DLL extraction. A modified
# registry must never whitelist arbitrary author bytes through a forged row.
FULL_REQUEST_SHA = "c5090810560ca10736e93795fa78b1245f9bd69503a14c296364b55061c36ec1"
SHADOW_REQUEST = "reports/rf-shadow-weapon-d3dx-sources.json"
SHADOW_MANIFEST = "reports/rf-shadow-weapon-d3dx-keyframes.json"
SHADOW_REQUEST_SHA = "362d0c9e5c94e884c6649ce5ee45efd44d0020bb3dfa69d7c286386d5d7a01bd"
# Preserve the exact request bytes sent to the DLL probe. The Git document
# uses normalized LF and remains a separate readable copy of that request.
SKILL_V11_REQUEST = 'artifacts/native-d3dx/skill-v11-sources-request.json'
SKILL_V11_MANIFEST = 'reports/rf-skill-v11-d3dx-keyframes.json'
SKILL_V11_REQUEST_SHA = '6cfca2ca5eef6e909622a03504eacf0c4158e04aa5f2578d778ac69b435b3503'
ARC_START_REQUEST = 'reports/rf-archenemy-start-d3dx-sources-v17.json'
ARC_START_MANIFEST = 'reports/rf-archenemy-start-d3dx-keyframes-v17.json'
ARC_START_REQUEST_SHA = '6c5234fcbb7b82490d62d46fb71a2ce6b00383045a4c83936ae484e2f90238ca'
LK_FX_REQUEST = 'reports/lk-fx-d3dx-sources-v2.json'
LK_FX_MANIFEST = 'reports/lk-fx-d3dx-keyframes-v2.json'
LK_FX_REQUEST_SHA = 'c96631750f621fbbc49a96e7f7588817438c0309dd472b5480b00f999ceb695a'
LANDING_REQUEST = 'reports/rf-landing-d3dx-sources-v1.json'
LANDING_MANIFEST = 'reports/rf-landing-d3dx-keyframes-v1.json'
LANDING_REQUEST_SHA = 'f083832fac4411b4183ed649d8e74f7263714ba231c5cfdab9b8301401011ad0'
VC_FX_REQUEST = 'reports/vc-fx-d3dx-sources-v1.json'
VC_FX_MANIFEST = 'reports/vc-fx-d3dx-keyframes-v1.json'
# Pin the Git LF receipt bytes (.gitattributes), not the generator's Windows
# CRLF copy. Source X/DLL/key hashes inside this receipt are unchanged.
VC_FX_REQUEST_SHA = '65f72bf71b8c9ccc081dab9dde35692276de25e12945c7b1c2105dab905d609f'
BATTLE_LIFE_REQUEST = 'reports/battle-life-fx-d3dx-sources-v1.json'
BATTLE_LIFE_MANIFEST = 'reports/battle-life-fx-d3dx-keyframes-v1.json'
BATTLE_LIFE_REQUEST_SHA = 'd5e1fe6633b80704905759c7c251cec0fff17dd4cbd9765eceb5c49d26fae238'

ADD_FX_REQUEST = 'reports/add-fx-d3dx-sources-v1.json'
ADD_FX_MANIFEST = 'reports/add-fx-d3dx-keyframes-v1.json'
ADD_FX_REQUEST_SHA = '28da3b5e186e300b8e3521d5acf562dbe13336f96570bfb81e18acd7a7e75514'
APOCALYPSE_REQUEST = 'reports/mm-apocalypse-d3dx-sources-v1.json'
APOCALYPSE_MANIFEST = 'reports/mm-apocalypse-d3dx-keyframes-v1.json'
APOCALYPSE_REQUEST_SHA = '5f4f5c7386ecb99fcd68e71538e791f09aa8eb3f577f69d456f2dfaaf7b1146b'

IS_FX_REQUEST = 'reports/is-fx-d3dx-sources-v1.json'
IS_FX_MANIFEST = 'reports/is-fx-d3dx-keyframes-v1.json'
IS_FX_REQUEST_SHA = '7d667d970d91979c850eac5607d342775bf1af8d18e11f008480f27660ce77e0'
IS_FEEDBACK_REQUEST = 'reports/is-feedback-d3dx-sources-v2.json'
IS_FEEDBACK_MANIFEST = 'reports/is-feedback-d3dx-keyframes-v2.json'
IS_FEEDBACK_REQUEST_SHA = '658eeeba380279001f327e3d5c900d51f9653b0f286994ccfd19484fddd74550'

PVP_MAP_REQUEST = 'reports/pvp-map-d3dx-sources-v1.json'
PVP_MAP_MANIFEST = 'reports/pvp-map-d3dx-keyframes-v1.json'
PVP_MAP_REQUEST_SHA = '60c6cba5cebab4392a0b592666aa26faf492e4eed8b146407f16c8c70c294fe6'
RS_FX_REQUEST = 'reports/rs-fx-d3dx-sources-v1.json'
RS_FX_MANIFEST = 'reports/rs-fx-d3dx-keyframes-v1.json'
RS_FX_REQUEST_SHA = 'fcf852c15efda1ef183cea1f7cf7f99924521eb3d75bfb7594ac4ff8320b1692'
COSTUME_REQUEST = 'reports/costumes-d3dx-sources-v1.json'
COSTUME_MANIFEST = 'reports/costumes-d3dx-keyframes-v1.json'
COSTUME_REQUEST_SHA = '7a49172b452e72cb88a0cf9091b4c378570ecca3497a49ec1ce0cf3e160cdbce'
BM_FX_REQUEST = 'reports/bm-fx-d3dx-sources-v1.json'
BM_FX_MANIFEST = 'reports/bm-fx-d3dx-keyframes-v1.json'
BM_FX_REQUEST_SHA = '1ca72905d3934740c4669126e21500c2c24a73a15273b75bb28aa4fa35ceefcd'

COSTUME_FX_REQUEST = 'reports/costume-effects-d3dx-sources-v2.json'
COSTUME_FX_MANIFEST = 'reports/costume-effects-d3dx-keyframes-v2.json'
COSTUME_FX_REQUEST_SHA = '2483ff7f55a46e669114a75984c2ad7f91bf53a93ae6e7b89979f417e1c912e0'


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _read_json(path):
    try:
        return json.loads(path.read_bytes())
    except (OSError, ValueError) as error:
        raise ValueError(f"Measured native key evidence unavailable/corrupt: {path}") from error


def _number(value, label, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Invalid native {label}")
    if value < 0 or (positive and value == 0):
        raise ValueError(f"Invalid native {label}")
    return value


def _single(rows, label):
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError(f"Measured native keys require one {label}; multi-set mapping unverified")
    return rows[0]


def _channel(group, summary, width, tps, rotation=False):
    if not isinstance(group, dict) or not isinstance(summary, dict):
        raise ValueError("Missing canonical native key group")
    count = group.get("count")
    if type(count) is not int or count <= 0 or count > 1_000_000:
        raise ValueError("Invalid native key count")
    if type(group.get("stride")) is not int or type(summary.get("count")) is not int or group.get("stride") != width or summary.get("keyStrideFloats") != width or summary.get("count") != count:
        raise ValueError("Native key count/stride mismatch")
    try:
        raw = base64.b64decode(group["keyBytesBase64"], validate=True)
    except (KeyError, ValueError, TypeError, binascii.Error) as error:
        raise ValueError("Invalid canonical native key bytes") from error
    if len(raw) != count * width * 4:
        raise ValueError("Truncated canonical native key bytes")
    if _hash(raw) != group.get("keyBytesSha256") or group.get("keyBytesSha256") != summary.get("keyBytesSha256"):
        raise ValueError("Native key bytes hash mismatch")
    ticks, values = [], []
    for row in struct.iter_unpack("<" + "f" * width, raw):
        if not all(math.isfinite(n) for n in row):
            raise ValueError("Nonfinite native key")
        tick, *value = row
        if tick < 0 or (ticks and tick <= ticks[-1]):
            raise ValueError("Native key ticks must be nonnegative and strictly sorted")
        if rotation:
            if sum(n*n for n in value) <= 1e-24:
                raise ValueError("Zero native quaternion")
            # Raw GetRotationKeys is row XYZW. Preserve original float32 values
            # and signed zeros: conjugate XYZ once, without local normalization.
            value = [-value[0], -value[1], -value[2], value[3]]
        ticks.append(tick)
        values.append(value)
    return {"ticks": ticks, "times": [tick / tps for tick in ticks], "time_unit": "seconds",
            "values": values, "source_key_type": "original-D3DX-GetKeys",
            "native_key_bytes_sha256": group["keyBytesSha256"]}


def decode_measured_native_keys(source_path, parsed_clips, repo_root=ROOT):
    """Return decode_animations-compatible clips for exact measured source only.

    Legacy Iron has a single set. Full-skill measurements additionally return
    exact GetName/GetPlaybackType identities for every set, with no index guess.
    """
    path, repo_root = Path(source_path), Path(repo_root).resolve()
    measured = _decode_registered_keys(path, parsed_clips, repo_root,
        'reports/ca-shield-d3dx-sources-v45.json', 'reports/ca-shield-d3dx-keyframes-v45.json',
        'f49dabab42018565922010fefb0354595764affacf95992ada6bc74ea32ba950', 'CA shield-v45')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root,
        'reports/three-costumes-d3dx-sources-v1.json', 'reports/three-costumes-d3dx-keyframes-v1.json',
        'd618b456cdb7318acacab174686dfc348863cc02500d2878af4268e52b5a7874', 'Three original costume sets-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root,
        'reports/player-feedback-d3dx-sources-v30.json', 'reports/player-feedback-d3dx-keyframes-v30.json',
        '424dc28cdd5bd32b9a856ff3e6652121878cdde765ee1197acd3964882d86a91', 'Player feedback Blood Cutter-v30')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, APOCALYPSE_REQUEST,
        APOCALYPSE_MANIFEST, APOCALYPSE_REQUEST_SHA, 'MM Apocalypse NPC')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, ADD_FX_REQUEST,
        ADD_FX_MANIFEST, ADD_FX_REQUEST_SHA, 'ADD FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root,
        'reports/elesis-fx-d3dx-sources-v1.json', 'reports/elesis-fx-d3dx-keyframes-v1.json',
        'f9cf93972a262df43d53f1afe64340b23ae7f25b005e59ba0f208a9755eff8cb', 'Elesis FX/costumes-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, IS_FEEDBACK_REQUEST,
        IS_FEEDBACK_MANIFEST, IS_FEEDBACK_REQUEST_SHA, 'IS feedback-v2')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, COSTUME_FX_REQUEST,
        COSTUME_FX_MANIFEST, COSTUME_FX_REQUEST_SHA, 'Costume effects-v2')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, IS_FX_REQUEST,
        IS_FX_MANIFEST, IS_FX_REQUEST_SHA, 'IS FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, BATTLE_LIFE_REQUEST,
        BATTLE_LIFE_MANIFEST, BATTLE_LIFE_REQUEST_SHA, 'Battle life FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, PVP_MAP_REQUEST,
        PVP_MAP_MANIFEST, PVP_MAP_REQUEST_SHA, 'PvP map-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, COSTUME_REQUEST,
        COSTUME_MANIFEST, COSTUME_REQUEST_SHA, 'Costumes-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, RS_FX_REQUEST,
        RS_FX_MANIFEST, RS_FX_REQUEST_SHA, 'RS FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, BM_FX_REQUEST,
        BM_FX_MANIFEST, BM_FX_REQUEST_SHA, 'BM FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, VC_FX_REQUEST,
        VC_FX_MANIFEST, VC_FX_REQUEST_SHA, 'VC FX-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, LK_FX_REQUEST,
        LK_FX_MANIFEST, LK_FX_REQUEST_SHA, 'LK FX-v2')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, LANDING_REQUEST,
        LANDING_MANIFEST, LANDING_REQUEST_SHA, 'Air-down landing-v1')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, ARC_START_REQUEST,
        ARC_START_MANIFEST, ARC_START_REQUEST_SHA, 'Archenemy Start-v17')
    if measured is not None:
        return measured
    measured = _decode_full_skill_keys(path, parsed_clips, repo_root)
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, SKILL_V11_REQUEST,
        SKILL_V11_MANIFEST, SKILL_V11_REQUEST_SHA, 'Skill-v11 ValkNEW')
    if measured is not None:
        return measured
    measured = _decode_registered_keys(path, parsed_clips, repo_root, SHADOW_REQUEST,
        SHADOW_MANIFEST, SHADOW_REQUEST_SHA, "Shadow-weapon")
    if measured is not None:
        return measured
    known_name = path.name.casefold() == SOURCE_NAME.casefold()
    if not path.is_file():
        if known_name:
            raise ValueError("Measured native source missing")
        return None
    source_bytes = path.read_bytes()
    source_sha = _hash(source_bytes)
    if source_sha != SOURCE_SHA:
        if known_name:
            raise ValueError("Measured native source hash mismatch")
        return None
    if len(source_bytes) != SOURCE_BYTES:
        raise ValueError("Measured native source size mismatch")
    parsed = _single(parsed_clips, "parsed AnimationSet")
    if not isinstance(parsed.get("name"), str) or not parsed["name"]:
        raise ValueError("Missing parsed AnimationSet name")
    manifest = _read_json(repo_root / MANIFEST)
    if not isinstance(manifest, dict) or manifest.get("schema") != "elsword.native-d3dx-keyframes-manifest.v1" or manifest.get("fullClientExecuted") is not False:
        raise ValueError("Invalid native key manifest schema/evidence")
    if not isinstance(manifest.get("dll"), dict) or manifest["dll"].get("sha256") != DLL_SHA:
        raise ValueError("Measured keys require frozen 2016 D3DX DLL")
    source = _single(manifest.get("sources"), "measured source")
    if source.get("sourceSha256") != SOURCE_SHA or source.get("sourceBytes") != SOURCE_BYTES:
        raise ValueError("Measured native manifest source hash/size mismatch")
    recorded_animation = _single(source.get("animations"), "measured AnimationSet")
    entry = manifest.get("artifact", {})
    if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
        raise ValueError("Missing measured native artifact path")
    artifact_path = (repo_root / entry["path"]).resolve()
    if not artifact_path.is_relative_to(repo_root):
        raise ValueError("Native artifact path escapes task repository")
    try:
        artifact_bytes = artifact_path.read_bytes()
    except OSError as error:
        raise ValueError("Measured native key artifact missing") from error
    if _hash(artifact_bytes) != entry.get("sha256") or len(artifact_bytes) != entry.get("bytes"):
        raise ValueError("Measured native artifact hash/size mismatch")
    try:
        artifact = json.loads(artifact_bytes)
    except ValueError as error:
        raise ValueError("Corrupt measured native key artifact JSON") from error
    if not isinstance(artifact, dict) or artifact.get("schema") != "elsword.native-d3dx-keyframes.v1" or artifact.get("fullClientExecuted") is not False:
        raise ValueError("Invalid measured native key artifact schema/evidence")
    if artifact.get("dllSha256") != DLL_SHA or artifact.get("probeSourceSha256") != manifest.get("probeSourceSha256"):
        raise ValueError("Native artifact DLL/probe hash mismatch")
    native_source = _single(artifact.get("sources"), "artifact source")
    if native_source.get("sourceSha256") != SOURCE_SHA or native_source.get("sourceBytes") != SOURCE_BYTES:
        raise ValueError("Native artifact source hash/size mismatch")
    animation = _single(native_source.get("animations"), "artifact AnimationSet")
    if type(animation.get("index")) is not int or type(recorded_animation.get("index")) is not int or animation.get("index") != 0 or recorded_animation.get("index") != 0:
        raise ValueError("Native AnimationSet index mapping unverified")
    tps = _number(animation.get("ticksPerSecond"), "tick rate", positive=True)
    period = _number(animation.get("period"), "period", positive=True)
    if tps != recorded_animation.get("ticksPerSecond") or period != recorded_animation.get("period"):
        raise ValueError("Native AnimationSet clock mismatch")
    if tps != 4800 or period != 0.7666666507720947:
        raise ValueError("Native clock differs from frozen original Iron measurement")
    channels, summaries = animation.get("channels"), recorded_animation.get("channels")
    if not isinstance(channels, list) or not channels or not isinstance(summaries, list):
        raise ValueError("Missing native animation channels")
    summaries_by_name = {c.get("name"): c for c in summaries if isinstance(c, dict)}
    if len(summaries_by_name) != len(summaries) or len(channels) != len(summaries):
        raise ValueError("Native channel count/name mismatch")
    tracks, seen, all_ticks = [], set(), []
    for channel in channels:
        name = channel.get("name") if isinstance(channel, dict) else None
        if not isinstance(name, str) or not name or name in seen or name not in summaries_by_name:
            raise ValueError("Invalid/duplicate native channel name")
        seen.add(name)
        summary = summaries_by_name[name]
        track = {"frame_name": name, "warnings": [], "native_d3dx_keys": True}
        for property_name, key, width in (("translation", "translationKeys", 4), ("scale", "scaleKeys", 4), ("rotation", "rotationKeys", 5)):
            track[property_name] = _channel(channel.get(key), summary.get(key), width, tps, property_name == "rotation")
            all_ticks.extend(track[property_name]["ticks"])
        tracks.append(track)
    return [{"name": parsed["name"], "ticks_per_second": tps,
             "ticks_per_second_source": "original-client-shipped-DLL GetKeys",
             "duration_seconds": period, "minimum_tick": min(all_ticks), "maximum_tick": max(all_ticks),
             "tracks": tracks, "warnings": [], "rotation_order": "xyzw", "source_quaternion_order": "xyzw-row",
             "coordinate_convention": "source_axes_column_vector_local_transform", "native_d3dx_keys": True,
             "native_d3dx_evidence": {"manifest": MANIFEST, "source_sha256": source_sha, "dll_sha256": DLL_SHA,
                                      "artifact_sha256": entry["sha256"]}}]


def _decode_full_skill_keys(path, parsed_clips, repo_root):
    return _decode_registered_keys(path, parsed_clips, repo_root, FULL_REQUEST,
        FULL_MANIFEST, FULL_REQUEST_SHA, "Full-skill")


def _decode_registered_keys(path, parsed_clips, repo_root, request_file,
        manifest_file, request_sha, label):
    """One deliberate frozen extension per actual DLL execution, no wildcard."""
    request_path = repo_root / request_file
    if not request_path.is_file():
        # These two exact original files have independently pinned map and
        # battle-life receipts. An isolated proof repository may retain either;
        # the remaining decoder still verifies the selected registry and bytes.
        # A present but corrupt registry must fail before this fallback.
        shared_respawn = path.name.casefold() in ('respawnlanding01.x', 'respawnlanding02.x')
        if request_file == BATTLE_LIFE_REQUEST and shared_respawn and not (repo_root / PVP_MAP_REQUEST).is_file():
            raise ValueError('Battle life measured native source registry missing')
        if request_file == PVP_MAP_REQUEST and path.name.casefold() in {
            'respawnlanding01.x','respawnlanding02.x','respawnlanding03.y','rana_b_damageup_circle_f15.x'} and not (
                shared_respawn and (repo_root / BATTLE_LIFE_REQUEST).is_file()):
            raise ValueError('PvP map measured native source registry missing')
        if request_file == LANDING_REQUEST and path.name.casefold() == 'effect_elsword_dropdown.x':
            raise ValueError('Air-down landing measured native source registry missing')
        if request_file == ARC_START_REQUEST and re_arc_start_name(path.name):
            raise ValueError('Archenemy Start measured native source registry missing')
        if request_file == SKILL_V11_REQUEST and path.name.casefold() == 'raven_si_sa_rot_vkj_spear_mesh01.x':
            raise ValueError('Skill-v11 ValkNEW measured native source registry missing')
        return None
    if _hash(request_path.read_bytes()) != request_sha:
        raise ValueError(f'{label} original-DLL source registry hash mismatch')
    request = _read_json(request_path)
    if not isinstance(request, dict) or request.get("schema") != "elsword.native-d3dx-source-request.v1" or request.get("dllSha256") != DLL_SHA:
        raise ValueError(f"Invalid frozen {label} original-DLL source registry")
    rows = request.get("sources")
    if not isinstance(rows, list) or any(not isinstance(r,dict) or not isinstance(r.get('source'),str) or not isinstance(r.get('sourceSha256'),str) for r in rows) or len({r.get('sourceSha256') for r in rows}) != len(rows):
        raise ValueError(f"Duplicate/invalid {label} source registry")
    name = path.name.casefold()
    named = [r for r in rows if Path(r['source'].replace('\\', '/')).name.casefold() == name]
    if not path.is_file():
        if named:
            raise ValueError("Measured native source missing")
        return None
    data = path.read_bytes()
    sha = _hash(data)
    matched = [r for r in rows if r.get('sourceSha256') == sha]
    if not matched:
        if named:
            raise ValueError("Measured native source hash mismatch")
        return None
    registered = matched[0]
    if registered.get('actualLoaderHresult') != '0x00000000':
        raise ValueError(f'{label} original-DLL loader did not succeed')
    if len(data) != registered.get('sourceBytes'):
        raise ValueError("Measured native source size mismatch")
    expected_animations = registered.get('nativeAnimations')
    if expected_animations == []:
        if parsed_clips:
            raise ValueError("Original DLL measured no AnimationSet; parsed set mismatch")
        return None  # Measured static mesh: no invented Normal clip or tick rate.
    if not isinstance(expected_animations, list) or not expected_animations:
        raise ValueError(f"{label} source lacks original-DLL animation measurement")
    manifest = _read_json(repo_root / manifest_file)
    if not isinstance(manifest,dict) or manifest.get('schema') != 'elsword.native-d3dx-keyframes-manifest.v1' or not isinstance(manifest.get('dll'),dict) or manifest['dll'].get('sha256') != DLL_SHA or manifest.get('fullClientExecuted') is not False:
        raise ValueError(f"Invalid {label} native key manifest")
    if not isinstance(manifest.get('sources'),list) or any(not isinstance(r,dict) for r in manifest['sources']):
        raise ValueError('Invalid native manifest sources')
    recorded = [r for r in manifest['sources'] if r.get('sourceSha256') == sha]
    source = _single(recorded, f'{label} measured source')
    if source.get('sourceBytes') != len(data):
        raise ValueError("Native manifest source size mismatch")
    entry = manifest.get('artifact')
    if not isinstance(entry,dict) or not isinstance(entry.get('path'),str):
        raise ValueError('Missing measured native artifact path')
    artifact_path = (repo_root / entry['path']).resolve()
    if not artifact_path.is_relative_to(repo_root):
        raise ValueError("Native artifact path escapes task repository")
    try:
        raw = artifact_path.read_bytes()
    except OSError as error:
        raise ValueError("Measured native key artifact missing") from error
    if _hash(raw) != entry.get('sha256') or len(raw) != entry.get('bytes'):
        raise ValueError("Measured native artifact hash/size mismatch")
    try:
        artifact = json.loads(raw)
    except ValueError as error:
        raise ValueError('Corrupt measured native key artifact JSON') from error
    if not isinstance(artifact,dict) or artifact.get('schema') != 'elsword.native-d3dx-keyframes.v1' or artifact.get('dllSha256') != DLL_SHA or artifact.get('probeSourceSha256') != manifest.get('probeSourceSha256') or artifact.get('fullClientExecuted') is not False:
        raise ValueError(f"Invalid {label} native key artifact")
    if not isinstance(artifact.get('sources'),list) or any(not isinstance(r,dict) for r in artifact['sources']):
        raise ValueError('Invalid native artifact sources')
    native_source = _single([r for r in artifact['sources'] if r.get('sourceSha256') == sha], f'{label} artifact source')
    if native_source.get('sourceBytes') != len(data):
        raise ValueError("Native artifact source size mismatch")
    def by_name(values):
        if not isinstance(values, list) or any(not isinstance(v, dict) or not isinstance(v.get('name'), str) or not v['name'] for v in values):
            raise ValueError('Missing actual original-DLL AnimationSet name')
        result = {v['name']: v for v in values}
        if len(result) != len(values):
            raise ValueError('Duplicate actual AnimationSet name; mapping unverified')
        return result
    expected, recorded_sets, native_sets, parsed = map(by_name, (expected_animations, source.get('animations'), native_source.get('animations'), parsed_clips))
    if set(expected) != set(recorded_sets) or set(expected) != set(native_sets) or set(expected) != set(parsed):
        raise ValueError('Actual native/parsed AnimationSet names differ; no index guess')
    output = []
    for name in parsed:
        frozen, summary, animation = expected[name], recorded_sets[name], native_sets[name]
        for key in ('index', 'period', 'ticksPerSecond', 'playbackType'):
            if animation.get(key) != summary.get(key) or animation.get(key) != frozen.get(key):
                raise ValueError('Native AnimationSet metadata differs from frozen measurement')
        tps = _number(animation.get('ticksPerSecond'), 'tick rate', positive=True)
        period = _number(animation.get('period'), 'period')
        playback = animation.get('playbackType')
        if type(playback) is not int or playback not in (0, 1, 2):
            raise ValueError('Unsupported original-DLL playback type')
        channels = animation.get('channels')
        summaries = summary.get('channels')
        if not isinstance(channels, list) or not channels or not isinstance(summaries, list):
            raise ValueError('Missing native animation channels')
        if any(not isinstance(c,dict) or not isinstance(c.get('name'),str) for c in summaries):
            raise ValueError('Invalid native channel summary')
        summaries_by_name = {c['name']: c for c in summaries}
        if len(summaries_by_name) != len(summaries) or len(channels) != len(summaries):
            raise ValueError('Native channel count/name mismatch')
        tracks, seen, all_ticks = [], set(), []
        for c in channels:
            bone = c.get('name') if isinstance(c,dict) else None
            if not isinstance(bone, str) or not bone or bone in seen or bone not in summaries_by_name:
                raise ValueError('Invalid/duplicate native channel name')
            seen.add(bone)
            track = {'frame_name': bone, 'warnings': [], 'native_d3dx_keys': True}
            for property, key, width in (('translation', 'translationKeys', 4), ('scale', 'scaleKeys', 4), ('rotation', 'rotationKeys', 5)):
                track[property] = _channel(c.get(key), summaries_by_name[bone].get(key), width, tps, property == 'rotation')
                all_ticks.extend(track[property]['ticks'])
            tracks.append(track)
        output.append({'name': name, 'ticks_per_second': tps, 'ticks_per_second_source': 'original-client-shipped-DLL GetKeys',
            'duration_seconds': period, 'nativePlaybackField': playback, 'minimum_tick': min(all_ticks), 'maximum_tick': max(all_ticks),
            'tracks': tracks, 'warnings': [], 'rotation_order': 'xyzw', 'source_quaternion_order': 'xyzw-row',
            'coordinate_convention': 'source_axes_column_vector_local_transform', 'native_d3dx_keys': True,
            'native_d3dx_evidence': {'manifest': manifest_file, 'source_sha256': sha, 'dll_sha256': DLL_SHA, 'artifact_sha256': entry['sha256']}})
    return output


def re_arc_start_name(name):
    return name.casefold() in {
        f'raven_overtaker_sp2a_flyingimpact_start_0{i}.x' for i in range(1, 5)}
