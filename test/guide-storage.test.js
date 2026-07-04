const assert = require('assert');
const { requiresStorageSelection } = require('../src/renderer/guide-storage');

function testDefaultRequiresStorage() {
  assert.strictEqual(requiresStorageSelection(null), true);
  assert.strictEqual(requiresStorageSelection({ title: 'Legacy' }), true);
}

function testExplicitFalseSkipsStorageSelection() {
  assert.strictEqual(requiresStorageSelection({ requiresStorageSelection: false }), false);
}

function testExplicitTrueRequiresStorageSelection() {
  assert.strictEqual(requiresStorageSelection({ requiresStorageSelection: true }), true);
}

testDefaultRequiresStorage();
testExplicitFalseSkipsStorageSelection();
testExplicitTrueRequiresStorageSelection();
console.log('ok - guide storage tests passed');
