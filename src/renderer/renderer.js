const g = window.graphite;
const pickerLogic = window.pickerLogic;
const guideStorage = window.guideStorage;
let guide = null;   // loaded guide
let file = null;    // guide filename
let sd = null;      // SD folder path
let i = 0;          // current step index
let os = 'unknown'; // process.platform from main
let sessionState = null; // persisted resume state
const done = new Set(); // completed step ids
let confirmEl = null;
let confirmMessageEl = null;
let confirmContinueBtn = null;
let confirmTimer = null;
let confirmResolve = null;
let confirmCountdown = 0;

const $ = id => document.getElementById(id);

async function buildShell() {
  const [header, picker, guideView] = await Promise.all([
    g.getView('header.html'),
    g.getView('picker.html'),
    g.getView('guide.html'),
  ]);
  $('app').innerHTML = [header, picker, guideView].join('\n');
}

// Tiny markdown: **bold**, `code`, and paragraphs. Enough for guide bodies.
function md(text) {
  return text.split('\n\n').map(p =>
    '<p>' + p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>') + '</p>'
  ).join('');
}

function listItem(node) {
  const li = document.createElement('li');
  li.appendChild(node);
  $('guide-list').appendChild(li);
}

function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function clearConfirmTimer() {
  if (confirmTimer) {
    clearInterval(confirmTimer);
    confirmTimer = null;
  }
}

function closeConfirm(result) {
  clearConfirmTimer();
  if (confirmEl) confirmEl.hidden = true;
  if (confirmResolve) {
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve(result);
  }
}

function updateConfirmContinueText(continueLabel) {
  if (!confirmContinueBtn) return;
  if (confirmCountdown > 0) {
    confirmContinueBtn.textContent = `${continueLabel} (${confirmCountdown}s)`;
    confirmContinueBtn.disabled = true;
  } else {
    confirmContinueBtn.textContent = continueLabel;
    confirmContinueBtn.disabled = false;
  }
}

function ensureConfirm() {
  if (confirmEl) return;

  confirmEl = document.createElement('div');
  confirmEl.id = 'confirm-modal';
  confirmEl.className = 'modal';
  confirmEl.hidden = true;

  const card = document.createElement('div');
  card.className = 'modal-card';

  confirmMessageEl = document.createElement('p');
  card.appendChild(confirmMessageEl);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const confirmCancelBtn = button('Cancel', () => closeConfirm(false));
  confirmContinueBtn = button('Continue', () => closeConfirm(true));
  actions.appendChild(confirmCancelBtn);
  actions.appendChild(confirmContinueBtn);
  card.appendChild(actions);

  confirmEl.appendChild(card);
  document.body.appendChild(confirmEl);
}

function showConfirm(message, { continueLabel = 'Continue', countdownSeconds = 0 } = {}) {
  ensureConfirm();
  if (confirmResolve) closeConfirm(false);

  confirmMessageEl.textContent = message;
  confirmEl.hidden = false;
  confirmCountdown = countdownSeconds;
  updateConfirmContinueText(continueLabel);
  clearConfirmTimer();
  if (confirmCountdown > 0) {
    confirmTimer = setInterval(() => {
      confirmCountdown -= 1;
      updateConfirmContinueText(continueLabel);
      if (confirmCountdown <= 0) clearConfirmTimer();
    }, 1000);
  }

  return new Promise(resolve => {
    confirmResolve = resolve;
  });
}

function confirmDeleteSession() {
  return showConfirm('Are you sure you want to delete this session?', { countdownSeconds: 5 });
}

function confirmLegacyMethod() {
  return showConfirm('You are choosing a legacy method. Are you sure you wish to continue?');
}

function addTextLine(text, className) {
  const li = document.createElement('li');
  if (className) li.className = className;
  li.textContent = text;
  $('guide-list').appendChild(li);
}

function clearHomeResume() {
  const home = $('resume-home');
  if (home) home.innerHTML = '';
}

function showPicker() {
  $('picker').hidden = false;
  $('guide').hidden = true;
}

function resumeStepLabel(st) {
  return Number.isInteger(st?.i) ? st.i + 1 : 1;
}

function renderHomeResume() {
  const home = $('resume-home');
  if (!home) return;
  home.innerHTML = '';
  if (!sessionState?.file) return;

  const box = document.createElement('div');
  box.className = 'resume-box';

  const msg = document.createElement('div');
  msg.textContent = "You've already started a session.";
  box.appendChild(msg);

  const detail = document.createElement('div');
  detail.textContent = `${sessionState.file} (step ${resumeStepLabel(sessionState)})`;
  box.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'resume-actions';
  actions.appendChild(button('Resume', () => start(sessionState.file, sessionState)));
  actions.appendChild(button('Delete session', async () => {
    if (!await confirmDeleteSession()) return;
    await g.clearState();
    sessionState = null;
    renderHomeResume();
    if (guide && !$('picker').hidden) showConsoles(allGuides);
  }));
  box.appendChild(actions);
  home.appendChild(box);
}

// Step 1: pick console. Guides grouped by their `console` field (one per folder).
function showConsoles(guides) {
  const byConsole = {};
  guides.forEach(gd => (byConsole[gd.console] ||= []).push(gd));
  $('picker-title').textContent = 'Pick your console';
  $('guide-list').innerHTML = '';
  clearHomeResume();
  Object.keys(byConsole).forEach(c =>
    listItem(button(c, () => showModelOrMethods(c, byConsole[c])))
  );
  renderHomeResume();
}

function showModelOrMethods(console, methods) {
  const models = pickerLogic.collectModels(methods);
  if (models.length > 0) return showModels(console, methods, models);
  return showMethods(console, methods, null, models);
}

// Step 2: pick model when the selected console has model-aware guides.
function showModels(console, methods, models) {
  $('picker-title').textContent = `${console} - pick your model`;
  $('guide-list').innerHTML = '';
  clearHomeResume();
  models.forEach(model =>
    listItem(button(model, () => showMethods(console, methods, model, models)))
  );
  listItem(button('Back', () => showConsoles(allGuides)));
}

function methodLabel(method) {
  const warnings = Array.isArray(method.warnings) && method.warnings.length
    ? ` [${method.warnings.join(', ')}]`
    : '';
  return `${method.title}${warnings}`;
}

// Step 3 (or 2 for legacy guides): pick method.
function showMethods(console, methods, selectedModel = null, models = []) {
  $('picker-title').textContent = selectedModel
    ? `${console} (${selectedModel}) - pick a method`
    : `${console} - pick a method`;
  $('guide-list').innerHTML = '';
  clearHomeResume();
  const { recommended, rest } = pickerLogic.splitMethodsByRecommendation(methods, selectedModel);
  if (!recommended.length && !rest.length) {
    addTextLine('No methods matched this model yet.', 'meta-note');
  }
  recommended.forEach(m => listItem(button(`${methodLabel(m)} (recommended)`, () => showDetails(console, methods, m.file, selectedModel, models))));
  if (recommended.length && rest.length) {
    const sep = document.createElement('li');
    sep.className = 'sep';
    sep.textContent = '--------';
    $('guide-list').appendChild(sep);
  }
  rest.forEach(m => listItem(button(methodLabel(m), async () => {
    if (!await confirmLegacyMethod()) return;
    showDetails(console, methods, m.file, selectedModel, models);
  })));
  listItem(button('Back', () => {
    if (models.length > 0) return showModels(console, methods, models);
    return showConsoles(allGuides);
  }));
}

let allGuides = [];

function osExplorerName() {
  if (os === 'darwin') return 'Finder';
  if (os === 'win32') return 'File Explorer';
  return 'your file manager';
}

async function showDetails(console, methods, guideFile, selectedModel = null, models = []) {
  const details = await g.loadGuide(guideFile);
  const needsStorageSelection = guideStorage.requiresStorageSelection(details);
  $('picker-title').textContent = `${details.title} - requirements and notes`;
  $('guide-list').innerHTML = '';
  clearHomeResume();

  addTextLine('Requirements:', 'meta-title');
  const reqs = Array.isArray(details.requirements) ? details.requirements : [];
  if (reqs.length) {
    reqs.forEach(r => addTextLine(`- ${r}`, 'meta-item'));
  } else {
    addTextLine('- No extra requirements listed.', 'meta-item');
  }

  const warnings = Array.isArray(details.warnings) ? details.warnings : [];
  if (warnings.length) {
    addTextLine('Warnings:', 'meta-title');
    warnings.forEach(w => addTextLine(`- ${w}`, 'meta-item'));
  }

  if (details._note) {
    addTextLine('Notes:', 'meta-title');
    addTextLine(details._note, 'meta-note');
  }

  if (needsStorageSelection) {
    addTextLine(`Select your SD/microSD card in ${osExplorerName()}.`, 'meta-instruction');
    listItem(button('Select SD/microSD and continue', () => start(guideFile, null, details)));
  } else {
    addTextLine('This guide does not require selecting SD/microSD in Graphite.', 'meta-instruction');
    listItem(button('Continue', () => start(guideFile, null, details)));
  }

  if (sessionState?.file === guideFile) {
    addTextLine("You've already started a session.", 'meta-title');
    listItem(button(`Resume (step ${resumeStepLabel(sessionState)})`, () => start(guideFile, sessionState, details)));
    listItem(button('Delete session', async () => {
      if (!await confirmDeleteSession()) return;
      await g.clearState();
      sessionState = null;
      showDetails(console, methods, guideFile);
    }));
  }

  listItem(button('Back', () => showMethods(console, methods, selectedModel, models)));
}

async function init() {
  await buildShell();
  bindGuideNav();
  allGuides = await g.listGuides();
  os = await g.getPlatform();
  sessionState = await g.getState();
  showPicker();
  showConsoles(allGuides);
}

async function start(f, st, loadedGuide = null) {
  file = f;
  guide = loadedGuide || await g.loadGuide(f);
  const needsStorageSelection = guideStorage.requiresStorageSelection(guide);
  sd = needsStorageSelection ? (st?.sd || sd) : null;
  if (needsStorageSelection && !sd) {
    sd = await g.pickSD();
    if (!sd) return;
  }
  $('sd-label').textContent = needsStorageSelection ? `SD: ${sd}` : 'Storage: not required';
  i = st?.i || 0;
  done.clear();
  (st?.done || []).forEach(d => done.add(d));
  $('picker').hidden = true;
  $('guide').hidden = false;
  render();
}

function render() {
  const step = guide.steps[i];
  $('progress-bar').style.width = `${(i / guide.steps.length) * 100}%`;
  $('step-title').textContent = step.title;
  $('step-body').innerHTML = md(step.body || '');
  $('step-status').textContent = '';
  $('back').disabled = i === 0;

  const box = $('step-action');
  box.innerHTML = '';
  const isDone = done.has(step.id) || !step.action;

  if (step.action) {
    const btn = document.createElement('button');
    btn.textContent = step.action.type === 'manual' ? 'I did this' : 'Run';
    btn.onclick = () => runStep(step, btn);
    box.appendChild(btn);
  }
  $('next').disabled = !isDone && !!step.action;
  $('next').textContent = i === guide.steps.length - 1 ? 'Finish' : 'Next';
}

async function runStep(step, btn) {
  btn.disabled = true;
  $('step-status').textContent = step.action.type === 'manual' ? '' : 'Working...';
  try {
    if (step.action.type !== 'manual') {
      if (!sd && (step.action.type === 'extract' || step.action.type === 'copy')) {
        throw new Error('this guide step requires storage selection');
      }
      await g.runAction(step.action, sd);
    }
    done.add(step.id);
    $('step-status').textContent = 'Done';
    $('next').disabled = false;
    await save();
  } catch (e) {
    $('step-status').textContent = `Error: ${e.message}`;
    btn.disabled = false;
  }
}

function save() {
  sessionState = { file, sd, i, done: [...done] };
  return g.setState(sessionState);
}

function bindGuideNav() {
  $('next').onclick = async () => {
    if (i < guide.steps.length - 1) { i++; await save(); render(); }
    else { $('step-status').textContent = 'All done. Your SD card is ready.'; }
  };
  $('back').onclick = () => { if (i > 0) { i--; render(); } };
}

init();
