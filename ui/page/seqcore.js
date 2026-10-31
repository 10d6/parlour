// The modulation sequencer's pattern maths for the page's editor, from
// reedorgan's core/modseq.js (D30–D32). The engine plays the same patterns
// (src/organ.h); this half edits them. Names are prefixed where they'd clash
// in the page's joined scope.
// x runs 0…1 through the note; the result runs 0…1 of the way there.
//  linear: even
//  slow:   slow start, then faster, x²
//  fast:   fast start, then settling, 1 − (1 − x)²
//  s:      slow at both ends, smoothstep
export const SEQ_CURVES = { linear: 'Linear', slow: 'Slow start', fast: 'Fast start', s: 'S-curve' };
export function seqShape(x, curve) {
  const u = Math.min(1, Math.max(0, x));
  if (curve === 'slow') return u * u;
  if (curve === 'fast') return 1 - (1 - u) * (1 - u);
  if (curve === 's') return u * u * (3 - 2 * u);
  return u;
}
// The rows, top to bottom: sweeps up, then sweeps down.
export const SEQ_ROWS = [1, -1].flatMap(dir => Object.keys(SEQ_CURVES).map(curve => ({ id: (dir > 0 ? 'up-' : 'down-') + curve, dir, curve })));
const SEQ_ROW_BY_ID = Object.fromEntries(SEQ_ROWS.map(r => [r.id, r]));

// Time signatures. The tempo counts the beat unit: quarter notes in x/4, eighth
// notes in 6/8 (as Pedal autoplay did, D22).
export const METERS = {
  '2/4': { beats: 2, unit: 4 },
  '3/4': { beats: 3, unit: 4 },
  '4/4': { beats: 4, unit: 4 },
  '5/4': { beats: 5, unit: 4 },
  '6/8': { beats: 6, unit: 8 },
};
export const MAX_BARS = 4;
export const TEMPO_MIN = 30, TEMPO_MAX = 200;
export const stepsPerBeat = meter => 16 / METERS[meter].unit;      // 4 in x/4, 2 in 6/8
export const stepsPerBar = meter => METERS[meter].beats * stepsPerBeat(meter);
export const seqSteps = (meter, bars) => bars * stepsPerBar(meter);
export const SEQ_TRIGGERS = ['first', 'each'];

// The lanes, in order, and each one's range: the sequencer works in shares of
// the range (0…1), and Amount is a share of it too.
//  left, right: how far that treadle is pressed down, 0–100% of its stroke
//  direct:      Direct wind, 0–3.6″ on the gauge (the reservoir's pressure, 0…1)
//  fan:         the Vox Humana fan's speed, 1–12 blade passes a second, as its slider
//  swell:       the knee swell, closed to fully open
export const SEQ_TARGET_RANGE = { left: [0, 100], right: [0, 100], direct: [0, 3.6], fan: [1, 12], swell: [0, 100] };
export const SEQ_TARGETS = Object.keys(SEQ_TARGET_RANGE);
export const LANE_NAMES = { left: 'Left treadle', right: 'Right treadle', direct: 'Direct wind', fan: 'Fan speed', swell: 'Knee swell' };
// The treadle lanes are the bellows: they run all the time, from the first
// touch, as Pedal autoplay did. The others follow Starts on.
export const FREE_LANES = ['left', 'right'];
// A target's value as a share of its range, and back.
export const toShare = (target, v) => { const [lo, hi] = SEQ_TARGET_RANGE[target]; return (v - lo) / (hi - lo); };
export const fromShare = (target, s) => { const [lo, hi] = SEQ_TARGET_RANGE[target]; return lo + s * (hi - lo); };
// The Amount readout: the percentage, and what it comes to in the target's units.
export function amountText(target, pct) {
  if (pct === 0) return 'None';
  const span = SEQ_TARGET_RANGE[target][1] - SEQ_TARGET_RANGE[target][0], d = pct / 100 * span;
  if (target === 'direct') return `${pct}% · ${d.toFixed(1)}″`;
  if (target === 'fan') return `${pct}% · ${d.toFixed(1)} Hz`;
  return target === 'swell' ? `${pct}% of the swell` : `${pct}% of a stroke`;
}

// One treadle stroke lasting n 16ths: pressed quickly (a Fast start sweep up
// over the first quarter of it), then let up (a Fast start sweep down) with a
// 16th to spare when there's room. A quarter-note stroke is up for one 16th and
// down over two, which gives about the air of an autoplay stroke with the
// default foot envelope (D22).
export function seqStroke(start, n = 4) {
  const up = Math.max(1, Math.floor(n / 4)), down = Math.max(1, n - up - (n >= 4 ? 1 : 0));
  return [{ row: 'up-fast', start, len: up }, { row: 'down-fast', start: start + up, len: down }];
}

// The starting patterns. The treadles reproduce Pedal autoplay's default (D22):
// one bar of 4/4, right on beat 1, left on beat 2, then a half-note rest, and
// they're on. The others are off, each with a swell up and back over the bar.
const SEQ_SWELL = [{ row: 'up-s', start: 0, len: 8 }, { row: 'down-s', start: 8, len: 8 }];
export const DEFAULT_SEQ = {
  meter: '4/4', bars: 1, trigger: 'first', edit: 'left',
  lanes: {
    left: { on: true, amount: 1, notes: seqStroke(4) },
    right: { on: true, amount: 1, notes: seqStroke(0) },
    direct: { on: false, amount: .25, notes: SEQ_SWELL },
    fan: { on: false, amount: .25, notes: SEQ_SWELL },
    swell: { on: false, amount: .25, notes: SEQ_SWELL },
  },
};

// Notes kept on known rows, inside n steps, in order, and never overlapping (a
// later note that overlaps an earlier one is dropped).
function cleanSeqNotes(src, n) {
  const notes = [];
  for (const x of [...src].filter(x => x && SEQ_ROW_BY_ID[x.row] && Number.isInteger(x.start) && Number.isInteger(x.len)).sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, x.start), end = Math.min(n, x.start + x.len);
    if (end <= start || (notes.length && start < notes[notes.length - 1].start + notes[notes.length - 1].len)) continue;
    notes.push({ row: x.row, start, len: end - start });
  }
  return notes;
}
// A pattern with every field valid; anything missing or wrong takes the default.
export function normaliseSeq(p) {
  p = p || {};
  const meter = METERS[p.meter] ? p.meter : DEFAULT_SEQ.meter;
  const bars = Number.isInteger(p.bars) && p.bars >= 1 && p.bars <= MAX_BARS ? p.bars : DEFAULT_SEQ.bars;
  const n = seqSteps(meter, bars), lanes = {};
  for (const id of SEQ_TARGETS) {
    const src = p.lanes && p.lanes[id] || {}, def = DEFAULT_SEQ.lanes[id];
    lanes[id] = {
      on: typeof src.on === 'boolean' ? src.on : def.on,
      amount: typeof src.amount === 'number' && src.amount >= 0 && src.amount <= 1 ? src.amount : def.amount,
      notes: cleanSeqNotes(Array.isArray(src.notes) ? src.notes : def.notes, n),
    };
  }
  return {
    meter, bars, lanes,
    trigger: SEQ_TRIGGERS.includes(p.trigger) ? p.trigger : DEFAULT_SEQ.trigger,
    edit: SEQ_TARGETS.includes(p.edit) ? p.edit : DEFAULT_SEQ.edit,
  };
}

// Editing. Each returns a new list of notes (in order) and the index of the
// note it placed or changed, or −1.
// Placing a note on a step replaces whatever note covered that step, on any row:
// the control can only move one way at a time.
export function placeNote(notes, row, step) {
  const kept = notes.filter(x => step < x.start || step >= x.start + x.len);
  const out = [...kept, { row, start: step, len: 1 }].sort((a, b) => a.start - b.start);
  return { notes: out, index: out.findIndex(x => x.start === step) };
}
// Moves one end of note i to step `to`: edge 'end' stretches or shortens it
// forwards, 'start' backwards. It can't shrink below one step, pass the
// pattern's ends, or run into the notes either side of it.
export function resizeNote(notes, i, edge, to, steps) {
  const x = notes[i]; if (!x) return { notes, index: -1 };
  const prevEnd = i > 0 ? notes[i - 1].start + notes[i - 1].len : 0;
  const nextStart = i < notes.length - 1 ? notes[i + 1].start : steps;
  let start = x.start, end = x.start + x.len;
  if (edge === 'end') end = Math.min(nextStart, Math.max(start + 1, to));
  else start = Math.max(prevEnd, Math.min(end - 1, to));
  const out = notes.map((y, k) => k === i ? { ...y, start, len: end - start } : y);
  return { notes: out, index: i };
}
export const removeNote = (notes, i) => notes.filter((_, k) => k !== i);
// Changing the time or the number of bars keeps what each bar had: a note
// stays at its place in its bar, and notes that no longer fit are dropped or
// shortened.
export function reshape(p, meter, bars) {
  const oldBar = stepsPerBar(p.meter), newBar = stepsPerBar(meter), lanes = {};
  for (const id of SEQ_TARGETS) {
    const notes = [];
    for (const x of p.lanes[id].notes) {
      const bar = Math.floor(x.start / oldBar), off = x.start % oldBar;
      if (bar < bars && off < newBar) notes.push({ ...x, start: bar * newBar + off });
    }
    lanes[id] = { ...p.lanes[id], notes };
  }
  return normaliseSeq({ ...p, meter, bars, lanes });
}

