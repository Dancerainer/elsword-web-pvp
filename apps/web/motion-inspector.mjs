import { createPoseAudit } from './pose-audit.mjs';

// Internal M3 verification tool. It samples source clips without changing the
// simulation, input history, damage or resources; it is not another game mode.
export function createMotionInspector({ host, view, sourceAudit, onOpen, onClose, canOpen = () => true }) {
  const button = document.createElement('button'); button.textContent = 'Motion inspector'; button.id = 'motion-inspect';
  host.querySelector('.tools').insertBefore(button, host.querySelector('.status'));
  const panel = document.createElement('section'); panel.className = 'motion-inspector'; panel.hidden = true;
  panel.innerHTML = `<header><strong>Inspect original animation frames</strong><button id="motion-close">Close inspector</button></header>
    <p>Plays the source keyframes with root motion. Combat events are disabled in this view.</p>
    <label>Source animation <select id="motion-clip"></select></label>
    <label>Time (seconds) <input id="motion-time" type="number" min="0" step="0.01" value="0"></label>
    <button id="motion-play">Play animation</button><output id="motion-result" aria-live="polite"></output>`;
  host.querySelector('.viewport').append(panel);
  const select = panel.querySelector('select'), input = panel.querySelector('input'), play = panel.querySelector('#motion-play'), result = panel.querySelector('output');
  for (const name of view.clips.keys()) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
  select.value = 'Wait';
  let active = false, playing = false, seconds = 0, audit=sourceAudit, lastReport, generation=0;
  function duration() { const group = view.clips.get(select.value); return view.sourceDurations.get(select.value) ?? (group.to - group.from) / group.targetedAnimations[0].animation.framePerSecond; }
  function choose() { seconds = 0; input.value = '0'; input.max = String(duration()); }
  select.onchange = choose;
  input.oninput = () => { const n = Number(input.value); if (Number.isFinite(n)) seconds = Math.max(0, Math.min(duration(), n)); };
  play.onclick = () => { playing = !playing; play.textContent = playing ? 'Pause animation' : 'Play animation'; };
  button.onclick = async () => {
    if (active || !canOpen()) return;
    button.disabled = true;const requestGeneration=generation;
    try {
      if (!audit) {
        const response = await fetch('/assets/rf/pose-tracks.json.gz'); if (!response.ok) throw Error('HTTP ' + response.status);
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        const loaded=createPoseAudit(await new Response(stream).json());
        if(requestGeneration!==generation)return;
        audit=loaded;
      }
      if (!canOpen()) return;
      onOpen(); active = true; playing = false; play.textContent = 'Play animation'; choose(); panel.hidden = false;
    } catch (error) { host.querySelector('.arena-message').textContent = 'Failed to load motion inspector: ' + error.message; }
    finally { button.disabled = false; }
  };
  panel.querySelector('#motion-close').onclick = () => { active = false; playing = false; panel.hidden = true; onClose(); };
  return {
    setView(next,{sourceAudit:nextAudit}={}){
      generation++;active=false;playing=false;seconds=0;view=next;audit=nextAudit;lastReport=null;
      panel.hidden=true;play.textContent='Play animation';result.textContent='';delete result.dataset.poseReport;
      select.replaceChildren();for(const name of view.clips.keys()){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}
      select.value=view.clips.has('Wait')?'Wait':view.clips.keys().next().value;choose();button.disabled=false;
    },
    get active() { return active; },
    get sourceAudit() { return audit; },
    update(dt) { if (active && playing) { seconds = duration() > 0 ? (seconds + dt) % duration() : 0; input.value = seconds.toFixed(3); } },
    actor(actor) { return active ? { ...actor, animationName: select.value, animationTime: seconds, animationLoop: false, applyMotionOffset: false, consumeRootTranslation: false } : actor; },
    afterRender(actor) {
      if (!active) return;
      lastReport = audit(view, this.actor(actor));
      result.textContent = `Source animation ${lastReport.clip} · ${seconds.toFixed(3)} / ${duration().toFixed(3)} s\n` +
        `Rendered pose: ${lastReport.comparedNodes} nodes · Maximum error ${lastReport.maximumErrorNative.toExponential(2)} native units\n` +
        `Engine playback: ${view.sample.paused ? 'paused' : 'playing'} · Target client trace pending`;
      result.dataset.poseReport = JSON.stringify(lastReport);
    },
  };
}
