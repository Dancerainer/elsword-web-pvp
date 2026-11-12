'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function windowCommand(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.control || input.meta || input.alt || input.shift) return null;
  if (input.key === 'F11') return 'fullscreen';
  if (input.key === 'F5') return 'refresh';
  return null;
}
function permittedNavigation(url, origin) {
  try { const parsed = new URL(url); return parsed.origin === origin && !parsed.username && !parsed.password; }
  catch { return false; }
}
function shellSender(event, shell, shellPath) {
  return event.sender === shell && event.senderFrame === shell.mainFrame
    && event.senderFrame.url === pathToFileURL(path.resolve(shellPath)).href;
}
async function listenLocalServer(server, preferredPort = 0) {
  const listen = port => new Promise((resolve, reject) => {
    const failed = error => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(server.address().port); };
    server.once('error', failed); server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  try { return await listen(preferredPort); }
  catch (error) {
    if (!preferredPort || !['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
    return listen(0);
  }
}
module.exports = { windowCommand, permittedNavigation, shellSender, listenLocalServer };
