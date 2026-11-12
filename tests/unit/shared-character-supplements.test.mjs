import test from 'node:test';
import assert from 'node:assert/strict';
import {composeCharacterPose} from '../../packages/combat-assets/shared-character.mjs';

test('sibling pose reuses exact shared channels and retains its additional original hand channel',()=>{
  const torso={frame_name:'Torso',translation:{times:[0,1],values:[[0,0,0],[1,0,0]]}};
  const hand={frame_name:'LeftHand',translation:{times:[0,1],values:[[1,0,0],[2,0,0]]}};
  const pose={frames:[{name:'Torso'},{name:'LeftHand'}],clips:[],sharedClips:['Wait'],sharedClipTrackSupplements:{Wait:[hand]}};
  const shared={clips:[{name:'Wait',durationSeconds:1,tracks:[torso]}]};
  const output=composeCharacterPose(pose,shared);
  assert.deepEqual(output.clips[0].tracks,[torso,hand]);
  assert.equal(output.clips[0].tracks[0],torso);assert.equal(output.clips[0].tracks[1],hand);
  assert.equal(shared.clips[0].tracks.length,1);assert.equal(pose.clips.length,0);
  for(const invalid of [[torso],[{frame_name:'Missing'}],[hand,hand],{}])
    assert.throws(()=>composeCharacterPose({...pose,sharedClipTrackSupplements:{Wait:invalid}},shared),TypeError);
});
