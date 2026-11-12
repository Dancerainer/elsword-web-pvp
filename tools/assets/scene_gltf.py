"""Export authored DirectX scene geometry to glTF without layout adaptation.

Uses the vendored io_directx_x parser (GPL-3.0, see scene_vendor/LICENSE).
GLB preserves frame transforms, skin joints, UVs, material and textures.
Based on the user's earlier static exporter; every source scene mesh is kept.
Missing explicit animation rates stay in native tick sidecars, never guessed.
"""
from __future__ import annotations
import importlib.util
import json
import struct
import warnings
import zlib
from pathlib import Path
import numpy as np
from PIL import Image
from scene_animation import decode_animations, decompose_native_matrix

WORK = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('dx_parser', WORK/'scene_vendor/parser.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
C = np.diag([1., 1., -1., 1.])


def parse_strict(source):
    """Reject truncated MSZIP streams even if the reference parser salvages a tree.

    2016 samples have a DWORD decompressed file length followed by blocks with
    WORD uncompressed length, WORD compressed length (including CK), CK marker,
    and raw deflate bytes. Validate every block and the full declared length.
    """
    raw = Path(source).read_bytes()
    if len(raw) < 16 or raw[:4] != b'xof ' or raw[12:16] not in (b'0032', b'0064'):
        raise ValueError('Invalid DirectX header')
    if raw[8:12] in (b'bzip', b'tzip'):
        if len(raw) < 26:
            raise ValueError('Truncated compressed DirectX header')
        declared = struct.unpack_from('<I', raw, 16)[0]
        pos, total, window = 20, 0, b''
        while pos < len(raw):
            if len(raw) - pos < 6:
                raise ValueError('Truncated MSZIP block header')
            uncompressed, compressed = struct.unpack_from('<HH', raw, pos)
            end = pos + 4 + compressed
            if compressed < 2 or end > len(raw) or raw[pos + 4:pos + 6] != b'CK':
                raise ValueError('Invalid or truncated MSZIP block framing')
            d = zlib.decompressobj(wbits=-15, zdict=window) if window else zlib.decompressobj(wbits=-15)
            try:
                out = d.decompress(raw[pos + 6:end]) + d.flush()
            except zlib.error as exc:
                raise ValueError('Damaged MSZIP deflate data') from exc
            if not d.eof or d.unused_data or len(out) != uncompressed:
                raise ValueError('Incomplete or mismatched MSZIP block')
            window = (window + out)[-32768:]
            total += len(out)
            pos = end
        if total + 16 != declared:
            raise ValueError('Decompressed DirectX declared size mismatch')
    elif raw[8:12] not in (b'bin ', b'txt '):
        raise ValueError('Unknown DirectX container format')
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        tree = parser.parse_x_file(str(source))
    if caught:
        raise ValueError(f'Parser emitted warnings; refusing partial conversion: {caught}')
    return tree


def matrix(node):
    vals = node.nums() if node is not None else []
    if node is not None and (len(vals) != 16 or not all(np.isfinite(vals))):
        raise ValueError('Invalid authored frame matrix')
    return np.array(vals, dtype=np.float64).reshape(4, 4).T if node is not None else np.eye(4)


def flat(mat):
    return [float(x) for x in mat.T.reshape(-1)]


class Exporter:
    def __init__(self, name, texture_lookup):
        self.name = name
        self.doc = {'asset': {'version': '2.0', 'generator': 'Elsword 2016 scene exporter v1'},
                    'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                    'skins': [], 'materials': [], 'images': [], 'textures': [],
                    'samplers': [{'magFilter': 9729, 'minFilter': 9729, 'wrapS': 10497, 'wrapT': 10497}],
                    'bufferViews': [], 'accessors': [], 'buffers': []}
        self.buffer = bytearray()
        self.render_meshes = []
        self.texture_lookup = texture_lookup
        self.texture_ids = {}
        self.sources = []
        self.missing_textures = set()

    def view(self, blob, target=None):
        while len(self.buffer) % 4:
            self.buffer.append(0)
        index = len(self.doc['bufferViews'])
        item = {'buffer': 0, 'byteOffset': len(self.buffer), 'byteLength': len(blob)}
        if target:
            item['target'] = target
        self.doc['bufferViews'].append(item)
        self.buffer.extend(blob)
        return index

    def accessor(self, data, kind, component=5126, target=None, bounds=False):
        dtype = {5126: '<f4', 5125: '<u4', 5123: '<u2'}[component]
        a = np.asarray(data, dtype=dtype)
        if not np.isfinite(a).all():
            raise ValueError('Non-finite numeric data')
        item = {'bufferView': self.view(a.tobytes(), target), 'componentType': component,
                'count': len(a), 'type': kind}
        if bounds:
            item['min'], item['max'] = np.atleast_1d(a.min(axis=0)).tolist(), np.atleast_1d(a.max(axis=0)).tolist()
        self.doc['accessors'].append(item)
        return len(self.doc['accessors']) - 1

    def texture(self, filename, dest):
        source = self.texture_lookup.get(Path(filename.replace('\\', '/')).name.casefold())
        if not source:
            if filename:
                self.missing_textures.add(filename)
            return None, None, None
        if source in self.texture_ids:
            return self.texture_ids[source]
        image = Image.open(source).convert('RGBA')
        pngname = source.stem + '.png'
        dest.mkdir(parents=True, exist_ok=True)
        image.save(dest/pngname)
        import io
        memory = io.BytesIO()
        image.save(memory, format='PNG')
        self.doc['images'].append({'bufferView': self.view(memory.getvalue()), 'mimeType': 'image/png', 'name': source.name})
        self.doc['textures'].append({'sampler': 0, 'source': len(self.doc['images'])-1})
        out = (len(self.doc['textures'])-1, image, pngname)
        self.texture_ids[source] = out
        return out

    def add(self, source, dest, tree=None, clips_override=None):
        if tree is None:
            tree = parse_strict(source)
        frame_nodes, worlds, mesh_frames, meshes = {}, {}, {}, []
        ambiguous_frames = set()
        frame_list = []

        def frames(n, parent=None, parent_world=None, path=()):
            if parent_world is None:
                parent_world = np.eye(4)
            current_world = parent_world
            current_parent = parent
            if n.kind == 'Frame':
                path = path + (n.name,)
                local = matrix(n.child('FrameTransformMatrix'))
                current_world = parent_world @ local
                index = len(self.doc['nodes'])
                self.doc['nodes'].append({'name': source.stem + '/' + (n.name or 'unnamed'), 'matrix': flat(C@local@C)})
                if parent is None:
                    self.doc['scenes'][0]['nodes'].append(index)
                else:
                    self.doc['nodes'][parent].setdefault('children', []).append(index)
                if n.name:
                    if n.name in frame_nodes:
                        ambiguous_frames.add(n.name)
                    frame_nodes[n.name] = index
                    worlds[n.name] = current_world
                    frame_list.append(n.name)
                current_parent = index
            if n.kind == 'Mesh':
                meshes.append(n)
                mesh_frames[id(n)] = (current_parent, current_world, path)
            for child in n.children:
                frames(child, current_parent, current_world, path)
        frames(tree)
        for mesh_index, mesh in enumerate(meshes):
            skin_nodes = mesh.children_of('SkinWeights')
            holder, mesh_world, holder_path = mesh_frames[id(mesh)]
            holder_name = self.doc['nodes'][holder]['name'] if holder is not None else source.stem
            nums = mesh.nums()
            if not nums:
                raise ValueError('Empty Mesh declaration')
            nv = int(nums[0]); pos = np.array(nums[1:1+nv*3]).reshape(nv, 3)
            cursor = 1+nv*3; nf = int(nums[cursor]); cursor += 1
            faces = []
            for _ in range(nf):
                count = int(nums[cursor]); cursor += 1
                f = [int(x) for x in nums[cursor:cursor+count]]; cursor += count
                if len(f) != count or len(f) < 3 or min(f) < 0 or max(f) >= nv:
                    raise ValueError('Invalid polygon')
                faces.append(f)
            if cursor != len(nums):
                raise ValueError('Unexpected Mesh values')
            normals_node = mesh.child('MeshNormals')
            normal_faces, normals = None, None
            if normals_node:
                values = normals_node.nums(); nn = int(values[0])
                normals = np.array(values[1:1+nn*3]).reshape(nn, 3)
                cur = 1+nn*3; normal_faces = []
                if int(values[cur]) != nf:
                    raise ValueError('Normal face count mismatch')
                cur += 1
                for f in faces:
                    cnt = int(values[cur]); cur += 1
                    if cnt != len(f):
                        raise ValueError('Normal corner count mismatch')
                    normal_faces.append([int(x) for x in values[cur:cur+cnt]]); cur += cnt
            uvnode = mesh.child('MeshTextureCoords')
            uvs = None
            if uvnode:
                uv = uvnode.nums()
                if int(uv[0]) != nv:
                    raise ValueError('UV vertex count mismatch')
                uvs = np.array(uv[1:]).reshape(nv, 2)
            joints, weights, inverse_binds = None, None, []
            baked = np.c_[pos, np.ones(nv)]
            if skin_nodes:
                vertex_weights = [[] for _ in range(nv)]
                joint_ids = []
                baked = np.zeros((nv, 4))
                for joint_no, sw in enumerate(skin_nodes):
                    name = sw.strings()[0]
                    values = sw.nums(); cnt = int(values[0])
                    indices = np.array(values[1:1+cnt], dtype=int)
                    ws = np.array(values[1+cnt:1+2*cnt])
                    offset = np.array(values[1+2*cnt:]).reshape(4,4).T
                    if name not in frame_nodes:
                        raise ValueError(f'Missing skin frame {name}')
                    if name in ambiguous_frames:
                        raise ValueError(f'Ambiguous skin frame {name}')
                    joint_ids.append(frame_nodes[name]); inverse_binds.append(flat(C@offset@C))
                    weighted = (worlds[name]@offset@np.c_[pos[indices],np.ones(cnt)].T).T
                    baked[indices] += weighted*ws[:,None]
                    for vi, weight in zip(indices, ws):
                        if weight > 0:
                            vertex_weights[vi].append((joint_no, float(weight)))
                joints = np.zeros((nv, 4), dtype=np.uint16)
                weights = np.zeros((nv, 4), dtype=np.float32)
                for vi, vw in enumerate(vertex_weights):
                    if not vw or len(vw)>4 or abs(sum(w for j,w in vw)-1)>0.001:
                        raise ValueError('Unsupported/un-normalized skin weights')
                    for slot, (ji, wt) in enumerate(vw):
                        joints[vi,slot], weights[vi,slot] = ji,wt
                self.doc['skins'].append({'name': holder_name, 'joints':joint_ids,
                    'inverseBindMatrices':self.accessor(inverse_binds,'MAT4')})
                skin_id = len(self.doc['skins'])-1
            else:
                baked = (mesh_world@baked.T).T
                skin_id = None
            baked = (C@baked.T).T[:,:3]
            matlist = mesh.child('MeshMaterialList')
            materials = matlist.children_of('Material') if matlist else []
            face_materials = [0]*nf
            if matlist:
                v=matlist.ints(); face_materials=v[2:2+v[1]]
                if len(face_materials)==1:
                    face_materials*=nf
                if len(face_materials)!=nf:
                    raise ValueError('Material face count mismatch')
            if matlist and matlist.children_of('REF'):
                raise ValueError('External material references require resolution')
            if not materials:
                materials=[None]
            mat_ids, images, png_names = [], [], []
            for material in materials:
                vals=material.nums() if material else [1,1,1,1]
                color=vals[:4]
                texnode=material.child('TextureFilename','TextureFileName') if material else None
                texid,img,png=None,None,None
                if texnode and texnode.strings():
                    texid,img,png=self.texture(texnode.strings()[0],dest/'textures')
                pbr={'baseColorFactor':[float(x) for x in color], 'metallicFactor':0.,'roughnessFactor':1.}
                if texid is not None:
                    pbr['baseColorTexture']={'index':texid}
                mat={'name':png or holder_name,'pbrMetallicRoughness':pbr,'doubleSided':True}
                if img is not None and img.getextrema()[3][0]<255:
                    mat.update(alphaMode='MASK',alphaCutoff=0.5)
                mat_ids.append(len(self.doc['materials'])); self.doc['materials'].append(mat)
                images.append(img); png_names.append(png)
            primitives=[]
            for mi in sorted(set(face_materials)):
                if mi >= len(materials):
                    raise ValueError('Material index outside table')
                p,n,u,j,w,tri=[],[],[],[],[],[]
                for fi,f in enumerate(faces):
                    if face_materials[fi] != mi:
                        continue
                    # Flip Z from DirectX LH to glTF RH, and reverse winding.
                    for k in range(1,len(f)-1):
                        for corner in (0,k+1,k):
                            vi=f[corner]; p.append((pos[vi]*[1,1,-1]).tolist())
                            if normals is not None:
                                n.append((normals[normal_faces[fi][corner]]*[1,1,-1]).tolist())
                            if uvs is not None:u.append(uvs[vi].tolist())
                            if joints is not None:j.append(joints[vi].tolist());w.append(weights[vi].tolist())
                        tri.append([baked[f[0]],baked[f[k+1]],baked[f[k]]])
                attr={'POSITION':self.accessor(p,'VEC3',target=34962,bounds=True)}
                if n:attr['NORMAL']=self.accessor(n,'VEC3',target=34962)
                if u:attr['TEXCOORD_0']=self.accessor(u,'VEC2',target=34962)
                if j:attr['JOINTS_0']=self.accessor(j,'VEC4',5123,34962);attr['WEIGHTS_0']=self.accessor(w,'VEC4',target=34962)
                primitives.append({'attributes':attr,'material':mat_ids[mi],'mode':4})
                self.render_meshes.append({'name':holder_name,'triangles':np.array(tri),
                    'uv':np.array(u).reshape(-1,3,2) if u else None,'image':images[mi],
                    'png':png_names[mi],'color':np.array([0.65,0.70,0.75])})
            self.doc['meshes'].append({'name':holder_name,'primitives':primitives})
            mesh_id=len(self.doc['meshes'])-1
            if holder is None:
                holder=len(self.doc['nodes']);self.doc['nodes'].append({'name':holder_name});self.doc['scenes'][0]['nodes'].append(holder)
            if skin_id is not None:
                # glTF skin matrices already contain the full authored transforms.
                # Put skinned render nodes at scene root with identity transform.
                render_node={'name':holder_name+'/render','mesh':mesh_id,'skin':skin_id}
                self.doc['scenes'][0]['nodes'].append(len(self.doc['nodes']))
                self.doc['nodes'].append(render_node)
            else:
                self.doc['nodes'][holder]['mesh']=mesh_id
        # Repeated names in separate static branches are legal. Each mesh keeps
        # its actual parent node/matrix. Never bind a skin or animation by an
        # ambiguous name; animated duplicates remain only in source evidence.
        self.add_animations(clips_override if clips_override is not None else decode_animations(tree),
                            {name: index for name, index in frame_nodes.items() if name not in ambiguous_frames})
        self.sources.append(source.name)

    def add_animations(self, clips, frame_nodes):
        for clip in clips:
            if clip.get('ticks_per_second') is None:
                continue
            animation={'name':clip['name'],'channels':[],'samplers':[]}
            for track in clip['tracks']:
                if track['frame_name'] not in frame_nodes or track.get('warnings'):
                    continue
                index=frame_nodes[track['frame_name']]; node=self.doc['nodes'][index]
                if 'matrix' in node:
                    try:
                        t,s,q=decompose_native_matrix(node['matrix'])
                    except ValueError:
                        # All three channels are required to replace a singular bind transform.
                        if not all(k in track for k in ('translation','scale','rotation')):
                            continue
                        t,s,q=([0,0,0],[1,1,1],[0,0,0,1])
                    node.pop('matrix');node.update(translation=t,scale=s,rotation=q)
                for channel in ('translation','scale','rotation'):
                    if channel not in track:continue
                    data=track[channel]
                    times=np.asarray(data['times'],dtype=np.float32)
                    values=np.asarray(data['values'],dtype=np.float32)
                    if not len(times):continue
                    unique={float(t):v for t,v in zip(times,values)}
                    times=np.array(sorted(unique),dtype=np.float32)
                    values=np.array([unique[float(t)] for t in times],dtype=np.float32)
                    if channel=='translation':values*=np.array([1,1,-1],dtype=np.float32)
                    if channel=='rotation':
                        values*=np.array([-1,-1,1,1],dtype=np.float32)
                        values/=np.linalg.norm(values,axis=1)[:,None]
                        for i in range(1,len(values)):
                            if values[i-1]@values[i]<0:values[i]*=-1
                    sampler=len(animation['samplers'])
                    animation['samplers'].append({'input':self.accessor(times,'SCALAR',bounds=True),
                        'output':self.accessor(values,'VEC4' if channel=='rotation' else 'VEC3'),'interpolation':'LINEAR'})
                    animation['channels'].append({'sampler':sampler,'target':{'node':index,'path':channel}})
            if animation['channels']:
                self.doc.setdefault('animations',[]).append(animation)
