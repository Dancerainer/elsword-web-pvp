// Only the document entry starts itself. Battle imports the reusable shell
// without evaluating another auto-start under a different module URL.
import {startLobbyShell} from './lobby-shell.mjs';
void startLobbyShell().catch(error=>{
 console.error('Lobby initialization failed',error);const host=document.querySelector('#app');if(!host)return;
 const panel=document.createElement('section');panel.className='lobby-entry-error';panel.setAttribute('role','alert');
 const text=document.createElement('p');text.textContent='Failed to initialize lobby: '+error.message;
 const reload=document.createElement('button');reload.textContent='Reload';reload.onclick=()=>window.location.reload();panel.append(text,reload);host.append(panel);
});
