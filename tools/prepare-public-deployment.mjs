import {mkdir,readFile,writeFile,readdir,copyFile,lstat,rename} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyRuntime} from './verify-public-runtime.mjs';
import {runtimeAssetExclusionReason,isStandaloneAnimationAsset,animationSidecarEmbeddedInPose} from './runtime-asset-policy.mjs';

const ROOT = fileURLToPath(new URL('../',import.meta.url));
const RUNTIME_ROOTS = Object.freeze(['rf','ui','scene','audio']);
const OPTIONAL_RUNTIME_ROOTS = Object.freeze(['lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de','common','common-buffs','battle-life','cast-display','costumes','map-mechanics']);
// These are the extensions present in the actual RF/map/UI/audio runtime.
// Raw sources, executables, archives and arbitrary gzip files are not publishable.
const RUNTIME_EXTENSIONS = new Set(['.glb','.json','.ogg','.png','.ttf','.wav']);
const PROOF_DIRECTORY = /^(?:source|sources|proof|proofs|evidence|receipt|receipts|contracts|superseded|generated)(?:$|[-_])/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (parent,child) => {
  const relative = path.relative(parent,child);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

async function requirePath(file,kind) {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw Error('Asset snapshot cannot contain links: ' + file);
  if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) throw Error('Unexpected asset path type: ' + file);
}
async function requireNoLinkAncestors(file) {
  const absolute = path.resolve(file), drive = path.parse(absolute).root;
  let current = drive;
  for (const part of absolute.slice(drive.length).split(path.sep).filter(Boolean)) {
    current = path.join(current,part); await requirePath(current,'directory');
  }
}
async function mkdirWithoutLinks(directory) {
  try {await requirePath(directory,'directory');}
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdirWithoutLinks(path.dirname(directory)); await mkdir(directory);
  }
}
function nativeFiles(manifest) {
  if (manifest?.schemaVersion !== 1 || !manifest.modules || typeof manifest.modules !== 'object'
    || Array.isArray(manifest.modules) || Object.keys(manifest.modules).length !== 10) throw Error('Invalid native module inventory');
  const files = Object.values(manifest.modules).map(record => {
    if (!record || typeof record !== 'object' || typeof record.file !== 'string' || typeof record.sha256 !== 'string'
      || !/^[a-z0-9-]+\.wasm$/.test(record.file) || !/^[a-f0-9]{64}$/.test(record.sha256)) throw Error('Invalid top-level native module path or hash');
    return 'native/' + record.file;
  });
  if (new Set(files).size !== 10) throw Error('Duplicate native module file');
  return files.sort(compare);
}

/** Freeze only web runtime assets. Injected verifiers are for labeled fixture
 * tests; the CLI always initializes the actual sealed native runtime. */
export async function preparePublicDeployment({root = ROOT,source = path.join(root,'artifacts'),destination,
  verifier = verifyRuntime} = {}) {
  root = path.resolve(root); source = path.resolve(source);
  destination = path.resolve(destination ?? path.join(root,'runtime','public-assets',`${Date.now()}-${randomBytes(6).toString('hex')}`));
  if (inside(source,destination) || inside(destination,source)) throw Error('Asset snapshot must be separate from its source');
  if (typeof verifier !== 'function') throw TypeError('Runtime verifier required');
  await requireNoLinkAncestors(source);
  await requireNoLinkAncestors(path.join(root,'dist'));
  const bundleFile = path.join(root,'dist/game.js'); await requirePath(bundleFile,'file');
  const bundleSha256 = hash(await readFile(bundleFile));
  await requirePath(path.join(source,'native'),'directory');
  await requirePath(path.join(source,'native/manifest.json'),'file');
  const manifestBytes = await readFile(path.join(source,'native/manifest.json'));
  let manifest;
  try {manifest = JSON.parse(manifestBytes.toString('utf8'));} catch {throw Error('Invalid native manifest JSON');}
  const moduleFiles = nativeFiles(manifest);
  await mkdirWithoutLinks(path.dirname(destination)); await requireNoLinkAncestors(path.dirname(destination));
  // Existing snapshots are never overwritten, even after a previous failed run.
  await mkdir(destination);
  const inventory = {};
  const exclusions=[],proofInputs=new Map();
  const rfManifestBytes=await readFile(path.join(source,'rf/manifest.json'));
  const rfManifest=JSON.parse(rfManifestBytes.toString('utf8'));
  let hasRuntimeGlb=false;
  if(typeof rfManifest.runtimeGlb==='string'&&/^[a-zA-Z0-9_-]+\.glb$/.test(rfManifest.runtimeGlb)){
    try{await requirePath(path.join(source,'rf',rfManifest.runtimeGlb),'file');hasRuntimeGlb=true;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  proofInputs.set('rf/manifest.json',hash(rfManifestBytes));
  async function exclusion(file){
    let animationRedundant=false;
    if(isStandaloneAnimationAsset(file)){
      const pose=file.replace(/\.animation\.json$/,'.pose.json');
      try{
        for(const candidate of [file,pose]){await requireNoLinkAncestors(path.dirname(path.join(source,candidate)));await requirePath(path.join(source,candidate),'file');}
        const animationBytes=await readFile(path.join(source,file)),poseBytes=await readFile(path.join(source,pose));
        animationRedundant=animationSidecarEmbeddedInPose(JSON.parse(animationBytes),JSON.parse(poseBytes));
        if(animationRedundant){proofInputs.set(file,hash(animationBytes));proofInputs.set(pose,hash(poseBytes));}
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const reason=runtimeAssetExclusionReason(file,{rfManifest,hasRuntimeGlb,animationRedundant});
    if(reason){const bytes=await readFile(path.join(source,file));exclusions.push({file,bytes:bytes.length,sha256:hash(bytes),reason});}
    return reason;
  }
  async function copy(relative,expectedBytes) {
    const input = path.join(source,relative), output = path.join(destination,relative);
    await requireNoLinkAncestors(path.dirname(input)); await requirePath(input,'file');
    const before = await readFile(input);
    if (expectedBytes && !before.equals(expectedBytes)) throw Error('Asset changed before copying: ' + relative);
    inventory[relative] = hash(before);
    await mkdir(path.dirname(output),{recursive:true});
    await copyFile(input,output);
    await requirePath(input,'file'); await requirePath(output,'file');
    if (hash(await readFile(output)) !== inventory[relative]) throw Error('Asset changed while copying: ' + relative);
  }
  async function walk(relative) {
    await requirePath(path.join(source,relative),'directory');
    const entries = (await readdir(path.join(source,relative),{withFileTypes:true})).sort((a,b) => compare(a.name,b.name));
    for (const entry of entries) {
      const file = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error('Asset snapshot cannot contain links: ' + file);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !PROOF_DIRECTORY.test(entry.name)) await walk(file);
      } else if (entry.isFile()) {
        if (!entry.name.startsWith('.') && (RUNTIME_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || /\.json\.gz$/i.test(entry.name)) && !await exclusion(file)) await copy(file);
      } else throw Error('Unexpected asset path type: ' + file);
    }
  }
  const runtimeRoots=[...RUNTIME_ROOTS];
  for(const directory of OPTIONAL_RUNTIME_ROOTS){
    try{await requirePath(path.join(source,directory),'directory');runtimeRoots.push(directory);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for (const directory of runtimeRoots) await walk(directory);
  await copy('native/manifest.json',manifestBytes);
  for (const file of moduleFiles) await copy(file);
  const native = await verifier(async file => {
    if (!Object.hasOwn(inventory,file)) throw Error('Verifier requested non-snapshot asset: ' + file);
    return readFile(path.join(destination,file));
  });
  for (const [file,expected] of Object.entries(inventory)) {
    await requireNoLinkAncestors(path.dirname(path.join(source,file))); await requirePath(path.join(source,file),'file');
    await requireNoLinkAncestors(path.dirname(path.join(destination,file))); await requirePath(path.join(destination,file),'file');
    if (hash(await readFile(path.join(source,file))) !== expected) throw Error('Source asset changed during preparation: ' + file);
    if (hash(await readFile(path.join(destination,file))) !== expected) throw Error('Snapshot asset changed during preparation: ' + file);
  }
  for(const [file,expected]of proofInputs)if(hash(await readFile(path.join(source,file)))!==expected)throw Error('Asset exclusion evidence changed during preparation: '+file);
  await requirePath(bundleFile,'file');
  if (hash(await readFile(bundleFile)) !== bundleSha256) throw Error('Browser bundle changed during preparation');
  const metadata = {schemaVersion:1,assetRoot:destination,assetSourceRoot:source,bundleSha256,native,
    assetPolicy:{schemaVersion:1,runtimeRoots,nativeFiles:['native/manifest.json',...moduleFiles],exclusions},files:inventory};
  const metadataFile = path.join(root,'dist/deployment.json'), temporary = metadataFile + '.' + randomBytes(6).toString('hex');
  await writeFile(temporary,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'}); await rename(temporary,metadataFile);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metadata = await preparePublicDeployment({source:path.resolve(process.argv[2] || path.join(ROOT,'artifacts'))});
  console.log(JSON.stringify({assetRoot:metadata.assetRoot,bundleSha256:metadata.bundleSha256,
    nativeVersion:metadata.native.runtimeVersion,fileCount:Object.keys(metadata.files).length}));
}
