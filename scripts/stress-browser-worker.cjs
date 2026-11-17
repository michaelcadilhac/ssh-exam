// Private manual-test worker. No production caller or personal browser profile.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

// Only the new user/network namespace is configured. Drop its capabilities
// before Node/Chromium run; no host interface, route or network service changes.
const NETNS_BOOTSTRAP = String.raw`
import ctypes,fcntl,os,socket,struct,subprocess,sys
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
r=fcntl.ioctl(s,0x8913,struct.pack('16sh',b'lo',0))
fcntl.ioctl(s,0x8914,struct.pack('16sh',b'lo',struct.unpack('16sh',r[:18])[1]|1));s.close()
# Chromium treats loopback-only networks as offline. Both ends stay inside this
# namespace; the private default route has no path to a host or external network.
for args in [
 ['link','add','exam-test0','type','veth','peer','name','exam-test1'],
 ['link','set','exam-test0','up'],['link','set','exam-test1','up'],
 ['addr','add','192.0.2.1/30','dev','exam-test0'],
 ['route','add','default','via','192.0.2.2','dev','exam-test0']]:
 subprocess.run(['/usr/bin/ip',*args],check=True)
libc=ctypes.CDLL(None,use_errno=True)
assert libc.prctl(47,4,0,0,0)==0
class Header(ctypes.Structure):_fields_=[('version',ctypes.c_uint32),('pid',ctypes.c_int)]
class Data(ctypes.Structure):_fields_=[('effective',ctypes.c_uint32),('permitted',ctypes.c_uint32),('inheritable',ctypes.c_uint32)]
h=Header(0x20080522,0);d=(Data*2)();assert libc.capset(ctypes.byref(h),ctypes.byref(d))==0
assert all(int(l.split()[1],16)==0 for l in open('/proc/self/status') if l.startswith(('CapEff:','CapPrm:','CapInh:','CapAmb:')))
os.execv(sys.argv[1],sys.argv[1:])
`;

function proxy(target, sockets, maximum = 1024) {
  return net.createServer({ allowHalfOpen: true }, incoming => {
    if (sockets.size >= maximum * 2) return incoming.destroy();
    const outgoing = net.createConnection({ ...target, allowHalfOpen: true });
    sockets.add(incoming); sockets.add(outgoing);
    for (const [source, peer] of [[incoming, outgoing], [outgoing, incoming]]) {
      source.setNoDelay(true);
      source.on('error', () => peer.destroy());
      source.on('close', () => { sockets.delete(source); peer.destroy(); });
    }
    incoming.pipe(outgoing); outgoing.pipe(incoming);
  });
}
function listen(server, address) {
  return new Promise((resolve, reject) => {
    const failed = error => reject(error);
    server.once('error', failed);
    server.listen(address, () => {
      server.removeListener('error', failed);
      if (typeof address === 'string') fs.chmodSync(address, 0o600);
      resolve(server.address());
    });
  });
}

async function main() {
  process.umask(0o077);
  const root = __dirname, temporary = path.join(root, 'temporary');
  const inner = process.argv[2] === '--private-network';
  if (!inner) fs.mkdirSync(temporary, { mode: 0o700 });
  const held = fs.lstatSync(temporary);
  assert(held.isDirectory() && held.uid === process.getuid() && (held.mode & 0o777) === 0o700);
  process.env.TMPDIR = temporary;
  const sockets = new Set(), servers = [];
  let child, browser, closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      if (browser) await browser.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const ended = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => { console.error('Owned namespace cleanup exceeded20s'); process.exit(1); }, 20000);
        await ended; clearTimeout(timer);
      }
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
      if (!inner) fs.writeFileSync(path.join(root, 'closed.json'), JSON.stringify({ closed: true }), { mode: 0o600, flag: 'wx' });
      process.exit(0);
    } catch (error) { console.error(error); process.exit(1); }
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  async function add(target, address) {
    const server = proxy(target, sockets); servers.push(server);
    return listen(server, address);
  }
  const hostNamespace = inner ? process.env.EXAM_STRESS_HOST_NETNS : fs.readlinkSync('/proc/self/ns/net');
  assert.match(hostNamespace || '', /^net:\[\d+\]$/);
  if (inner) {
    const namespace = fs.readlinkSync('/proc/self/ns/net');
    assert.notEqual(namespace, hostNamespace);
    const port = Number(process.env.EXAM_STRESS_BROWSER_PORT);
    assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
    await add({ path: path.join(root, 'web.sock') }, { host: '127.0.0.1', port: 9444 });
    await add({ path: path.join(root, 'relay.sock') }, { host: '127.0.0.1', port: 9445 });
    const { chromium } = require('./playwright-core');
    browser = await chromium.launchServer({
      executablePath: '/usr/bin/chromium', headless: true,
      chromiumSandbox: true, host: '127.0.0.1', port, timeout: 30000,
      ignoreDefaultArgs: ['--disable-dev-shm-usage'],
      downloadsPath: temporary, tracesDir: temporary,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: temporary },
      args: ['--disk-cache-size=10485760'],
    });
    await add({ host: '127.0.0.1', port }, path.join(root, 'control.sock'));
    const browserPid = browser.process().pid;
    const stat = fs.readFileSync(`/proc/${browserPid}/stat`, 'utf8');
    fs.writeFileSync(path.join(root, 'namespace-ready.json'), JSON.stringify({
      endpoint: browser.wsEndpoint(), browser_pid: browserPid,
      browser_start_ticks: stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19],
      namespace_node_pid: process.pid, browser_network_namespace: namespace,
      host_network_namespace: hostNamespace,
    }), { mode: 0o600, flag: 'wx' });
    browser.on('close', () => { if (!closing) process.exit(1); });
  } else {
    await add({ host: '127.0.0.1', port: 9444 }, path.join(root, 'web.sock'));
    await add({ host: '127.0.0.1', port: 9445 }, path.join(root, 'relay.sock'));
    const address = await add({ path: path.join(root, 'control.sock') }, { host: '127.0.0.1', port: 0 });
    child = spawn('/usr/bin/unshare', ['--user', '--map-current-user', '--net', '--keep-caps', '/usr/bin/python3', '-c', NETNS_BOOTSTRAP, '/usr/bin/node', __filename, '--private-network'], {
      stdio: 'inherit',
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: temporary, EXAM_STRESS_HOST_NETNS: hostNamespace, EXAM_STRESS_BROWSER_PORT: String(address.port) },
    });
    child.on('error', error => { console.error(error); process.exit(1); });
    child.on('exit', () => { if (!closing) process.exit(1); });
    const deadline = Date.now() + 35000;
    const readyPath = path.join(root, 'namespace-ready.json');
    while (!fs.existsSync(readyPath)) {
      assert(Date.now() < deadline, 'Private browser namespace did not become ready');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
    assert.equal(ready.namespace_node_pid, child.pid);
    assert.notEqual(ready.browser_network_namespace, hostNamespace);
    assert.equal(fs.readlinkSync(`/proc/${child.pid}/ns/net`), ready.browser_network_namespace);
    assert.equal(fs.readlinkSync(`/proc/${ready.browser_pid}/ns/net`), ready.browser_network_namespace);
    fs.writeFileSync(path.join(root, 'endpoint.json'), JSON.stringify({ ...ready, node_pid: process.pid }), { mode: 0o600, flag: 'wx' });
    console.log('PRIVATE_BROWSER_READY network=isolated-loopback');
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
else module.exports = { proxy, listen, NETNS_BOOTSTRAP };
