const assert = require('assert');
const {
  collectModels,
  methodAppliesToModel,
  methodIsRecommended,
  splitMethodsByRecommendation,
} = require('../src/renderer/picker-logic');

const methods = [
  {
    title: 'RCM softmod (v1/Erista)',
    models: ['Switch v1 (Erista)'],
    recommendedModels: ['Switch v1 (Erista)'],
    warnings: [],
  },
  {
    title: 'Modchip install (OLED/Mariko)',
    models: ['Switch OLED', 'Switch V2 (Mariko)'],
    recommendedModels: ['Switch OLED', 'Switch V2 (Mariko)'],
    warnings: ['Requires soldering'],
  },
  {
    title: 'Generic legacy flow',
    recommended: false,
  },
];

function testCollectModels() {
  assert.deepStrictEqual(collectModels(methods), [
    'Switch v1 (Erista)',
    'Switch OLED',
    'Switch V2 (Mariko)',
  ]);
}

function testModelApplicability() {
  assert.strictEqual(methodAppliesToModel(methods[0], 'Switch v1 (Erista)'), true);
  assert.strictEqual(methodAppliesToModel(methods[0], 'Switch OLED'), false);
  assert.strictEqual(methodAppliesToModel(methods[2], 'Switch OLED'), true); // generic guide stays visible
}

function testRecommendationForModel() {
  assert.strictEqual(methodIsRecommended(methods[0], 'Switch v1 (Erista)'), true);
  assert.strictEqual(methodIsRecommended(methods[0], 'Switch OLED'), false);
  assert.strictEqual(methodIsRecommended({ title: 'Legacy', recommended: true }, null), true);
}

function testSplitMethods() {
  const split = splitMethodsByRecommendation(methods, 'Switch OLED');
  assert.deepStrictEqual(split.recommended.map(m => m.title), ['Modchip install (OLED/Mariko)']);
  assert.deepStrictEqual(split.rest.map(m => m.title), ['Generic legacy flow']);
}

testCollectModels();
testModelApplicability();
testRecommendationForModel();
testSplitMethods();
console.log('ok - picker logic tests passed');
