const g = window.graphite;
let guide = null;   // loaded guide
let file = null;    // guide filename
let sd = null;      // SD folder path
let i = 0;          // current step index
const done = new Set(); // completed step ids

const $ = id => document.getElementById(id);

// Tiny markdown: **bold**, `code`, and paragraphs. Enough for guide bodies.
function md(text) {
  return text.split('\n\n').map(p =>
    '<p>' + p
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>') + '</p>'
  ).join('');
}

async function init() {
  const guides = await g.listGuides();
  $('guide-list').innerHTML = '';
  guides.forEach(gd => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = `${gd.console} — ${gd.method}`;
    b.onclick = () => start(gd.file);
    li.appendChild(b);
    $('guide-list').appendChild(li);
  });

  const st = await g.getState();
  if (st) {
    const resume = document.createElement('p');
    const b = document.createElement('button');
    b.textContent = `Resume ${st.file} (step ${st.i + 1})`;
    b.onclick = () => start(st.file, st);
    resume.appendChild(b);
    $('guide-list').appendChild(resume);
  }
}

async function start(f, st) {
  file = f;
  guide = await g.loadGuide(f);
  sd = st?.sd || sd;
  if (!sd) {
    sd = await g.pickSD();
    if (!sd) return;
  }
  $('sd-label').textContent = `SD: ${sd}`;
  i = st?.i || 0;
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
  const hasAction = step.action && step.action.type !== 'manual';
  const isDone = done.has(step.id) || !step.action;

  if (step.action) {
    const btn = document.createElement('button');
    btn.textContent = step.action.type === 'manual' ? "I did this ✓" : 'Run';
    btn.onclick = () => runStep(step, btn);
    box.appendChild(btn);
  }
  $('next').disabled = !isDone && !!step.action;
  $('next').textContent = i === guide.steps.length - 1 ? 'Finish' : 'Next';
}

async function runStep(step, btn) {
  btn.disabled = true;
  $('step-status').textContent = step.action.type === 'manual' ? '' : 'Working…';
  try {
    if (step.action.type !== 'manual') {
      await g.runAction(step.action, sd);
    }
    done.add(step.id);
    $('step-status').textContent = 'Done ✓';
    $('next').disabled = false;
    await save();
  } catch (e) {
    $('step-status').textContent = `Error: ${e.message}`;
    btn.disabled = false;
  }
}

function save() {
  return g.setState({ file, sd, i, done: [...done] });
}

$('next').onclick = async () => {
  if (i < guide.steps.length - 1) { i++; await save(); render(); }
  else { $('step-status').textContent = 'All done. Your SD card is ready.'; }
};
$('back').onclick = () => { if (i > 0) { i--; render(); } };

init();
