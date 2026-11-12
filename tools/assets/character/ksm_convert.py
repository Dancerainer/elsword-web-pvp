"""Read the KSM 0x200 / KAC 0x100 variant tested against the 2016 RF files.

This is a bounded, read-only binary decoder derived from the local samples.
It deliberately does not load game code. The source files are never changed.
Coordinates and sparse animation values are kept in their original convention.
"""
from __future__ import annotations

import argparse
import collections
import gzip
import json
import math
import re
import struct
from pathlib import Path


class FormatError(ValueError):
    pass


class Reader:
    def __init__(self, data):
        self.data = data

    def unpack(self, fmt, offset):
        size = struct.calcsize(fmt)
        if offset < 0 or offset + size > len(self.data):
            raise FormatError(f"Out-of-bounds read at {offset} of {size} bytes")
        return struct.unpack_from(fmt, self.data, offset)

    def string(self, offset):
        size, = self.unpack('<I', offset)
        if size > 65536 or offset + 4 + size > len(self.data):
            raise FormatError(f"Invalid string at {offset}")
        return self.data[offset+4:offset+4+size].decode('utf-8', errors='replace')


def parse_kac(data, frame_count):
    r = Reader(data)
    magic, version, count = r.unpack('<4sII', 0)
    if magic != b'KAC ' or version != 0x100:
        raise FormatError(f"Unsupported KAC version {version:#x}")
    if count > 4096 or 12 + 4 * count > len(data):
        raise FormatError('Invalid KAC clip count')
    offsets = r.unpack('<' + 'I' * count, 12)
    clips = []
    for clip_offset in offsets:
        name_ptr, reserved, tps, playback, track_count = r.unpack('<IIdII', clip_offset)
        if not math.isfinite(tps) or tps <= 0 or track_count > frame_count:
            raise FormatError('Invalid KAC track count or time scale')
        sizes = r.unpack('<' + 'I' * track_count, clip_offset + 24)
        cursor = clip_offset + 24 + 4 * track_count
        tracks = []
        duration_ticks = 0.0
        for size in sizes:
            bone, key_count = r.unpack('<II', cursor)
            if size < 8 or cursor + size > len(data) or bone >= frame_count or key_count > (size - 8) // 5:
                raise FormatError('Invalid animation frame index/key count')
            metas = [r.unpack('<fB', cursor+8+i*5) for i in range(key_count)]
            value_cursor = cursor + 8 + 5 * key_count
            keys = []
            previous_time = -math.inf
            for ticks, mask in metas:
                if not math.isfinite(ticks) or ticks < previous_time or mask & 0x80:
                    raise FormatError('Unsupported key mask/time')
                previous_time = ticks
                count_values = (mask & 0x3f).bit_count() + (4 if mask & 0x40 else 0)
                values = iter(r.unpack('<' + 'f' * count_values, value_cursor))
                value_cursor += count_values * 4
                scale = [next(values) if mask & (1 << i) else None for i in range(3)]
                translation = [next(values) if mask & (1 << (i+3)) else None for i in range(3)]
                rotation = [next(values) for _ in range(4)] if mask & 0x40 else None
                all_values = [v for v in scale+translation+(rotation or []) if v is not None]
                if not all(math.isfinite(v) for v in all_values):
                    raise FormatError('Non-finite animation value')
                keys.append({'time_ticks':ticks, 'change_mask':mask,
                             'scale':scale, 'translation':translation, 'rotation':rotation})
                duration_ticks = max(duration_ticks, ticks)
            if value_cursor != cursor + size:
                raise FormatError(f'Animation track has {cursor+size-value_cursor} unparsed bytes')
            tracks.append({'frame':bone, 'keys':keys})
            cursor += size
        if cursor != name_ptr:
            raise FormatError(f'Clip data does not end at its name: {cursor} != {name_ptr}')
        clips.append({'name':r.string(name_ptr), 'ticks_per_second':tps,
                      'duration_ticks':duration_ticks, 'duration_seconds':duration_ticks/tps,
                      'reserved':reserved, 'playback_field':playback, 'tracks':tracks})
    return clips


def expanded_track(track, ticks_per_second):
    """Expand carry-forward sparse keys into ordinary scale/position/XY ZW keys.

    The stream starts with identity SRT. Every set bit replaces a component.
    This matches local bind matrices and unit quaternion norms in the samples.
    """
    scale, translation, rotation = [1.,1.,1.], [0.,0.,0.], [0.,0.,0.,1.]
    result = []
    for key in track['keys']:
        for i in range(3):
            if key['scale'][i] is not None: scale[i] = key['scale'][i]
            if key['translation'][i] is not None: translation[i] = key['translation'][i]
        if key['rotation'] is not None: rotation = key['rotation'][:]
        result.append({'time':key['time_ticks']/ticks_per_second,
                       'scale':scale[:], 'translation':translation[:], 'rotation':rotation[:]})
    return result


def parse_ksm(path):
    path = Path(path)
    data = path.read_bytes()
    r = Reader(data)
    magic, version, animation_offset = r.unpack('<4sII', 0)
    if magic != b'KSM ' or version != 0x200:
        raise FormatError(f'Unsupported KSM version {version:#x}')
    count, = r.unpack('<I', 28)
    if count > 4096 or 32 + 84 * count > len(data) or animation_offset > len(data):
        raise FormatError('Invalid frame count/animation offset')
    frames, meshes = [], []
    for i in range(count):
        frame_offset = 32 + 84 * i
        name_ptr, = r.unpack('<I', frame_offset)
        matrix = list(r.unpack('<16f', frame_offset + 4))
        if not all(math.isfinite(value) for value in matrix):
            raise FormatError('Non-finite frame matrix')
        reserved, mesh_ptr, sibling, child = r.unpack('<IIii', frame_offset + 68)
        bounding_radius, = r.unpack('<f', frame_offset + 68)
        if not math.isfinite(bounding_radius) or bounding_radius < 0:
            raise FormatError('Invalid stored frame bounding radius')
        if sibling < -1 or sibling >= count or child < -1 or child >= count:
            raise FormatError('Invalid frame hierarchy')
        original_name = r.string(name_ptr) if name_ptr else None
        frame = {'index':i, 'name':original_name or f'KSM_UnnamedFrame_{i}', 'source_name':original_name, 'matrix':matrix,
                 'reserved_raw_uint':reserved, 'bounding_radius':bounding_radius,
                 'sibling':sibling, 'child':child, 'parent':None,
                 'mesh_index':None}
        frames.append(frame)
        if not mesh_ptr: continue
        h = r.unpack('<15I', mesh_ptr)
        extra_ptr, fvf, extra, mat_count, mat_ptr, nv, vertex_ptr, nt, index_ptr, attr_ptr, nb, bone_ptr, skin_field, reserved2, extra_value = h
        if nv > len(data) // 24 or nt > len(data) // 6 or mat_count > len(data) // 72 or nb > count:
            raise FormatError('Invalid mesh array count')
        stride = 32 if fvf == 0x112 else 24 if fvf == 0x12 else None
        if stride is None or index_ptr - vertex_ptr != nv * stride:
            raise FormatError(f'Unsupported vertex layout {fvf:#x}')
        positions, normals, uv = [], [], []
        for j in range(nv):
            v = r.unpack('<' + 'f' * (stride//4), vertex_ptr + j * stride)
            if not all(math.isfinite(x) for x in v): raise FormatError('Non-finite vertex')
            positions.append(list(v[:3])); normals.append(list(v[3:6]))
            if stride == 32: uv.append(list(v[6:8]))
        triangles = [list(r.unpack('<3H', index_ptr + j*6)) for j in range(nt)]
        if any(v >= nv for tri in triangles for v in tri): raise FormatError('Invalid mesh index')
        attributes = list(r.unpack('<' + 'I' * nt, attr_ptr))
        if any(v >= mat_count for v in attributes): raise FormatError('Invalid material index')
        materials = []
        for j in range(mat_count):
            values = list(r.unpack('<17f', mat_ptr + j*72))
            if not all(math.isfinite(v) for v in values):
                raise FormatError('Non-finite material value')
            texture_ptr, = r.unpack('<I', mat_ptr + j*72 + 68)
            materials.append({'diffuse':values[:4], 'ambient':values[4:8],
                              'specular':values[8:12], 'emissive':values[12:16],
                              'power':values[16], 'texture':r.string(texture_ptr) if texture_ptr else None})
        skin = []
        for j in range(nb):
            offset_matrix = list(r.unpack('<16f', bone_ptr + j*76))
            frame_index, nw, weight_ptr = r.unpack('<III', bone_ptr + j*76 + 64)
            if nw > nv or not all(math.isfinite(v) for v in offset_matrix):
                raise FormatError('Invalid skin weight count/offset matrix')
            indices = list(r.unpack('<' + 'I' * nw, weight_ptr))
            weights = list(r.unpack('<' + 'f' * nw, weight_ptr + nw*4))
            if frame_index >= count or any(v >= nv for v in indices): raise FormatError('Invalid skin index')
            if any(not math.isfinite(w) or w < 0 or w > 1.00001 for w in weights): raise FormatError('Invalid skin weight')
            skin.append({'frame':frame_index, 'offset_matrix':offset_matrix,
                         'vertex_indices':indices, 'weights':weights})
        frame['mesh_index'] = len(meshes)
        meshes.append({'name':frame['name'], 'frame':i, 'fvf':fvf, 'positions':positions,
                       'normals':normals, 'texcoords':uv, 'triangles':triangles,
                       'material_indices':attributes, 'materials':materials, 'skin_weights':skin,
                       'header_raw':list(h)})
    visited = set()
    pending = [(0, None)] if count else []
    while pending:
        current, parent = pending.pop()
        if current == -1:
            continue
        if current in visited:
            raise FormatError('Cyclic/repeated frame hierarchy')
        visited.add(current); frames[current]['parent'] = parent
        pending.append((frames[current]['sibling'], parent))
        pending.append((frames[current]['child'], current))
    if animation_offset < 32 + 84 * count:
        raise FormatError('KAC offset overlaps frame table')
    if data[animation_offset:] and data[animation_offset:animation_offset+4] != b'KAC ':
        raise FormatError('Unsupported animation payload')
    animations = parse_kac(data[animation_offset:], count) if data[animation_offset:animation_offset+4] == b'KAC ' else []
    return {'source':str(path), 'ksm_version':version, 'animation_offset':animation_offset,
            'bounds_raw':list(r.unpack('<4f', 12)), 'frames':frames, 'meshes':meshes,
            'animations':animations, 'unreachable_frames':sorted(set(range(count))-visited)}


def summary(decoded):
    return {'source':decoded['source'], 'ksm_version':decoded['ksm_version'],
            'frame_count':len(decoded['frames']), 'mesh_count':len(decoded['meshes']),
            'vertices':sum(len(m['positions']) for m in decoded['meshes']),
            'triangles':sum(len(m['triangles']) for m in decoded['meshes']),
            'skin_bones':sum(len(m['skin_weights']) for m in decoded['meshes']),
            'frames':[{'index':f['index'], 'name':f['name'], 'parent':f['parent']} for f in decoded['frames']],
            'textures':sorted({m['texture'] for mesh in decoded['meshes'] for m in mesh['materials'] if m['texture']}),
            'animations':[{'name':a['name'], 'duration_seconds':a['duration_seconds'],
                           'tracks':len(a['tracks']), 'keys':sum(len(t['keys']) for t in a['tracks'])}
                          for a in decoded['animations']],
            'unreachable_frames':decoded['unreachable_frames']}


def export_obj(decoded, output):
    """Export geometry in original per-mesh space; rigs/animation remain in JSON.

    Collision and attack helper meshes retain their explicit original names.
    OBJ cannot carry skeletons, weights, or animation; use decoded data for that.
    """
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    mtl = output.with_suffix('.mtl')
    lines = ['# KSM geometry only; original per-mesh coordinates', f'mtllib {mtl.name}']
    materials = []
    base, uv_base = 1, 1
    for mesh_index, mesh in enumerate(decoded['meshes']):
        lines.append('o ' + (mesh['name'] or f'unnamed_{mesh_index}').replace(' ', '_'))
        for p in mesh['positions']: lines.append('v ' + ' '.join(f'{v:.9g}' for v in p))
        for p in mesh['texcoords']: lines.append(f'vt {p[0]:.9g} {1-p[1]:.9g}')
        for p in mesh['normals']: lines.append('vn ' + ' '.join(f'{v:.9g}' for v in p))
        for j, mat in enumerate(mesh['materials']):
            materials.extend([f'newmtl mesh_{mesh_index}_mat_{j}',
                              'Kd ' + ' '.join(f'{v:.9g}' for v in mat['diffuse'][:3]),
                              'd ' + f"{mat['diffuse'][3]:.9g}"])
            if mat['texture']: materials.append('map_Kd ' + mat['texture'])
            materials.append('')
        active = None
        for tri, mat in zip(mesh['triangles'], mesh['material_indices']):
            if mat != active: lines.append(f'usemtl mesh_{mesh_index}_mat_{mat}'); active = mat
            def face_index(v):
                return f'{base+v}/{uv_base+v}/{base+v}' if mesh['texcoords'] else f'{base+v}//{base+v}'
            lines.append('f ' + ' '.join(face_index(v) for v in tri))
        base += len(mesh['positions'])
        uv_base += len(mesh['texcoords'])
    output.write_text('\n'.join(lines)+'\n', encoding='utf-8')
    mtl.write_text('\n'.join(materials)+'\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source', type=Path)
    ap.add_argument('output', type=Path)
    ap.add_argument('--full', action='store_true', help='Also save lossless decoded JSON compressed with gzip')
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    paths = [args.source] if args.source.is_file() else sorted(args.source.rglob('*'))
    reports, failures = [], []
    for path in paths:
        if not path.is_file() or path.suffix.lower() != '.x': continue
        with path.open('rb') as fp:
            if fp.read(4) != b'KSM ': continue
        rel = Path(path.name) if args.source.is_file() else path.relative_to(args.source)
        out = args.output / rel.parent / rel.stem
        out.parent.mkdir(parents=True, exist_ok=True)
        try:
            decoded = parse_ksm(path)
            report = summary(decoded)
            reports.append(report)
            out.with_suffix('.summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            if decoded['meshes']: export_obj(decoded, out.with_suffix('.obj'))
            if args.full:
                with gzip.open(out.with_suffix('.decoded.json.gz'), 'wt', encoding='utf-8') as fp:
                    json.dump(decoded, fp, ensure_ascii=False, separators=(',', ':'))
        except (FormatError, struct.error, OSError) as error:
            failures.append({'source':str(path), 'error':str(error)})
    total = {'files':len(reports), 'failures':failures,
             'meshes':sum(r['mesh_count'] for r in reports),
             'vertices':sum(r['vertices'] for r in reports),
             'triangles':sum(r['triangles'] for r in reports),
             'clips':sum(len(r['animations']) for r in reports),
             'keys':sum(a['keys'] for r in reports for a in r['animations']),
             'entries':reports}
    (args.output/'manifest.json').write_text(json.dumps(total, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in total.items() if k!='entries'}, ensure_ascii=False))


if __name__ == '__main__': main()
