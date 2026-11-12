"""Decode standard DirectX XNode animation without Blender dependencies.

Returned TRS uses column-vector local transforms in the SOURCE axes. No axis,
unit, or handedness conversion is performed. X type-0 quaternion keys store
WXYZ in the file's row-matrix convention; rotation.values stores the equivalent
column-matrix quaternion XYZW (the conjugate), ready for a caller's basis change.
Missing channels remain missing and must retain their static Frame transform.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path

import numpy as np


def walk(root):
    yield root
    for child in root.children:
        yield from walk(child)


def read_key_block(node):
    """Return (type, [(tick, native values)], errors); never fabricate keys."""
    nums = node.nums()
    if len(nums) < 2:
        return None, [], ["AnimationKey missing type/count"]
    kind, count, cursor = int(nums[0]), int(nums[1]), 2
    frames, errors = [], []
    for index in range(count):
        if cursor + 2 > len(nums):
            errors.append(f"truncated key header at key {index}/{count}")
            break
        tick, width = float(nums[cursor]), int(nums[cursor + 1])
        cursor += 2
        if width < 0 or cursor + width > len(nums):
            errors.append(f"invalid/truncated key values at key {index}/{count}")
            break
        values = [float(value) for value in nums[cursor:cursor + width]]
        cursor += width
        if not math.isfinite(tick) or not all(math.isfinite(value) for value in values):
            errors.append(f"nonfinite key {index}/{count} omitted")
            continue
        frames.append((tick, values))
    if cursor != len(nums):
        errors.append(f"{len(nums)-cursor} numeric values remained after declared keys")
    return kind, frames, errors


def quaternion_xyzw_from_matrix(rotation):
    """Quaternion from a proper orthonormal 3x3 COLUMN rotation matrix."""
    r = np.asarray(rotation, dtype=float)
    trace = float(np.trace(r))
    if trace > 0:
        factor = math.sqrt(trace + 1.0) * 2.0
        q = [(r[2, 1]-r[1, 2])/factor, (r[0, 2]-r[2, 0])/factor,
             (r[1, 0]-r[0, 1])/factor, factor/4.0]
    else:
        axis = int(np.argmax(np.diag(r)))
        if axis == 0:
            factor = math.sqrt(max(0.0, 1+r[0, 0]-r[1, 1]-r[2, 2])) * 2
            q = [factor/4, (r[0, 1]+r[1, 0])/factor,
                 (r[0, 2]+r[2, 0])/factor, (r[2, 1]-r[1, 2])/factor]
        elif axis == 1:
            factor = math.sqrt(max(0.0, 1+r[1, 1]-r[0, 0]-r[2, 2])) * 2
            q = [(r[0, 1]+r[1, 0])/factor, factor/4,
                 (r[1, 2]+r[2, 1])/factor, (r[0, 2]-r[2, 0])/factor]
        else:
            factor = math.sqrt(max(0.0, 1+r[2, 2]-r[0, 0]-r[1, 1])) * 2
            q = [(r[0, 2]+r[2, 0])/factor, (r[1, 2]+r[2, 1])/factor,
                 factor/4, (r[1, 0]-r[0, 1])/factor]
    q = np.asarray(q, dtype=float)
    return (q / np.linalg.norm(q)).tolist()


def decompose_native_matrix(values, tolerance=1e-4):
    """Decompose a native X ROW matrix. Reject shear/perspective/singular data.

    Reflection is represented by one signed scale axis, chosen deterministically
    as the largest-magnitude axis. The matrix is transposed to column form before
    decomposition; this is a storage/convention operation, not handedness change.
    """
    if len(values) != 16:
        raise ValueError(f"matrix key has {len(values)} values instead of 16")
    matrix = np.asarray(values, dtype=float).reshape((4, 4)).T
    if not np.isfinite(matrix).all():
        raise ValueError("matrix contains nonfinite values")
    if not np.allclose(matrix[3], [0, 0, 0, 1], atol=tolerance, rtol=0):
        raise ValueError("perspective/non-affine matrix cannot be represented as TRS")
    linear = matrix[:3, :3]
    scale = np.linalg.norm(linear, axis=0)
    if np.min(scale) <= 1e-10:
        raise ValueError("singular/zero-scale matrix decomposition unhandled")
    rotation = linear / scale
    if np.linalg.det(rotation) < 0:
        axis = int(np.argmax(scale))
        scale[axis] = -scale[axis]
        rotation[:, axis] = -rotation[:, axis]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=tolerance, rtol=0):
        raise ValueError("shear matrix decomposition unhandled")
    return (matrix[:3, 3].tolist(), scale.tolist(), quaternion_xyzw_from_matrix(rotation))


def _channel(frames, ticks_per_second, source_key_type, rotation=False):
    by_tick = {tick: list(values) for tick, values in frames}
    ticks = sorted(by_tick)
    values = [by_tick[tick] for tick in ticks]
    if rotation:
        # q and -q are identical rotations; make adjacent signs continuous.
        for index in range(1, len(values)):
            if sum(a*b for a, b in zip(values[index-1], values[index])) < 0:
                values[index] = [-component for component in values[index]]
    return {
        "ticks": ticks,
        "times": [tick / ticks_per_second for tick in ticks] if ticks_per_second else ticks,
        "time_unit": "seconds" if ticks_per_second else "ticks",
        "values": values, "source_key_type": source_key_type,
    }


def decode_animations(root, *, default_ticks_per_second=None, include_native_matrices=False):
    """Return list of {name, ticks_per_second, tracks, warnings}.

    tracks have frame_name and optional translation/scale/rotation channel dicts
    with independent key times and values. Type 3/4 matrix keys override separate
    TRS keys on that frame, matching Assimp's X importer. A matrix channel with ANY
    unrepresentable key is retained as native_matrices and reported as unhandled;
    no incomplete substitute TRS is emitted. Absent AnimTicksPerSecond never gets
    an implicit guessed FPS. Pass an explicit default if the caller has evidence.
    """
    nodes = list(walk(root))
    ticks_per_second = None
    for node in nodes:
        if node.kind == "AnimTicksPerSecond" and node.nums():
            rate = float(node.nums()[0])
            if math.isfinite(rate) and rate > 0:
                ticks_per_second = rate
                break
    rate_source = "AnimTicksPerSecond" if ticks_per_second else "missing"
    if ticks_per_second is None and default_ticks_per_second is not None:
        ticks_per_second = float(default_ticks_per_second)
        if not math.isfinite(ticks_per_second) or ticks_per_second <= 0:
            raise ValueError("default_ticks_per_second must be finite and positive")
        rate_source = "caller_supplied_default"
    results = []
    for aset in (node for node in nodes if node.kind == "AnimationSet"):
        clip = {"name": aset.name, "ticks_per_second": ticks_per_second,
                "ticks_per_second_source": rate_source, "tracks": [], "warnings": [],
                "rotation_order": "xyzw", "source_quaternion_order": "wxyz",
                "coordinate_convention": "source_axes_column_vector_local_transform"}
        if ticks_per_second is None:
            clip["warnings"].append("Missing explicit tick rate; channel times remain in ticks")
        all_ticks = []
        for anim in aset.children_of("Animation"):
            ref = anim.child("REF")
            frame_name = next((str(v) for token, v in ref.values if token in ("WORD", "STR")), None) if ref else None
            if not frame_name:
                clip["warnings"].append("Animation without a frame reference omitted")
                continue
            track = {"frame_name": frame_name, "warnings": []}
            blocks = {}
            for key_node in anim.children_of("AnimationKey"):
                kind, frames, errors = read_key_block(key_node)
                track["warnings"].extend(errors)
                if kind in blocks:
                    track["warnings"].append(f"multiple type {kind} key blocks merged by tick; last key wins")
                blocks.setdefault(kind, []).extend(frames)
            matrix_type = 4 if 4 in blocks else 3 if 3 in blocks else None
            if matrix_type is not None:
                matrix_frames = blocks[matrix_type]
                decoded = {"translation": [], "scale": [], "rotation": []}
                matrix_errors = []
                for tick, values in matrix_frames:
                    try:
                        translation, scale, rotation = decompose_native_matrix(values)
                        decoded["translation"].append((tick, translation))
                        decoded["scale"].append((tick, scale))
                        decoded["rotation"].append((tick, rotation))
                    except ValueError as exc:
                        matrix_errors.append({"tick": tick, "reason": str(exc)})
                if matrix_errors:
                    track["matrix_decomposition_status"] = "unhandled"
                    track["matrix_decomposition_errors"] = matrix_errors
                    track["warnings"].append(f"{len(matrix_errors)} matrix key(s) cannot be represented as TRS")
                else:
                    track["matrix_decomposition_status"] = "decoded"
                    for name, frames in decoded.items():
                        if frames:
                            track[name] = _channel(frames, ticks_per_second, matrix_type, name == "rotation")
                if include_native_matrices or matrix_errors:
                    track["native_matrices"] = _channel(matrix_frames, ticks_per_second, matrix_type)
                    track["native_matrices"]["matrix_convention"] = "row_major_row_vector"
                all_ticks.extend(tick for tick, _ in matrix_frames)
            else:
                for kind, name, width in ((0, "rotation", 4), (1, "scale", 3), (2, "translation", 3)):
                    frames = []
                    for tick, values in blocks.get(kind, []):
                        if len(values) != width:
                            track["warnings"].append(f"type {kind} key at tick {tick} has width {len(values)}; omitted")
                            continue
                        if kind == 0:
                            w, x, y, z = values
                            norm = math.sqrt(w*w+x*x+y*y+z*z)
                            if norm <= 1e-12:
                                track["warnings"].append(f"zero quaternion at tick {tick} omitted")
                                continue
                            # Same column-local convention as transposed matrix keys.
                            values = [-x/norm, -y/norm, -z/norm, w/norm]
                        frames.append((tick, values))
                    if frames:
                        track[name] = _channel(frames, ticks_per_second, kind, name == "rotation")
                        all_ticks.extend(tick for tick, _ in frames)
                for unknown in set(blocks) - {0, 1, 2}:
                    track["warnings"].append(f"unsupported key type {unknown}")
            if any(name in track for name in ("translation", "scale", "rotation", "native_matrices")):
                clip["tracks"].append(track)
            else:
                clip["warnings"].append(f"{frame_name}: no decodable channel")
        clip["minimum_tick"] = min(all_ticks) if all_ticks else None
        clip["maximum_tick"] = max(all_ticks) if all_ticks else None
        clip["duration_seconds"] = ((clip["maximum_tick"]-clip["minimum_tick"])/ticks_per_second
                                    if all_ticks and ticks_per_second else None)
        results.append(clip)
    return results


def main():
    arguments = argparse.ArgumentParser()
    work = Path(__file__).resolve().parents[1]
    arguments.add_argument("source", nargs="?", type=Path, default=work / "raw" / "data001" / "ElswordBasicEff.x")
    arguments.add_argument("--output", type=Path, default=work / "elsword_animation_sample.json")
    args = arguments.parse_args()
    from inspect_directx import load_parser
    parser, _ = load_parser(work)
    decoded = decode_animations(parser.parse_x_file(str(args.source)))
    summaries = [{"name": clip["name"], "tracks": len(clip["tracks"]),
                  "minimum_tick": clip["minimum_tick"], "maximum_tick": clip["maximum_tick"],
                  "ticks_per_second": clip["ticks_per_second"], "duration_seconds": clip["duration_seconds"],
                  "key_counts": dict(Counter({name: sum(len(track[name]["times"]) for track in clip["tracks"] if name in track)
                                              for name in ("translation", "scale", "rotation")})),
                  "warnings": clip["warnings"]} for clip in decoded]
    sample_tracks = []
    for track in decoded[0]["tracks"][:3] if decoded else []:
        sample = dict(track)
        for name in ("translation", "scale", "rotation"):
            if name in sample:
                sample[name] = {**sample[name], "sample_truncated_to_first_4_keys": len(sample[name]["times"]) > 4,
                                "ticks": sample[name]["ticks"][:4], "times": sample[name]["times"][:4],
                                "values": sample[name]["values"][:4]}
        sample_tracks.append(sample)
    sample = {"source": str(args.source.resolve()), "summaries": summaries,
              "coordinate_convention": "source_axes_column_vector_local_transform",
              "rotation_order": "xyzw", "type_0_source_order": "wxyz",
              "type_0_conversion": "conjugate and reorder; axis/handedness conversion remains caller's responsibility",
              "sample_clip": decoded[0]["name"] if decoded else None, "sample_tracks": sample_tracks}
    args.output.write_text(json.dumps(sample, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(summaries, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
