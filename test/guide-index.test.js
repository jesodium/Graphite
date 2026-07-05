const assert = require('assert');
const { normalizeGuideMetadata } = require('../src/guide-index');

function testLegacyGuideFallback() {
  const meta = normalizeGuideMetadata('wiiu/aroma.json', {
    console: 'Wii U',
    title: 'Aroma',
    recommended: true,
  });
  assert.deepStrictEqual(meta, {
    file: 'wiiu/aroma.json',
    console: 'Wii U',
    title: 'Aroma',
    recommended: true,
    extra: false,
    tileImage: null,
    wip: false,
    requiresStorageSelection: true,
    models: [],
    recommendedModels: [],
    warnings: [],
    requirements: [],
  });
}

function testModelMetadataSanitization() {
  const meta = normalizeGuideMetadata('switch/modchip-oled.json', {
    console: 'Nintendo Switch',
    title: 'Modchip install',
    recommended: false,
    models: ['Switch OLED', '', 'Switch V2 (Mariko)', 123],
    recommendedModels: ['Switch OLED', 'Not Supported'],
    warnings: ['Requires soldering', null, 'Advanced hardware work'],
  });
  assert.deepStrictEqual(meta, {
    file: 'switch/modchip-oled.json',
    console: 'Nintendo Switch',
    title: 'Modchip install',
    recommended: false,
    extra: false,
    tileImage: null,
    wip: false,
    requiresStorageSelection: true,
    models: ['Switch OLED', 'Switch V2 (Mariko)'],
    recommendedModels: ['Switch OLED'],
    warnings: ['Requires soldering', 'Advanced hardware work'],
    requirements: [],
  });
}

function testExplicitNoStorageSelection() {
  const meta = normalizeGuideMetadata('demo/no-storage.json', {
    console: 'Demo Console',
    title: 'No storage needed',
    recommended: false,
    requiresStorageSelection: false,
  });
  assert.strictEqual(meta.requiresStorageSelection, false);
}

function testWipFlag() {
  const meta = normalizeGuideMetadata('switch/wip.json', {
    console: 'Nintendo Switch',
    title: 'Work in progress guide',
    wip: true,
  });
  assert.strictEqual(meta.wip, true);
}

testLegacyGuideFallback();
testModelMetadataSanitization();
testExplicitNoStorageSelection();
testWipFlag();
console.log('ok - guide-index metadata tests passed');
