"""Build a provenance-checked 2016 RF asset set without running the client.

Run with Python + numpy + Pillow. Inputs and catalog are read-only. All converted
client assets are written under the requested ignored output directory.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import math
import re
import sqlite3
import struct
import sys
import warnings
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

from export_ksm_sample import clips, node, to_tree
from export_samples import C, Exporter, flat, matrix, parser, render
from ksm_convert import parse_ksm
from directx_animation import decode_animations, decompose_native_matrix
from native_d3dx_keys import decode_measured_native_keys

VERSION = "rf-assets-2016-native-v1"
MOTIONS = ("Motion_Raven.x", "Motion_Raven_Common.x", "Motion_Raven_OT.x", "Motion_Raven_RF.x")
# Target-2016 RF state declarations refer to these exact names. Their source
# packages use the same original Raven named hierarchy; only tracks whose
# entire parent paths match may be registered. No renamed/substitute animation.
SUPPLEMENTAL_MOTIONS = {
    "Motion_Raven_WT.x": {"sha256": "e1c6bcce13404b980d16db8a2b7a0237b97c6736b9c69a2deeb6b5f5c0dd1a2f", "clips": ("SI_A_RVC_BLEEDING_SLICER_AIR",)},
    "Motion_Raven_VC.x": {"sha256": "cfaae409b0994665e378b42fc589c4cabdad9fd241d3b06c7d417f5a02d837aa", "clips": ("Wait10",)},
}
BODY = (
    "Mesh_Raven_RRF_Base_Hair_Sorted.X",
    "Mesh_Raven_Cash_Face_Sorted.X",
    "Mesh_Raven_RRF_Cash_Upbody_Sorted.X",
    "Mesh_Raven_RRF_Cash_LowBody_Sorted.X",
    "Mesh_Raven_RRF_Cash_Left_Hand_Sorted.x",
    "Mesh_Raven_RRF_Cash_Right_Hand_Sorted.X",
    "Mesh_Raven_RRF_Cash_Foot_Sorted.X",
)
WEAPON = "Mesh_Raven_RRF_Cash_Weapon_Sorted.X"
EFFECTS = (
    "Motion_Raven_RageMode_Nasod.x",
    "Raven_SI_A_RF_Thrust_Mesh01.X",
    "Raven_RRF_Combo_ZZXFX_Mesh01.X",
    "Raven_RRF_SI_SA_X_Crash_Mesh01.X",
    "Raven_RRF_SI_SA_X_Crash_Mesh02.X",
    "Raven_RRF_SI_SA_X_Crash_Mesh03.X",
    "DummyAttackBox_50x50x50.X",
    "ST_DarkFireBall_Dummy.X",
)
HELPERS = ("COLLISION", "FOOTSTEPS", "ATTACK_LINE", "ATTACK_SPHERE", "TRACE_")
REQUIRED_TEMPLATES = ("Raven_WeaponDummy01", "Raven_NasodBall", "Raven_Aura", "Mesh_Power_Assault")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def json_bytes(value, compact=False):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
        separators=(",", ":") if compact else None, indent=None if compact else 2) + "\n").encode("utf-8")


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json_bytes(value, compact))


def profile_display_path(path):
    root = Path(__file__).resolve().parents[3]
    resolved = path.resolve()
    return resolved.relative_to(root).as_posix() if resolved.is_relative_to(root) else path.name


def walk(root, parents=()):
    current = parents + (root,) if root.kind == "Frame" else parents
    yield root, current
    for child in root.children:
        yield from walk(child, current)


class Catalog:
    """Fail on ambiguity and source corruption; never silently choose another era."""
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.connection = sqlite3.connect((self.root / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
        self.connection.row_factory = sqlite3.Row
        self.rows = {}
        for row in self.connection.execute("SELECT * FROM assets WHERE status='ok'"):
            self.rows.setdefault(row["name"].casefold(), []).append(dict(row))
        self.used = {}

    def path(self, filename):
        name = Path(filename.replace("\\", "/")).name.casefold()
        rows = self.rows.get(name, [])
        if not rows:
            raise FileNotFoundError(f"Source asset missing: {filename}")
        if len({r["sha256"] for r in rows}) != 1:
            raise ValueError(f"Ambiguous source asset: {filename}; declare an archive explicitly")
        row = sorted(rows, key=lambda r: (r["archive"], r["ordinal"]))[0]
        path = (self.root / row["raw_path"]).resolve()
        if not path.is_relative_to(self.root / "raw"):
            raise ValueError("Catalog source escapes raw directory")
        if path not in self.used:
            data = path.read_bytes()
            if digest(data) != row["sha256"].lower():
                raise ValueError(f"Source SHA256 differs from catalog: {filename}")
            self.used[path] = {
                "archive": row["archive"], "ordinal": row["ordinal"], "name": row["name"],
                "rawPath": row["raw_path"], "sha256": row["sha256"].lower(),
                "bytes": len(data), "signatureHex": data[:16].hex(),
            }
        return path

    def get(self, filename, default=None):
        try:
            return self.path(filename)
        except FileNotFoundError:
            return default

    def evidence(self, path):
        return self.used[path]


def load_x(path):
    raw = path.read_bytes()
    if raw[8:12] in (b"bzip", b"tzip"):
        # The vendored parser supports recovery; this build never permits it.
        # Each compressed size includes CK; each block has a decoded-size word.
        if len(raw) < 26:
            raise ValueError("Truncated DirectX MSZIP header")
        declared, = struct.unpack_from("<I", raw, 16)
        if declared < 16 or declared > 64 * 1024 * 1024:
            raise ValueError("Invalid DirectX decoded size")
        cursor, decoded_size, window = 20, 0, b""
        while cursor < len(raw):
            if cursor + 6 > len(raw):
                raise ValueError("Truncated MSZIP block header")
            uncompressed, compressed = struct.unpack_from("<HH", raw, cursor)
            end = cursor + 4 + compressed
            if compressed < 2 or uncompressed > 32768 or end > len(raw) or raw[cursor+4:cursor+6] != b"CK":
                raise ValueError("Invalid/truncated MSZIP block framing")
            inflater = zlib.decompressobj(-15, zdict=window) if window else zlib.decompressobj(-15)
            try:
                block = inflater.decompress(raw[cursor+6:end]) + inflater.flush()
            except zlib.error as error:
                raise ValueError("Corrupt MSZIP block") from error
            if not inflater.eof or inflater.unused_data or len(block) != uncompressed:
                raise ValueError("Incomplete MSZIP block or decoded size mismatch")
            decoded_size += len(block); window = (window + block)[-32768:]; cursor = end
        if decoded_size != declared - 16:
            raise ValueError("DirectX total decoded size mismatch")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        tree = parser.parse_x_file(str(path))
    if caught:
        raise ValueError(f"Parser warning for {path.name}: " + "; ".join(str(w.message) for w in caught))
    return tree


def helpers_from_tree(tree, source):
    result = []
    for frame, ancestry in walk(tree):
        if frame.kind != "Frame" or not any(k in frame.name.upper() for k in HELPERS):
            continue
        entry = {"name": frame.name, "parent": ancestry[-2].name if len(ancestry) > 1 else None,
            "source": source, "nativeRowMatrix": frame.child("FrameTransformMatrix").nums(),
            "gltfColumnMatrix": flat(C @ matrix(frame.child("FrameTransformMatrix")) @ C)}
        if frame.meta:
            entry.update(frame.meta)
        vertices, triangles = [], []
        for mesh, mesh_ancestry in walk(frame):
            if mesh.kind != "Mesh":
                continue
            v = mesh.nums(); count = int(v[0]); cursor = 1 + count * 3
            relative = np.eye(4)
            for descendant in mesh_ancestry[1:]:
                relative = relative @ matrix(descendant.child("FrameTransformMatrix"))
            points = np.asarray(v[1:cursor]).reshape(count, 3)
            p = (relative @ np.c_[points, np.ones(count)].T).T[:, :3].tolist()
            polygons = int(v[cursor]); cursor += 1
            for _ in range(polygons):
                size = int(v[cursor]); cursor += 1
                face = [int(k) + len(vertices) for k in v[cursor:cursor + size]]; cursor += size
                for i in range(1, size - 1):
                    triangles.append([face[0], face[i], face[i + 1]])
            vertices.extend(p)
        if vertices:
            points = np.asarray(vertices)
            center = (points.min(0) + points.max(0)) / 2
            entry.update(nativeVertices=vertices, nativeTriangles=triangles,
                nativeLocalBounds={"min": points.min(0).tolist(), "max": points.max(0).tolist()},
                geometryBoundingSphereCandidate={"center": center.tolist(),
                    "radius": float(np.linalg.norm(points-center,axis=1).max()),
                    "algorithm": "farthest original vertex from AABB center; D3DXFrameCalculateBoundingSphere equality unverified"})
        result.append(entry)
    return result


def asset_metadata(exporter, destination, summary):
    summary["file"] = exporter.name + ".glb"
    summary["sha256"] = digest((destination / summary["file"]).read_bytes())
    summary["nodes"] = [n["name"] for n in exporter.doc["nodes"]]
    points = np.concatenate([m["triangles"].reshape(-1, 3) for m in exporter.render_meshes])
    summary["bindBounds"] = {"min": points.min(0).tolist(), "max": points.max(0).tolist()}
    summary["materials"] = exporter.doc["materials"]
    # OBJ is not used by this pipeline. Remove only files just generated here.
    for extension in (".obj", ".mtl"):
        (destination / (exporter.name + extension)).unlink(missing_ok=True)
    return summary


def supplemental_motion_binding(decoded, base, selected_names):
    """Validate original named-track registration onto the Raven base hierarchy."""
    def paths(document):
        result = {}
        for frame in document['frames']:
            if frame['name'] in result:
                raise ValueError('Duplicate motion frame name; output binding unverified')
            current, ancestry, seen = frame, [], set()
            while current is not None:
                if current['index'] in seen:
                    raise ValueError('Cyclic motion frame hierarchy')
                seen.add(current['index']); ancestry.append(current['name'])
                current = document['frames'][current['parent']] if current['parent'] is not None else None
            result[frame['name']] = tuple(reversed(ancestry))
        return result
    if decoded['unreachable_frames']:
        raise ValueError('Unreachable supplemental motion frame')
    source_paths, target_paths = paths(decoded), paths(base)
    selected = [a for a in decoded['animations'] if a['name'] in selected_names]
    if {a['name'] for a in selected} != set(selected_names):
        raise ValueError('Required supplemental original animation missing')
    track_names = {decoded['frames'][t['frame']]['name'] for a in selected for t in a['tracks']}
    mismatches = sorted(name for name in track_names if source_paths[name] != target_paths.get(name))
    if mismatches:
        raise ValueError('Supplemental motion named-track parent paths differ: ' + str(mismatches))
    base_matrices = {f['name']: f['matrix'] for f in base['frames']}
    return {'binding': 'original named tracks; unchanged full parent paths; no retargeting',
        'selectedClips': sorted(selected_names), 'sourceFrameCount': len(decoded['frames']),
        'baseFrameCount': len(base['frames']), 'registeredTrackNames': sorted(track_names),
        'differentBindFrames': sorted(f['name'] for f in decoded['frames']
            if f['name'] in base_matrices and f['matrix'] != base_matrices[f['name']]),
        'baseFramesWithoutSourceTrack': sorted(set(target_paths) - track_names),
        'evidenceBoundary': 'target resource/name/hierarchy verified; whole original client animation registration not executed'}


def validate_weapon_mounts(tree, frames, mounts):
    """Resolve all original rigid mounts before mutating the target hierarchy."""
    if not mounts or any(not isinstance(m,dict) or not all(isinstance(m.get(k),str) and m[k] for k in ('name','source','target')) for m in mounts):
        raise ValueError('Weapon mounts require nonempty source, target and name')
    if len({m['name'] for m in mounts}) != len(mounts) or any(m['name'] in frames for m in mounts):
        raise ValueError('Weapon mounts must have distinct new names')
    result=[]
    for definition in mounts:
        originals=[n for n,_ in walk(tree) if n.kind=='Frame' and n.name==definition['source']]
        if len(originals)!=1 or definition['target'] not in frames:
            raise ValueError('Original weapon mount frame missing or ambiguous: '+str(definition))
        if originals[0].child('FrameTransformMatrix') is None:
            raise ValueError('Original weapon mount transform missing')
        result.append(originals[0])
    return result


def build_character(catalog, destination, runtime_profile=None, all_character_animations=False, *, spec=None):
    # All Raven careers share the verified decoder/exporter. Selection is data,
    # and never changes the RF defaults used by previous conversion receipts.
    spec = spec or {}
    motions, body = spec.get('motions', MOTIONS), spec.get('body', BODY)
    weapon_name = spec.get('weapon', WEAPON)
    supplemental_motions = spec.get('supplementalMotions', SUPPLEMENTAL_MOTIONS)
    asset_id = spec.get('id', 'rf')
    primary = catalog.path(motions[0]); base = parse_ksm(primary)
    skeleton = to_tree(base)
    registration_base = copy.deepcopy(base)
    for extra_source, allowed_names in spec.get('additionalMotionRoots', {}).items():
        extra = parse_ksm(catalog.path(extra_source))
        present = {f['name'] for f in registration_base['frames']}
        additions = [f for f in extra['frames'] if f['name'] not in present]
        if {f['name'] for f in additions} != set(allowed_names) or any(f['parent'] != 0 or f['child'] != -1 for f in additions):
            raise ValueError('Additional original motion roots differ from explicit selection')
        root_frame = next(n for n, _ in walk(skeleton) if n.kind == 'Frame' and n.name == 'Scene_Root')
        for frame in additions:
            original = node('Frame', name=frame['name'])
            original.children.append(node('FrameTransformMatrix', frame['matrix']))
            root_frame.children.append(original)
            registration_base['frames'].append({**frame, 'index': len(registration_base['frames']), 'mesh_index': None})
    original_helpers = helpers_from_tree(skeleton, catalog.evidence(primary)["rawPath"])
    # Geometry inside Motion_* is helper geometry. Body comes from the RF parts.
    for frame, _ in walk(skeleton):
        frame.children = [child for child in frame.children if child.kind != "Mesh"]
    frames = {n.name: n for n, _ in walk(skeleton) if n.kind == "Frame"}
    attachments = []
    for filename in body:
        path = catalog.path(filename); tree = load_x(path)
        if spec.get('bodyHelperGeometry'):
            # Elesis Motion_EL contains named empty helper frames. The actual
            # original helper meshes are shipped in the equipped body parts.
            # Attach those by their original names/parents, just like skins;
            # never retain a zero motion-dummy radius over real .X geometry.
            for helper in helpers_from_tree(tree, catalog.evidence(path)['rawPath']):
                if not helper.get('nativeVertices') or 'SPHERE' not in helper['name']:
                    continue
                old = next((h for h in original_helpers if h['name'] == helper['name']), None)
                if old is None or old['parent'] != helper['parent']:
                    raise ValueError('Body helper has no matching original motion frame: '+helper['name'])
                if old.get('nativeVertices'):
                    if old['nativeVertices'] != helper['nativeVertices'] or old.get('nativeTriangles') != helper.get('nativeTriangles'):
                        raise ValueError('Ambiguous body helper geometry: '+helper['name'])
                    old.setdefault('identicalGeometrySources', []).append(helper['source'])
                    continue
                helper['namedFrameRegistration'] = {
                    'motionSource': old['source'], 'motionNativeRowMatrix': old['nativeRowMatrix'],
                    'binding': 'Original body helper geometry on the same named motion frame and parent; source mesh transform retained as evidence',
                    'radiusEvidence': 'Original .X helper vertices; native D3DX bounding-sphere constructor not executed'}
                original_helpers[original_helpers.index(old)] = helper
        attached = 0
        for mesh, ancestry in walk(tree):
            if mesh.kind != "Mesh" or not mesh.children_of("SkinWeights"):
                continue
            holder = ancestry[-1]
            if holder.name not in frames:
                # Costume mesh holders are not necessarily motion-track nodes.
                # Skin bone names/offsets are authoritative; keep the source
                # holder transform separately instead of renaming onto a bone.
                added = node("Frame", name=asset_id.upper()+"_Part_" + holder.name)
                added.children.append(copy.deepcopy(holder.child("FrameTransformMatrix")))
                frames["Scene_Root"].children.append(added)
                frames[holder.name] = added
            frames[holder.name].children.append(copy.deepcopy(mesh)); attached += 1
        if not attached:
            raise ValueError(f"No skinned RF body geometry in {filename}")
        attachments.append({"source": catalog.evidence(path)["rawPath"], "meshes": attached, "type": "skinned"})
    weapon = catalog.path(weapon_name); tree = load_x(weapon)
    weapon_mount = spec.get('weaponMount', 'Dummy1_Rhand')
    mounts = spec.get('weaponMounts', ({'source': weapon_mount, 'target': weapon_mount, 'name': asset_id.upper()+'_SwordMount'},))
    for definition,original in zip(mounts,validate_weapon_mounts(tree,frames,mounts)):
        mount = copy.deepcopy(original); mount.name = definition['name']
        # Preserve explicit native weapon-frame bindings before namespacing
        # repeated Add rigid weapons onto each authored Dynamo bone.
        for child, _ in walk(mount):
            if child.kind == 'Frame' and child is not mount:
                child.name = spec.get('weaponFrameRenames', {}).get(child.name, child.name)
                if len(mounts) > 1:
                    child.name = definition['name']+'_'+(child.name or 'Unnamed')
        frames[definition['target']].children.append(mount)
        # Original weapon helpers may themselves be effect-owner bones.
        frames.update({n.name: n for n, _ in walk(mount) if n.kind == 'Frame'})
        original_helpers.extend(helpers_from_tree(mount, catalog.evidence(weapon)['rawPath']))
        attachments.append({'source': catalog.evidence(weapon)['rawPath'], 'type': 'rigid',
            'parent': definition['target'], 'node': mount.name, 'sourceFrame': definition['source'],
            'nativeRowMatrix': mount.child('FrameTransformMatrix').nums()})
    all_clips, records, native_documents, duplicate_clips = [], [], [], []
    hashes = {}
    hierarchy = [(f["name"], f["parent"]) for f in base["frames"]]
    bind_differences = []
    motion_sources = list(motions) + (list(supplemental_motions) if all_character_animations else [])
    for filename in motion_sources:
        path = catalog.path(filename); decoded = base if path == primary else parse_ksm(path)
        supplemental = supplemental_motions.get(filename)
        if supplemental:
            if catalog.evidence(path)['sha256'] != supplemental['sha256']:
                raise ValueError('Supplemental motion source hash mismatch: ' + filename)
            bind_differences.append({'source': filename, **supplemental_motion_binding(decoded, base, supplemental['clips'])})
        elif spec.get('additionalMotionRoots'):
            bind_differences.append({'source': filename, **supplemental_motion_binding(decoded, registration_base,
                [animation['name'] for animation in decoded['animations']])})
        elif decoded["unreachable_frames"] or [(f["name"], f["parent"]) for f in decoded["frames"]] != hierarchy:
            raise ValueError(f"Motion skeleton topology differs: {filename}")
        elif path != primary:
            changed = [f["name"] for f, b in zip(decoded["frames"], base["frames"]) if f["matrix"] != b["matrix"]]
            bind_differences.append({"source": filename, "differentBindFrames": changed})
        native_documents.append({"source": catalog.evidence(path), "decoded": decoded})
        for index, (native, clip) in enumerate(zip(decoded["animations"], clips(decoded))):
            if supplemental and clip['name'] not in supplemental['clips']:
                continue
            original_name = clip["name"]; signature = digest(json_bytes(clip, True))
            if original_name in hashes:
                if hashes[original_name] == signature:
                    duplicate_clips.append({"source": filename, "sourceIndex": index, "name": original_name,
                        "status": "identical decoded keys; one GLB clip", "sha256": signature})
                    continue
                clip["name"] = original_name + "__" + path.stem
                duplicate_clips.append({"source": filename, "sourceIndex": index, "name": original_name,
                    "status": "different keys; both preserved", "exportedName": clip["name"], "sha256": signature})
            else:
                hashes[original_name] = signature
            missing = sorted({t["frame_name"] for t in clip["tracks"]} - set(frames))
            if missing:
                raise ValueError(f"Animation has missing bones: {filename}/{original_name}: {missing}")
            record = {"name": clip["name"], "sourceName": original_name, "source": catalog.evidence(path)["rawPath"],
                "sourceAnimationIndex": index, "durationSeconds": native["duration_seconds"],
                "durationTicks": native["duration_ticks"], "ticksPerSecond": native["ticks_per_second"],
                "nativePlaybackField": native["playback_field"], "decodedKeysSha256": signature,
                "trackCount": len(clip["tracks"])}
            root = next((t for t in clip["tracks"] if t["frame_name"] == "Bip01"), None)
            if root:
                positions = np.asarray(root["translation"]["values"]) * [1, 1, -1]
                record["rootMotion"] = {"bone": "Bip01", "timesSeconds": root["translation"]["times"],
                    "positionsGltf": positions.tolist(), "deltaGltf": (positions[-1] - positions[0]).tolist(),
                    "boundsGltf": {"min": positions.min(0).tolist(), "max": positions.max(0).tolist()},
                    "semantics": "authored absolute bone-local translation; gameplay consumption unverified"}
            # State PLAY_TYPE and the animation set's native D3DX playback
            # field are separate. Preserve the decoded source period/playback
            # for pose sampling, including a previous clip during a blend.
            clip["durationSeconds"] = native["duration_seconds"]
            clip["nativePlaybackField"] = native["playback_field"]
            all_clips.append(clip); records.append(record)
    exporter = Exporter(asset_id, texture_lookup=catalog, asset_root=catalog.root)
    exporter.add(primary, destination, tree=skeleton, clips_override=all_clips)
    if exporter.missing_textures:
        raise ValueError("Missing RF textures: " + str(exporter.missing_textures))
    # Use an explicit display approximation, preserving original diffuse factors.
    exporter.doc["extensionsUsed"] = ["KHR_materials_unlit"]
    for material in exporter.doc["materials"]:
        material["extensions"] = {"KHR_materials_unlit": {}}
        material["extras"] = {"nativeLighting": "unverified", "alphaDecision": "pixel alpha; MASK cutoff .4 display adapter"}
    for n in exporter.doc["nodes"]:
        n["name"] = n["name"].removeprefix(primary.stem + "/").replace("/render", "_render")
    exporter.sources = [catalog.evidence(catalog.path(filename))["rawPath"] for filename in tuple(motion_sources) + tuple(body) + (weapon_name,)]
    summary = asset_metadata(exporter, destination, exporter.save(destination))
    runtime_names = {"Wait", "Wait3", "Walk", "BoostPower", "RespawnLanding",
        "SP2a_PowerAssault", "Raven_OT_SP1a_ChargedBolt", "SI_A_RF_MEGADRILL_BREAK", "SI_A_RF_THRUST",
        "SI_A_RF_SHADOW_STEP", "SI_A_RRF_HELL_DIVE"}
    profile_coverage = None
    effect_bones = set()
    if runtime_profile is not None:
        profile_bytes = runtime_profile.read_bytes(); profile = json.loads(profile_bytes)
        states = {name: state["animationName"] for name, state in profile["states"].items()}
        missing = sorted(set(states.values()) - {clip["name"] for clip in all_clips})
        if missing:
            raise ValueError("RF profile requires animations absent from original motion files: " + str(missing))
        runtime_names.update(states.values())
        effect_bones = {entry['BONE_NAME'] for declaration in profile.get('effectSets', {}).values()
            for key, entry in declaration['raw'].items()
            if re.fullmatch(r'EFFECT\d+', key) and isinstance(entry, dict) and entry.get('BONE_NAME')}
        missing_bones = sorted(effect_bones - set(frames))
        if missing_bones:
            raise ValueError('Effect-set owner bones absent from original RF skeleton: ' + str(missing_bones))
        profile_coverage = {"path": profile_display_path(runtime_profile), "sha256": digest(profile_bytes),
            "profileId": profile.get("profileId"), "stateAnimations": states, "effectOwnerBones": sorted(effect_bones),
            "purpose": "runtime resource coverage only; no gameplay values/timing are derived from this selection"}
    runtime_prefixes = ("Jump", "Dash", "Combo", "Damage", "Guard", "StandUp",
        "OT_ComboX", "OT_DashJump", "ROT_Dash_Combo", "RRF_COMBO", "RRF_DASH_JUMP")
    runtime_clips = [clip for clip in all_clips if all_character_animations or clip["name"] in runtime_names or clip["name"].startswith(runtime_prefixes)]
    shared_runtime = (spec or {}).get('sharedRuntimeClips', {})
    required_runtime = (spec or {}).get('runtimeClips')
    if required_runtime is not None:
        absent=set(required_runtime)-{c['name'] for c in all_clips}
        if absent:raise ValueError('Requested runtime clips missing: '+str(sorted(absent)))
        runtime_clips=[c for c in runtime_clips if c['name'] in required_runtime]
    clip_hashes={record['name']:record['decodedKeysSha256'] for record in records}
    shared_names=[c['name'] for c in runtime_clips if c['name'] in shared_runtime
        and shared_runtime[c['name']]==clip_hashes[c['name']]]
    runtime_clips=[c for c in runtime_clips if c['name'] not in shared_names]
    runtime = Exporter(asset_id+"-runtime", texture_lookup=catalog, asset_root=catalog.root,
        compact_animation_keys=True, deduplicate_accessors=True)
    runtime.add(primary, destination, tree=skeleton, clips_override=runtime_clips)
    runtime.doc["extensionsUsed"] = exporter.doc["extensionsUsed"]
    for material, full_material in zip(runtime.doc["materials"], exporter.doc["materials"]):
        material.update(extensions=copy.deepcopy(full_material["extensions"]), extras=copy.deepcopy(full_material["extras"]))
    for n in runtime.doc["nodes"]:
        n["name"] = n["name"].removeprefix(primary.stem + "/").replace("/render", "_render")
    runtime.sources = exporter.sources
    runtime_summary = asset_metadata(runtime, destination, runtime.save(destination))
    if shared_names:runtime_summary['sharedAnimationNames']=shared_names
    runtime_summary["selection"] = {"included": [clip["name"] for clip in runtime_clips],
        "excluded": [clip["name"] for clip in all_clips if clip not in runtime_clips],
        "purpose": "all original Raven motion clips retained for RF skill resource coverage; state bindings remain separate" if all_character_animations else "M3 RF locomotion/combo/reaction/awakening and profile-required skills; full rf.glb retained",
        "mode": "all-original-clips" if all_character_animations else "profile-and-common-clips",
        "keyCompaction": "only exactly constant interior keys removed; accessor data deduplicated; no value/time quantization"}
    if profile_coverage is not None:
        runtime_summary["profileCoverage"] = profile_coverage
    render(exporter, destination, "2016 "+asset_id.upper()+" source mesh / bind pose / no client measurement")
    write_json(destination / "helpers.json", {"format": VERSION, "axes": "native DirectX left-handed, Y up; vertices unscaled",
        "status": "geometry-only; native collision/intersection and active timing unverified", "helpers": original_helpers})
    write_json(destination / "skeleton.json", {"frames": base["frames"], "nativeBounds": base["bounds_raw"],
        "bindDifferences": bind_differences, "nullFrameNames": [f["index"] for f in base["frames"] if f["source_name"] is None]})
    with (destination / "native-motion.json.gz").open("wb") as stream:
        stream.write(gzip.compress(json_bytes(native_documents, True), mtime=0))
    with (destination / "pose-tracks.json.gz").open("wb") as stream:
        pose_frames = [n for n, _ in walk(skeleton) if n.kind == "Frame"]
        pose_ids = {id(n): i for i, n in enumerate(pose_frames)}
        pose_skeleton = [{"name": n.name,
            "parent": pose_ids[id(ancestry[-2])] if len(ancestry) > 1 else None,
            "nativeRowMatrix": n.child("FrameTransformMatrix").nums()}
            for n, ancestry in walk(skeleton) if n.kind == "Frame"]
        stream.write(gzip.compress(json_bytes({"schemaVersion": 1,
            "coordinateConvention": "native DirectX axes, column matrices; clips rotations conjugated to XYZW",
            "interpolation": "LINEAR positions/scales and normalized-linear rotations; shipped D3DX GetSRT execution evidence; whole client pose unmeasured",
            "frames": pose_skeleton, "helpers": original_helpers, "clips": all_clips}, True), mtime=0))
    needed = {h["name"] for h in original_helpers} | effect_bones
    frame_lookup = {frame["name"]: index for index, frame in enumerate(pose_skeleton)}
    for helper in list(needed):
        parent = pose_skeleton[frame_lookup[helper]]["parent"]
        while parent is not None:
            needed.add(pose_skeleton[parent]["name"]); parent = pose_skeleton[parent]["parent"]
    runtime_frames = [copy.deepcopy(frame) for frame in pose_skeleton if frame["name"] in needed]
    runtime_ids = {frame["name"]: index for index, frame in enumerate(runtime_frames)}
    for frame in runtime_frames:
        frame["parent"] = runtime_ids[pose_skeleton[frame["parent"]]["name"]] if frame["parent"] is not None else None
    runtime_pose_clips = []
    for clip in runtime_clips:
        subset = {"name": clip["name"], "ticks_per_second": clip["ticks_per_second"],
            "durationSeconds": clip["durationSeconds"], "nativePlaybackField": clip["nativePlaybackField"], "tracks": []}
        for original in clip["tracks"]:
            if original["frame_name"] not in needed:
                continue
            track = copy.deepcopy(original)
            for key in ("translation", "scale", "rotation"):
                channel = track[key]
                keep = [i for i, value in enumerate(channel["values"]) if i in (0, len(channel["values"])-1)
                    or value != channel["values"][i-1] or value != channel["values"][i+1]]
                channel["times"] = [channel["times"][i] for i in keep]
                channel["values"] = [channel["values"][i] for i in keep]
            subset["tracks"].append(track)
        runtime_pose_clips.append(subset)
    runtime_pose = {"schemaVersion": 1, "coordinateConvention": "native DirectX axes; column matrices",
        "frames": runtime_frames, "helpers": original_helpers, "clips": runtime_pose_clips,
        "selection": "selected original clips, collision helpers and declared effect-set owner bones with all their ancestors",
        "interpolation": "LINEAR/normalized-linear rotation; shipped D3DX GetSRT execution evidence; whole client pose unmeasured"}
    write_json(destination / "runtime-pose.json", runtime_pose, True)
    (destination / "runtime-pose.json.gz").write_bytes(gzip.compress(json_bytes(runtime_pose, True), mtime=0))
    write_json(destination / "clips.json", records)
    return {"glb": asset_id+".glb", "runtimeGlb": asset_id+"-runtime.glb", "runtimeCharacter": runtime_summary,
        "character": summary, "clips": records, "duplicateClips": duplicate_clips,
        "attachments": attachments, "helperGeometry": "helpers.json", "skeleton": "skeleton.json",
        "nativeMotion": "native-motion.json.gz", "poseTracks": "pose-tracks.json.gz",
        "runtimePose": "runtime-pose.json", "runtimePoseGzip": "runtime-pose.json.gz", "rootBone": "Bip01",
        "rootBindPositionGltf": (C @ matrix(frames["Bip01"].child("FrameTransformMatrix")) @ C)[:3, 3].tolist(),
        "bindDifferences": bind_differences}


def uniquify_effect_frames(tree):
    """Preserve duplicate nodes; keep original-name first-match refs and flag it."""
    seen, renamed = {}, []
    for frame, _ in walk(tree):
        if frame.kind != "Frame":
            continue
        name = frame.name or "X_UnnamedFrame"
        seen[name] = seen.get(name, 0) + 1
        unique = name if seen[name] == 1 else name + "__duplicate_" + str(seen[name])
        if frame.name != unique:
            renamed.append({"sourceName": frame.name, "exportedName": unique,
                "animationBinding": "first original-name node receives named animation; duplicate native binding unverified"})
            frame.name = unique
    return renamed


def measured_effect_tick_rate(path, evidence=None):
    """Only apply a rate actually read from this unchanged original .X by D3DX.

    The default remains unknown for every other source. These are DLL-loader
    observations, not a whole-client combat reference or a guessed FPS.
    """
    if evidence is None:
        root = Path(__file__).resolve().parents[3]
        reports = [root / "reports/ca-shield-d3dx-execution-v45.json", root / "reports/player-feedback-d3dx-execution-v30.json", root / "reports/mm-apocalypse-d3dx-execution-v1.json", root / "reports/add-fx-d3dx-execution-v1.json", root / "reports/rf-native-d3dx-execution.json", root / "reports/rf-native-d3dx-effects.json",
            root / "reports/rf-full-skill-d3dx-execution.json", root / "reports/rf-shadow-weapon-d3dx-execution.json",
            root / "reports/rf-landing-d3dx-execution-v1.json", root / "reports/costumes-d3dx-execution-v1.json", root / "reports/costume-effects-d3dx-execution-v2.json"]
        loaded = [(report.relative_to(root).as_posix(), json.loads(report.read_text(encoding="utf-8")))
            for report in reports if report.is_file()]
        if not loaded:
            return None
        if any(r.get("dll", {}).get("sha256") != "0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f" for _, r in loaded):
            raise ValueError("Effect clock evidence requires the frozen 2016 D3DX DLL")
        evidence = {"dll": loaded[0][1]["dll"], "traces": [dict(t, evidenceReport=path)
            for path, r in loaded for t in r.get("traces", [])]}
    if evidence.get("dll", {}).get("sha256") != "0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f":
        raise ValueError("Effect clock evidence requires the frozen 2016 D3DX DLL")
    for trace in evidence.get("traces", []):
        if trace.get("label", "").casefold() != ("original-X-loader-" + path.name).casefold():
            continue
        if trace.get("sourceSha256") != digest(path.read_bytes()):
            raise ValueError("Original .X clock evidence source hash mismatch: " + path.name)
        if trace.get("hresult") != "0x00000000":
            raise ValueError("Original .X clock evidence did not load successfully")
        rates = {a.get("ticksPerSecond") for a in trace.get("animations", [])}
        if len(rates) != 1:
            return None
        rate = rates.pop()
        if not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate <= 0:
            raise ValueError("Invalid observed original .X tick rate")
        return {"ticksPerSecond": rate, "evidenceClass": "target-2016-shipped-DLL-executed",
            "sourceSha256": trace["sourceSha256"], "dllSha256": evidence["dll"]["sha256"],
            "trace": trace["label"], "report": trace.get("evidenceReport", "reports/rf-native-d3dx-execution.json")}
    return None


def build_effect(catalog, destination, filename, *, render_profile=None, static_mesh=False, output_name=None):
    path = catalog.path(filename)
    output_name = output_name or path.stem
    if Path(output_name).name != output_name or '/' in output_name or '\\' in output_name:
        raise ValueError('Effect output name must be a filename stem')
    ksm = parse_ksm(path) if path.read_bytes()[:4] == b'KSM ' else None
    tree = to_tree(ksm) if ksm is not None else load_x(path)
    helpers = helpers_from_tree(tree, catalog.evidence(path)["rawPath"])
    duplicates = uniquify_effect_frames(tree)
    observed_clock = measured_effect_tick_rate(path) if ksm is None else None
    if static_mesh:
        # CX2SubEquip OpenXMesh has no animation controller. Keep authored
        # frame transforms, even if an unused animation set exists in the file.
        decoded = []
    elif ksm is None:
        decoded = decode_animations(tree, include_native_matrices=True,
            default_ticks_per_second=observed_clock["ticksPerSecond"] if observed_clock else None)
        native_keys = decode_measured_native_keys(path, decoded)
        if native_keys is not None:
            decoded = native_keys
    else:
        decoded = clips(ksm)
        for clip, original in zip(decoded, ksm['animations']):
            clip.update(duration_seconds=original['duration_seconds'], maximum_tick=original['duration_ticks'],
                        nativePlaybackField=original['playback_field'], warnings=[])
            for track in clip['tracks']: track['warnings'] = []
    missing_rates = any(a["ticks_per_second"] is None for a in decoded)
    exporter = Exporter(output_name, texture_lookup=catalog, asset_root=catalog.root)
    exporter.add(path, destination, tree=tree, clips_override=decoded)
    if exporter.missing_textures:
        raise ValueError(f"Missing effect textures: {filename}: {exporter.missing_textures}")
    exporter.doc["extensionsUsed"] = ["KHR_materials_unlit"]
    for material in exporter.doc["materials"]:
        if render_profile is not None:
            material['doubleSided'] = render_profile['cull'] == 'none'
            if render_profile['realColor']:
                material['extensions'] = {'KHR_materials_unlit': {}}
            if render_profile['blend']:
                material['alphaMode'] = 'BLEND'
                material.pop('alphaCutoff', None)
            material['extras'] = {'costumeRenderProfile': render_profile}
            continue
        material["extensions"] = {"KHR_materials_unlit": {}}
        material["alphaMode"] = "BLEND"; material.pop("alphaCutoff", None)
        material["extras"] = {"nativeBlendMode": "unverified", "displayBlend": "ordinary alpha blending, not additive"}
    for n in exporter.doc["nodes"]:
        n["name"] = n["name"].removeprefix(path.stem + "/")
    if exporter.render_meshes:
        summary = asset_metadata(exporter, destination, exporter.save(destination))
        glb = "effects/" + summary["file"]
    else:
        # A source attack-box asset is not visible geometry. Keep its actual
        # helper nodes and animation instead of inventing a visible effect.
        summary = {"meshes": 0, "nodes": [n["name"] for n in exporter.doc["nodes"]], "animations": []}
        glb = None
        for ext in (".glb", ".obj", ".mtl"):
            (destination / (output_name + ext)).unlink(missing_ok=True)
    write_json(destination / (output_name + ".animation.json"), decoded)
    pose_frames = [n for n, _ in walk(tree) if n.kind == "Frame"]
    pose_ids = {id(n): i for i, n in enumerate(pose_frames)}
    source_frames = {n.name: n for n in pose_frames}
    pose_clips, pose_failures = [], []
    for animation in decoded:
        tracks = []
        static_without_rate = False
        if animation["ticks_per_second"] is None and animation["maximum_tick"] not in (0, None):
            changing = any(any(values != channel["values"][0] for values in channel["values"])
                for track in animation["tracks"] for key, channel in track.items()
                if key in ("translation", "scale", "rotation", "native_matrices"))
            if changing:
                pose_failures.append({"clip": animation["name"], "reason": "missing tick rate for time-varying source"})
                continue
            static_without_rate = True
        for original_track in animation["tracks"]:
            track = copy.deepcopy(original_track)
            if track["warnings"]:
                pose_failures.append({"clip": animation["name"], "frame": track["frame_name"], "reason": track["warnings"]})
                continue
            if static_without_rate:
                for key in ("translation", "scale", "rotation"):
                    if key in track:
                        track[key]["times"] = [0]
                        track[key]["values"] = [track[key]["values"][0]]
                        track[key]["source"] = "all original keys identical; constant pose independent of unknown tick rate"
            if any(key not in track for key in ("translation", "scale", "rotation")):
                try:
                    position, scale, rotation = decompose_native_matrix(source_frames[track["frame_name"]].child("FrameTransformMatrix").nums())
                except ValueError as error:
                    pose_failures.append({"clip": animation["name"], "frame": track["frame_name"], "reason": str(error)})
                    continue
                for key, value in (("translation", position), ("scale", scale), ("rotation", rotation)):
                    if key not in track:
                        track[key] = {"times": [0], "values": [value], "source": "unchanged source bind channel"}
            tracks.append(track)
        pose_clips.append({"name": animation["name"], "ticks_per_second": animation["ticks_per_second"], "tracks": tracks,
            "durationSeconds": animation["duration_seconds"], "nativeD3dxKeys": animation.get("native_d3dx_keys", False),
            "nativePlaybackField": animation.get("nativePlaybackField"),
            "staticPoseWithoutTickRate": static_without_rate})
    pose_data = {"schemaVersion": 1, "coordinateConvention": "native DirectX axes; column matrices",
        "frames": [{"name": n.name, "parent": pose_ids[id(ancestry[-2])] if len(ancestry) > 1 else None,
            "nativeRowMatrix": n.child("FrameTransformMatrix").nums()}
            for n, ancestry in walk(tree) if n.kind == "Frame"],
        "helpers": helpers, "clips": pose_clips, "unsupportedTracks": pose_failures,
        "interpolation": "source tracks; original D3DX GetSRT normalized linear rotation; duplicate-name binding unverified",
        "observedClock": observed_clock}
    write_json(destination / (output_name + ".pose.json"), pose_data, True)
    return {"source": catalog.evidence(path)["rawPath"], "glb": glb,
        "asset": summary, "animations": [{"name": a["name"], "durationSeconds": a["duration_seconds"],
            "nativePlaybackField": a.get("nativePlaybackField"),
            "ticksPerSecond": a["ticks_per_second"], "warnings": a["warnings"],
            "trackWarnings": [{"frame": t["frame_name"], "warnings": t["warnings"]} for t in a["tracks"] if t["warnings"]]}
            for a in decoded], "nativeAnimation": "effects/" + output_name + ".animation.json",
        "poseData": "effects/" + output_name + ".pose.json", "unsupportedPoseTracks": pose_failures,
        "missingExplicitTickRate": missing_rates, "observedClock": observed_clock,
        "renamedDuplicateFrames": duplicates, "helpers": helpers,
        "status": "converted source geometry; gameplay transform/time and native blending require evidence"}


def selected_templates(catalog, effects):
    path = catalog.path("GameMajorXMeshPlayer.txt")
    # Template identifiers and declarations used here are ASCII. Latin1 keeps
    # byte positions lossless even if comments use a legacy code page.
    text = path.read_bytes().decode("latin1")
    requested = set(REQUIRED_TEMPLATES)
    mesh_names = {Path(effect["source"]).name.casefold() for effect in effects}
    records = []
    for match in re.finditer(r'TEMPLET\s+"([^"\r\n]+)"\s*\{([^{}]*)\}', text):
        name, body = match.group(1), match.group(2)
        mesh_match = re.search(r'MeshName\s*=\s*"([^"\r\n]+)"', body)
        if name not in requested and (not mesh_match or mesh_match.group(1).casefold() not in mesh_names or "raven" not in name.casefold()):
            continue
        fields = {}
        for line in body.splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                fields[" ".join(key.split())] = value.strip()
        records.append({"name": name, "meshName": mesh_match.group(1) if mesh_match else None,
            "source": catalog.evidence(path)["rawPath"], "sourceByteOffset": match.start(),
            "sourceLine": text.count("\n", 0, match.start()) + 1,
            "fieldsLiteral": fields, "definition": match.group(0)})
    if not requested.issubset({r["name"] for r in records}):
        raise ValueError("Required 2016 effect template was not found")
    return records


def parse_template_vector(literal):
    """Decode only an explicitly declared XYZ numeric literal, never a default."""
    if literal is None:
        return None
    number = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
    match = re.fullmatch(rf"XYZ\(\s*({number})\s*,\s*({number})\s*,\s*({number})\s*\)", literal)
    if not match:
        raise ValueError(f"Unsupported template XYZ literal: {literal}")
    values = [float(value) for value in match.groups()]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Non-finite template XYZ literal")
    return values


def effect_asset_index(catalog, templates, effects):
    """Link native mainEffect template IDs to their converted helper pose files.

    This is data lookup, not effect-set execution. A missing native initializer
    stays null; the runtime must resolve any default from independent evidence.
    """
    by_mesh = {Path(effect["source"]).name.casefold(): effect for effect in effects}
    result = {"schemaVersion": 1, "referenceVersion": "Steam-NA-2016-V6.0420.5",
        "clientMeasured": False, "evidenceLevel": "original-file-data",
        "coordinateConvention": "native DirectX left-handed Y up, original units; column matrices",
        "templates": {}, "limits": [
            "Missing initializers are null; no engine defaults are guessed.",
            "Template Size is distinct from effect-set Scale; compose both according to native transform evidence.",
            "Helper geometry and sphere candidates are not a verified native collision algorithm.",
            "Raven_WeaponDummy02 is not declared in the 2016 GameMajorXMeshPlayer.txt source."]}
    for template in templates:
        effect = by_mesh.get((template["meshName"] or "").casefold())
        if effect is None:
            continue
        fields = template["fieldsLiteral"]
        initial = {key: fields.get("Global Initial " + key) for key in ("Size", "AniName", "Velocity", "Color")}
        animation = None
        if initial["AniName"] is not None:
            match = re.fullmatch(r'"([^"\r\n]+)"\s*,\s*(XAP_\w+)', initial["AniName"])
            if not match:
                raise ValueError("Unsupported template animation literal: " + initial["AniName"])
            animation = {"name": match.group(1), "playback": match.group(2)}
        source = catalog.evidence(catalog.path("GameMajorXMeshPlayer.txt"))
        result["templates"][template["name"]] = {
            "meshName": template["meshName"], "poseData": effect["poseData"], "glb": effect["glb"],
            "helperNames": [helper["name"] for helper in effect["helpers"]],
            "source": {**source, "templateByteOffset": template["sourceByteOffset"], "templateLine": template["sourceLine"]},
            "meshSource": catalog.evidence(catalog.path(template["meshName"])),
            "initialSize": parse_template_vector(initial["Size"]),
            "initialAnimation": animation,
            "initialVelocity": parse_template_vector(initial["Velocity"]),
            "initialLiterals": initial,
            "drawCountLiteral": fields.get("DrawCount"), "lifeTimeLiteral": fields.get("LifeTime"),
            "unsupportedPoseTracks": effect["unsupportedPoseTracks"],
            "missingExplicitTickRate": effect["missingExplicitTickRate"]}
    if not set(REQUIRED_TEMPLATES).issubset(result["templates"]):
        raise ValueError("Required damage-effect template has no converted pose resource")
    return result


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--source-root", type=Path, default=Path("asset_work"))
    args.add_argument("--output", type=Path, default=Path("artifacts/rf"))
    args.add_argument("--report", type=Path, default=Path("reports/rf-assets-build.json"))
    args.add_argument("--runtime-profile", type=Path, help="Include every state animation required by this research profile")
    args.add_argument("--all-character-animations", action="store_true", help="Retain all original Raven motion clips in runtime; does not infer RF skill bindings")
    options = args.parse_args()
    destination = options.output.resolve()
    if destination.is_relative_to(options.source_root.resolve()):
        raise ValueError("Output must not modify the upstream input tree")
    destination.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(options.source_root)
    manifest = {"schemaVersion": 1, "converterVersion": VERSION, "id": "rf", "name": "Reckless Fist",
        "referenceVersion": "Steam-NA-2016-V6.0420.5", "evidenceLevel": "original-file-data",
        "clientMeasured": False, "axes": {"source": "DirectX left-handed Y up", "output": "glTF right-handed Y up",
            "conversion": "reflect Z, reverse triangle winding; preserve UV and original units", "unitsPerMetre": None},
        "costumeSelection": "exact 2016 RF promotion file names; item/UnitTemplet selection not yet cross-verified",
        "limits": ["Native 2016 renderer and client screenshots are not verified.",
            "Do not use animation duration as gameplay state or hit-window duration.",
            "Root keys are preserved; gameplay root-motion ownership remains explicit and unverified.",
            "Unlit/alpha rendering is a declared display adapter; native lighting/blend behavior needs evidence."]}
    manifest.update(build_character(catalog, destination, options.runtime_profile, options.all_character_animations))
    effects, failures = [], []
    for filename in EFFECTS:
        try:
            effects.append(build_effect(catalog, destination / "effects", filename))
        except (ValueError, OSError, IndexError) as error:
            failures.append({"source": filename, "status": "unsupported", "reason": str(error)})
    manifest["effects"] = effects; manifest["unsupportedEffects"] = failures
    manifest["effectTemplates"] = selected_templates(catalog, effects)
    write_json(destination / "effect-templates.json", manifest["effectTemplates"])
    effect_index = effect_asset_index(catalog, manifest["effectTemplates"], effects)
    write_json(destination / "effect-assets.json", effect_index)
    write_json(Path("contracts/rf-assets-effect-index.json"), effect_index)
    manifest["effectAssetIndex"] = "effect-assets.json"
    manifest["mechanismResources"] = {"awakening": {"characterClip": "BoostPower", "timeSemantics": "unverified"},
        "ravenNasodCore": {"glb": next((e["glb"] for e in effects if Path(e["source"]).name.casefold() == EFFECTS[0].casefold()), None),
            "sourceClipNames": ["Wait", "Guard", "Attack1", "Attack2", "Attack3", "Attack4", "Attack5"],
            "status": "original visual assets; charge/guard/attack state rules handled by combat evidence"}}
    manifest["sourceEvidence"] = sorted(catalog.used.values(), key=lambda r: r["rawPath"])
    manifest["converterSources"] = [{"file": p.relative_to(Path(__file__).parent).as_posix(), "sha256": digest(p.read_bytes())}
        for p in sorted(Path(__file__).parent.rglob("*.py")) if "__pycache__" not in p.parts]
    write_json(destination / "manifest.json", manifest)
    write_json(Path("contracts/rf-assets-motion-index.json"), {"schemaVersion": 1,
        "referenceVersion": manifest["referenceVersion"], "evidenceLevel": "original-file-data",
        "clientMeasured": False, "characterGlb": manifest["glb"], "nasodGlb": manifest["mechanismResources"]["ravenNasodCore"]["glb"],
        "coordinates": manifest["axes"], "runtimeGlb": manifest["runtimeGlb"],
        "runtimeClipNames": manifest["runtimeCharacter"]["selection"]["included"],
        "rootBindPositionGltf": manifest["rootBindPositionGltf"],
        "clips": [{k: v for k, v in record.items() if k != "rootMotion"} for record in manifest["clips"]],
        "duplicateClips": manifest["duplicateClips"], "nativeMotionSources": [catalog.evidence(catalog.path(name)) for name in MOTIONS]})
    outputs = [{"file": p.relative_to(destination).as_posix(), "sha256": digest(p.read_bytes()), "bytes": p.stat().st_size}
        for p in sorted(destination.rglob("*")) if p.is_file() and p != destination / "outputs.json"]
    write_json(destination / "outputs.json", outputs)
    report = {"schemaVersion": 1, "converterVersion": VERSION, "outputDirectory": str(destination),
        "referenceVersion": manifest["referenceVersion"], "clientMeasured": False,
        "summary": {"clips": len(manifest["clips"]), "duplicateClips": len(manifest["duplicateClips"]),
            "meshes": manifest["character"]["meshes"], "skins": manifest["character"]["skins"],
            "sourceFiles": len(manifest["sourceEvidence"]), "effects": len(effects), "unsupportedEffects": len(failures)},
        "sourceEvidence": manifest["sourceEvidence"], "converterSources": manifest["converterSources"],
        "outputs": outputs, "unsupportedEffects": failures, "limits": manifest["limits"]}
    write_json(options.report, report)
    print(json.dumps(report["summary"]))


if __name__ == "__main__":
    main()
