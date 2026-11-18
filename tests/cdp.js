// Minimal Chrome DevTools Protocol driver (Node 22+ has global WebSocket/fetch).
// node tests/cdp.js <port> <url> <outPng> [jsToEval]   (env: W, H, DPR, THEME=light|dark, CLIP=<css selector>)
const [port, url, outPng, js] = process.argv.slice(2);
const fs = require('fs');

(async () => {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: +(process.env.W || 1280), height: +(process.env.H || 1500), deviceScaleFactor: +(process.env.DPR || 1), mobile: false });
  if (process.env.THEME) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.THEME }] });
  await new Promise((r) => setTimeout(r, 6000));
  if (js) {
    const res = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(res.result && (res.result.result ? res.result.result.value : res.result), null, 1));
  }
  let params = { format: 'png' };
  if (process.env.CLIP) {
    const r = await send('Runtime.evaluate', { expression: `(() => { const e = document.querySelector(${JSON.stringify(process.env.CLIP)}); const b = e.getBoundingClientRect(); return [b.left + scrollX, b.top + scrollY, b.width, b.height]; })()`, returnByValue: true });
    const [x, y, width, height] = r.result.result.value;
    const pad = +(process.env.PAD || 0);
    params = { format: 'png', captureBeyondViewport: true, clip: { x: x - pad, y: y - pad, width: width + 2 * pad, height: height + 2 * pad, scale: 1 } };
  }
  const shot = await send('Page.captureScreenshot', params);
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, 'base64'));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
