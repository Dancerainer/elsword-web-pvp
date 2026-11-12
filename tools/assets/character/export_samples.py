"""Export selected healthy standard DirectX character/effect assets to GLB/OBJ.

Uses the vendored io_directx_x parser (GPL-3.0, see third_party directory).
GLB preserves frame transforms, skin joints, UVs, material and textures.
This sample exporter does not translate animations or engine particle effects.
"""
from __future__ import annotations
import importlib.util
import json
import struct
import hashlib
import warnings
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from directx_animation import decode_animations, decompose_native_matrix

WORK = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('dx_parser', WORK/'third_party/io_directx_x/parser.py')
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
C = np.diag([1., 1., -1., 1.])


def named_material_definitions(tree):
    """Keep source names exact; DirectX Material references are not filenames."""
    definitions = {}
    def collect(node):
        if node.kind == 'Material' and node.name:
            definitions.setdefault(node.name, []).append(node)
        for child in node.children:
            collect(child)
    collect(tree)
    return definitions


def resolve_mesh_materials(matlist, definitions):
    """Resolve ordered inline/REF material slots without inventing a fallback."""
    if matlist is None:
        return [None]
    header = matlist.ints()
    if len(header) < 2 or header[0] < 0:
        raise ValueError('Invalid MeshMaterialList header')
    materials = []
    for entry in matlist.children:
        if entry.kind == 'Material':
            materials.append(entry)
        elif entry.kind == 'REF':
            names = [value for kind, value in entry.values
                     if kind in (parser.TOK_WORD, parser.TOK_STR)]
            if len(names) != 1 or len(entry.values) != 1:
                raise ValueError('Invalid material reference')
            candidates = definitions.get(names[0], [])
            if len(candidates) != 1:
                raise ValueError('Unresolved or ambiguous material reference: ' + names[0])
            materials.append(candidates[0])
        else:
            raise ValueError('Unsupported MeshMaterialList entry: ' + entry.kind)
    if len(materials) != header[0]:
        raise ValueError('Material slot count differs from declaration')
    return materials or [None]


def matrix(node):
    vals = node.nums() if node is not None else []
    return np.array(vals, dtype=np.float64).reshape(4, 4).T if len(vals) == 16 else np.eye(4)


def flat(mat):
    return [float(x) for x in mat.T.reshape(-1)]


class Exporter:
    def __init__(self, name, *, texture_lookup=None, asset_root=None, compact_animation_keys=False, deduplicate_accessors=False):
        self.name = name
        self.asset_root = Path(asset_root) if asset_root else WORK
        self.compact_animation_keys = compact_animation_keys
        self.deduplicate_accessors = deduplicate_accessors
        self.accessor_cache = {}
        self.doc = {'asset': {'version': '2.0', 'generator': 'Elsword 2016 RF exporter v1'},
                    'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                    'skins': [], 'materials': [], 'images': [], 'textures': [],
                    'samplers': [{'magFilter': 9729, 'minFilter': 9729, 'wrapS': 10497, 'wrapT': 10497}],
                    'bufferViews': [], 'accessors': [], 'buffers': []}
        self.buffer = bytearray()
        self.render_meshes = []
        self.texture_lookup = texture_lookup or {}
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
        blob = a.tobytes()
        cache_key = (kind, component, target, bounds, a.shape, hashlib.sha256(blob).digest())
        if self.deduplicate_accessors and cache_key in self.accessor_cache:
            return self.accessor_cache[cache_key]
        item = {'bufferView': self.view(blob, target), 'componentType': component,
                'count': len(a), 'type': kind}
        if bounds:
            item['min'], item['max'] = np.atleast_1d(a.min(axis=0)).tolist(), np.atleast_1d(a.max(axis=0)).tolist()
        self.doc['accessors'].append(item)
        result = len(self.doc['accessors']) - 1
        if self.deduplicate_accessors:
            self.accessor_cache[cache_key] = result
        return result

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
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter('always')
                tree = parser.parse_x_file(str(source))
            if caught:
                raise ValueError(f'Parser emitted warnings; refusing sample export: {caught}')
        material_definitions = named_material_definitions(tree)
        frame_nodes, worlds, mesh_frames, meshes = {}, {}, {}, []
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
                        raise ValueError(f'Duplicate named frame: {n.name}')
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
            # Character exports contain helper collision and footsteps geometry.
            if any(any(helper in name.upper() for helper in ('COLLISION','FOOTSTEPS','ATTACK_LINE','ATTACK_SPHERE','TRACE_')) for name in holder_path):
                continue
            if source.name.lower().startswith('mesh_') and not skin_nodes:
                ml=mesh.child('MeshMaterialList')
                has_texture=any(m is not None and m.child('TextureFilename','TextureFileName') is not None
                    and any(m.child('TextureFilename','TextureFileName').strings())
                    for m in resolve_mesh_materials(ml, material_definitions)) if ml else False
                if not has_texture:
                    continue
            nums = mesh.nums()
            nv = int(nums[0]); pos = np.array(nums[1:1+nv*3]).reshape(nv, 3)
            cursor = 1+nv*3; nf = int(nums[cursor]); cursor += 1
            faces = []
            for _ in range(nf):
                count = int(nums[cursor]); cursor += 1
                f = [int(x) for x in nums[cursor:cursor+count]]; cursor += count
                if len(f) < 3 or min(f) < 0 or max(f) >= nv:
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
            materials = resolve_mesh_materials(matlist, material_definitions)
            face_materials = [0]*nf
            if matlist:
                v=matlist.ints(); face_materials=v[2:2+v[1]]
                if len(face_materials)==1:
                    face_materials*=nf
                if len(face_materials)!=nf:
                    raise ValueError('Material face count mismatch')
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
                    mat.update(alphaMode='MASK',alphaCutoff=0.4)
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
        self.add_animations(clips_override if clips_override is not None else decode_animations(tree),frame_nodes)
        self.sources.append(source.relative_to(self.asset_root).as_posix())

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
                    if self.compact_animation_keys and len(times) > 2:
                        # Remove only interior keys of EXACTLY equal-value runs.
                        # Endpoints/times stay, preserving interpolation/length.
                        keep=np.ones(len(times),dtype=bool)
                        keep[1:-1]=~(np.all(values[:-2]==values[1:-1],axis=1)&np.all(values[1:-1]==values[2:],axis=1))
                        times=times[keep];values=values[keep]
                    sampler=len(animation['samplers'])
                    animation['samplers'].append({'input':self.accessor(times,'SCALAR',bounds=True),
                        'output':self.accessor(values,'VEC4' if channel=='rotation' else 'VEC3'),'interpolation':'LINEAR'})
                    animation['channels'].append({'sampler':sampler,'target':{'node':index,'path':channel}})
            if animation['channels']:
                self.doc.setdefault('animations',[]).append(animation)

    def save(self, dest):
        dest.mkdir(parents=True,exist_ok=True)
        self.doc['buffers']=[{'byteLength':len(self.buffer)}]
        self.doc['extras']={'sourceFiles':self.sources,'coordinateConversion':'Z reflection, reversed triangle winding',
            'missingTextures':sorted(self.missing_textures),
            'limitations':'Source pose with original skin. Engine particle behavior not translated. Missing texture names are retained in extras.'}
        export_doc={k:v for k,v in self.doc.items() if not isinstance(v,list) or v}
        if not self.doc['textures']:export_doc.pop('samplers',None)
        jb=json.dumps(export_doc,separators=(',',':')).encode()
        jb+=b' '*((-len(jb))%4); bb=bytes(self.buffer);bb+=b'\0'*((-len(bb))%4)
        glb=struct.pack('<3I',0x46546c67,2,12+8+len(jb)+8+len(bb))+struct.pack('<2I',len(jb),0x4e4f534a)+jb+struct.pack('<2I',len(bb),0x004e4942)+bb
        (dest/(self.name+'.glb')).write_bytes(glb)
        obj=['# Elsword static source pose; bones preserved in corresponding GLB',f'mtllib {self.name}.mtl']
        mtl=[];off=1
        for idx,m in enumerate(self.render_meshes):
            obj.extend([f'o part_{idx}',f'usemtl material_{idx}'])
            pts=m['triangles'].reshape(-1,3)
            for v in pts:obj.append('v '+' '.join(f'{x:.8g}' for x in v))
            uv=m['uv'].reshape(-1,2) if m['uv'] is not None else np.zeros((len(pts),2))
            for v in uv:obj.append(f'vt {v[0]:.8g} {1-v[1]:.8g}')
            for k in range(0,len(pts),3):obj.append('f '+' '.join(f'{off+k+q}/{off+k+q}' for q in (0,1,2)))
            mtl.extend([f'newmtl material_{idx}','Kd 1 1 1','d 1','illum 1'])
            if m['png']:mtl.append(f'map_Kd textures/{m["png"]}')
            off+=len(pts)
        (dest/(self.name+'.obj')).write_text('\n'.join(obj)+'\n',encoding='utf-8')
        (dest/(self.name+'.mtl')).write_text('\n'.join(mtl)+'\n',encoding='utf-8')
        return {'name':self.name,'sources':self.sources,'meshes':len(self.doc['meshes']),
            'skins':len(self.doc['skins']),'joint_references':sum(len(s['joints']) for s in self.doc['skins']),
            'triangles':sum(len(m['triangles']) for m in self.render_meshes),'glb_bytes':len(glb),
            'animations':[a['name'] for a in self.doc.get('animations',[])],
            'missing_textures':sorted(self.missing_textures)}


def render(exporter,dest,caption='Extracted source mesh + textures | static source pose', *, yaw=.36, cull_back=False):
    width,height=960,960
    canvas=np.zeros((height,width,3),dtype=np.uint8);canvas[:]=[23,29,40]
    depth=np.full((height,width),-np.inf)
    points=np.concatenate([m['triangles'].reshape(-1,3) for m in exporter.render_meshes])
    # The imported model is Y-up. Orthographic view slightly turned around Y.
    pitch=-0.035
    ry=np.array([[np.cos(yaw),0,np.sin(yaw)],[0,1,0],[-np.sin(yaw),0,np.cos(yaw)]])
    rx=np.array([[1,0,0],[0,np.cos(pitch),-np.sin(pitch)],[0,np.sin(pitch),np.cos(pitch)]])
    view=rx@ry
    viewed=points@view.T;lo=viewed.min(0);hi=viewed.max(0)
    scale=min((width-160)/(hi[0]-lo[0]),(height-150)/(hi[1]-lo[1]));center=(lo+hi)/2
    for m in exporter.render_meshes:
        image=np.array(m['image']) if m['image'] is not None else None
        for fi,triangle in enumerate(m['triangles']):
            pts=triangle@view.T
            screen=np.c_[(pts[:,0]-center[0])*scale+width/2,
                         -(pts[:,1]-center[1])*scale+height/2+25,pts[:,2]]
            x0=max(0,int(np.floor(screen[:,0].min())));x1=min(width-1,int(np.ceil(screen[:,0].max())))
            y0=max(0,int(np.floor(screen[:,1].min())));y1=min(height-1,int(np.ceil(screen[:,1].max())))
            if x1<x0 or y1<y0:continue
            a,b,c=screen;den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            # Screen Y is inverted; a glTF CCW front face has negative area.
            if abs(den)<1e-8 or (cull_back and den>=0):continue
            xx,yy=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
            w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
            w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w2=1-w0-w1
            z=w0*a[2]+w1*b[2]+w2*c[2]
            mask=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(z>depth[y0:y1+1,x0:x1+1])
            if not mask.any():continue
            normal=np.cross(pts[1]-pts[0],pts[2]-pts[0]);norm=np.linalg.norm(normal)
            light=.72+.28*abs(float(normal@np.array([.3,.5,.8]))/norm) if norm else 1.
            if image is not None and m['uv'] is not None:
                uv=w0[...,None]*m['uv'][fi,0]+w1[...,None]*m['uv'][fi,1]+w2[...,None]*m['uv'][fi,2]
                tx=np.clip((uv[...,0]%1*image.shape[1]).astype(int),0,image.shape[1]-1)
                ty=np.clip((uv[...,1]%1*image.shape[0]).astype(int),0,image.shape[0]-1)
                rgba=image[ty,tx];mask &= rgba[...,3]>=100;rgb=rgba[...,:3]*light
            else:rgb=np.zeros((*mask.shape,3))+m['color']*255*light
            region=canvas[y0:y1+1,x0:x1+1];region[mask]=np.clip(rgb[mask],0,255).astype(np.uint8)
            depth[y0:y1+1,x0:x1+1][mask]=z[mask]
    result=Image.fromarray(canvas)
    draw=ImageDraw.Draw(result)
    fontpath=Path('C:/Windows/Fonts/segoeui.ttf')
    font=ImageFont.truetype(str(fontpath),24) if fontpath.exists() else ImageFont.load_default()
    draw.text((28,20),exporter.name,fill='#f0f1f6',font=font)
    draw.text((28,height-44),caption,fill='#bbc9d9',font=font)
    result.save(dest/(exporter.name+'_preview.png'))
    return result


def main():
    dest=WORK/'samples';dest.mkdir(parents=True,exist_ok=True)
    examples=[('Elsword_Basic',[WORK/'raw/data001/ElswordBasicEff.x']),
              ('Elsword_LordKnight',[p for p in sorted((WORK/'raw/data001').glob('Mesh_Elsword_ELK_*')) if p.suffix.lower()=='.x']),
              ('Chung_Basic',[p for p in sorted((WORK/'raw/data001').glob('Mesh_CHUNG_Basic_*')) if p.suffix.lower()=='.x']),
              ('ArmageddonBlade',[WORK/'raw/data001/ArmageddonBlade.X'])]
    summaries=[]
    for name,files in examples:
        ex=Exporter(name);folder=dest/name
        for source in files:
            ex.add(source,folder)
        info=ex.save(folder);render(ex,folder);summaries.append(info);print(json.dumps(info),flush=True)
    (dest/'sample_summary.json').write_text(json.dumps(summaries,indent=2),encoding='utf-8')


if __name__=='__main__':main()
