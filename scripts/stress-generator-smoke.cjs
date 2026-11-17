// Verify the owned remote browser and both reverse forwards before any guest starts.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { WebSocketServer } = require('ws');

(async () => {
  assert.match(process.env.EXAM_STRESS_BROWSER_WS || '', /^ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/);
  const timer = setTimeout(() => process.exit(124), 30000);
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/echo' ? req.headers.cookie || '' : '<title>Private synthetic generator</title>');
  });
  let browser, relay, localScratchChecked = false;
  try {
    if (process.env.EXAM_STRESS_LOCAL_SCRATCH) {
      const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-scratch-routing-'));
      try {
        assert.equal(path.dirname(probe), fs.realpathSync(process.env.EXAM_STRESS_LOCAL_SCRATCH));
        fs.writeFileSync(path.join(probe, 'probe'), 'private synthetic scratch', { mode: 0o600 });
        localScratchChecked = true;
      } finally { fs.rmSync(probe, { recursive: true }); }
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(9444, '127.0.0.1', resolve); });
    relay = new WebSocketServer({ host: '127.0.0.1', port: 9445 });
    relay.on('connection', socket => socket.on('message', (data, binary) => socket.send(data, { binary })));
    await new Promise((resolve, reject) => { relay.once('listening', resolve); relay.once('error', reject); });
    browser = await chromium.connect(process.env.EXAM_STRESS_BROWSER_WS, { timeout: 10000 });
    const entries = [];
    for (const value of ['one', 'two']) {
      const context = await browser.newContext();
      assert.deepEqual(await context.cookies(), []);
      await context.addCookies([{ name: 'synthetic', value, url: 'http://127.0.0.1:9444' }]);
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:9444', { timeout: 10000 });
      assert.equal(await page.title(), 'Private synthetic generator');
      assert.equal(await page.evaluate(() => navigator.onLine), true,
        'The isolated browser must report its working private connection online');
      entries.push({ context, page, value });
    }
    for (const { page, value } of entries) {
      assert.equal(await page.evaluate(() => fetch('/echo').then(r => r.text())), 'synthetic=' + value);
      assert.deepEqual(await page.evaluate(() => new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:9445');
        ws.binaryType = 'arraybuffer';
        const result = {};
        const timeout = setTimeout(() => reject(Error('Private reverse relay timed out')), 5000);
        ws.onerror = reject;
        ws.onopen = () => { ws.send('synthetic relay'); ws.send(new Uint8Array([17, 42])); };
        ws.onmessage = event => {
          if (typeof event.data === 'string') result.text = event.data;
          else result.binary = Array.from(new Uint8Array(event.data));
          if (result.text && result.binary) { clearTimeout(timeout); ws.close(); resolve(result); }
        };
      })), { text: 'synthetic relay', binary: [17, 42] });
      assert.equal(await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const stream = canvas.captureStream(2);
        const video = document.createElement('video');
        video.muted = true; video.srcObject = stream;
        const paint = setInterval(() => canvas.getContext('2d').fillRect(0, 0, 320, 180), 100);
        try {
          await video.play();
          return video.videoWidth === 320 && video.videoHeight === 180;
        } finally { clearInterval(paint); stream.getTracks().forEach(track => track.stop()); }
      }), true);
    }
    await Promise.all(entries.map(entry => entry.context.close()));
    await browser.close();
    browser = await chromium.connect(process.env.EXAM_STRESS_BROWSER_WS, { timeout: 10000 });
    const fresh = await browser.newContext();
    assert.deepEqual(await fresh.cookies(), []);
    await fresh.close();
    console.log(JSON.stringify({ remoteBrowserVersion: browser.version(), contexts: 2,
      isolatedCookies: true, reverseHTTP: true, reverseWebSocket: true,
      syntheticCapture: true, serverReusable: true, localScratchChecked }));
  } finally {
    if (browser) await browser.close();
    if (relay) await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
    clearTimeout(timer);
  }
})().catch(error => { console.error(error); process.exit(1); });
