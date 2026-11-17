// Private manual-test worker. No production caller or personal browser profile.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./playwright-core');

(async () => {
  process.umask(0o077);
  const root = __dirname;
  const temporary = path.join(root, 'temporary');
  fs.mkdirSync(temporary, { mode: 0o700 });
  process.env.TMPDIR = temporary;
  const server = await chromium.launchServer({
    executablePath: '/usr/bin/chromium', headless: true,
    chromiumSandbox: true, host: '127.0.0.1', port: 0, timeout: 30000,
    // Marco has ample tmpfs but little root-disk scratch. Chromium shared pages
    // remain charged to this worker's memory cgroup, instead of deleted disk files.
    ignoreDefaultArgs: ['--disable-dev-shm-usage'],
    downloadsPath: temporary, tracesDir: temporary,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TMPDIR: temporary },
    args: ['--disk-cache-size=10485760'],
  });
  const browserPid = server.process().pid;
  const browserStat = fs.readFileSync(`/proc/${browserPid}/stat`, 'utf8');
  fs.writeFileSync(path.join(root, 'endpoint.json'), JSON.stringify({
    endpoint: server.wsEndpoint(), browser_pid: browserPid,
    browser_start_ticks: browserStat.slice(browserStat.lastIndexOf(')') + 2).trim().split(/\s+/)[19],
    node_pid: process.pid,
  }), { mode: 0o600, flag: 'wx' });
  console.log('PRIVATE_BROWSER_READY');
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    fs.writeFileSync(path.join(root, 'closed.json'), JSON.stringify({ closed: true }),
      { mode: 0o600, flag: 'wx' });
    process.exit(0);
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  server.on('close', () => { if (!closing) process.exit(1); });
})().catch((error) => { console.error(error); process.exit(1); });
