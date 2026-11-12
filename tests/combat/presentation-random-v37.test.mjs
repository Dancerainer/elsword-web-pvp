import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {presentationRandom} from '../../packages/combat-core/presentation-random.mjs';
const sound={'2':'fixture.ogg','3':50,'4':1};
const damage={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:.123456789},REACT_TYPE:7,HIT_TYPE:1};

test('extra local and remote sound callbacks cannot change real native critical results or combat seed',()=>{
  const base=vcFixture({passives:[],seed:2016}),noisy=vcFixture({passives:[],seed:2016});
  const run=(f,noise)=>{
    f.a.stats.criticalRate=.5;const results=[];
    for(let hit=0;hit<16;hit++){
      if(noise)for(let i=0;i<31;i++){f.sim.soundEvent(f.a,'local-cosmetic',sound);f.sim.soundEvent(f.b,'remote-cosmetic',sound);}
      assert.equal(f.sim.applyHit(f.a,f.b,damage,{kind:'character'}).accepted,true);
      const event=f.sim.drainEvents().find(e=>e.type==='hit');
      results.push({amount:event.amount,critical:event.critical,hp:f.b.hp,seed:f.sim.state.seed});
    }
    return results;
  };
  assert.deepEqual(run(noisy,true),run(base,false));
});
test('actor sound selection and effect sound events use presentation state, not the combat stream',()=>{
  const {sim,a,b}=vcFixture({passives:[],seed:2016}),seed=sim.state.seed;
  sim.enter(a,'RSI_SA_RWT_GIGA_PROMINENCE','cosmetic-stream-fixture');
  assert.ok(a.soundSet,'the actual authored state selects a sound bank');
  for(let i=0;i<64;i++)sim.soundEvent(b,'remote-cosmetic',sound);
  assert.equal(sim.state.seed,seed);
  assert.ok(Object.keys(sim.state.presentationRandom.actors).length>=2);
});
test('presentation streams are per actor and deterministic across full snapshot restore',()=>{
  const base={seed:71},noisy={seed:71};
  for(let i=0;i<32;i++){
    for(let n=0;n<9;n++)presentationRandom(noisy,'target');
    assert.equal(presentationRandom(noisy,'vc'),presentationRandom(base,'vc'));
  }
  assert.equal(base.seed,71);assert.equal(noisy.seed,71);
  assert.ok(Number.isFinite(presentationRandom(noisy,'__proto__')));
  const {sim,a}=vcFixture({seed:71}),saved=sim.snapshot();
  const run=()=>Array.from({length:20},()=>{sim.soundEvent(sim.actor(a.id),'restore',sound);return sim.rng();});
  const expected=run(),snapshot=sim.snapshot();sim.restore(saved);assert.deepEqual(run(),expected);assert.deepEqual(sim.snapshot(),snapshot);
});
