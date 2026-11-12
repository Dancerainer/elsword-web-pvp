"""Seal the LK runtime asset manifest after character, effects, audio and UI builds."""
import argparse
import gzip
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'character'))
from build_rf import write_json,digest

def complete_pose(output,profile,additional_bones=(),documented_missing_bones=(),*,unsupported_owner_bones=()):
    """Extend the compact helper pose with real effect-owner bones and ancestors.

    Full original tracks have already been decoded by the character converter.
    This selection removes only exactly constant interior keys, retaining every
    source time/value. It cannot synthesize a missing bone or clip.
    """
    full_pose=output/'pose-tracks.json.gz'
    if not full_pose.exists():full_pose=output/'source-proof/pose-tracks.json.gz'
    pose=json.loads(gzip.decompress(full_pose.read_bytes()))
    data=json.loads(profile.read_text('utf8'));frames=pose['frames']
    ids={f['name']:i for i,f in enumerate(frames)}
    needed={h['name'] for h in pose['helpers']}
    if set(additional_bones)-ids.keys():raise ValueError('Required original bones missing')
    needed.update(additional_bones)
    # Original shared buff declarations can request _HEAD_BONE. Preserve the
    # real character node so the executor's separately evidenced token adapter
    # can sample the victim; no reference offset or synthetic track is added.
    shared_buff_bones={'Bip01_Head'}
    if shared_buff_bones-ids.keys():
        raise ValueError('Original shared buff attachment bone absent: '+str(sorted(shared_buff_bones-ids.keys())))
    needed.update(shared_buff_bones)
    owners={entry['BONE_NAME'] for d in data['effectSets'].values() for key,entry in d['raw'].items()
        if key.startswith('EFFECT') and isinstance(entry,dict) and entry.get('BONE_NAME')}
    # Shared buff EffectSet::_HEAD_BONE is the separately evidenced runtime
    # head-token adapter, not a literal mesh frame. Preserve its real bone.
    source_owner_tokens=sorted(owners)
    owners={'Bip01_Head' if name=='_HEAD_BONE' else name for name in owners}
    effect_scopes={}
    # Some effect-set entries trace the mesh created earlier in the same set.
    # These names must not be invented as actor bones or attached to Bip01.
    effect_poses=set()
    index_path=output/'fx/index.json'
    if index_path.is_file():
        # A shared conversion retains its own original hierarchy. Inspect that
        # hierarchy instead of inventing missing actor bones for another class.
        effect_poses.update((output/t['poseData']).resolve() for t in
            json.loads(index_path.read_text('utf8'))['templates'].values() if t.get('poseData'))
    else:
        effect_poses.update((output/'fx/meshes').glob('*.pose.json'))
    for p in sorted(effect_poses):
        effect=json.loads(p.read_text('utf8'))
        for f in effect['frames']:
            if f['name'] in owners-ids.keys():
                import os
                effect_scopes.setdefault(f['name'],[]).append(Path(os.path.relpath(p,output)).as_posix())
    missing=owners-ids.keys()-effect_scopes.keys()
    if missing-(set(documented_missing_bones)|set(unsupported_owner_bones)):raise ValueError('Target effect bones absent from actor and converted effect hierarchies: '+str(sorted(missing)))
    if set(unsupported_owner_bones)-missing:raise ValueError('Declared unsupported owner bone unexpectedly resolved')
    needed.update(owners & ids.keys())
    for name in list(needed):
        parent=frames[ids[name]]['parent']
        while parent is not None:
            needed.add(frames[parent]['name']);parent=frames[parent]['parent']
    selection=[dict(f) for f in frames if f['name'] in needed];newids={f['name']:i for i,f in enumerate(selection)}
    for f in selection:f['parent']=newids[frames[f['parent']]['name']] if f['parent'] is not None else None
    selected_clips=[]
    for clip in pose['clips']:
        target={k:clip[k] for k in ('name','ticks_per_second','durationSeconds','nativePlaybackField')};target['tracks']=[]
        for original in clip['tracks']:
            if original['frame_name'] not in needed:continue
            track=dict(original)
            for key in ('translation','scale','rotation'):
                channel=dict(track[key]);values=channel['values']
                keep=[i for i,v in enumerate(values) if i in (0,len(values)-1) or v!=values[i-1] or v!=values[i+1]]
                channel['times']=[channel['times'][i] for i in keep];channel['values']=[values[i] for i in keep];track[key]=channel
            target['tracks'].append(track)
        selected_clips.append(target)
    result={'schemaVersion':1,'coordinateConvention':'native DirectX axes; column matrices',
        'frames':selection,'helpers':pose['helpers'],'clips':selected_clips,
        'selection':'Original profession collision/effect-owner/shared buff attachment bones and their ancestors; all original clips preserved',
        'interpolation':pose['interpolation']}
    write_json(output/'runtime-pose.json',result,True)
    (output/'runtime-pose.json.gz').write_bytes(gzip.compress((output/'runtime-pose.json').read_bytes(),mtime=0))
    return {'effectOwnerBones':sorted(owners & ids.keys()),'sharedBuffAttachmentBones':sorted(shared_buff_bones),'effectMeshBoneScopes':effect_scopes,
        'unsupportedOriginalOwnerBones':sorted(missing),
        'unresolvedEffectOwnerBones':sorted(missing),
        'sourceEffectOwnerTokens':source_owner_tokens,'ownerTokenBindings':{'_HEAD_BONE':'Bip01_Head'},
        'effectMeshBoneScopeEvidence':'original converted effect mesh hierarchies; trace-target binding native consumer is separate',
        'frameCount':len(selection),'clipCount':len(selected_clips),
        'profileId':data['profileId'],'purpose':'source resource coverage; no additional gameplay trigger'}

def finalize(output,profile,profession_id='lk',additional_bones=(),documented_missing_bones=(),*,unsupported_owner_bones=()):
    manifest=json.loads((output/'manifest.json').read_text('utf8'))
    manifest['runtimeCharacter']['profileCoverage']=complete_pose(output,profile,additional_bones,documented_missing_bones,
        unsupported_owner_bones=unsupported_owner_bones)
    fx=json.loads((output/'fx/index.json').read_text('utf8'))
    portrait=json.loads((output/'ui/manifest.json').read_text('utf8'))
    manifest.update(visualEffectIndexes=['fx/index.json'],audioManifest='audio/manifest.json',
        portraits=portrait['pieces'],effectAssetIndex='effect-assets.json',
        effectTemplates={'schemaVersion':1,'templates':fx['templates']},
        unsupportedEffects=fx['meshFailures'],
        effectSourceEvidence=fx['sourceFiles'],
        profile={'profileId':json.loads(profile.read_text('utf8'))['profileId'],
            'sha256':digest(profile.read_bytes().replace(b'\r\n',b'\n')),'hashNormalization':'UTF-8 LF'})
    write_json(output/'effect-assets.json',{'schemaVersion':1,'templates':fx['templates']})
    write_json(output/'manifest.json',manifest)
    outputs=[{'file':p.relative_to(output).as_posix(),'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size}
        for p in sorted(output.rglob('*')) if p.is_file() and p.name!='outputs.json']
    write_json(output/'outputs.json',outputs)
    report={'schemaVersion':1,'outputDirectory':str(output.resolve()),'profile':manifest['profile'],
        'clientMeasured':False,'summary':{'files':len(outputs),'bytes':sum(r['bytes'] for r in outputs),
            'originalCharacterClips':len(manifest['clips']),'fxTemplates':len(fx['templates']),
            'fxTextures':len({r['file'] for t in fx['templates'].values() for r in t['textures'].values()}),
            'meshFailures':len(fx['meshFailures']),'missingTemplates':len(fx['missingTemplates'])},
        'outputs':outputs,'limits':manifest['limits'],'unsupportedEffects':fx['meshFailures'],
        'missingTemplates':fx['missingTemplates']}
    write_json(Path(__file__).resolve().parents[2]/f'reports/{profession_id}-assets-runtime.json',report)
    print(json.dumps(report['summary']))

if __name__=='__main__':
    root=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,default=root/'artifacts/lk');p.add_argument('--profile',type=Path,default=root/'packages/combat-core/lk-profile.json')
    a=p.parse_args();finalize(a.output,a.profile)
