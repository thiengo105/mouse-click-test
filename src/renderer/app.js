import { MouseDiagnostics, DEFAULT_THRESHOLDS, BUTTONS } from './detector.js';

const $ = (id) => document.getElementById(id);

const testArea = $('test-area');
const diagnostics = new MouseDiagnostics();

let dirty = true;
let logCursor = 0; // highest log seq already painted
let logNeedsRebuild = false;

/* ------------------------------------------------------------------ input */

// Right-click menus, middle-click autoscroll and text selection all interfere
// with a raw button test, so none of them are allowed anywhere in the window.
for (const type of ['contextmenu', 'auxclick', 'dragstart', 'selectstart']) {
  window.addEventListener(type, (e) => e.preventDefault());
}

testArea.addEventListener('mousedown', (e) => {
  e.preventDefault();
  testArea.focus();
  record({ type: 'down', button: e.button, ts: e.timeStamp });
  paintPress(e.button, true);
});

// Bound on the window so a release outside the test panel still completes the
// pair; releases for buttons that were never pressed here are ignored unless
// they happen inside the panel, where they count as dropped presses.
window.addEventListener('mouseup', (e) => {
  const inside = testArea.contains(e.target);
  if (!inside && !diagnostics.isDown(e.button)) return;
  e.preventDefault();
  record({ type: 'up', button: e.button, ts: e.timeStamp });
  paintPress(e.button, false);
});

testArea.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    record({
      type: 'wheel',
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ts: e.timeStamp,
    });
    paintScroll(e.deltaY);
  },
  { passive: false }
);

window.addEventListener('blur', (e) => {
  if (!diagnostics.anyDown()) return;
  record({ type: 'blur', ts: e.timeStamp || performance.now() });
  for (const b of BUTTONS) paintPress(b.id, false);
});

function record(event) {
  diagnostics.ingest(event);
  dirty = true;
}

/* ----------------------------------------------------------- mouse diagram */

const scrollTimers = { up: 0, down: 0 };

function paintPress(button, active) {
  const zone = $(`zone-${button}`);
  if (!zone) return;
  zone.classList.toggle('active', active);
  if (!active) {
    zone.classList.remove('flash');
    void zone.getBoundingClientRect();
    zone.classList.add('flash');
  }
}

function paintScroll(deltaY) {
  if (deltaY === 0) return;
  const key = deltaY < 0 ? 'up' : 'down';
  const arrow = $(`scroll-${key}`);
  arrow.classList.add('active');
  clearTimeout(scrollTimers[key]);
  scrollTimers[key] = setTimeout(() => arrow.classList.remove('active'), 140);
}

/* ---------------------------------------------------------------- controls */

$('btn-reset').addEventListener('click', () => {
  diagnostics.reset();
  for (const b of BUTTONS) paintPress(b.id, false);
  $('log').replaceChildren();
  logCursor = 0;
  dirty = true;
});

$('btn-export').addEventListener('click', () => {
  const payload = {
    generatedAt: new Date().toISOString(),
    platform: window.platform,
    thresholds: diagnostics.thresholds,
    summary: diagnostics.snapshot(performance.now()),
    rawEvents: diagnostics.rawEvents,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `mouse-click-test-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

for (const [key, value] of Object.entries(DEFAULT_THRESHOLDS)) {
  const input = $(`th-${key}`);
  if (!input) continue;
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(diagnostics.thresholds[key]);
      return;
    }
    diagnostics.setThresholds({ [key]: parsed });
    logNeedsRebuild = true;
    dirty = true;
  });
}

/* ----------------------------------------------------------------- render */

// Supplied by the Electron preload or the Tauri initialization script; the
// renderer itself is shell-agnostic.
const platform = window.platform || {};
$('platform-info').textContent = [
  `${platform.os || '?'} ${platform.arch || ''}`.trim(),
  platform.runtime,
]
  .filter(Boolean)
  .join(' · ');

const fmt = (n, digits = 0) =>
  n === 0 ? '0' : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

function cellClass(value, warnAt, failAt) {
  if (value >= failAt) return 'bad';
  if (value >= warnAt) return 'mid';
  return value === 0 ? 'zero' : '';
}

function renderClock(now) {
  const elapsed = diagnostics.startTs !== null ? (now - diagnostics.startTs) / 1000 : 0;
  const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const secs = String(Math.floor(elapsed % 60)).padStart(2, '0');
  $('session-timer').textContent = `${mins}:${secs}`;
}

function render() {
  const now = performance.now();
  const snap = diagnostics.snapshot(now);

  renderClock(now);
  $('event-count').textContent = `${snap.totalEvents} events`;

  renderVerdict(snap);
  renderIssues(snap.issues);
  renderButtons(snap.buttons);
  renderWheel(snap.wheel);
  renderCoverage(snap.coverage);
  renderLog(snap.log);
}

function renderVerdict(snap) {
  const badge = $('verdict-badge');
  const text = $('verdict-text');
  const fails = snap.issues.filter((i) => i.severity === 'fail').length;
  const warns = snap.issues.filter((i) => i.severity === 'warn').length;

  badge.className = 'verdict-badge';
  if (snap.totalEvents === 0) {
    badge.textContent = 'No data';
    text.textContent = 'Start clicking to collect samples.';
  } else if (fails > 0) {
    badge.classList.add('fail');
    badge.textContent = 'Faulty';
    text.textContent = `${fails} fault${fails === 1 ? '' : 's'} detected across ${snap.totalEvents} events.`;
  } else if (warns > 0) {
    badge.classList.add('warn');
    badge.textContent = 'Suspect';
    text.textContent = `${warns} anomal${warns === 1 ? 'y' : 'ies'} worth another pass.`;
  } else {
    badge.classList.add('ok');
    badge.textContent = 'Healthy';
    text.textContent = `No faults in ${snap.totalEvents} events. Keep testing to raise confidence.`;
  }
}

function renderIssues(issues) {
  const host = $('issues');
  if (issues.length === 0) {
    host.replaceChildren(el('div', 'empty', 'Nothing detected yet.'));
    return;
  }
  host.replaceChildren(
    ...issues.map((issue) => {
      const head = el('div', 'issue-head');
      head.append(el('span', '', issue.title), el('span', 'target', issue.target));
      const node = el('div', `issue ${issue.severity}`);
      node.append(head, el('div', 'issue-body', issue.detail));
      return node;
    })
  );
}

function renderButtons(buttons) {
  const body = $('button-table').tBodies[0];
  const rows = buttons.map((b) => {
    const tr = el('tr');
    if (b.isDown) tr.classList.add('pressed');
    tr.append(
      td(b.label, ''),
      td(fmt(b.clicks), b.clicks === 0 ? 'zero' : ''),
      td(fmt(b.chatter), cellClass(b.chatter, 1, 3)),
      td(fmt(b.microClicks), cellClass(b.microClicks, 1, 3)),
      td(fmt(b.orphanUps), cellClass(b.orphanUps, 1, 3)),
      td(b.clicks ? `${fmt(b.holdAvg, 1)} ms` : '—', b.clicks ? '' : 'zero'),
      td(b.gapMin ? `${fmt(b.gapMin, 1)} ms` : '—', b.gapMin && b.gapMin <= diagnostics.thresholds.chatterMs ? 'bad' : ''),
      td(b.cps ? fmt(b.cps, 1) : '—', b.cps ? '' : 'zero')
    );
    return tr;
  });
  body.replaceChildren(...rows);

  for (const b of buttons) {
    const counter = $(`c-${b.id}`);
    if (counter) counter.textContent = String(b.clicks);
    const zone = $(`zone-${b.id}`);
    if (zone) zone.classList.toggle('fault', b.chatter > 0 || b.stuck > 0);
  }
}

function renderWheel(w) {
  $('c-wu').textContent = String(w.up);
  $('c-wd').textContent = String(w.down);

  const cells = [
    ['Events', fmt(w.events), ''],
    ['Up', fmt(w.up), ''],
    ['Down', fmt(w.down), ''],
    ['Horizontal', fmt(w.left + w.right), ''],
    ['Detent step', w.step ? fmt(w.step) : '—', ''],
    ['Notches', fmt(w.notches, 1), ''],
    ['Gestures', fmt(w.gestures), ''],
    ['Reversals', fmt(w.reversals), cellClass(w.reversals, 1, 3)],
    ['Delta spikes', fmt(w.spikes), cellClass(w.spikes, 1, 3)],
    ['Partial steps', fmt(w.partialSteps), ''],
    ['Empty events', fmt(w.zeroDeltas), cellClass(w.zeroDeltas, 1, 3)],
    ['Min gap', w.minGap ? `${fmt(w.minGap, 1)} ms` : '—', ''],
  ];

  $('wheel-stats').replaceChildren(
    ...cells.map(([k, v, cls]) => {
      const cell = el('div', `cell ${cls}`.trim());
      cell.append(el('div', 'cell-k', k), el('div', 'cell-v', v));
      return cell;
    })
  );
}

function renderCoverage(coverage) {
  $('coverage').replaceChildren(
    ...coverage.map((c) => el('span', `chip ${c.done ? 'done' : ''}`.trim(), `${c.done ? '✓' : '○'} ${c.label}`))
  );
}

function renderLog(entries) {
  const host = $('log');

  if (logNeedsRebuild) {
    host.replaceChildren();
    logCursor = 0;
    logNeedsRebuild = false;
  }

  const fresh = entries.filter((e) => e.seq > logCursor);
  if (fresh.length === 0) return;

  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 24;

  for (const entry of fresh) {
    const row = el('div', `log-row ${entry.flags.length ? 'flagged' : ''}`.trim());
    row.append(
      el('span', 't', `${(entry.offset / 1000).toFixed(3)}s`),
      el('span', 'k', entry.kind),
      el('span', 'n', entry.label),
      el('span', 'd', entry.detail)
    );
    if (entry.flags.length) row.append(el('span', 'f', entry.flags.join(' ')));
    host.append(row);
    logCursor = entry.seq;
  }

  while (host.childElementCount > 250) host.firstElementChild.remove();
  if (atBottom) host.scrollTop = host.scrollHeight;
}

/* ------------------------------------------------------------- DOM helpers */

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function td(text, className) {
  return el('td', className, text);
}

/* --------------------------------------------------------------- main loop */

let lastPaint = 0;
let lastClock = 0;

function tick(now) {
  // Full repaint only on new input, or while a button is held down so the
  // "currently stuck" warning can appear without further events.
  if ((dirty || diagnostics.anyDown()) && now - lastPaint > 50) {
    dirty = false;
    lastPaint = now;
    render();
  } else if (now - lastClock > 500) {
    lastClock = now;
    renderClock(now);
  }
  requestAnimationFrame(tick);
}

render();
requestAnimationFrame(tick);
testArea.focus();
