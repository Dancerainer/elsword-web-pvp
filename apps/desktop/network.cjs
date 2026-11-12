'use strict';
const http = require('node:http');
const https = require('node:https');
// Same bounded, fixed-origin update transport as the portable client, with
// byte progress for the desktop window. Never logs URLs with credentials.
function requestUpdate(origin, endpoint, { body, limit = 2 * 1024 * 1024, onProgress = () => {}, signal } = {}) {
  const url = new URL(endpoint, origin);
  if (url.origin !== origin) throw Error('update-origin-changed');
  return new Promise((resolve, reject) => {
    const bytes = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: bytes ? 'POST' : 'GET', signal,
      headers: { 'Accept-Encoding':'identity', ...(bytes ? {Origin:origin,'Content-Type':'application/json','Content-Length':bytes.length} : {}) },
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); resolve({status:response.statusCode,bytes:Buffer.alloc(0)}); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) { response.destroy(Error('update-transfer-too-large')); return; }
        chunks.push(chunk); onProgress(size);
      });
      response.on('error', reject);
      response.on('end', () => resolve({status:200,bytes:Buffer.concat(chunks)}));
    });
    request.setTimeout(url.pathname.endsWith('/file') || url.pathname.endsWith('/plan') ? 900000 : 30000, () => request.destroy(Error('update-timeout')));
    request.on('error', reject); request.end(bytes);
  });
}
module.exports = { requestUpdate };
