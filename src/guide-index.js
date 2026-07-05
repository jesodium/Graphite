function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeGuideMetadata(file, guide) {
  const models = cleanStringArray(guide.models);
  const recommendedModels = cleanStringArray(guide.recommendedModels)
    .filter(model => models.includes(model));
  const warnings = cleanStringArray(guide.warnings);
  const requirements = cleanStringArray(guide.requirements);
  return {
    file,
    console: guide.console,
    title: guide.title,
    recommended: !!guide.recommended,
    extra: !!guide.extra,
    tileImage: typeof guide.tileImage === 'string' ? guide.tileImage : null,
    wip: !!guide.wip,
    requiresStorageSelection: guide.requiresStorageSelection !== false,
    models,
    recommendedModels,
    warnings,
    requirements,
  };
}

module.exports = { normalizeGuideMetadata };
