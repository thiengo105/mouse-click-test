/**
 * Mouse diagnostics engine.
 *
 * Pure logic: it consumes timestamped input events and produces statistics plus
 * a list of detected faults. It holds no DOM references so the thresholds can
 * be changed and the whole session replayed from the raw event log.
 */

export const DEFAULT_THRESHOLDS = {
  /** A press landing this soon after the previous release is switch bounce. */
  chatterMs: 80,
  /** A press/release cycle shorter than this is too fast to be human. */
  microClickMs: 15,
  /** A button held longer than this is reported as possibly stuck. */
  stuckMs: 5000,
  /** Informational: the OS double-click window this app assumes. */
  doubleClickMs: 500,
  /** A wheel direction flip within this window is encoder bounce. */
  scrollReversalMs: 60,
  /** A wheel delta this many times the usual step is a spike. */
  scrollJumpFactor: 4,
};

export const BUTTONS = [
  { id: 0, key: 'left', label: 'Left' },
  { id: 1, key: 'middle', label: 'Middle / Wheel' },
  { id: 2, key: 'right', label: 'Right' },
  { id: 3, key: 'back', label: 'Back (X1)' },
  { id: 4, key: 'forward', label: 'Forward (X2)' },
];

const MAX_RAW_EVENTS = 50000;
const MAX_LOG_ENTRIES = 250;
const MAX_SAMPLES = 2000;

function buttonLabel(id) {
  const known = BUTTONS.find((b) => b.id === id);
  return known ? known.label : `Button ${id}`;
}

function emptyButtonStats(id) {
  return {
    id,
    label: buttonLabel(id),
    downs: 0,
    ups: 0,
    clicks: 0,
    chatter: 0,
    microClicks: 0,
    stuck: 0,
    orphanUps: 0,
    doublePresses: 0,
    holdTotal: 0,
    holdMin: Infinity,
    holdMax: 0,
    gapMin: Infinity,
    intervalMin: Infinity,
    intervals: [],
    isDown: false,
    // null rather than 0: a timestamp of exactly 0 is legitimate.
    downTs: null,
    lastUpTs: null,
    lastDownTs: null,
  };
}

function emptyWheelStats() {
  return {
    events: 0,
    up: 0,
    down: 0,
    left: 0,
    right: 0,
    reversals: 0,
    spikes: 0,
    zeroDeltas: 0,
    partialSteps: 0,
    gestures: 0,
    magnitudes: [],
    step: 0,
    lastSign: 0,
    lastTs: null,
    minGap: Infinity,
  };
}

/** Most frequent magnitude, rounded, treated as one detent of the wheel. */
function dominantStep(magnitudes) {
  if (magnitudes.length === 0) return 0;
  const histogram = new Map();
  for (const value of magnitudes) {
    const bucket = Math.round(value);
    if (bucket === 0) continue;
    histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [bucket, count] of histogram) {
    if (count > bestCount || (count === bestCount && bucket > best)) {
      best = bucket;
      bestCount = count;
    }
  }
  return best;
}

function push(sample, value) {
  sample.push(value);
  if (sample.length > MAX_SAMPLES) sample.shift();
}

export class MouseDiagnostics {
  constructor(thresholds = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.reset();
  }

  reset() {
    this.buttons = new Map(BUTTONS.map((b) => [b.id, emptyButtonStats(b.id)]));
    this.wheel = emptyWheelStats();
    this.log = [];
    this.rawEvents = [];
    this.startTs = null;
    this.lastTs = null;
    this.seq = 0;
  }

  setThresholds(next) {
    this.thresholds = { ...this.thresholds, ...next };
    const events = this.rawEvents;
    this.reset();
    for (const event of events) this.#apply(event, false);
    this.rawEvents = events.slice();
  }

  /** Feed one event. `event` is {type, ts, ...}. */
  ingest(event) {
    if (this.rawEvents.length < MAX_RAW_EVENTS) this.rawEvents.push(event);
    this.#apply(event, true);
  }

  #apply(event, live) {
    if (this.startTs === null) this.startTs = event.ts;
    this.lastTs = this.lastTs === null ? event.ts : Math.max(this.lastTs, event.ts);
    if (event.type === 'down') this.#down(event);
    else if (event.type === 'up') this.#up(event);
    else if (event.type === 'wheel') this.#wheel(event);
    else if (event.type === 'blur') this.#blur(event);
    void live;
  }

  #stats(buttonId) {
    if (!this.buttons.has(buttonId)) {
      this.buttons.set(buttonId, emptyButtonStats(buttonId));
    }
    return this.buttons.get(buttonId);
  }

  #down(event) {
    const s = this.#stats(event.button);
    const flags = [];

    if (s.lastUpTs !== null) {
      const gap = event.ts - s.lastUpTs;
      if (gap < s.gapMin) s.gapMin = gap;
      if (gap <= this.thresholds.chatterMs) {
        s.chatter += 1;
        flags.push('chatter');
      } else if (gap <= this.thresholds.doubleClickMs) {
        s.doublePresses += 1;
      }
    }

    if (s.lastDownTs !== null) {
      const interval = event.ts - s.lastDownTs;
      push(s.intervals, interval);
      if (interval < s.intervalMin) s.intervalMin = interval;
    }

    if (s.isDown) {
      // A second press with no intervening release: the release was dropped.
      flags.push('missing-release');
    }

    s.downs += 1;
    s.isDown = true;
    s.downTs = event.ts;
    s.lastDownTs = event.ts;

    this.#pushLog({
      ts: event.ts,
      kind: 'down',
      label: s.label,
      detail: `press #${s.downs}`,
      flags,
    });
  }

  #up(event) {
    const s = this.#stats(event.button);
    const flags = [];

    if (!s.isDown) {
      s.orphanUps += 1;
      s.ups += 1;
      flags.push('orphan-release');
      this.#pushLog({
        ts: event.ts,
        kind: 'up',
        label: s.label,
        detail: 'release with no matching press',
        flags,
      });
      s.lastUpTs = event.ts;
      return;
    }

    const hold = event.ts - s.downTs;
    s.ups += 1;
    s.clicks += 1;
    s.isDown = false;
    s.lastUpTs = event.ts;
    s.holdTotal += hold;
    if (hold < s.holdMin) s.holdMin = hold;
    if (hold > s.holdMax) s.holdMax = hold;

    if (hold < this.thresholds.microClickMs) {
      s.microClicks += 1;
      flags.push('micro-click');
    }
    if (hold > this.thresholds.stuckMs) {
      s.stuck += 1;
      flags.push('stuck');
    }

    this.#pushLog({
      ts: event.ts,
      kind: 'up',
      label: s.label,
      detail: `held ${hold.toFixed(1)} ms`,
      flags,
    });
  }

  #wheel(event) {
    const w = this.wheel;
    const { deltaX, deltaY } = event;
    const flags = [];

    w.events += 1;

    if (deltaY === 0 && deltaX === 0) {
      w.zeroDeltas += 1;
      flags.push('zero-delta');
    }

    if (deltaY < 0) w.up += 1;
    else if (deltaY > 0) w.down += 1;
    if (deltaX < 0) w.left += 1;
    else if (deltaX > 0) w.right += 1;

    const magnitude = Math.abs(deltaY) || Math.abs(deltaX);
    if (magnitude > 0) push(w.magnitudes, magnitude);
    w.step = dominantStep(w.magnitudes);

    const sign = Math.sign(deltaY) || Math.sign(deltaX);
    const gap = w.lastTs !== null ? event.ts - w.lastTs : Infinity;
    if (gap < w.minGap) w.minGap = gap;

    if (sign !== 0 && w.lastSign !== 0 && sign !== w.lastSign) {
      if (gap <= this.thresholds.scrollReversalMs) {
        w.reversals += 1;
        flags.push('reversal');
      }
    }

    // A new gesture starts after a pause or a deliberate direction change.
    if (gap > 200 || (sign !== w.lastSign && gap > this.thresholds.scrollReversalMs)) {
      w.gestures += 1;
    }

    if (w.step > 0 && magnitude > 0) {
      if (magnitude > w.step * this.thresholds.scrollJumpFactor) {
        w.spikes += 1;
        flags.push('delta-spike');
      } else if (magnitude < w.step * 0.25) {
        w.partialSteps += 1;
      }
    }

    if (sign !== 0) w.lastSign = sign;
    w.lastTs = event.ts;

    const axis = Math.abs(deltaY) >= Math.abs(deltaX) ? 'Y' : 'X';
    const value = axis === 'Y' ? deltaY : deltaX;
    this.#pushLog({
      ts: event.ts,
      kind: 'wheel',
      label: `Wheel ${axis}`,
      detail: `${value > 0 ? '+' : ''}${value.toFixed(1)}`,
      flags,
    });
  }

  #blur(event) {
    // Focus loss releases everything without counting it as a fault.
    for (const s of this.buttons.values()) {
      if (s.isDown) {
        s.isDown = false;
        s.lastUpTs = event.ts;
        this.#pushLog({
          ts: event.ts,
          kind: 'info',
          label: s.label,
          detail: 'released (window lost focus)',
          flags: [],
        });
      }
    }
  }

  #pushLog(entry) {
    entry.seq = ++this.seq;
    entry.offset = entry.ts - this.startTs;
    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) this.log.shift();
  }

  isDown(buttonId) {
    const s = this.buttons.get(buttonId);
    return Boolean(s && s.isDown);
  }

  anyDown() {
    for (const s of this.buttons.values()) if (s.isDown) return true;
    return false;
  }

  /** Buttons currently held past the stuck threshold, evaluated against `now`. */
  heldTooLong(now) {
    const out = [];
    for (const s of this.buttons.values()) {
      if (s.isDown && now - s.downTs > this.thresholds.stuckMs) {
        out.push({ label: s.label, held: now - s.downTs });
      }
    }
    return out;
  }

  snapshot(now = this.lastTs ?? 0) {
    const buttons = [...this.buttons.values()].map((s) => ({
      id: s.id,
      label: s.label,
      downs: s.downs,
      ups: s.ups,
      clicks: s.clicks,
      chatter: s.chatter,
      microClicks: s.microClicks,
      stuck: s.stuck,
      orphanUps: s.orphanUps,
      doublePresses: s.doublePresses,
      isDown: s.isDown,
      holdAvg: s.clicks > 0 ? s.holdTotal / s.clicks : 0,
      holdMin: s.holdMin === Infinity ? 0 : s.holdMin,
      holdMax: s.holdMax,
      gapMin: s.gapMin === Infinity ? 0 : s.gapMin,
      intervalMin: s.intervalMin === Infinity ? 0 : s.intervalMin,
      cps: cpsOf(s.intervals),
      chatterRate: s.downs > 0 ? s.chatter / s.downs : 0,
    }));

    const w = this.wheel;
    const wheel = {
      ...w,
      magnitudes: undefined,
      minGap: w.minGap === Infinity ? 0 : w.minGap,
      reversalRate: w.events > 0 ? w.reversals / w.events : 0,
      notches: w.step > 0 ? w.magnitudes.reduce((a, m) => a + m / w.step, 0) : 0,
    };

    return {
      buttons,
      wheel,
      issues: this.#issues(buttons, wheel, now),
      coverage: this.#coverage(buttons, wheel),
      durationMs: this.startTs !== null ? this.lastTs - this.startTs : 0,
      totalEvents: this.seq,
      log: this.log,
    };
  }

  #issues(buttons, wheel, now) {
    const issues = [];

    for (const b of buttons) {
      if (b.chatter > 0) {
        const bad = b.chatterRate >= 0.05 || b.chatter >= 3;
        issues.push({
          severity: bad ? 'fail' : 'warn',
          target: b.label,
          title: 'Double-click / chatter',
          detail:
            `${b.chatter} of ${b.downs} presses arrived within ` +
            `${this.thresholds.chatterMs} ms of the previous release ` +
            `(${(b.chatterRate * 100).toFixed(1)}%). Classic worn switch bounce.`,
        });
      }
      if (b.microClicks > 0) {
        issues.push({
          severity: 'warn',
          target: b.label,
          title: 'Implausibly short clicks',
          detail:
            `${b.microClicks} press/release cycles were under ` +
            `${this.thresholds.microClickMs} ms — shorter than a human can click.`,
        });
      }
      if (b.orphanUps > 0) {
        issues.push({
          severity: 'warn',
          target: b.label,
          title: 'Unmatched releases',
          detail: `${b.orphanUps} releases arrived with no matching press. Presses are being dropped.`,
        });
      }
      if (b.stuck > 0) {
        issues.push({
          severity: 'fail',
          target: b.label,
          title: 'Button stuck down',
          detail: `${b.stuck} presses were held past ${this.thresholds.stuckMs} ms before releasing.`,
        });
      }
    }

    for (const held of this.heldTooLong(now)) {
      issues.push({
        severity: 'fail',
        target: held.label,
        title: 'Currently stuck',
        detail: `Held for ${(held.held / 1000).toFixed(1)} s and still down.`,
      });
    }

    if (wheel.reversals > 0) {
      const bad = wheel.reversalRate >= 0.05 || wheel.reversals >= 3;
      issues.push({
        severity: bad ? 'fail' : 'warn',
        target: 'Scroll wheel',
        title: 'Scroll direction reversals',
        detail:
          `${wheel.reversals} direction flips within ${this.thresholds.scrollReversalMs} ms ` +
          `(${(wheel.reversalRate * 100).toFixed(1)}% of events). Indicates a dirty or failing encoder.`,
      });
    }
    if (wheel.spikes > 0) {
      issues.push({
        severity: 'warn',
        target: 'Scroll wheel',
        title: 'Erratic scroll distance',
        detail:
          `${wheel.spikes} event${wheel.spikes === 1 ? '' : 's'} exceeded ` +
          `${this.thresholds.scrollJumpFactor}× the usual ${wheel.step} unit step. ` +
          `The wheel is over-scrolling.`,
      });
    }
    if (wheel.zeroDeltas > 0) {
      issues.push({
        severity: 'info',
        target: 'Scroll wheel',
        title: 'Empty scroll events',
        detail: `${wheel.zeroDeltas} wheel events carried no movement.`,
      });
    }
    if (wheel.partialSteps > 0) {
      issues.push({
        severity: 'info',
        target: 'Scroll wheel',
        title: 'Partial detents',
        detail:
          `${wheel.partialSteps} events were under a quarter of a full step. ` +
          `Normal for a trackpad or a free-spin wheel; suspicious on a notched wheel.`,
      });
    }

    const order = { fail: 0, warn: 1, info: 2 };
    return issues.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  #coverage(buttons, wheel) {
    const items = buttons.map((b) => ({ label: b.label, done: b.clicks > 0 }));
    items.push({ label: 'Scroll up', done: wheel.up > 0 });
    items.push({ label: 'Scroll down', done: wheel.down > 0 });
    return items;
  }
}

function cpsOf(intervals) {
  if (intervals.length === 0) return 0;
  const recent = intervals.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  return mean > 0 ? 1000 / mean : 0;
}
