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
let confirmHideTimer = null;

const $ = id => document.getElementById(id);

// Cover with the curtain, then run fn (may be async — content loads while the
// curtain is down, so the screen is ready the moment it lifts), then lift.
function withCurtain(fn) {
  const c = $('curtain');
  c.classList.add('active');
  setTimeout(async () => {
    await fn();
    setTimeout(() => c.classList.remove('active'), 50);
  }, 450);
}

async function buildShell() {
  const [header, picker, guideView] = await Promise.all([
    g.getView('header.html'),
    g.getView('picker.html'),
    g.getView('guide.html'),
  ]);
  $('app').innerHTML = [header, picker, guideView].join('\n');
}

// Tiny markdown: **bold**, `code`, `!!danger!!`, and paragraphs. Enough for guide bodies.
function md(text) {
  return text.split('\n\n').map(p =>
    '<p>' + p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/!!(.+?)!!/g, '<span class="danger">$1</span>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>') + '</p>'
  ).join('');
}

function listItem(node) {
  const li = document.createElement('li');
  li.appendChild(node);
  $('guide-list').appendChild(li);
}

function button(text, onclick, className = 'method-card') {
  const b = document.createElement('button');
  b.className = className;
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function tileButton(onclick) {
  const b = document.createElement('button');
  b.onclick = onclick;
  return b;
}

// Top-left "← Back" text link. Pass null to clear it (top-level screen).
function renderBack(onclick) {
  const nav = $('picker-nav');
  if (!nav) return;
  nav.innerHTML = '';
  if (!onclick) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'back-link';
  b.innerHTML = '<span class="back-arrow" aria-hidden="true">←</span><span>Back</span>';
  b.onclick = onclick;
  nav.appendChild(b);
}

function clearConfirmTimer() {
  if (confirmTimer) {
    clearInterval(confirmTimer);
    confirmTimer = null;
  }
}

function closeConfirm(result) {
  clearConfirmTimer();
  if (confirmEl) {
    confirmEl.classList.add('closing');
    if (confirmHideTimer) clearTimeout(confirmHideTimer);
    confirmHideTimer = setTimeout(() => {
      confirmEl.hidden = true;
      confirmEl.classList.remove('closing');
      confirmHideTimer = null;
    }, 200);
  }
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
  const confirmCancelBtn = button('Cancel', () => {
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 400);
    closeConfirm(false);
  });
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
  if (confirmHideTimer) { clearTimeout(confirmHideTimer); confirmHideTimer = null; }
  confirmEl.classList.remove('closing');

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
  li.innerHTML = md(text).replace(/<\/?p>/g, '');
  $('guide-list').appendChild(li);
}

function clearHomeResume() {
  const b = $('resume-banner');
  if (b) b.innerHTML = '';
}

function showPicker() {
  $('picker').hidden = false;
  $('guide').hidden = true;
  $('sd-label').textContent = ''; // storage label belongs to the step flow, not the catalog
}

function resumeStepLabel(st) {
  return Number.isInteger(st?.i) ? st.i + 1 : 1;
}

function renderHomeResume() {
  const b = $('resume-banner');
  if (!b) return;
  b.innerHTML = '';
  if (!sessionState?.file) return;

  const box = document.createElement('div');
  box.className = 'resume-banner-box';

  const info = document.createElement('div');
  info.className = 'resume-info';
  const label = document.createElement('span');
  label.className = 'resume-label';
  label.textContent = 'Ongoing session';
  const detail = document.createElement('span');
  detail.className = 'resume-detail';
  detail.textContent = sessionState.file + ' (step ' + resumeStepLabel(sessionState) + ')';
  info.appendChild(label);
  info.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'resume-actions';
  const resumeBtn = document.createElement('button');
  resumeBtn.textContent = 'Resume';
  resumeBtn.onclick = () => start(sessionState.file, sessionState);
  actions.appendChild(resumeBtn);

  box.appendChild(info);
  box.appendChild(actions);
  b.appendChild(box);
}

// Step 1: pick console. Guides grouped by their `console` field (one per folder).
function showConsoles(guides) {
  const byConsole = {};
  guides.forEach(gd => (byConsole[gd.console] ||= []).push(gd));
  withCurtain(() => {
    $('picker-title').textContent = 'Pick your console';
    $('guide-list').innerHTML = '';
    clearHomeResume();
    renderBack(null);
    const grid = document.createElement('div');
    grid.className = 'console-grid';
    Object.keys(byConsole).forEach(c => {
      const count = byConsole[c].length;
      const btn = tileButton(() => showModelOrMethods(c, byConsole[c]));
      btn.className = 'console-tile';
      // identity color comes from the console's console.json (guides:list attaches it)
      const edge = byConsole[c].find(gd => gd.edge)?.edge;
      if (edge) btn.style.setProperty('--edge', edge);
      const tileImg = byConsole[c].find(gd => gd.consoleTileImage)?.consoleTileImage;
      if (tileImg) {
        btn.classList.add('has-console-img');
        btn.style.setProperty('--console-img', `url('${tileImg}')`);
      }
      btn.innerHTML = '<span class="console-name">' + c + '</span><span class="console-count">' + count + ' guide' + (count !== 1 ? 's' : '') + '</span>';
      const li = document.createElement('li');
      li.appendChild(btn);
      grid.appendChild(li);
    });
    $('guide-list').appendChild(grid);
    renderHomeResume();
  });
}

function showModelOrMethods(console, methods) {
  const models = pickerLogic.collectModels(methods);
  if (models.length > 0) return showModels(console, methods, models);
  return showMethods(console, methods, null, models);
}

// Step 2: pick model when the selected console has model-aware guides.
function showModels(console, methods, models) {
  withCurtain(() => {
    $('picker-title').textContent = `${console} - pick your model`;
    $('guide-list').innerHTML = '';
    clearHomeResume();
    models.forEach(model => {
      const btn = button(model, () => showMethods(console, methods, model, models));
      listItem(btn);
    });
    renderBack(() => showConsoles(allGuides));
  });
}

// Square method tile: title, minimum requirements (small), optional badge.
function methodTile(m, onclick, badge) {
  const b = tileButton(onclick);
  b.className = 'method-card';
  if (m.tileImage) {
    b.classList.add('has-bg');
    b.style.setProperty('--tile-img', `url('${m.tileImage}')`);
  }
  const reqs = (Array.isArray(m.requirements) ? m.requirements : []).slice(0, 3);
  b.innerHTML =
    '<span class="method-name">' + m.title + '</span>' +
    (reqs.length ? '<span class="method-reqs">' + reqs.map(r => '<span class="req">' + r + '</span>').join('') + '</span>' : '') +
    (badge ? '<span class="badge">' + badge + '</span>' : '');
  return b;
}

function methodGrid(tiles) {
  const grid = document.createElement('div');
  grid.className = 'method-grid';
  tiles.forEach(t => grid.appendChild(t));
  $('guide-list').appendChild(grid);
}

// Step 3 (or 2 for legacy guides): pick method.
function showMethods(console, methods, selectedModel = null, models = []) {
  const { recommended, rest, extras } = pickerLogic.splitMethodsByRecommendation(methods, selectedModel);
  const sectionSep = label => {
    const sep = document.createElement('li');
    sep.className = 'sep';
    sep.innerHTML = `<span class="sep-text">${label}</span>`;
    $('guide-list').appendChild(sep);
  };
  withCurtain(() => {
    $('picker-title').textContent = selectedModel
      ? `${console} (${selectedModel}) - pick a method`
      : `${console} - pick a method`;
    $('guide-list').innerHTML = '';
    clearHomeResume();
    if (!recommended.length && !rest.length && !extras.length) {
      addTextLine('No methods matched this model yet.', 'meta-note');
    }
    if (recommended.length) {
      methodGrid(recommended.map(m =>
        methodTile(m, () => showDetails(console, methods, m.file, selectedModel, models), 'recommended')));
    }
    if (recommended.length && rest.length) {
      sectionSep('other methods');
    }
    if (rest.length) {
      methodGrid(rest.map(m =>
        methodTile(m, async () => {
          if (!await confirmLegacyMethod()) return;
          showDetails(console, methods, m.file, selectedModel, models);
        })));
    }
    if (extras.length) {
      sectionSep('extras');
      methodGrid(extras.map(m =>
        methodTile(m, () => showDetails(console, methods, m.file, selectedModel, models))));
    }
    renderBack(() => {
      if (models.length > 0) return showModels(console, methods, models);
      return showConsoles(allGuides);
    });
  });
}

let allGuides = [];

function osExplorerName() {
  if (os === 'darwin') return 'Finder';
  if (os === 'win32') return 'File Explorer';
  return 'your file manager';
}

async function showDetails(console, methods, guideFile, selectedModel = null, models = []) {
  withCurtain(async () => {
    const details = await g.loadGuide(guideFile); // loads under the curtain
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
      listItem(button(`Select in ${osExplorerName()}`, () => start(guideFile, null, details), 'action-btn'));
    } else {
      addTextLine('This guide does not require selecting SD/microSD in Graphite.', 'meta-instruction');
      listItem(button('Continue', () => start(guideFile, null, details), 'action-btn'));
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

    renderBack(() => showMethods(console, methods, selectedModel, models));
  });
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
  // Drop steps meant for other platforms (e.g. the Mac-only clean-and-eject step).
  guide.steps = guide.steps.filter(s => !s.platform || s.platform === os);
  const needsStorageSelection = guideStorage.requiresStorageSelection(guide);
  sd = needsStorageSelection ? (st?.sd || sd) : null;
  if (needsStorageSelection && !sd) {
    sd = await g.pickSD();
    if (!sd) return;
    // FAT32 verification/format is handled by any guide step with action type "fat32".
  }
  $('sd-label').textContent = needsStorageSelection && sd ? `SD: ${sd}` : '';
  i = st?.i || 0;
  done.clear();
  (st?.done || []).forEach(d => done.add(d));
  withCurtain(() => {
    $('picker').hidden = true;
    $('guide').hidden = false;
    render();
  });
}

function render() {
  const step = guide.steps[i];
  $('progress-bar').style.width = `${(i / guide.steps.length) * 100}%`;
  $('step-title').textContent = step.title;
  $('step-body').innerHTML = md(step.body || '');
  $('step-status').textContent = '';
  $('back').disabled = i === 0;

  // Optional step image(s): string or array; URL or bundled path.
  const imgBox = $('step-image');
  imgBox.innerHTML = '';
  const imgs = step.image ? (Array.isArray(step.image) ? step.image : [step.image]) : [];
  imgs.forEach(src => {
    const img = document.createElement('img');
    img.className = 'step-img';
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    imgBox.appendChild(img);
  });

  const box = $('step-action');
  box.innerHTML = '';
  const isDone = done.has(step.id) || !step.action;

  if (step.action?.type === 'fat32') {
    renderFat32Check(step, box);
  } else if (step.action) {
    const btn = document.createElement('button');
    btn.textContent = step.action.label || (step.action.type === 'manual' ? 'I did this' : 'Run');
    btn.onclick = () => runStep(step, btn);
    box.appendChild(btn);
  }
  $('next').disabled = !isDone && !!step.action && !step.action.optional;
  $('next').textContent = i === guide.steps.length - 1 ? 'Finish' : 'Next';
}

function fat32Status(box, text, cls) {
  const p = document.createElement('p');
  p.className = 'fat32-status' + (cls ? ' ' + cls : '');
  p.textContent = text;
  box.appendChild(p);
  return p;
}

// Auto-verify the selected card is FAT32; offer a Format button if not.
// Driven by a guide step's `{ "type": "fat32", "warning": "..." }` action — fully data-driven.
async function renderFat32Check(step, box) {
  if (!sd) { // storage not selected — let the user proceed manually
    fat32Status(box, 'No card selected to verify.', 'warn');
    const btn = button('Continue anyway', () => { markStepDone(step); render(); }, 'action-btn');
    box.appendChild(btn);
    return;
  }
  fat32Status(box, 'Checking card format…');
  const check = await g.checkSD(sd);
  box.innerHTML = '';

  if (!check.ok) { // platform can't auto-check (e.g. Windows) — manual fallback
    fat32Status(box, 'Cannot auto-verify format here. Make sure the card is FAT32.', 'warn');
    const btn = button('It is FAT32 — continue', () => { markStepDone(step); render(); }, 'action-btn');
    box.appendChild(btn);
    return;
  }
  if (check.isFAT32) {
    fat32Status(box, '✓ Card is FAT32.', 'ok');
    markStepDone(step);
    $('next').disabled = false;
    return;
  }
  fat32Status(box, `✗ Card is ${check.fsName || 'not FAT32'}. It must be FAT32.`, 'warn');
  box.appendChild(button('Format to FAT32', () => runFormat(step, box), 'action-btn'));
}

async function runFormat(step, box) {
  const warning = step.action.warning
    || 'Formatting erases everything on this card. Back up anything you need first — this cannot be undone.';
  const go = await showConfirm(warning, { continueLabel: 'Format to FAT32', countdownSeconds: 3 });
  if (!go) return;
  box.innerHTML = '';
  fat32Status(box, 'Formatting…');
  const result = await g.formatSD(sd);
  if (!result.ok) {
    box.innerHTML = '';
    fat32Status(box, 'Format failed: ' + (result.error || 'unknown error'), 'warn');
    box.appendChild(button('Try again', () => render(), 'action-btn'));
    return;
  }
  render(); // re-runs the check — should now pass and mark the step done
}

function markStepDone(step) {
  done.add(step.id);
  return save();
}

async function runStep(step, btn) {
  btn.disabled = true;
  $('step-status').textContent = step.action.type === 'manual' ? '' : 'Working...';
  try {
    if (step.action.type !== 'manual') {
      const needsSd = ['extract', 'copy', 'sdinstall', 'backupnand', 'cleaneject'];
      if (!sd && needsSd.includes(step.action.type)) {
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

// Guide complete: clear the session, celebrate, then return home.
async function finishGuide() {
  await g.clearState();
  sessionState = null;
  showSuccess(() => withCurtain(() => {
    $('guide').hidden = true;
    showPicker();
    showConsoles(allGuides);
  }));
}

let successEl = null;
function showSuccess(onDone) {
  if (!successEl) {
    successEl = document.createElement('div');
    successEl.id = 'success-screen';
    successEl.hidden = true;
    successEl.innerHTML = '<div class="success-inner">'
      + '<div class="success-check">✅</div>'
      + '<h2>You have successfully modded your Wii U!</h2>'
      + '<p>Returning home…</p></div>';
    document.body.appendChild(successEl);
  }
  successEl.hidden = false;
  requestAnimationFrame(() => successEl.classList.add('show'));
  const finish = () => {
    if (successEl.hidden) return;
    successEl.classList.remove('show');
    clearTimeout(timer);
    setTimeout(() => { successEl.hidden = true; onDone(); }, 300);
  };
  const timer = setTimeout(finish, 2800);
  successEl.onclick = finish; // let the user skip the wait
}

function bindGuideNav() {
  // Exit to home, keeping progress saved so the session can be resumed later.
  $('exit-home').onclick = async () => {
    await save();
    showPicker();
    showConsoles(allGuides);
  };
  $('next').onclick = async () => {
    if (i < guide.steps.length - 1) { i++; await save(); render(); }
    else { await finishGuide(); }
  };
  $('back').onclick = () => { if (i > 0) { i--; render(); } };
}

init();
