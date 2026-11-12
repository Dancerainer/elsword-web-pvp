"""Convert the locally verified KSM/KAC variant through the shared GLB exporter."""
import json
from pathlib import Path
from ksm_convert import parse_ksm, expanded_track
from export_samples import Exporter, render, parser, WORK


def node(kind, values=(), strings=(), name=''):
    n=parser.XNode(kind,name)
    n.values=[('STR',s) for s in strings]+[('NUM',v) for v in values]
    return n


def to_tree(decoded):
    root=node('ROOT'); frames=[]
    for f in decoded['frames']:
        n=node('Frame',name=f['name']);n.children.append(node('FrameTransformMatrix',f['matrix']));frames.append(n)
        n.meta={'nativeStoredBoundingRadius':f['bounding_radius'], 'nativeFrameIndex':f['index']}
    for f in decoded['frames']:
        if f['parent'] is None:root.children.append(frames[f['index']])
        else:frames[f['parent']].children.append(frames[f['index']])
    for m in decoded['meshes']:
        vals=[len(m['positions'])]+[v for xyz in m['positions'] for v in xyz]+[len(m['triangles'])]
        for tri in m['triangles']:vals.extend([3]+tri)
        mesh=node('Mesh',vals,name=m['name'])
        vals=[len(m['normals'])]+[v for xyz in m['normals'] for v in xyz]+[len(m['triangles'])]
        for tri in m['triangles']:vals.extend([3]+tri)
        mesh.children.append(node('MeshNormals',vals))
        if m['texcoords']:mesh.children.append(node('MeshTextureCoords',[len(m['texcoords'])]+[v for uv in m['texcoords'] for v in uv]))
        material_list=node('MeshMaterialList',[len(m['materials']),len(m['triangles'])]+m['material_indices'])
        for mat in m['materials']:
            material=node('Material',mat['diffuse']+[mat['power']]+mat['specular'][:3]+mat['emissive'][:3])
            if mat['texture']:material.children.append(node('TextureFilename',strings=[mat['texture']]))
            material_list.children.append(material)
        mesh.children.append(material_list)
        for skin in m['skin_weights']:
            name=decoded['frames'][skin['frame']]['name']
            mesh.children.append(node('SkinWeights',[len(skin['vertex_indices'])]+skin['vertex_indices']+skin['weights']+skin['offset_matrix'],strings=[name]))
        frames[m['frame']].children.append(mesh)
    return root


def clips(decoded):
    result=[]
    for source in decoded['animations']:
        clip={'name':source['name'],'ticks_per_second':source['ticks_per_second'],'tracks':[]}
        for t in source['tracks']:
            keys=expanded_track(t,source['ticks_per_second'])
            track={'frame_name':decoded['frames'][t['frame']]['name']}
            for k in ('translation','scale','rotation'):
                values=[key[k] for key in keys]
                if k=='rotation':
                    # KAC raw XYZW is conjugated to ordinary column-vector convention.
                    values=[[-q[0],-q[1],-q[2],q[3]] for q in values]
                track[k]={'times':[key['time'] for key in keys],'values':values}
            clip['tracks'].append(track)
        result.append(clip)
    return result


def main():
    source=WORK/'raw/data002/Motion_Elsword_Field.x'
    decoded=parse_ksm(source)
    dest=WORK/'samples/Elsword_Field_Animated'
    ex=Exporter('Elsword_Field_Animated')
    ex.add(source,dest,tree=to_tree(decoded),clips_override=clips(decoded))
    info=ex.save(dest);render(ex,dest)
    (dest/'sample_summary.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(info,ensure_ascii=False))


if __name__=='__main__':main()
