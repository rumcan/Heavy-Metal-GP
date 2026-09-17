// ══════════════════════════════════════════════════════════════════════════
// MP-10 — a network you can unplug.
//
// The reconnect suite needs the one failure a browser cannot fake with
// `context.setOffline()`: the page stays ONLINE and only the ROOM SERVER stops
// answering. That is a different bug surface from "the whole tab is offline" —
// the SDK's own reconnect logic runs, the seat is held by the room, and the
// driver's marble keeps rolling under the AI.
//
// So: a TCP proxy in front of the sidecar that forwards everything while it is
// OPEN, and swallows everything while it is CLOSED (existing sockets cut, new
// data dropped) — the shape of a network partition, not of a refusal.
//
//   node tests/e2e-mp/sidecar-blackhole.mjs --listen 9101 --target 9001 --control 9102
//   curl -X POST localhost:9102/close     # partition
//   curl -X POST localhost:9102/open      # heal
//
// No dependencies, no root, no iptables. Kill it with SIGTERM.
// ══════════════════════════════════════════════════════════════════════════
import { createServer as createTcpServer, connect as tcpConnect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  return value && !value.startsWith('--') ? Number(value) : fallback;
}

const LISTEN = arg('listen', 9101);
const TARGET = arg('target', 9001);
const CONTROL = arg('control', 9102);

/** @type {Set<import('node:net').Socket>} Sockets currently being cut. */
const live = new Set();
let open = true;

const proxy = createTcpServer((from) => {
  live.add(from);
  const to = tcpConnect({ host: '127.0.0.1', port: TARGET }, () => {
    if (open) to.pipe(from).pipe(to);
    else from.end();
  });
  to.on('error', () => from.destroy());
  from.on('error', () => to.destroy());
  from.on('close', () => {
    live.delete(from);
    to.destroy();
  });
  // A partition is not a refusal: while closed, bytes go in and nothing comes
  // out — which is exactly what a dropped socket looks like from the page.
  from.on('data', (chunk) => {
    if (!open) return;
    if (!to.destroyed) to.write(chunk);
  });
});

const control = createHttpServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/state') return send(200, { open, sockets: live.size });
  if (req.method !== 'POST') return send(405, { error: 'POST /open or /close' });
  if (req.url === '/close') {
    open = false;
    // Cut the sockets that are already through: a partition takes the
    // conversation with it, it does not leave it half-open.
    for (const socket of live) socket.destroy();
  } else if (req.url === '/open') {
    open = true;
  } else {
    return send(404, { error: 'unknown' });
  }
  send(200, { open });
});

proxy.listen(LISTEN, '127.0.0.1');
control.listen(CONTROL, '127.0.0.1');
process.stdout.write(`sidecar blackhole: 127.0.0.1:${LISTEN} → 127.0.0.1:${TARGET} (control http://127.0.0.1:${CONTROL})\n`);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    proxy.close();
    control.close();
    for (const socket of live) socket.destroy();
    process.exit(0);
  });
}
