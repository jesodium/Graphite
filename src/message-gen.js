const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_SUFFIX = Buffer.from([0x75, 0x79, 0x79]);

function parseMac(str) {
  const clean = str.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 12) throw new Error(`invalid mac: ${str}`);
  return Buffer.from(clean, 'hex');
}

function sha1Mac(macStr) {
  const mac = parseMac(macStr);
  return crypto.createHash('sha1').update(Buffer.concat([mac, KEY_SUFFIX])).digest();
}

function cdbFolder(key) {
  return key.readUInt32BE(0).toString(16).padStart(8, '0');
}

function cdbEntryName(key) {
  const folder = cdbFolder(key);
  const extra = key[4].toString(16).padStart(2, '0');
  return folder + extra + '_HABA_01_000.txt';
}

function wiiTimestamp() {
  const now = new Date();
  const epoch = new Date('2000-01-01T00:00:00Z');
  const ms = now.getTime() - epoch.getTime();
  return Math.floor(ms / 1000);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function aes128CbcEncrypt(data, key, iv) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aes128CbcDecrypt(data, key, iv) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const ZERO_KEY = Buffer.alloc(16);
const ZERO_IV = Buffer.alloc(16);

const WILBRAND_VERSIONS = {
  '3.0':  { offset: 0x00, label: '3.0' },
  '3.1':  { offset: 0x01, label: '3.1' },
  '3.2':  { offset: 0x02, label: '3.2' },
  '3.3':  { offset: 0x03, label: '3.3' },
  '3.4':  { offset: 0x04, label: '3.4' },
  '4.0':  { offset: 0x05, label: '4.0' },
  '4.1':  { offset: 0x06, label: '4.1' },
  '4.2':  { offset: 0x07, label: '4.2' },
  '4.3':  { offset: 0x08, label: '4.3' },
};

const VALID_OUI = new Set(
  fs.readFileSync(path.join(__dirname, 'assets', 'wii-exploits', 'oui_list.txt'), 'utf8')
    .trim().split('\n').map(l => l.trim().toLowerCase())
);

function isValidMac(macStr) {
  try {
    const mac = parseMac(macStr);
    const oui = mac.slice(0, 3).toString('hex').toLowerCase();
    return VALID_OUI.has(oui);
  } catch { return false; }
}

const REGIONS = ['U', 'E', 'J', 'K'];
const REGION_NAMES = { U: 'Americas (NTSC)', E: 'Europe (PAL)', J: 'Japan', K: 'Korea' };

function validateRegion(r) {
  if (!REGIONS.includes(r)) throw new Error(`invalid region: ${r}. must be one of ${REGIONS.join(', ')}`);
}

const LETTERBOMB_TEMPLATE = {
  path: path.join(__dirname, 'assets', 'wii-exploits', 'template'),
  hmacOffset: 0xB0,
  hmacLength: 20,
  filenameOffset: 0x80,
  filenameLength: 32,
};

function letterbombGenerate(macStr, region) {
  region = region.toUpperCase();
  validateRegion(region);

  const key = sha1Mac(macStr);
  const templatePath = LETTERBOMB_TEMPLATE.path + region + '.bin';
  const template = fs.readFileSync(templatePath);

  const folder = cdbFolder(key);
  const entryName = cdbEntryName(key);
  const entryNameBuf = Buffer.alloc(32);
  entryNameBuf.write(entryName, 'ascii');

  const working = Buffer.from(template);
  working.fill(0, LETTERBOMB_TEMPLATE.hmacOffset, LETTERBOMB_TEMPLATE.hmacOffset + LETTERBOMB_TEMPLATE.hmacLength);
  entryNameBuf.copy(working, LETTERBOMB_TEMPLATE.filenameOffset);

  const hmac = crypto.createHmac('sha1', key).update(working).digest();
  hmac.copy(working, LETTERBOMB_TEMPLATE.hmacOffset);

  const outPath = path.join('private', 'wii', 'title', 'HAEA', folder, entryName);
  return { data: working, path: outPath, folder, entryName };
}

function wilbrandGenerate(macStr, region, version, bootElfPath) {
  region = region.toUpperCase();
  validateRegion(region);
  const ver = WILBRAND_VERSIONS[version];
  if (!ver) throw new Error(`unsupported wilbrand version: ${version}`);

  const key = sha1Mac(macStr);
  const folder = cdbFolder(key);
  const entryName = cdbEntryName(key);

  const envelope = fs.readFileSync(path.join(__dirname, 'assets', 'wii-exploits', 'wilbrand-envelope.bin'));
  const loader = fs.readFileSync(path.join(__dirname, 'assets', 'wii-exploits', 'wilbrand-loader.bin'));

  let bootElf = Buffer.alloc(0);
  if (bootElfPath && fs.existsSync(bootElfPath)) {
    bootElf = fs.readFileSync(bootElfPath);
  }

  const payload = Buffer.concat([loader, bootElf]);
  const padded = Buffer.alloc(Math.ceil(payload.length / 16) * 16);
  payload.copy(padded);

  const encrypted = aes128CbcEncrypt(padded, ZERO_KEY, ZERO_IV);

  const cdbSize = 0x32400;
  const cdb = Buffer.alloc(cdbSize, 0);

  const headerLen = Math.min(envelope.length, 0x60);
  envelope.slice(0, headerLen).copy(cdb, 0);

  const entryNameBuf = Buffer.alloc(32);
  entryNameBuf.write(entryName, 'ascii');
  entryNameBuf.copy(cdb, 0x80);

  const ts = wiiTimestamp();
  cdb.writeUInt32BE(ts, 0x70);
  cdb[0x72] = ver.offset;

  const encStart = 0xB0;
  const encLen = Math.min(encrypted.length, cdbSize - encStart);
  encrypted.slice(0, encLen).copy(cdb, encStart);

  const crcVal = crc32(cdb.slice(0, 0xB0));
  cdb.writeUInt32BE(crcVal, 0x10);

  const hmacInput = Buffer.from(cdb);
  hmacInput.fill(0, 0xB0, 0xC4);
  const hmac = crypto.createHmac('sha1', key).update(hmacInput).digest();
  hmac.copy(cdb, 0xB0);

  const outPath = path.join('private', 'wii', 'title', 'HAEA', folder, entryName);
  return { data: cdb, path: outPath, folder, entryName };
}

module.exports = {
  KEY_SUFFIX,
  parseMac,
  sha1Mac,
  cdbFolder,
  cdbEntryName,
  wiiTimestamp,
  crc32,
  aes128CbcEncrypt,
  aes128CbcDecrypt,
  ZERO_KEY,
  ZERO_IV,
  WILBRAND_VERSIONS,
  VALID_OUI,
  isValidMac,
  REGIONS,
  REGION_NAMES,
  validateRegion,
  letterbombGenerate,
  wilbrandGenerate,
};
