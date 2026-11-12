/** Production view with completed one-pixel texture I/O for NullEngine.
 * Real source GLBs/pose data still load through SceneLoader. This does not
 * measure browser decoding, shader compilation, original pixels or GPU blend. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..');
const moduleUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const wrapper=moduleUrl(`export * from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
import {RawTexture,Engine} from ${JSON.stringify(import.meta.resolve('@babylonjs/core'))};
export class Texture extends RawTexture {constructor(path,scene,_noMipmap,_invertY,_samplingMode,onLoad){
 super(new Uint8Array([255,255,255,255]),1,1,Engine.TEXTUREFORMAT_RGBA,scene,false,false);
 this.url=path;this.getInternalTexture().isReady=true;queueMicrotask(()=>onLoad?.());
}}`);
const preparation=moduleUrl(`export {updateControlledEffectLookup,scheduleRenderPreparation,createPreparationDiagnostics} from ${JSON.stringify(pathToFileURL(resolve(root,'apps/web/render-preparation.mjs')).href)};
export function createRenderPreparationCache(){return async()=>{};}`);
const source=readFileSync(resolve(root,'apps/web/effects-view.mjs'),'utf8')
 .replace("from '@babylonjs/core'",'from '+JSON.stringify(wrapper))
 .replace("from './render-preparation.mjs'",'from '+JSON.stringify(preparation))
 .replace(/(import\s+(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,(_all,start,quote,file)=>
   start+quote+(file.startsWith('.')?pathToFileURL(resolve(root,'apps/web',file)).href:file.startsWith('data:')?file:import.meta.resolve(file))+quote);
export const {createEffectsView}=await import(moduleUrl(source));
