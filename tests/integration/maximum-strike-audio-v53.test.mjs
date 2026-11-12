import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createBattleAudio} from '../../apps/web/battle-audio.mjs';
import {resolveHitSound} from '../../packages/combat-core/hit-audio.mjs';
import source from '../fixtures/evidence/audio-source.json' with {type:'json'};
const root=new URL('../../',import.meta.url),relative='de/audio/manifest.json';
const overlay=new URL('runtime/fixes1017-maximum/assets/'+relative,root);
const manifestPath=existsSync(overlay)?overlay:new URL('artifacts/'+relative,root);
// Source mapping and waveform hashes come from independently decoded target
// Enum/DamageSound and catalog-verified raw WAV; mock playback proves routing.
test('Maximum HT_PLASMA_1 resolves its original WAV through a loaded DE manifest to the audio player',()=>{
 assert.equal(resolveHitSound({HIT_TYPE:43,REACT_TYPE:2},{hittedType:1}),'HitPlasma1.wav');
 const manifest=JSON.parse(readFileSync(manifestPath)),entry=manifest.files['HitPlasma1.wav'];assert.ok(entry,'source hit WAV must be in the runtime audio closure');
 const wav=readFileSync(new URL('HitPlasma1.wav',manifestPath));
 assert.equal(createHash('sha256').update(wav).digest('hex'),source.outputs['de/audio/HitPlasma1.wav'].sha256);
 assert.equal(wav.length,136226);assert.equal(wav.toString('ascii',0,4),'RIFF');
 const calls=[],errors=[];const player=createBattleAudio({createAudio:url=>({volume:1,currentTime:0,play(){calls.push(url);return Promise.resolve();},pause(){},removeAttribute(){},load(){}}),onError:e=>errors.push(e)});
 player.configure({manifest});assert.equal(player.play('HitPlasma1.wav'),true);
 assert.equal(calls.length,1);assert.equal(new URL(calls[0],'http://fixture').pathname,'/assets/de/audio/HitPlasma1.wav');assert.deepEqual(errors,[]);player.dispose();
});
