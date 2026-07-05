// Runnable check for engine.js trust-boundary logic. No framework: `node test-engine.js`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { runAction, safeJoin, download, removeMacJunk } = require('../src/engine');

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

  // 5. sdinstall downloads each zip and extracts it to the SD root
  const zipSrv = require('http').createServer((_q, res) => {
    res.end(fs.readFileSync(zip)); // serve the fixture zip from test 2
  });
  await new Promise(r => zipSrv.listen(0, r));
  const zipUrl = `http://127.0.0.1:${zipSrv.address().port}/`;
  await runAction(
    { type: 'sdinstall', destSubpath: '', downloads: [{ url: zipUrl, dest: 'a.zip' }] },
    { root, cache }
  );
  assert.ok(fs.existsSync(path.join(root, 'hello.txt')), 'sdinstall extracted to SD root');
  zipSrv.close();
  server.close();

  // 6. backupnand copies NAND files off the SD to a fresh Desktop folder, clears the card.
  //    Redirect HOME so we don't touch the real Desktop.
  const fakeHome = path.join(tmp, 'home');
  fs.mkdirSync(path.join(fakeHome, 'Desktop'), { recursive: true });
  const realHome = os.homedir;
  os.homedir = () => fakeHome;
  try {
    fs.writeFileSync(path.join(root, 'otp.bin'), 'otp');
    fs.writeFileSync(path.join(root, 'mlc.bin.part00'), 'mlc');
    const d1 = await runAction({ type: 'backupnand' }, { root, cache });
    assert.ok(fs.existsSync(path.join(d1, 'otp.bin')), 'backup copied otp.bin');
    assert.ok(fs.existsSync(path.join(d1, 'mlc.bin.part00')), 'backup copied mlc part');
    assert.ok(!fs.existsSync(path.join(root, 'otp.bin')), 'backup cleared card');
    // second run must not collide with the first folder
    fs.writeFileSync(path.join(root, 'otp.bin'), 'otp2');
    const d2 = await runAction({ type: 'backupnand' }, { root, cache });
    assert.notStrictEqual(d1, d2, 'second backup got a unique folder');
    await assert.rejects(runAction({ type: 'backupnand' }, { root, cache }), /No NAND backup/, 'empty card rejected');
  } finally {
    os.homedir = realHome;
  }

  // 7. removeMacJunk strips hidden macOS files (nested too) but keeps real files
  const jroot = path.join(tmp, 'junk');
  fs.mkdirSync(path.join(jroot, 'wiiu'), { recursive: true });
  fs.writeFileSync(path.join(jroot, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(jroot, '._payload.elf'), 'x');
  fs.writeFileSync(path.join(jroot, 'wiiu', '.DS_Store'), 'x');
  fs.writeFileSync(path.join(jroot, 'wiiu', 'payload.elf'), 'real');
  fs.mkdirSync(path.join(jroot, '.Spotlight-V100'));
  await removeMacJunk(jroot);
  assert.ok(!fs.existsSync(path.join(jroot, '.DS_Store')), 'top .DS_Store gone');
  assert.ok(!fs.existsSync(path.join(jroot, '._payload.elf')), 'AppleDouble gone');
  assert.ok(!fs.existsSync(path.join(jroot, '.Spotlight-V100')), 'Spotlight dir gone');
  assert.ok(!fs.existsSync(path.join(jroot, 'wiiu', '.DS_Store')), 'nested .DS_Store gone');
  assert.ok(fs.existsSync(path.join(jroot, 'wiiu', 'payload.elf')), 'real file kept');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok — all engine checks passed');
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
