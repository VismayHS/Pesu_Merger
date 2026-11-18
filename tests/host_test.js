// Drives the native host (run_host.bat on Windows, run_host.sh elsewhere) over the Chrome native-messaging protocol.
// Usage: node tests/host_test.js <samples-dir>
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const nh = path.join(__dirname, '..', 'native-host');
const proc = process.platform === 'win32'
  ? spawn('cmd.exe', ['/c', path.join(nh, 'run_host.bat')], { stdio: ['pipe', 'pipe', 'inherit'] })
  : spawn(path.join(nh, 'run_host.sh'), [], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = Buffer.alloc(0);
const waiters = new Map();
let nextId = 1;
proc.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    if (n > 1024 * 1024) throw new Error('host message exceeds 1MB: ' + n);
    const msg = JSON.parse(buf.slice(4, 4 + n).toString('utf8'));
    buf = buf.slice(4 + n);
    const w = waiters.get(msg.id);
    if (!w) continue;
    if (msg.type === 'result') {
      if (!msg.ok) { waiters.delete(msg.id); w.reject(new Error(msg.error)); continue; }
      w.meta = msg.meta; w.total = msg.chunks; w.parts = [];
      if (!w.total) { waiters.delete(msg.id); w.resolve({ meta: w.meta, data: null }); }
    } else if (msg.type === 'chunk') {
      w.parts[msg.i] = Buffer.from(msg.data, 'base64');
      if (w.parts.filter(Boolean).length === w.total) { waiters.delete(msg.id); w.resolve({ meta: w.meta, data: Buffer.concat(w.parts) }); }
    }
  }
});

function send(obj) {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
  proc.stdin.write(Buffer.concat([h, b]));
}
function request(op, meta, data) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    const CH = 4 * 1024 * 1024;
    const chunks = [];
    if (data) for (let i = 0; i < data.length; i += CH) chunks.push(data.slice(i, i + CH));
    send({ id, op, meta, chunks: chunks.length });
    chunks.forEach((c, i) => send({ id, op: 'chunk', i, data: c.toString('base64') }));
  });
}

(async () => {
  const ping = await request('ping', {});
  console.log('PING', JSON.stringify(ping.meta));
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  for (const engine of ['auto', 'libreoffice']) {
    for (const f of fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())) {
      const ext = path.extname(f).slice(1);
      const t0 = Date.now();
      try {
        const r = await request('convert', { name: f, ext, engine }, fs.readFileSync(path.join(dir, f)));
        const out = path.join(outDir, `${path.basename(f, '.' + ext)}.${ext}.${engine}.pdf`);
        fs.writeFileSync(out, r.data);
        console.log('OK  ', engine.padEnd(11), f.padEnd(16), r.meta.engine, ((Date.now() - t0) / 1000).toFixed(1) + 's', r.data.length, 'bytes', r.data.slice(0, 5).toString());
      } catch (e) {
        console.log('FAIL', engine.padEnd(11), f.padEnd(16), e.message);
      }
    }
  }
  // repair: feed a converted PDF back through
  const anyPdf = fs.readdirSync(outDir).find((f) => f.endsWith('.pdf'));
  const rep = await request('repair_pdf', {}, fs.readFileSync(path.join(outDir, anyPdf)));
  console.log('REPAIR', rep.meta.engine, rep.data.length);
  // big payload round-trip (forces multi-chunk both ways): 9MB bogus "pdf" through repair should fail cleanly
  try { await request('repair_pdf', {}, Buffer.alloc(9 * 1024 * 1024, 65)); } catch (e) { console.log('BIG bad pdf -> error ok:', e.message.slice(0, 80)); }
  proc.stdin.end();
})().catch((e) => { console.error(e); process.exit(1); });
