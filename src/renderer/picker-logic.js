(function attachPickerLogic(globalObj) {
  function collectModels(methods) {
    const seen = new Set();
    const out = [];
    methods.forEach(method => {
      if (!Array.isArray(method.models)) return;
      method.models.forEach(model => {
        if (!model || seen.has(model)) return;
        seen.add(model);
        out.push(model);
      });
    });
    return out;
  }

  function methodAppliesToModel(method, selectedModel) {
    if (!selectedModel) return true;
    if (!Array.isArray(method.models) || method.models.length === 0) return true;
    return method.models.includes(selectedModel);
  }

  function methodIsRecommended(method, selectedModel) {
    if (selectedModel && Array.isArray(method.recommendedModels) && method.recommendedModels.length > 0) {
      return method.recommendedModels.includes(selectedModel);
    }
    return !!method.recommended;
  }

  function splitMethodsByRecommendation(methods, selectedModel) {
    const applicable = methods.filter(method => methodAppliesToModel(method, selectedModel));
    const notRecommended = applicable.filter(method => !methodIsRecommended(method, selectedModel));
    return {
      recommended: applicable.filter(method => methodIsRecommended(method, selectedModel)),
      // "rest" = other CFW methods; "extras" = auxiliary guides flagged with `extra`.
      rest: notRecommended.filter(method => !method.extra),
      extras: notRecommended.filter(method => method.extra),
    };
  }

  const api = { collectModels, methodAppliesToModel, methodIsRecommended, splitMethodsByRecommendation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalObj.pickerLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
