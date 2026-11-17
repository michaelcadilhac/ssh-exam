const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { proxy, listen } = require('../scripts/stress-browser-worker.cjs');

test('private Unix/TCP bridges preserve a large bidirectional reply after a client half-close', { timeout: 5000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-proxy-'));
  const sockets = new Set();
  const echo = net.createServer({ allowHalfOpen: true }, socket => {
    const chunks = []; socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => socket.end(Buffer.concat(chunks)));
  });
  const endpoint = await listen(echo, { host: '127.0.0.1', port: 0 });
  const a = proxy({ host: '127.0.0.1', port: endpoint.port }, sockets);
  const socketPath = path.join(root, 'private.sock'); await listen(a, socketPath);
  assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
  const b = proxy({ path: socketPath }, sockets);
  const exposed = await listen(b, { host: '127.0.0.1', port: 0 });
  const client = net.createConnection({ host: '127.0.0.1', port: exposed.port });
  const payload = Buffer.alloc(2 * 1024 * 1024, 37), received = [];
  client.on('data', chunk => received.push(chunk));
  try { client.end(payload); await once(client, 'close'); assert.deepEqual(Buffer.concat(received), payload); }
  finally {
    client.destroy(); for (const socket of sockets) socket.destroy();
    await Promise.all([a, b, echo].map(server => new Promise(resolve => server.close(resolve))));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unavailable private peer closes only its owned socket without an unhandled error', { timeout: 3000 }, async () => {
  const sockets = new Set(), server = proxy({ path: '/nonexistent-synthetic-stress-peer' }, sockets);
  const address = await listen(server, { host: '127.0.0.1', port: 0 });
  const client = net.createConnection({ host: '127.0.0.1', port: address.port });
  client.on('error', () => {});
  try { await once(client, 'close'); await new Promise(resolve => setImmediate(resolve)); assert.equal(sockets.size, 0); }
  finally { client.destroy(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});

test('proxy capacity refuses a new client while an admitted connection stays usable', { timeout: 3000 }, async () => {
  const sockets = new Set(); let accepted = 0;
  const echo = net.createServer(socket => { accepted++; socket.pipe(socket); });
  const target = await listen(echo, { host: '127.0.0.1', port: 0 });
  const server = proxy({ host: '127.0.0.1', port: target.port }, sockets, 1);
  const address = await listen(server, { host: '127.0.0.1', port: 0 });
  const first = net.createConnection({ host: '127.0.0.1', port: address.port });
  await once(first, 'connect');
  const echoed = once(first, 'data'); first.write('before'); assert.equal(String((await echoed)[0]), 'before');
  const second = net.createConnection({ host: '127.0.0.1', port: address.port }); second.on('error', () => {});
  try {
    await once(second, 'close'); assert.equal(accepted, 1);
    const reply = once(first, 'data'); first.write('after'); assert.equal(String((await reply)[0]), 'after');
  } finally {
    first.destroy(); second.destroy(); for (const socket of sockets) socket.destroy();
    await Promise.all([server, echo].map(server => new Promise(resolve => server.close(resolve))));
  }
});
