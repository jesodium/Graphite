// Runnable check for engine.js trust-boundary logic. No framework: `node test-engine.js`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { runAction, safeJoin, download } = require('./engine');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-'));
  const root = path.join(tmp, 'sd');       // pretend SD card
  const cache = path.join(tmp, 'cache');
  fs.mkdirSync(root); fs.mkdirSync(cache);

  // 1. safeJoin rejects `..` escape
  assert.throws(() => safeJoin(root, '../escape'), /escapes/, 'safeJoin should reject ..');
  assert.throws(() => safeJoin(root, '/abs/path'), /escapes/, 'safeJoin should reject absolute');
  assert.ok(safeJoin(root, 'wiiu/apps').startsWith(root), 'safeJoin allows normal subpath');

  // 2. extract lands files under target
  const zip = path.join(cache, 'fixture.zip');
  const src = path.join(tmp, 'zipsrc'); fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'hello.txt'), 'hi');
  execSync(`cd "${src}" && zip -qr "${zip}" .`);
  await runAction({ type: 'extract', archive: 'fixture.zip', destSubpath: 'wiiu' }, { root, cache });
  assert.ok(fs.existsSync(path.join(root, 'wiiu', 'hello.txt')), 'extract landed file');

  // 3. extract with escaping destSubpath rejected, nothing written outside root
  await assert.rejects(
    runAction({ type: 'extract', archive: 'fixture.zip', destSubpath: '../pwned' }, { root, cache }),
    /escapes/, 'extract should reject escaping destSubpath'
  );
  assert.ok(!fs.existsSync(path.join(tmp, 'pwned')), 'nothing written outside root');

  // 4. download rejects sha256 mismatch and deletes the file
  const server = require('http').createServer((_q, res) => res.end('payload'));
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const dest = path.join(cache, 'dl.bin');
  await assert.rejects(download(url, dest, 'deadbeef'.repeat(8)), /mismatch/, 'bad hash rejected');
  assert.ok(!fs.existsSync(dest), 'bad-hash file deleted');
  const good = crypto.createHash('sha256').update('payload').digest('hex');
  await download(url, dest, good);
  assert.ok(fs.existsSync(dest), 'good hash accepted');
  server.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok — all engine checks passed');
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
