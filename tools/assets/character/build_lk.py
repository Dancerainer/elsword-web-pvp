"""Convert source-checked target2016 LK promotion parts and original motion files.

The conversion uses the tested DirectX/KSM/GLB primitives from build_rf; the
character selection is independent and no RF motion or body is substituted.
"""
from __future__ import annotations
import argparse
import copy
import gzip
import json
import re
from pathlib import Path
import numpy as np
from build_rf import (Catalog, helpers_from_tree, walk, load_x, asset_metadata,
    supplemental_motion_binding, digest, json_bytes, write_json, profile_display_path)
from export_ksm_sample import clips, node, to_tree
from export_samples import C, Exporter, matrix, render
from ksm_convert import parse_ksm
VERSION = "lk-assets-target2016-v1"
MOTIONS = ("Motion_Elsword.x", "Motion_Elsword_Common.x", "Motion_Elsword_SK.x", "Motion_Elsword_LK.x")
SUPPLEMENTAL_MOTIONS = {}
BODY = ("Mesh_Elsword_ELK_Base_Hair_Sorted.X", "Mesh_Elsword_ELK_Basic_Face_Sorted.X",
    "Mesh_Elsword_ELK_CASH_Upbody_Sorted.X", "Mesh_Elsword_ELK_CASH_Lowbody_Sorted.X",
    "Mesh_Elsword_ELK_CASH_Hand_Sorted.X", "Mesh_Elsword_ELK_CASH_Foot_Sorted.X")
WEAPON = "Mesh_Elsword_ELK_Cash_Weapon_Sorted.X"
def build_character(catalog, destination, runtime_profile=None, all_character_animations=False, spec=None):
    # Elsword professions share a converter, never a guessed animation binding.
    spec = spec or {}
    motions, body = spec.get('motions', MOTIONS), spec.get('body', BODY)
    weapon_name = spec.get('weapon', WEAPON)
    supplemental_motions = spec.get('supplementalMotions', SUPPLEMENTAL_MOTIONS)
    asset_id = spec.get('id', 'lk')
    primary = catalog.path(motions[0]); base = parse_ksm(primary)
    skeleton = to_tree(base)
    original_helpers = helpers_from_tree(skeleton, catalog.evidence(primary)["rawPath"])
    # Geometry inside Motion_* is helper geometry. Body comes from the LK parts.
    for frame, _ in walk(skeleton):
        frame.children = [child for child in frame.children if child.kind != "Mesh"]
    frames = {n.name: n for n, _ in walk(skeleton) if n.kind == "Frame"}
    attachments = []
    for filename in body:
        path = catalog.path(filename); tree = load_x(path)
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
            raise ValueError(f"No skinned LK body geometry in {filename}")
        attachments.append({"source": catalog.evidence(path)["rawPath"], "meshes": attached, "type": "skinned"})
    weapon = catalog.path(weapon_name); tree = load_x(weapon)
    mount = copy.deepcopy(next(n for n, _ in walk(tree) if n.kind == "Frame" and n.name == "Dummy1_Rhand"))
    mount.name = asset_id.upper()+"_SwordMount"
    frames["Dummy1_Rhand"].children.append(mount)
    # Weapon trace helpers are original frames below the mounted sword and can
    # be explicit effect-owner bones. Include them in coverage/runtime ancestry.
    frames.update({n.name: n for n, _ in walk(mount) if n.kind == 'Frame'})
    original_helpers.extend(helpers_from_tree(mount, catalog.evidence(weapon)["rawPath"]))
    attachments.append({"source": catalog.evidence(weapon)["rawPath"], "type": "rigid",
        "parent": "Dummy1_Rhand", "node": mount.name,
        "nativeRowMatrix": mount.child("FrameTransformMatrix").nums()})
    all_clips, records, native_documents, duplicate_clips = [], [], [], []
    hashes = {}
    hierarchy = [(f["name"], f["parent"]) for f in base["frames"]]
    bind_differences = []
    motion_sources = list(motions)
    for filename in motion_sources:
        path = catalog.path(filename); decoded = base if path == primary else parse_ksm(path)
        supplemental = supplemental_motions.get(filename)
        if supplemental:
            if catalog.evidence(path)['sha256'] != supplemental['sha256']:
                raise ValueError('Supplemental motion source hash mismatch: ' + filename)
            bind_differences.append({'source': filename, **supplemental_motion_binding(decoded, base, supplemental['clips'])})
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
        raise ValueError("Missing LK textures: " + str(exporter.missing_textures))
    # Use an explicit display approximation, preserving original diffuse factors.
    exporter.doc["extensionsUsed"] = ["KHR_materials_unlit"]
    for material in exporter.doc["materials"]:
        material["extensions"] = {"KHR_materials_unlit": {}}
        material["extras"] = {"nativeLighting": "unverified", "alphaDecision": "pixel alpha; MASK cutoff .4 display adapter"}
    for n in exporter.doc["nodes"]:
        n["name"] = n["name"].removeprefix(primary.stem + "/").replace("/render", "_render")
    exporter.sources = [catalog.evidence(catalog.path(filename))["rawPath"] for filename in tuple(motion_sources) + tuple(body) + (weapon_name,)]
    summary = asset_metadata(exporter, destination, exporter.save(destination))
    runtime_names = {"Wait", "Walk", "BoostPower", "RespawnLanding"}
    profile_coverage = None
    effect_bones = set()
    if runtime_profile is not None:
        profile_bytes = runtime_profile.read_bytes(); profile = json.loads(profile_bytes)
        states = {name: state["animationName"] for name, state in profile["states"].items()}
        missing = sorted(set(states.values()) - {clip["name"] for clip in all_clips})
        if missing:
            raise ValueError("LK profile requires animations absent from original motion files: " + str(missing))
        runtime_names.update(states.values())
        effect_bones = {entry['BONE_NAME'] for declaration in profile.get('effectSets', {}).values()
            for key, entry in declaration['raw'].items()
            if re.fullmatch(r'EFFECT\d+', key) and isinstance(entry, dict) and entry.get('BONE_NAME')}
        missing_bones = sorted(effect_bones - set(frames))
        # Sandstorm's original set traces bones on a generated effect mesh.
        # Keep these names separate; finalize_lk_assets proves their resource
        # hierarchy coverage without inventing actor bones or a binding.
        effect_bones.intersection_update(frames)
        profile_coverage = {"path": profile_display_path(runtime_profile), "sha256": digest(profile_bytes),
            "profileId": profile.get("profileId"), "stateAnimations": states, "effectOwnerBones": sorted(effect_bones),
            "effectMeshBoneNames": missing_bones,
            "purpose": "runtime resource coverage only; no gameplay values/timing are derived from this selection"}
    runtime_prefixes = ("Jump", "Dash", "Combo", "Damage", "Guard", "StandUp", "LK_", "Knight_")
    runtime_clips = [clip for clip in all_clips if all_character_animations or clip["name"] in runtime_names or clip["name"].startswith(runtime_prefixes)]
    shared_runtime = spec.get('sharedRuntimeClips', {})
    required_runtime = spec.get('runtimeClips')
    if required_runtime is not None:
        absent = set(required_runtime)-{c['name'] for c in all_clips}
        if absent: raise ValueError('Requested Elsword runtime clips missing: '+str(sorted(absent)))
        runtime_clips = [c for c in runtime_clips if c['name'] in required_runtime]
    shared_names = [c['name'] for c in runtime_clips if shared_runtime.get(c['name']) == hashes.get(c['name'])]
    runtime_clips = [c for c in runtime_clips if c['name'] not in shared_names]
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
    if shared_names: runtime_summary['sharedAnimationNames'] = shared_names
    runtime_summary["selection"] = {"included": [clip["name"] for clip in runtime_clips],
        "excluded": [clip["name"] for clip in all_clips if clip not in runtime_clips],
        "purpose": "all original Elsword motion clips retained for "+asset_id.upper()+" skill resource coverage; state bindings remain separate" if all_character_animations else "M3 "+asset_id.upper()+" locomotion/combo/reaction/awakening and profile-required skills; full "+asset_id+".glb retained",
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,default=Path('asset_work'))
    parser.add_argument('--output',type=Path,default=Path('artifacts/lk'))
    parser.add_argument('--runtime-profile',type=Path)
    parser.add_argument('--report',type=Path,default=Path('reports/lk-assets-build.json'))
    opts=parser.parse_args();dest=opts.output.resolve()
    if dest.is_relative_to(opts.source_root.resolve()):raise ValueError('Output must stay outside upstream inputs')
    dest.mkdir(parents=True,exist_ok=True);catalog=Catalog(opts.source_root)
    manifest={'schemaVersion':1,'converterVersion':VERSION,'id':'lk','name':'Lord Knight',
        'referenceVersion':'Steam-NA-2016-V6.0420.5','evidenceLevel':'original-file-data',
        'clientMeasured':False,'axes':{'source':'DirectX left-handed Y up','output':'glTF right-handed Y up',
            'conversion':'reflect Z and reverse triangle winding; original units and UV preserved'},
        'costumeSelection':'exact target2016 ELK promotion filenames; item/UnitTemplet costume selection not yet verified',
        'limits':['Target2016 runtime traces and native GPU screenshots unavailable.',
            'Animation duration is not a gameplay state duration or hit-window measurement.',
            'Unlit rendering and alpha MASK remain explicitly declared display adapters.']}
    manifest.update(build_character(catalog,dest,opts.runtime_profile,True))
    manifest.update(effects=[],unsupportedEffects=[],effectTemplates=[],effectAssetIndex='effect-assets.json',
        mechanismResources={'awakening':{'characterClip':'BoostPower','timeSemantics':'target declaration plus simulation executor'},
            'wayOfSword':{'status':'target fields retained; no guessed destruction/vitality consumer'}})
    manifest['sourceEvidence']=sorted(catalog.used.values(),key=lambda r:r['rawPath'])
    write_json(dest/'effect-assets.json',{'schemaVersion':1,'templates':{}})
    write_json(dest/'manifest.json',manifest)
    write_json(Path('contracts/lk-assets-motion-index.json'),{'schemaVersion':1,'clientMeasured':False,
        'referenceVersion':manifest['referenceVersion'],'characterGlb':manifest['glb'],'runtimeGlb':manifest['runtimeGlb'],
        'rootBindPositionGltf':manifest['rootBindPositionGltf'],
        'runtimeClipNames':manifest['runtimeCharacter']['selection']['included'],
        'clips':[{k:v for k,v in c.items() if k!='rootMotion'} for c in manifest['clips']],
        'sources':manifest['sourceEvidence']})
    outputs=[{'file':p.relative_to(dest).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p.read_bytes())}
        for p in sorted(dest.rglob('*')) if p.is_file() and p.name!='outputs.json']
    write_json(dest/'outputs.json',outputs)
    report={'schemaVersion':1,'outputDirectory':str(dest),'clientMeasured':False,'sourceEvidence':manifest['sourceEvidence'],
        'converterVersion':VERSION,'outputs':outputs,'summary':{'clips':len(manifest['clips']),
        'meshes':manifest['character']['meshes'],'skins':manifest['character']['skins'],'sources':len(manifest['sourceEvidence'])}}
    write_json(opts.report,report);print(json.dumps(report['summary']))
if __name__=='__main__':main()
