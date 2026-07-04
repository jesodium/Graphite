// Pure Node step engine — no Electron. Runs one guide action against a chosen root dir.
// Consumed by main.js (IPC) and test-engine.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extract = require('extract-zip');

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

    case 'manual':
      return null; // user does it on the console; nothing to automate

    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}

module.exports = { runAction, safeJoin, sha256, download };
