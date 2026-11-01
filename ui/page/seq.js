// The modulation sequencer's editor (reedorgan's modseq.js, D30–D32). The
// pattern is the synth's custom state "seq" (API.md §5a), so it's saved in
// patches and played by the engine; the page draws the piano roll, edits it
// and shows the playhead.
//
// Tempo: in the browser the sequencer keeps its own tempo (the "seq.tempo"
// parameter, saved in patches), and the page tells the engine so with the
// "clock.own" message. In a DAW it follows the song's tempo instead.
import { page, byId, bindSlider, pageStore } from "./util.js";
import { drawVox } from "./stops.js";
import {
  SEQ_ROWS, SEQ_CURVES, SEQ_TARGETS, LANE_NAMES, METERS, MAX_BARS, normaliseSeq, reshape,
  placeNote, resizeNote, removeNote, seqSteps, stepsPerBar, stepsPerBeat, seqShape, amountText,
} from "./seqcore.js";

let seqP = normaliseSeq();   // meter, bars, trigger, edit (the lane on show), lanes {on, amount, notes}
let seqSel = -1, seqSent = "";
let gridEl, laneEl, playEl, onEl, amountEl, amountOut, tabsEl, meterEl, barsEl, trigEl;
const seqPos = { free: -1, keys: -1 };

const curLane = () => seqP.lanes[seqP.edit];
const curSteps = () => seqSteps(seqP.meter, seqP.bars);
const rowIndex = (id) => SEQ_ROWS.findIndex((r) => r.id === id);
// grid rows: 1 the beat numbers, 2 "Sweep up", 3–6 its curves, 7 "Sweep down", 8–11 its curves
const gridRow = (i) => (i < 4 ? 3 + i : 4 + i);
const describeRow = (r) => `Sweep ${r.dir > 0 ? "up" : "down"}, ${SEQ_CURVES[r.curve]}`;
function whereStep(s) {
  const bar = stepsPerBar(seqP.meter), beat = stepsPerBeat(seqP.meter);
  return `bar ${Math.floor(s / bar) + 1}, beat ${Math.floor((s % bar) / beat) + 1}, 16th ${(s % beat) + 1}`;
}

// What each lane needs to move, and how to turn that on when the lane is.
//  - The treadles rest while Direct wind supplies the air; turning one on turns Direct wind off.
//  - Direct wind only moves while it's on; turning its lane on turns it on.
//  - The fan only turns while the Vox Humana is drawn; turning its lane on draws it.
const seqParamOn = (id) => page.sk.get(id) >= 0.5;
const LANE_TARGETS = {
  left: { ready: () => !seqParamOn("wind.direct"), enable: () => page.sk.set("wind.direct", 0) },
  right: { ready: () => !seqParamOn("wind.direct"), enable: () => page.sk.set("wind.direct", 0) },
  direct: { ready: () => seqParamOn("wind.direct"), enable: () => page.sk.set("wind.direct", 1) },
  fan: { ready: () => seqParamOn("stop.vox"), enable: () => drawVox() },
  swell: { ready: () => true, enable: () => {} },
};
const lanePos = (id) => (id === "left" || id === "right" ? seqPos.free : seqPos.keys);
const lanePlaying = (id) => seqP.lanes[id].on && lanePos(id) >= 0 && LANE_TARGETS[id].ready();

// Saves the pattern (everything but the lane on show) to the engine.
function commit() {
  const { edit, ...rest } = seqP;
  seqSent = JSON.stringify(rest);
  page.sk.setCustom("seq", rest);
}

function curvePath(r) {
  let d = "";
  for (let k = 0; k <= 20; k++) {
    const x = k * 5, y = seqShape(k / 20, r.curve) * 100;
    d += (k ? "L" : "M") + x + " " + (r.dir > 0 ? 100 - y : y).toFixed(1);
  }
  return d;
}
const curveSvg = (r, cls) => `<svg class="${cls}" viewBox="-4 -4 108 108" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath(r)}" vector-effect="non-scaling-stroke"/></svg>`;

function renderTabs() {
  tabsEl.querySelectorAll(".seq-tab").forEach((b) => {
    const id = b.dataset.lane;
    b.setAttribute("aria-selected", id === seqP.edit ? "true" : "false");
    b.classList.toggle("on", seqP.lanes[id].on);
  });
  onEl.checked = curLane().on;
  amountEl.value = String(Math.round(curLane().amount * 100));
  amountOut.textContent = amountText(seqP.edit, +amountEl.value);
  gridEl.setAttribute("aria-label", `${LANE_NAMES[seqP.edit]} pattern`);
}
function seqRender() {
  const n = curSteps(), bar = stepsPerBar(seqP.meter), beat = stepsPerBeat(seqP.meter);
  gridEl.style.setProperty("--steps", n);
  let h = "";
  for (let s = 0; s < n; s += beat) {
    const b = Math.floor(s / bar), k = (s % bar) / beat + 1;
    h += `<span class="seq-beat${s % bar === 0 ? " is-bar" : ""}" style="grid-column:${s + 2} / span ${beat}">${s % bar === 0 && seqP.bars > 1 ? `${b + 1}.` : ""}${k}</span>`;
  }
  h += `<span class="seq-group" style="grid-row:2">Sweep up</span><span class="seq-group" style="grid-row:7">Sweep down</span>`;
  SEQ_ROWS.forEach((r, i) => {
    h += `<span class="seq-label" style="grid-row:${gridRow(i)}">${curveSvg(r, "seq-icon")}<span>${SEQ_CURVES[r.curve]}</span></span>`;
    for (let s = 0; s < n; s++) {
      h += `<button type="button" class="seq-cell${s % beat === 0 ? " is-beat" : ""}${s % bar === 0 ? " is-bar" : ""}" style="grid-row:${gridRow(i)};grid-column:${s + 2}" data-row="${r.id}" data-step="${s}" aria-label="${describeRow(r)}, ${whereStep(s)}"></button>`;
    }
  });
  curLane().notes.forEach((x, k) => { h += noteHtml(x, k); });
  h += `<div class="seq-lane" style="grid-column:2 / -1;grid-row:1 / -1"><div class="seq-play" hidden></div></div>`;
  gridEl.innerHTML = h;
  laneEl = gridEl.querySelector(".seq-lane");
  playEl = gridEl.querySelector(".seq-play");
  renderTabs();
}
function noteHtml(x, k) {
  const r = SEQ_ROWS[rowIndex(x.row)];
  return `<button type="button" class="seq-note ${r.dir > 0 ? "up" : "down"}${k === seqSel ? " selected" : ""}" data-i="${k}" style="${noteStyle(x)}" aria-label="${noteLabel(x)}">` +
    `${curveSvg(r, "seq-shape")}<span class="seq-handle start" data-edge="start"></span><span class="seq-handle end" data-edge="end"></span></button>`;
}
const noteStyle = (x) => `grid-row:${gridRow(rowIndex(x.row))};grid-column:${x.start + 2} / span ${x.len}`;
const noteLabel = (x) => `${describeRow(SEQ_ROWS[rowIndex(x.row)])}, ${x.len} sixteenth${x.len > 1 ? "s" : ""} from ${whereStep(x.start)}`;
function selectNote(k, focus = true) {
  seqSel = k;
  gridEl.querySelectorAll(".seq-note").forEach((el) => el.classList.toggle("selected", +el.dataset.i === k));
  const el = gridEl.querySelector(`.seq-note[data-i="${k}"]`);
  if (el && focus) el.focus();
}
function editNotes({ notes, index }) {
  curLane().notes = notes;
  commit();
  seqRender();
  if (index >= 0) selectNote(index);
}

// Stretching a note by dragging either end: updated in place while dragging,
// saved when it's let go.
function startDrag(e, handle) {
  const el = handle.closest(".seq-note"), k = +el.dataset.i, edge = handle.dataset.edge;
  e.preventDefault();
  e.stopPropagation();
  selectNote(k);
  handle.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const box = laneEl.getBoundingClientRect(), n = curSteps();
    const to = Math.round(((ev.clientX - box.left) / box.width) * n);
    curLane().notes = resizeNote(curLane().notes, k, edge, to, n).notes;
    el.style.cssText = noteStyle(curLane().notes[k]);
    el.setAttribute("aria-label", noteLabel(curLane().notes[k]));
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    commit();
    seqRender();
    selectNote(k);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

// Keys on a selected note: Backspace or Delete removes it; Shift+arrows
// stretch it, Alt+arrows shorten it.
function onNoteKey(e) {
  const el = e.target.closest && e.target.closest(".seq-note");
  if (!el) return;
  const k = +el.dataset.i, x = curLane().notes[k], n = curSteps();
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    e.stopPropagation();
    curLane().notes = removeNote(curLane().notes, k);
    seqSel = -1;
    commit();
    seqRender();
    gridEl.querySelector(`.seq-cell[data-row="${x.row}"][data-step="${x.start}"]`)?.focus();
    return;
  }
  if (!e.key.startsWith("Arrow") || !(e.shiftKey || e.altKey) || e.key === "ArrowUp" || e.key === "ArrowDown") return;
  e.preventDefault();
  e.stopPropagation();
  const right = e.key === "ArrowRight";
  const [edge, to] = e.shiftKey ? (right ? ["end", x.start + x.len + 1] : ["start", x.start - 1]) : (right ? ["start", x.start + 1] : ["end", x.start + x.len - 1]);
  editNotes(resizeNote(curLane().notes, k, edge, to, n));
}

export function setupSeq() {
  const { sk } = page;
  seqP = normaliseSeq({ ...(sk.custom("seq") || {}), edit: pageStore.get("seqLane", "left") });
  gridEl = byId("seqGrid");
  onEl = byId("seqOn");
  tabsEl = byId("seqLanes");
  amountEl = byId("seqAmountAmt");
  amountOut = byId("seqAmountOut");
  meterEl = byId("seqMeter");
  barsEl = byId("seqBars");
  trigEl = byId("seqTrigger");
  meterEl.innerHTML = Object.keys(METERS).map((k) => `<option value="${k}">${k}</option>`).join("");
  barsEl.innerHTML = Array.from({ length: MAX_BARS }, (_, i) => `<option value="${i + 1}">${i + 1} bar${i ? "s" : ""}</option>`).join("");
  tabsEl.innerHTML = SEQ_TARGETS.map((id) => `<button type="button" role="tab" class="seq-tab" data-lane="${id}"><span class="lamp" aria-hidden="true"></span>${LANE_NAMES[id]}</button>`).join("");
  const syncHead = () => { meterEl.value = seqP.meter; barsEl.value = String(seqP.bars); trigEl.value = seqP.trigger; };
  syncHead();
  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".seq-tab");
    if (!b) return;
    seqP.edit = b.dataset.lane;
    pageStore.set("seqLane", seqP.edit);
    seqSel = -1;
    seqRender();
  });
  // Turning a lane on turns on what it moves (D31, D32).
  onEl.addEventListener("change", () => {
    curLane().on = onEl.checked;
    if (curLane().on) LANE_TARGETS[seqP.edit].enable();
    commit();
    renderTabs();
  });
  amountEl.addEventListener("input", () => {
    curLane().amount = +amountEl.value / 100;
    amountOut.textContent = amountText(seqP.edit, +amountEl.value);
    commit();
  });
  const reshapeTo = () => { seqP = reshape(seqP, meterEl.value, +barsEl.value); seqSel = -1; commit(); seqRender(); };
  meterEl.addEventListener("change", reshapeTo);
  barsEl.addEventListener("change", reshapeTo);
  trigEl.addEventListener("change", () => { seqP.trigger = trigEl.value; commit(); });
  byId("seqClear").addEventListener("click", () => { curLane().notes = []; seqSel = -1; commit(); seqRender(); });
  gridEl.addEventListener("pointerdown", (e) => { const h = e.target.closest(".seq-handle"); if (h) startDrag(e, h); });
  gridEl.addEventListener("click", (e) => {
    const note = e.target.closest(".seq-note");
    if (note) { selectNote(+note.dataset.i); return; }
    const cell = e.target.closest(".seq-cell");
    if (cell) editNotes(placeNote(curLane().notes, cell.dataset.row, +cell.dataset.step));
  });
  gridEl.addEventListener("focusin", (e) => { const note = e.target.closest(".seq-note"); if (note && +note.dataset.i !== seqSel) selectNote(+note.dataset.i, false); });
  gridEl.addEventListener("keydown", onNoteKey);
  // A patch loading (or the plugin restoring) replaces the pattern.
  sk.onCustom("seq", (v) => {
    const text = JSON.stringify(v);
    if (text === seqSent) return;
    seqSent = text;
    seqP = normaliseSeq({ ...(v || {}), edit: seqP.edit });
    seqSel = -1;
    syncHead();
    seqRender();
  });
  seqRender();

  // The playhead: where the engine's two clocks are.
  sk.onMeter("seq.free", (v) => { seqPos.free = v; });
  sk.onMeter("seq.keys", (v) => { seqPos.keys = v; });
  const tick = () => {
    if (playEl) {
      const on = lanePlaying(seqP.edit);
      if (on) playEl.style.left = (lanePos(seqP.edit) * 100).toFixed(2) + "%";
      if (playEl.hidden === on) playEl.hidden = !on;
    }
    renderLamps();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Tempo: the sequencer's own in the browser; the DAW's in a plugin.
  if (sk.host) {
    byId("tempoField").hidden = true;
    byId("tempoHostField").hidden = false;
    const out = byId("tempoHost");
    sk.onMeters((m) => { if (m && m.bpm) out.textContent = `follows your DAW · ${Math.round(m.bpm)} bpm`; });
  } else {
    bindSlider("tempoAmt", "seq.tempo", { fmt: (v) => v + " bpm" });
    // Told once the sound is running (the first meter frame). A message sent
    // before that would start the audio without a click, which browsers
    // leave suspended, so the organ never sounded.
    let told = false;
    sk.onMeters(() => { if (!told) { told = true; sk.send("clock.own", 1); } });
  }
}
// The tabs' lamps follow whether each lane is on (a patch, or turning Direct
// wind on, can change that from elsewhere).
function renderLamps() {
  tabsEl.querySelectorAll(".seq-tab").forEach((b) => b.classList.toggle("on", seqP.lanes[b.dataset.lane].on));
}
