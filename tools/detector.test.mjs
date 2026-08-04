import assert from 'node:assert/strict';
import { MouseDiagnostics } from '../src/renderer/detector.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}

// --- chatter -------------------------------------------------------------
test('clean clicks produce no issues', () => {
  const d = new MouseDiagnostics();
  let t = 1000;
  for (let i = 0; i < 10; i++) {
    d.ingest({ type: 'down', button: 0, ts: t });
    d.ingest({ type: 'up', button: 0, ts: t + 70 });
    t += 400;
  }
  const s = d.snapshot(t);
  assert.equal(s.buttons[0].clicks, 10);
  assert.equal(s.buttons[0].chatter, 0);
  assert.equal(s.issues.length, 0, JSON.stringify(s.issues));
});

test('switch bounce is flagged as chatter', () => {
  const d = new MouseDiagnostics();
  let t = 1000;
  for (let i = 0; i < 5; i++) {
    d.ingest({ type: 'down', button: 0, ts: t });
    d.ingest({ type: 'up', button: 0, ts: t + 60 });
    // bounce: re-press 12 ms after release, 5 ms long
    d.ingest({ type: 'down', button: 0, ts: t + 72 });
    d.ingest({ type: 'up', button: 0, ts: t + 77 });
    t += 500;
  }
  const s = d.snapshot(t);
  const left = s.buttons[0];
  assert.equal(left.chatter, 5);
  assert.equal(left.microClicks, 5);
  const chatterIssue = s.issues.find((i) => i.title === 'Double-click / chatter');
  assert.ok(chatterIssue, 'chatter issue missing');
  assert.equal(chatterIssue.severity, 'fail');
});

test('deliberate double-click is NOT chatter', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 0, ts: 1000 });
  d.ingest({ type: 'up', button: 0, ts: 1060 });
  d.ingest({ type: 'down', button: 0, ts: 1200 }); // 140 ms gap: human
  d.ingest({ type: 'up', button: 0, ts: 1260 });
  const s = d.snapshot(1300);
  assert.equal(s.buttons[0].chatter, 0);
  assert.equal(s.buttons[0].doublePresses, 1);
  assert.equal(s.issues.length, 0);
});

// --- stuck / orphan ------------------------------------------------------
test('stuck button is a failure', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 2, ts: 0 });
  d.ingest({ type: 'up', button: 2, ts: 7000 });
  const s = d.snapshot(7000);
  assert.equal(s.buttons.find((b) => b.id === 2).stuck, 1);
  assert.ok(s.issues.some((i) => i.title === 'Button stuck down' && i.severity === 'fail'));
});

test('live held button is reported without a release', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 1, ts: 0 });
  const s = d.snapshot(9000);
  assert.ok(s.issues.some((i) => i.title === 'Currently stuck'));
});

test('orphan release is counted', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'up', button: 3, ts: 500 });
  const s = d.snapshot(500);
  assert.equal(s.buttons.find((b) => b.id === 3).orphanUps, 1);
  assert.ok(s.issues.some((i) => i.title === 'Unmatched releases'));
});

test('blur releases held buttons without penalty', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 0, ts: 0 });
  d.ingest({ type: 'blur', ts: 100 });
  const s = d.snapshot(20000);
  assert.equal(s.buttons[0].isDown, false);
  assert.equal(s.issues.length, 0);
});

// --- wheel ---------------------------------------------------------------
test('clean scrolling produces no issues', () => {
  const d = new MouseDiagnostics();
  let t = 0;
  for (let i = 0; i < 20; i++) {
    d.ingest({ type: 'wheel', deltaX: 0, deltaY: 100, deltaMode: 0, ts: t });
    t += 120;
  }
  const s = d.snapshot(t);
  assert.equal(s.wheel.down, 20);
  assert.equal(s.wheel.step, 100);
  assert.equal(s.wheel.reversals, 0);
  assert.equal(s.issues.length, 0, JSON.stringify(s.issues));
});

test('encoder bounce is flagged as reversal', () => {
  const d = new MouseDiagnostics();
  let t = 0;
  for (let i = 0; i < 10; i++) {
    d.ingest({ type: 'wheel', deltaX: 0, deltaY: 100, deltaMode: 0, ts: t });
    d.ingest({ type: 'wheel', deltaX: 0, deltaY: -100, deltaMode: 0, ts: t + 15 });
    t += 200;
  }
  const s = d.snapshot(t);
  assert.ok(s.wheel.reversals >= 10, `got ${s.wheel.reversals}`);
  assert.ok(s.issues.some((i) => i.title === 'Scroll direction reversals' && i.severity === 'fail'));
});

test('direction change after a pause is not a reversal', () => {
  const d = new MouseDiagnostics();
  for (let i = 0; i < 5; i++) d.ingest({ type: 'wheel', deltaX: 0, deltaY: 100, deltaMode: 0, ts: i * 120 });
  for (let i = 0; i < 5; i++) d.ingest({ type: 'wheel', deltaX: 0, deltaY: -100, deltaMode: 0, ts: 2000 + i * 120 });
  const s = d.snapshot(3000);
  assert.equal(s.wheel.reversals, 0);
});

test('over-scroll spike is flagged', () => {
  const d = new MouseDiagnostics();
  let t = 0;
  for (let i = 0; i < 20; i++, t += 120) d.ingest({ type: 'wheel', deltaX: 0, deltaY: 100, deltaMode: 0, ts: t });
  d.ingest({ type: 'wheel', deltaX: 0, deltaY: 900, deltaMode: 0, ts: t });
  const s = d.snapshot(t);
  assert.equal(s.wheel.spikes, 1);
  assert.ok(s.issues.some((i) => i.title === 'Erratic scroll distance'));
});

// --- replay --------------------------------------------------------------
test('raising the chatter window reclassifies past events', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 0, ts: 0 });
  d.ingest({ type: 'up', button: 0, ts: 50 });
  d.ingest({ type: 'down', button: 0, ts: 150 }); // 100 ms gap
  d.ingest({ type: 'up', button: 0, ts: 200 });
  assert.equal(d.snapshot(200).buttons[0].chatter, 0);

  d.setThresholds({ chatterMs: 120 });
  const after = d.snapshot(200);
  assert.equal(after.chatter, undefined);
  assert.equal(after.buttons[0].chatter, 1);
  assert.equal(after.buttons[0].clicks, 2, 'replay must not duplicate events');
  assert.equal(d.rawEvents.length, 4, 'raw log must survive replay');
});

test('coverage tracks untested inputs', () => {
  const d = new MouseDiagnostics();
  d.ingest({ type: 'down', button: 0, ts: 0 });
  d.ingest({ type: 'up', button: 0, ts: 50 });
  const s = d.snapshot(50);
  assert.equal(s.coverage.find((c) => c.label === 'Left').done, true);
  assert.equal(s.coverage.find((c) => c.label === 'Scroll up').done, false);
  assert.equal(s.coverage.length, 7);
});

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
