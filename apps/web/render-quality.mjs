// Browser presentation choices only. Never read by the combat executor.
export const RENDER_QUALITY_MODES=Object.freeze({
  auto:{label:'Auto',pixelRatio:1,pixels:1600000},
  performance:{label:'Performance',pixelRatio:.8,pixels:1000000},
  sharp:{label:'Sharp',pixelRatio:2,pixels:4000000},
});
const storageKey='elsword-render-quality-v1';
export function renderPixelRatio({width,height,devicePixelRatio=1,mode='auto',scale=1}){
  const settings=RENDER_QUALITY_MODES[mode];if(!settings)throw new RangeError('Unknown render quality');
  if(!(width>0&&height>0))return 1;
  const device=Number.isFinite(devicePixelRatio)&&devicePixelRatio>0?devicePixelRatio:1;
  return Math.min(device,settings.pixelRatio,Math.sqrt(settings.pixels/(width*height)))*Math.max(.65,Math.min(1,scale));
}
export function createRenderQuality({storage,onChange=()=>{}}={}){
  let mode='auto';try{const saved=storage?.getItem(storageKey);if(Object.hasOwn(RENDER_QUALITY_MODES,saved))mode=saved;}catch{}
  let scale=1,samples=[],fastWindows=0,changes=0;
  const reset=()=>{samples.length=0;fastWindows=0;};
  return {
    get mode(){return mode;},
    setMode(next){
      if(!Object.hasOwn(RENDER_QUALITY_MODES,next))throw new RangeError('Unknown render quality');
      mode=next;scale=1;reset();try{storage?.setItem(storageKey,mode);}catch{}onChange();
    },
    pixelRatio(size){return renderPixelRatio({...size,mode,scale});},
    // Windows and hysteresis avoid reallocating the backbuffer for single
    // shader/GC spikes. Background, paused and loading time cannot lower quality.
    sample(frameMs,{active=true}={}){
      if(mode!=='auto'||!active){reset();return;}
      if(!Number.isFinite(frameMs)||frameMs<=0||frameMs>250){reset();return;}
      samples.push(frameMs);if(samples.length<120)return;
      samples.sort((a,b)=>a-b);const slow=samples[107];samples.length=0;
      let next=scale;
      if(slow>21){fastWindows=0;next=Math.max(.65,scale-.1);}
      else if(slow<17.5){if(++fastWindows>=5){next=Math.min(1,scale+.05);fastWindows=0;}}
      else fastWindows=0;
      next=Math.round(next*100)/100;
      if(next!==scale){scale=next;changes++;onChange();}
    },
    proof:()=>({mode,scale,changes,pixelBudget:RENDER_QUALITY_MODES[mode].pixels}),
  };
}
