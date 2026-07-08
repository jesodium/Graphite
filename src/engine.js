// Pure Node step engine — no Electron. Runs one guide action against a chosen root dir.
// Consumed by main.js (IPC) and test-engine.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const extract = require('extract-zip');
const { sha1Mac, cdbFolder, cdbEntryName, letterbombGenerate, wilbrandGenerate, isValidMac, REGIONS, WILBRAND_VERSIONS, REGION_NAMES } = require('./message-gen');

// First free "<base>", "<base> (2)", "<base> (3)"… under `parent`.
function uniqueDir(parent, base) {
  let name = base;
  for (let n = 2; fs.existsSync(path.join(parent, name)); n++) name = `${base} (${n})`;
  return path.join(parent, name);
}

const MAC_JUNK = ['.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', '.apdisk'];

// Recursively strip the hidden files macOS scatters onto FAT32 cards.
// Best-effort: some entries (e.g. SIP-protected .Spotlight-V100) can't be removed
// or even scanned — skip those rather than aborting the whole clean.
async function removeMacJunk(dir) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.name === '.DS_Store' || e.name.startsWith('._') || MAC_JUNK.includes(e.name)) {
      await fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
    } else if (e.isDirectory()) {
      await removeMacJunk(p);
    }
  }
}

// Resolve `sub` under `root` and refuse anything that escapes it (zip-slip / `..`).
function safeJoin(root, sub) {
  const target = path.resolve(root, sub || '');
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes target dir: ${sub}`);
  }
  return target;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, dest, expectedSha) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  const got = await sha256(dest);
  if (expectedSha && got.toLowerCase() !== expectedSha.toLowerCase()) {
    await fs.promises.rm(dest, { force: true });
    throw new Error(`sha256 mismatch for ${url}\n expected ${expectedSha}\n got      ${got}`);
  }
  return dest;
}

// Runs a single step.action. `root` = SD folder, `cache` = app cache dir.
// download.dest / extract.archive / copy.src are relative to cache;
// extract/copy destSubpath is relative to root (guarded).
async function runAction(action, { root, cache }) {
  switch (action.type) {
    case 'download':
      return download(action.url, path.join(cache, action.dest), action.sha256);

    case 'extract': {
      const archive = path.join(cache, action.archive);
      const dir = safeJoin(root, action.destSubpath);
      await fs.promises.mkdir(dir, { recursive: true });
      // extract-zip (yauzl) rejects entries that escape `dir` — second guard.
      await extract(archive, { dir });
      return dir;
    }

    case 'copy': {
      const src = path.join(cache, action.src);
      const dest = safeJoin(root, action.destSubpath);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(src, dest);
      return dest;
    }

    // Download one or more zips and extract each onto the SD card — the whole
    // "put the files on your card" job in a single guide step. Each download may
    // set `to` (a subfolder like "install" or "wiiu"); default is the SD root
    // (or action.destSubpath). yauzl guards against entries escaping the dir.
    case 'sdinstall': {
      const rootDir = safeJoin(root, action.destSubpath);
      await fs.promises.mkdir(rootDir, { recursive: true });
      for (const dl of action.downloads || []) {
        const zip = path.join(cache, dl.dest);
        await download(dl.url, zip, dl.sha256);
        const dir = dl.to ? safeJoin(root, dl.to) : rootDir;
        await fs.promises.mkdir(dir, { recursive: true });
        await extract(zip, { dir });
      }
      return rootDir;
    }

    // Copy the NAND backup files the console dumped to the SD root into a fresh
    // Desktop folder, then clear them off the card. The dump itself is on-console.
    case 'backupnand': {
      const core = ['slc.bin', 'slccmpt.bin', 'seeprom.bin', 'otp.bin', 'nand.bin', 'keys.bin'];
      // Card may be unplugged (ENOENT) — treat that the same as "no backup here".
      const entries = await fs.promises.readdir(root).catch(() => []);
      const files = entries.filter(f => core.includes(f) || f.startsWith('mlc.bin.part'));
      if (!files.length) {
        throw new Error('No NAND backup found on the SD card. Make sure you ran the dump on your console first.');
      }
      const destDir = uniqueDir(path.join(os.homedir(), 'Desktop'), action.name || 'Wii NAND Backup');
      await fs.promises.mkdir(destDir, { recursive: true });
      for (const f of files) {
        await fs.promises.copyFile(path.join(root, f), path.join(destDir, f));
      }
      for (const f of files) await fs.promises.rm(path.join(root, f), { force: true });
      return destDir;
    }

    // macOS only: strip the hidden junk macOS wrote to the card, then eject it.
    case 'cleaneject': {
      await removeMacJunk(root);
      if (process.platform === 'darwin') {
        await new Promise((res, rej) => {
          require('child_process').execFile('diskutil', ['eject', root], err =>
            err ? rej(new Error('Cleaned the card, but could not eject it: ' + err.message)) : res());
        });
      }
      return root;
    }

    // Verify MAC is valid before proceeding.
    // Action payload carries mac + region from the renderer form.
    case 'genletterbomb': {
      const { mac, region } = action;
      if (!mac || !region) throw new Error('MAC address and region are required');
      if (!isValidMac(mac)) throw new Error('Invalid MAC address — does not match a known Nintendo Wii OUI');
      const result = letterbombGenerate(mac, region);
      const dest = safeJoin(root, result.path);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, result.data);
      return dest;
    }

    case 'genwilbrand': {
      const { mac, region, version } = action;
      if (!mac || !region || !version) throw new Error('MAC address, region, and system menu version are required');
      if (!isValidMac(mac)) throw new Error('Invalid MAC address — does not match a known Nintendo Wii OUI');
      const bootElf = safeJoin(root, 'boot.elf');
      const result = wilbrandGenerate(mac, region, version, bootElf);
      const dest = safeJoin(root, result.path);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, result.data);
      return dest;
    }

    case 'manual':
      return null; // user does it on the console; nothing to automate

    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}

// Look at what's actually on the card's top-level folders to figure out which
// console it's set up for. IMPORTANT NOTE: folder-name heuristic, not perfect —
// a card with none of these folders reads as unrecognized even if it's a real
// homebrew card set up in some unusual way. Add more markers here as needed.
async function detectConsole(root) {
  let entries;
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch { return null; }
  const dirs = new Set(entries.filter(e => e.isDirectory()).map(e => e.name.toLowerCase()));
  if (dirs.has('wiiu')) return 'wiiu';
  if (dirs.has('switch') || dirs.has('atmosphere') || dirs.has('bootloader')) return 'switch';
  if (dirs.has('apps') || dirs.has('private')) return 'wii';
  return null;
}

// Installed homebrew apps live at <sd>/apps/<id>/ (the Homebrew Channel convention,
// and where our own sdinstall extracts them). Returns the raw folder names found.
async function listInstalledApps(root) {
  try {
    const entries = await fs.promises.readdir(path.join(root, 'apps'), { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
}

async function uninstallApp(root, appId) {
  await fs.promises.rm(safeJoin(root, path.join('apps', appId)), { recursive: true, force: true });
}

// Top-level entries on the card, for the "you have random stuff on here" nag
// shown when a guide starts. Empty on read failure (unplugged card, etc).
async function listRoot(root) {
  try { return await fs.promises.readdir(root); }
  catch { return []; }
}

// Best-effort: SIP-protected entries like .Spotlight-V100 throw EPERM even with
// force:true (force only swallows "doesn't exist") — skip those instead of aborting.
async function clearRoot(root) {
  const entries = await listRoot(root);
  for (const name of entries) {
    await fs.promises.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { runAction, safeJoin, sha256, download, removeMacJunk, detectConsole, listInstalledApps, uninstallApp, listRoot, clearRoot, sha1Mac, cdbFolder, cdbEntryName, isValidMac, REGIONS, WILBRAND_VERSIONS, REGION_NAMES };
