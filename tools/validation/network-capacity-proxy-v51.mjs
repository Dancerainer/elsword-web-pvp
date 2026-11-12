/** Capacity-only diagnostic copy of network-health-proxy-v7.mjs.
 * Its delay, jitter, token buckets and live-flow scheduling are unchanged.
 * Byte frontiers distinguish source data, socket.write and write callbacks;
 * none proves that the remote client has read or decompressed these bytes.
 * No response/request bodies, query strings or headers enter diagnostics.
 */
import net from 'node:net';
import {performance} from 'node:perf_hooks';

const SAMPLE_INTERVAL_MS = 100;
const REQUEST_LINE_LIMIT = 2048;

function boundedSamples(limit) {
  const rows = [];
  let next = 0, dropped = 0;
  return {
    push(row) {
      if (rows.length < limit) rows.push(row);
      else { rows[next] = row; next = (next + 1) % limit; dropped++; }
    },
    snapshot() {
      return {samples: dropped ? [...rows.slice(next), ...rows.slice(0, next)] : [...rows], droppedSamples: dropped};
    },
  };
}

// Inspect only the first request line, retaining at most 2048 bytes until LF.
// A TCP flow can be reused by HTTP keep-alive: this is explicitly the FIRST
// request path, not a claim that every later byte belongs to this request.
function firstRequestPath(connection, data) {
  if (connection.requestLineComplete) return;
  const newline = data.indexOf(10);
  const length = newline < 0 ? data.length : newline + 1;
  if (connection.requestLine.length + length > REQUEST_LINE_LIMIT) {
    connection.requestLine = Buffer.alloc(0);
    connection.requestLineComplete = true;
    connection.pathStatus = 'request-line-limit';
    return;
  }
  connection.requestLine = Buffer.concat([connection.requestLine, data.subarray(0, length)]);
  if (newline < 0) return;
  const line = connection.requestLine.toString('ascii');
  connection.requestLine = Buffer.alloc(0);
  connection.requestLineComplete = true;
  const match = /^[A-Z]+ ([^\s]+) HTTP\/1\.[01]\r?\n$/.exec(line);
  if (!match || !(match[1].startsWith('/') || /^https?:\/\//i.test(match[1]))) {
    connection.pathStatus = 'unrecognized-request-line';
    return;
  }
  try {
    connection.firstRequestPath = match[1].startsWith('/')
      ? match[1].split(/[?#]/, 1)[0]
      : new URL(match[1]).pathname;
    connection.pathStatus = 'first-request-path-only';
  } catch { connection.pathStatus = 'invalid-request-target'; }
}

export async function createCapacityTcpProxy({
  upstreamPort, players, egressBytesPerSecond = 625000, oneWayMs = 80, slowPlayer = -1,
  slowBytesPerSecond = 32768, pausePlayer = -1, pauseAtWallMs = Infinity, pauseDurationMs = 0,
  queueHighWater = 32768, perPlayerOneWayMs = null, jitterMs = 0, jitterSeed = 17,
  maxDiagnosticSamples = 16384,
} = {}) {
  if (!Number.isInteger(maxDiagnosticSamples) || maxDiagnosticSamples < 1 || maxDiagnosticSamples > 131072) {
    throw new RangeError('maxDiagnosticSamples must be an integer from 1 to 131072');
  }
  const flows = new Map(), closedFlows = [], servers = [], events = [], bins = new Map(), queueSamples = [];
  const samples = boundedSamples(maxDiagnosticSamples);
  let closed = false, nextId = 0, nextConnectionId = 0, lastDownId = 0;
  let jitterState = jitterSeed >>> 0 || 1, lastQueueSample = -Infinity, maxSharedDownQueuedBytes = 0;
  const bucket = rate => ({rate, tokens: Number.isFinite(rate) ? rate * .01 : Infinity, at: performance.now()});
  const shared = bucket(egressBytesPerSecond);
  const individual = Array.from({length: players}, (_, i) => bucket(i === slowPlayer ? slowBytesPerSecond : Infinity));
  const debit = (b, bytes) => { if (Number.isFinite(b.rate)) b.tokens -= bytes; };
  function refresh(b, now) {
    if (Number.isFinite(b.rate)) { b.tokens = Math.min(b.rate * .02, b.tokens + (now - b.at) * b.rate / 1000); b.at = now; }
  }
  function record(flow, bytes) {
    const key = Math.floor(Date.now() / 100), row = bins.get(key) ?? {atWallMs: key * 100, down: 0, up: 0, players: {}};
    const direction = flow.direction === 'down' ? 'down' : 'up';
    row[direction] += bytes; row.players[flow.player] ??= {down: 0, up: 0}; row.players[flow.player][direction] += bytes; bins.set(key, row);
  }
  function observeSocket(flow) {
    if (!flow.destination) return;
    const f = flow.frontiers, socket = flow.destination;
    f.writableLength = socket.writableLength;
    f.maxWritableLength = Math.max(f.maxWritableLength, f.writableLength);
    f.writableNeedDrain = socket.writableNeedDrain;
    f.socketBytesWritten = socket.bytesWritten;
  }
  function flowRecord(flow) {
    observeSocket(flow);
    const {id, player, direction, bytes, maxQueueBytes, closed, queuedBytes, maxReadyWaitMs,
      abortedQueuedBytes = 0, createdAtWallMs, closedAtWallMs = null, closeReason = null, connection, frontiers} = flow;
    return {id, connectionId: connection.id, player, direction, bytes, maxQueueBytes, closed, queuedBytes, maxReadyWaitMs,
      abortedQueuedBytes, createdAtWallMs, closedAtWallMs, closeReason,
      firstRequestPath: connection.firstRequestPath, pathStatus: connection.pathStatus, ...frontiers,
      pendingWriteCallbackBytes: frontiers.writeBytes - frontiers.writeCallbackBytes - frontiers.writeCallbackErrorBytes};
  }
  function observeWait(flow, now = performance.now()) {
    if (flow.queue.length) flow.maxReadyWaitMs = Math.max(flow.maxReadyWaitMs, Math.max(0, now - flow.queue[0].readyAt));
  }
  function observeSharedQueue() {
    const bytes = [...flows.values()].filter(row => row.direction === 'down').reduce((sum, row) => sum + row.queuedBytes, 0);
    maxSharedDownQueuedBytes = Math.max(maxSharedDownQueuedBytes, bytes); return bytes;
  }
  function archive(flow, reason) {
    if (flow.closed) return;
    observeWait(flow); observeSharedQueue(); observeSocket(flow);
    flow.closed = true; flow.closedAtWallMs = Date.now(); flow.closeReason = reason;
    flow.abortedQueuedBytes = flow.queuedBytes; flow.queue.length = 0; flow.queuedBytes = 0;
    flows.delete(flow.id);
    // Keep counter objects, not sockets/buffers. A callback after close still
    // updates the archived frontier instead of being silently lost.
    const {source, destination, queue, ...record} = flow;
    closedFlows.push(record);
  }
  function attach(source, destination, player, direction, connection) {
    const frontiers = {sourceBytes: 0, sourceChunks: 0, maxSourceChunkBytes: 0, firstSourceAtWallMs: null, lastSourceAtWallMs: null,
      writeBytes: 0, writeCalls: 0, firstWriteAtWallMs: null, lastWriteAtWallMs: null,
      writeCallbackBytes: 0, writeCallbackCalls: 0, writeCallbackErrorBytes: 0, writeCallbackErrors: 0,
      lastWriteCallbackAtWallMs: null, maxWriteCallbackWaitMs: 0,
      writableLength: 0, maxWritableLength: 0, writableNeedDrain: false, needDrainObservations: 0,
      writeReturnedFalse: 0, drainEvents: 0, socketBytesWritten: 0};
    const flow = {id: ++nextId, player, direction, source, destination, connection, frontiers,
      queue: [], queuedBytes: 0, sourceEnded: false, sourceClosed: false, closed: false,
      bytes: 0, maxQueueBytes: 0, maxReadyWaitMs: 0, createdAtWallMs: Date.now()};
    flows.set(flow.id, flow);
    source.on('data', data => {
      if (flow.closed) return;
      const at = Date.now(); frontiers.sourceBytes += data.length; frontiers.sourceChunks++;
      frontiers.maxSourceChunkBytes = Math.max(frontiers.maxSourceChunkBytes, data.length);
      frontiers.firstSourceAtWallMs ??= at; frontiers.lastSourceAtWallMs = at;
      if (direction === 'up') firstRequestPath(connection, data);
      jitterState ^= jitterState << 13; jitterState ^= jitterState >>> 17; jitterState ^= jitterState << 5;
      const jitter = ((jitterState >>> 0) / 4294967296 * 2 - 1) * jitterMs;
      const delay = Math.max(0, (perPlayerOneWayMs?.[player] ?? oneWayMs) + jitter);
      const readyAt = Math.max(flow.queue.at(-1)?.readyAt ?? 0, performance.now() + delay);
      flow.queue.push({data, offset: 0, readyAt}); flow.queuedBytes += data.length;
      flow.maxQueueBytes = Math.max(flow.maxQueueBytes, flow.queuedBytes); observeSharedQueue();
      if (flow.queuedBytes >= queueHighWater) source.pause();
    });
    source.on('end', () => { flow.sourceEnded = true; });
    destination.on('drain', () => { frontiers.drainEvents++; observeSocket(flow); });
    source.on('error', () => {}); destination.on('error', () => {});
    source.on('close', hadError => {
      flow.sourceClosed = true;
      if (flow.closed) return;
      if (flow.sourceEnded && !hadError) {
        if (!flow.queue.length && !destination.destroyed) destination.end();
        return;
      }
      archive(flow, 'source-aborted'); if (!destination.destroyed) destination.destroy();
    });
    destination.on('close', () => archive(flow, 'destination-closed'));
    return flow;
  }
  function sendPiece(flow, now) {
    if (flow.closed || flow.destination.destroyed || flow.destination.writableNeedDrain || !flow.queue.length) return 0;
    if (flow.direction === 'down' && flow.player === pausePlayer && Date.now() >= pauseAtWallMs && Date.now() < pauseAtWallMs + pauseDurationMs) return 0;
    const row = flow.queue[0]; if (row.readyAt > now) return 0;
    const available = flow.direction === 'down' ? Math.floor(Math.min(shared.tokens, individual[flow.player].tokens)) : Infinity;
    const bytes = Math.min(1500, row.data.length - row.offset, available); if (bytes < 1) return 0;
    if (flow.direction === 'down') { debit(shared, bytes); debit(individual[flow.player], bytes); }
    const frontiers = flow.frontiers, writeAt = performance.now(), atWallMs = Date.now();
    frontiers.writeBytes += bytes; frontiers.writeCalls++;
    frontiers.firstWriteAtWallMs ??= atWallMs; frontiers.lastWriteAtWallMs = atWallMs;
    const accepted = flow.destination.write(row.data.subarray(row.offset, row.offset + bytes), error => {
      frontiers.writeCallbackCalls++;
      frontiers.lastWriteCallbackAtWallMs = Date.now();
      frontiers.maxWriteCallbackWaitMs = Math.max(frontiers.maxWriteCallbackWaitMs, performance.now() - writeAt);
      if (error) { frontiers.writeCallbackErrors++; frontiers.writeCallbackErrorBytes += bytes; }
      else frontiers.writeCallbackBytes += bytes;
      observeSocket(flow);
    });
    if (!accepted) frontiers.writeReturnedFalse++;
    observeSocket(flow);
    row.offset += bytes; flow.queuedBytes -= bytes; flow.bytes += bytes; record(flow, bytes);
    if (row.offset === row.data.length) flow.queue.shift(); return bytes;
  }
  const timer = setInterval(() => {
    if (closed) return;
    const now = performance.now(); refresh(shared, now); for (const b of individual) refresh(b, now);
    const live = [...flows.values()], down = live.filter(flow => flow.direction === 'down');
    for (const flow of live) observeWait(flow, now);
    const sharedQueuedBytes = observeSharedQueue();
    if (now - lastQueueSample >= SAMPLE_INTERVAL_MS) {
      lastQueueSample = now;
      const atWallMs = Date.now();
      queueSamples.push({atWallMs, downQueuedBytes: sharedQueuedBytes,
        readyDownQueuedBytes: down.reduce((n, flow) => n + flow.queue.reduce((sum, row) => sum + (row.readyAt <= now ? row.data.length - row.offset : 0), 0), 0)});
      for (const flow of live) {
        observeSocket(flow);
        if (flow.frontiers.writableNeedDrain) flow.frontiers.needDrainObservations++;
        samples.push({atWallMs, atMonoMs: now, ...flowRecord(flow)});
      }
    }
    // Preserve v7 scheduling: one 1500-byte piece per live flow per round,
    // rotating after actual writes, with at most 16 rounds per timer tick.
    let start = down.findIndex(flow => flow.id > lastDownId); if (start < 0) start = 0;
    for (let n = 0; n < down.length * 16; n++) {
      if (shared.tokens < 1) break;
      const flow = down[(start + n) % down.length]; if (sendPiece(flow, now)) lastDownId = flow.id;
    }
    for (const flow of live) {
      if (flow.direction === 'up') for (let pieces = 0; pieces < 16; pieces++) if (!sendPiece(flow, now)) break;
      if (flow.queuedBytes < queueHighWater / 2 && !flow.sourceEnded && !flow.sourceClosed) flow.source.resume();
      if (flow.sourceEnded && !flow.queue.length && !flow.destination.destroyed) flow.destination.end();
    }
  }, 2);
  for (let player = 0; player < players; player++) {
    const server = net.createServer({allowHalfOpen: true}, client => {
      const upstream = net.connect({host: '127.0.0.1', port: upstreamPort, allowHalfOpen: true});
      const connection = {id: ++nextConnectionId, firstRequestPath: null, pathStatus: 'awaiting-first-request-line',
        requestLine: Buffer.alloc(0), requestLineComplete: false};
      client.setNoDelay(true); upstream.setNoDelay(true); events.push({type: 'connection', player, atWallMs: Date.now()});
      attach(upstream, client, player, 'down', connection); attach(client, upstream, player, 'up', connection);
      client.once('close', () => events.push({type: 'close', player, atWallMs: Date.now()}));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  }
  return {
    ports: servers.map(server => server.address().port),
    setPause({player, atWallMs, durationMs}) {
      pausePlayer = player; pauseAtWallMs = atWallMs; pauseDurationMs = durationMs;
      events.push({type: 'pause-scheduled', player, atWallMs, durationMs});
    },
    snapshot() {
      for (const flow of flows.values()) observeWait(flow); observeSharedQueue();
      return {capturedAtWallMs: Date.now(), method: {
        egressBytesPerSecond: Number.isFinite(egressBytesPerSecond) ? egressBytesPerSecond : null,
        oneWayMs, perPlayerOneWayMs, jitterMs, jitterSeed, slowPlayer, slowBytesPerSecond, queueHighWater,
        fairScheduling: 'v2 live-flow round-robin after actual bytes sent, one 1500-byte piece per round; closed sockets removed; 20ms token cap; true socket backpressure; includes raw HTTP and WS framing, excludes TCP/IP headers and retransmissions',
      }, bins: [...bins.values()], events: [...events], queueSamples: [...queueSamples], maxSharedDownQueuedBytes,
      activeFlows: flows.size, closedFlowRecords: closedFlows.length,
      flows: [...closedFlows, ...flows.values()].map(flowRecord).sort((a, b) => a.id - b.id),
      diagnostics: {version: 'capacity-proxy-frontiers-v51', sampleIntervalMs: SAMPLE_INTERVAL_MS,
        maxSamples: maxDiagnosticSamples, ...samples.snapshot(),
        byteSemantics: 'sourceBytes is raw TCP data observed; writeBytes/legacy bytes is socket.write submission; writeCallbackBytes is successful local write callback, NOT receiver receipt; socketBytesWritten is Node socket accounting, NOT remote acknowledgement; encoded HTTP/gzip framing remains included',
        pathSemantics: 'firstRequestPath is only the first HTTP/1 request pathname for this TCP connection; later keep-alive requests are not classified; query, fragment, headers and body are never recorded',
      }};
    },
    closePlayer(player) {
      for (const flow of [...flows.values()]) if (flow.player === player) { flow.source.destroy(); flow.destination.destroy(); }
      events.push({type: 'forced-player-link-close', player, atWallMs: Date.now()});
    },
    async close() {
      closed = true; clearInterval(timer);
      for (const flow of flows.values()) { flow.source.destroy(); flow.destination.destroy(); }
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    },
  };
}

export const startNetworkCapacityProxy = createCapacityTcpProxy;
