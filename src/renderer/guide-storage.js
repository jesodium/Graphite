(function attachGuideStorage(globalObj) {
  function requiresStorageSelection(guide) {
    if (!guide || typeof guide !== 'object') return true;
    if (typeof guide.requiresStorageSelection === 'boolean') return guide.requiresStorageSelection;
    return true;
  }

  const api = { requiresStorageSelection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalObj.guideStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
