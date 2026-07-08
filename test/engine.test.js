// Runnable check for engine.js trust-boundary logic. No framework: `node test-engine.js`.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { runAction, safeJoin, download, removeMacJunk, detectConsole, listInstalledApps, uninstallApp, listRoot, clearRoot, sha1Mac, cdbFolder, cdbEntryName, isValidMac, REGIONS } = require('../src/engine');
const { letterbombGenerate, wilbrandGenerate } = require('../src/message-gen');

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

  // 8. detectConsole reads top-level folder markers
  const dr = path.join(tmp, 'detect');
  fs.mkdirSync(dr);
  assert.strictEqual(await detectConsole(dr), null, 'empty card is unrecognized');
  fs.mkdirSync(path.join(dr, 'apps'));
  assert.strictEqual(await detectConsole(dr), 'wii', 'apps folder reads as wii');
  fs.mkdirSync(path.join(dr, 'wiiu'));
  assert.strictEqual(await detectConsole(dr), 'wiiu', 'wiiu folder takes priority');

  // 9. listInstalledApps / uninstallApp work off <root>/apps/<id>
  fs.mkdirSync(path.join(dr, 'apps', 'wiiflow'), { recursive: true });
  fs.writeFileSync(path.join(dr, 'apps', 'wiiflow', 'boot.dol'), 'x');
  assert.deepStrictEqual(await listInstalledApps(dr), ['wiiflow'], 'lists installed app folders');
  await uninstallApp(dr, 'wiiflow');
  assert.ok(!fs.existsSync(path.join(dr, 'apps', 'wiiflow')), 'uninstall removed the app folder');
  await assert.rejects(uninstallApp(dr, '../../escape'), /escapes/, 'uninstall rejects escaping app id');

  // 10. listRoot / clearRoot — the "you have random stuff on your card" check
  const cr = path.join(tmp, 'clutter');
  fs.mkdirSync(cr);
  assert.deepStrictEqual(await listRoot(cr), [], 'empty card lists nothing');
  fs.writeFileSync(path.join(cr, 'random.txt'), 'x');
  fs.mkdirSync(path.join(cr, 'oldfolder'));
  assert.deepStrictEqual((await listRoot(cr)).sort(), ['oldfolder', 'random.txt'], 'lists top-level clutter');
  await clearRoot(cr);
  assert.deepStrictEqual(await listRoot(cr), [], 'clearRoot wipes everything');

  // 11. sha1Mac derives a 20-byte key and isValidMac rejects bad ouis
  const key = sha1Mac('AA:BB:CC:DD:EE:FF');
  assert.strictEqual(key.length, 20, 'key is 20 bytes');
  const key2 = sha1Mac('AABBCCDDEEFF');
  assert.deepStrictEqual(key, key2, 'mac without separators produces same key');
  assert.strictEqual(isValidMac('AA:BB:CC:DD:EE:FF'), false, 'fake OUI is rejected');
  // Known good OUI from the list
  assert.strictEqual(isValidMac('00:09:BF:12:34:56'), true, 'known Nintendo OUI accepted');
  assert.strictEqual(isValidMac('0017ab789012'), true, 'known OUI without separators');

  // 12. letterbombGenerate produces correct output path
  const lb = letterbombGenerate('00:09:BF:12:34:56', 'U');
  assert.ok(lb.path.startsWith('private/wii/title/HAEA/'), 'letterbomb path starts with HAEA dir');
  assert.ok(lb.path.endsWith('_HABA_01_000.txt'), 'letterbomb path ends with _HABA_01_000.txt');
  assert.ok(lb.path.includes('_HABA_'), 'letterbomb path includes HABA marker');
  assert.strictEqual(lb.data.length, 87232, 'letterbomb output is 87232 bytes');
  assert.strictEqual(lb.data[0], 0x43, 'letterbomb starts with CDBFILE magic');
  assert.strictEqual(lb.data[1], 0x44);
  assert.strictEqual(lb.data[2], 0x42);

  // 13. HMAC at offset 0xB0 is non-zero (patched, not placeholder)
  let allZero = true;
  for (let i = 0; i < 20; i++) { if (lb.data[0xB0 + i] !== 0) { allZero = false; break; } }
  assert.ok(!allZero, 'letterbomb HMAC at 0xB0 is non-zero');
  // Entry name in the binary matches the filename
  const nameInBin = lb.data.toString('ascii', 0x80, 0xA0).replace(/\x00+$/, '');
  assert.strictEqual(nameInBin, lb.entryName, 'binary filename matches entry name');

  // 14. Different regions produce different outputs for same mac
  const lbE = letterbombGenerate('00:09:BF:12:34:56', 'E');
  const lbJ = letterbombGenerate('00:09:BF:12:34:56', 'J');
  assert.ok(Buffer.compare(lb.data, lbE.data) !== 0, 'different region produces different output');
  // Same region + same mac = same output (deterministic)
  const lb2 = letterbombGenerate('00:09:BF:12:34:56', 'U');
  assert.deepStrictEqual(lb.data, lb2.data, 'same mac+region is deterministic');

  // 15. wilbrandGenerate produces correct structure
  const wb = wilbrandGenerate('00:09:BF:12:34:56', 'U', '4.3', null);
  assert.ok(wb.path.startsWith('private/wii/title/HAEA/'), 'wilbrand path starts with HAEA');
  assert.ok(wb.path.endsWith('_HABA_01_000.txt'), 'wilbrand path is a HABA txt');
  assert.strictEqual(wb.data.length, 0x32400, 'wilbrand output is 0x32400 bytes');
  // HMAC at 0xB0 is non-zero
  allZero = true;
  for (let i = 0; i < 20; i++) { if (wb.data[0xB0 + i] !== 0) { allZero = false; break; } }
  assert.ok(!allZero, 'wilbrand HMAC at 0xB0 is non-zero');
  // Version byte at 0x72 matches 4.3
  assert.strictEqual(wb.data[0x72], 0x08, 'wilbrand version byte at 0x72 is 0x08 for 4.3');

  // 16. genletterbomb action writes file to correct SD path
  const letterDir = path.join(tmp, 'sd-letter');
  fs.mkdirSync(letterDir);
  await runAction(
    { type: 'genletterbomb', mac: '00:09:BF:12:34:56', region: 'U' },
    { root: letterDir, cache }
  );
  const lbFiles = fs.readdirSync(path.join(letterDir, 'private', 'wii', 'title', 'HAEA'));
  assert.ok(lbFiles.length > 0, 'letterbomb creates HAEA subdirectory');
  const lbSubDir = path.join(letterDir, 'private', 'wii', 'title', 'HAEA', lbFiles[0]);
  const lbFile = fs.readdirSync(lbSubDir)[0];
  assert.ok(lbFile.endsWith('_HABA_01_000.txt'), 'letterbomb writes HABA txt file');
  assert.strictEqual(fs.statSync(path.join(lbSubDir, lbFile)).size, 87232, 'written file is 87232 bytes');

  // 17. genwilbrand action writes file to correct SD path
  const wbDir = path.join(tmp, 'sd-wilbrand');
  fs.mkdirSync(wbDir);
  await runAction(
    { type: 'genwilbrand', mac: '00:09:BF:12:34:56', region: 'E', version: '4.0' },
    { root: wbDir, cache }
  );
  const wbFiles = fs.readdirSync(path.join(wbDir, 'private', 'wii', 'title', 'HAEA'));
  assert.ok(wbFiles.length > 0, 'wilbrand creates HAEA subdirectory');
  const wbSubDir = path.join(wbDir, 'private', 'wii', 'title', 'HAEA', wbFiles[0]);
  const wbFile = fs.readdirSync(wbSubDir)[0];
  assert.ok(wbFile.endsWith('_HABA_01_000.txt'), 'wilbrand writes HABA txt file');

  // 18. genletterbomb rejects invalid MAC
  await assert.rejects(
    runAction({ type: 'genletterbomb', mac: 'DE:AD:BE:EF:00:00', region: 'U' }, { root: tmp, cache }),
    /OUI/, 'invalid OUI rejected'
  );

  // 19. genletterbomb rejects missing fields
  await assert.rejects(
    runAction({ type: 'genletterbomb', mac: '', region: 'U' }, { root: tmp, cache }),
    /required/, 'empty mac rejected'
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok — all engine checks passed');
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
