'use strict';
const { app, BrowserWindow, WebContentsView, Menu, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { windowCommand, permittedNavigation, shellSender, listenLocalServer } = require('./policy.cjs');
const { requestUpdate } = require('./network.cjs');
app.setName('web pvp client');
if(process.platform==='win32')app.setAppUserModelId('Elsword.WebPVP.Desktop');

const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'content')
  : process.env.EL_DESKTOP_CONTENT || path.resolve(__dirname, '../../runtime/desktop-content');
const serverConfigPath = path.join(app.isPackaged ? path.dirname(process.execPath) : ROOT, 'server-config.json');
const DATA = !app.isPackaged && process.env.EL_DESKTOP_USER_DATA
  ? process.env.EL_DESKTOP_USER_DATA : path.join(app.getPath('appData'), 'ElswordWebPVP', 'desktop-v1');
fs.mkdirSync(DATA, { recursive: true });
app.setPath('userData', DATA);
app.setPath('sessionData', path.join(DATA, 'browser'));
process.chdir(DATA);
const logFile = path.join(DATA, 'launcher.log');
try { if (fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.previous'); } catch {}
function log(message) { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + String(message) + '\n'); } catch {} }

let window, game, local, controller, startup, closing = false, confirming = false;
let state = { phase:'starting', title:'Starting', message:'Checking the client version.', busy:true, hasGame:false };
let memoryTimer;
const shellPath = path.join(__dirname, 'index.html');
function emit(update = {}) {
  const previous = state.title;
  state = { ...state, ...update, fullscreen:window?.isFullScreen() || false, maximized:window?.isMaximized() || false };
  if (state.title !== previous) log(state.title);
  if (window && !window.isDestroyed()) window.webContents.send('launcher:state', state);
}
function layout() {
  if (window && game) {
    const [width,height] = window.getContentSize();
    game.setBounds({ x:0, y:44, width, height:Math.max(1,height-44) });
  }
  emit();
}
async function stopGame() {
  if (game) {
    const old = game; game = null;
    window?.contentView.removeChildView(old);
    if (!old.webContents.isDestroyed()) old.webContents.close({ waitForBeforeUnload:false });
  }
  if (local) { const old = local; local = null; await old.close(); }
  emit({ hasGame:false });
}
async function confirmAction(message, button) {
  if (confirming || closing) return false;
  confirming = true;
  try {
    const result = await dialog.showMessageBox(window, { type:'question', title:'web pvp client', message,
      buttons:[button,'Cancel'], defaultId:1, cancelId:1, noLink:true });
    return result.response === 0;
  } finally { confirming = false; }
}
async function action(command) {
  if (!window || window.isDestroyed() || closing) return;
  switch (command) {
    case 'minimize': window.minimize(); break;
    case 'maximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break;
    case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'quit': app.quit(); break;
    case 'logs': await shell.openPath(DATA); break;
    case 'folder': await shell.openPath(app.isPackaged ? path.dirname(process.execPath) : ROOT); break;
    case 'refresh':
      if (state.busy) return;
      if (!game || !await confirmAction('Reload the game? This may interrupt your current match.','Reload game')) return;
      // Recreate a renderer even when its JS thread is stuck; the controls live
      // in a separate WebContents and therefore remain usable.
      await openGame(); break;
    case 'update':
      if (state.busy) return;
      if (game && !await confirmAction('Checking for updates closes the game. Finish your match before continuing.','Close game and check')) return;
      await stopGame(); await begin(); break;
    case 'retry': if (!state.busy) await begin(); break;
    default: throw Error('Unsupported window action');
  }
  emit();
}
function configureKeys(contents) {
  contents.setIgnoreMenuShortcuts(true);
  contents.on('before-input-event', (event,input) => {
    const command = windowCommand(input);
    if (command) { event.preventDefault(); void action(command).catch(error => log(error.message)); }
  });
}
async function openGame() {
  if (!local || closing) return;
  if (game) { const old = game; game = null; window.contentView.removeChildView(old); old.webContents.close({waitForBeforeUnload:false}); }
  const origin = 'http://127.0.0.1:' + local.server.address().port;
  const view = new WebContentsView({ webPreferences:{ preload:path.join(__dirname,'game-preload.cjs'),
    partition:'persist:game', sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  game = view; window.contentView.addChildView(view); layout();
  const contents = view.webContents;
  configureKeys(contents);
  contents.setWindowOpenHandler(() => ({action:'deny'}));
  contents.on('will-navigate', (event,url) => { if (!permittedNavigation(url,origin)) event.preventDefault(); });
  contents.on('will-redirect', (event,url) => { if (!permittedNavigation(url,origin)) event.preventDefault(); });
  contents.on('will-prevent-unload', event => event.preventDefault());
  contents.on('render-process-gone', (_event,details) => {
    log('Game renderer exited: ' + details.reason + '; exitCode=' + details.exitCode);
    if (game === view && !closing) { view.setVisible(false); emit({phase:'error',title:'Game stopped',message:details.reason==='oom'?'The game ran out of memory. Select Retry to restart it, or check for updates.':'Select Retry or Refresh to reload the game, or check for updates.',busy:false,hasGame:true,detail:'Reason: '+details.reason}); }
  });
  contents.on('unresponsive', () => {
    if (game === view) { view.setVisible(false); emit({phase:'error',title:'Game is not responding',message:'Select Refresh to reload the game. This interrupts the current match.',busy:false,hasGame:true,detail:''}); }
  });
  contents.on('responsive', () => { if(game === view) { view.setVisible(true); emit({phase:'playing',title:'Game running',message:'',hasGame:true,busy:false}); } });
  contents.on('did-fail-load', (_event,code,description,_url,mainFrame) => {
    if (mainFrame && code !== -3 && game === view) { view.setVisible(false); emit({phase:'error',title:'Unable to load the game',message:'Select Refresh to try again. Error: '+description,busy:false,hasGame:true}); }
  });
  await contents.loadURL(origin + '/');
  if (closing || game !== view) return;
  emit({phase:'playing',title:'Game running',message:'',hasGame:true,busy:false,detail:''}); contents.focus();
}
async function boot() {
  controller = new AbortController();
  emit({phase:'checking',title:'Check for updates',message:'Connecting to the game server to check for updates…',detail:'',progress:undefined,busy:true,hasGame:false});
  try {
    const { updateLocalClient } = await import(pathToFileURL(path.join(ROOT,'apps/local-client/updater.mjs')).href);
    let total = 0, received = 0, lastByte = Date.now(), lastPaint = 0;
    const timer = setInterval(() => {
      if (total && state.phase === 'downloading' && Date.now()-lastByte > 5000) emit({message:'Waiting for bandwidth. Matches in progress have priority over downloads.'});
    }, 2000);
    let updateState;
    try {
      updateState = await updateLocalClient({root:ROOT, configPath:serverConfigPath, log:message => {log(message); emit({title:'Updating',message});},
        request:async (origin,endpoint,options) => {
          const base = received;
          const response = await requestUpdate(origin,endpoint,{...options,signal:controller.signal,onProgress:size => {
            lastByte = Date.now(); received = base + size;
            if (total && Date.now()-lastPaint > 150) { lastPaint = Date.now(); emit({phase:'downloading',title:'Updating',message:'Downloading and verifying update files…',detail:(received/1000000).toFixed(2)+' / '+(total/1000000).toFixed(2)+' MB',progress:Math.min(.98,received/total)}); }
          }});
          if (endpoint === '/api/client-update/plan' && response.status === 200) {
            const plan = JSON.parse(response.bytes);
            if (plan.status === 'update-available') { total = plan.bytes; emit({phase:'downloading',title:'Updating',message:'Update found. Downloading…',progress:0}); }
          }
          return response;
        },hooks:{beforeCommit:() => emit({phase:'installing',title:'Installing update',message:'Download verified. Saving the new version…',progress:1})}});
    } finally { clearInterval(timer); }
    if (closing) return;
    if (updateState.status === 'updated') { emit({title:'Update complete',message:'Restarting…',progress:1}); app.relaunch(); app.quit(); return; }
    if (updateState.status === 'full-client-required') {
      const {fullClientRequiredMessage}=await import(pathToFileURL(path.join(ROOT,'apps/local-client/update-messages.mjs')).href);
      emit({phase:'full-client-required',title:'Full client update required',message:fullClientRequiredMessage(updateState),detail:'Your account and characters are stored on the server.',busy:false}); return;
    }
    emit({phase:'verifying',title:'Verifying local assets',message:'Checking the client files…',detail:'The first launch may take a while.',progress:undefined});
    const { createLocalClient } = await import(pathToFileURL(path.join(ROOT,'apps/local-client/client.mjs')).href);
    local = await createLocalClient({root:ROOT,configPath:serverConfigPath,updateState});
    if (closing) { await stopGame(); return; }
    // Remember the first assigned port: changing origins on every launch would
    // discard localStorage preferences such as audio volume and remembered ID.
    // Never attach to a server already occupying this port.
    const settingsFile = path.join(DATA,'local-origin.json');
    let port = 0;
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile,'utf8'));
      if(Number.isInteger(settings.port) && settings.port > 1023 && settings.port < 65536) port = settings.port;
    } catch {}
    const boundPort = await listenLocalServer(local.server, port);
    if (port && boundPort !== port) log('Saved port unavailable: '+port+'; assigned '+boundPort);
    fs.writeFileSync(settingsFile,JSON.stringify({port:boundPort})+'\n');
    await openGame();
  } catch (error) {
    log('Startup failed: ' + error.message);
    if (!closing) { await stopGame(); emit({phase:'error',title:'Unable to start',message:'Check your connection and files, then try again.\n'+error.message,detail:'Interrupted updates restore the previous files. Check the diagnostic log for details.',progress:undefined,busy:false}); }
  }
}
function begin() {
  if (state.busy && startup) return startup;
  emit({busy:true,title:'Restarting client',message:'Closing the game and its local connections…'});
  startup = (async () => { await stopGame(); if (!closing) await boot(); })();
  return startup;
}
async function shutdown() {
  if (closing) return;
  closing = true; controller?.abort();
  clearInterval(memoryTimer);
  // Give an in-progress install time to finish/roll back; the existing durable
  // journal recovers interrupted replacement on the next launch if needed.
  const deadline = setTimeout(() => app.exit(0),15000);
  try { await startup; await stopGame(); } finally { clearTimeout(deadline); app.exit(0); }
}

if (!app.requestSingleInstanceLock({contentRoot:ROOT})) app.quit();
else {
  app.on('second-instance', (_event,_argv,_cwd,data) => {
    if (!window) return;
    if (window.isMinimized()) window.restore(); window.show(); window.focus();
    if (data?.contentRoot !== ROOT) void dialog.showMessageBox(window,{type:'info',title:'Client already running',message:'A client from another folder is already running. Close its window before starting this copy.',detail:app.isPackaged?path.dirname(process.execPath):ROOT});
  });
  app.on('before-quit', event => { event.preventDefault(); void shutdown(); });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    memoryTimer = setInterval(() => {
      try { log('Process memory KiB: '+JSON.stringify(app.getAppMetrics().map(({pid,type,memory})=>({pid,type,memory})))); } catch {}
    }, 60000);
    memoryTimer.unref();
    Menu.setApplicationMenu(null);
    // Use the executable's real Windows icon for both the title bar and updater.
    // Reading it at runtime also follows the icon of a future branded executable.
    let programIcon;
    try {
      programIcon = await app.getFileIcon(process.execPath,{size:'large'});
      if (!programIcon.isEmpty()) state.icon = programIcon.toDataURL();
      else programIcon = undefined;
    } catch (error) { log('Program icon unavailable: '+error.message); }
    window = new BrowserWindow({title:'web pvp client',icon:programIcon,width:1340,height:850,minWidth:960,minHeight:600,
      show:false,backgroundColor:'#11151d',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    configureKeys(window.webContents);
    window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const gameSession = session.fromPartition('persist:game');
    gameSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
    gameSession.setPermissionCheckHandler(() => false);
    ipcMain.handle('launcher:state', event => { if(!shellSender(event,window.webContents,shellPath))throw Error('Invalid window');return state; });
    ipcMain.handle('launcher:action', (event,command) => {
      if(!shellSender(event,window.webContents,shellPath)||typeof command!=='string')throw Error('Invalid window');
      return action(command);
    });
    for(const name of ['resize','maximize','unmaximize','enter-full-screen','leave-full-screen'])window.on(name,layout);
    window.on('focus', () => { if(game && state.phase==='playing')game.webContents.focus(); });
    window.on('close', event => { event.preventDefault(); app.quit(); });
    await window.loadFile(shellPath); window.show();
    log('Launcher 1.0.0; Electron '+process.versions.electron+'; Chromium '+process.versions.chrome);
    await begin();
  }).catch(error => { log(error.stack); dialog.showErrorBox('Unable to start the client',error.message);app.exit(1); });
}

// Local integration harness only; packaged windows expose no test IPC or API.
if (!app.isPackaged) module.exports = { getState:() => ({...state}), getWindow:() => window,
  getGame:() => game, getLocal:() => local, action };
