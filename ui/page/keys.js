// The keyboard on screen and every way of playing it from the page: pointer,
// computer keys, and (in the browser) MIDI controllers that move settings
// (reedorgan's keys.js). Couplers, the sustain pedal and Expression live in
// the engine now, so they work in a DAW too; the page lights the keys the
// engine says are down, coupled octaves included (the "key" message).
import { page, byId, pageStore } from "./util.js";
import { ctl } from "./controls.js";
import { splitNote } from "./stops.js";
import { gateOn, gateOff, otherFoot } from "./treadles.js";

const KEYMAP = {
  z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
  q: 60, "2": 61, w: 62, "3": 63, e: 64, r: 65, "5": 66, t: 67, "6": 68, y: 69, "7": 70, u: 71,
  i: 72, "9": 73, o: 74, "0": 75, p: 76, "[": 77, "=": 78, "]": 79,
};
// The same keys by physical position (KeyboardEvent.code), so Shift can't
// change which note a key-up releases.
const CODE_NAME = { "[": "BracketLeft", "=": "Equal", "]": "BracketRight" };
const CODEMAP = {};
for (const k in KEYMAP) CODEMAP[CODE_NAME[k] || (/\d/.test(k) ? "Digit" + k : "Key" + k.toUpperCase())] = KEYMAP[k];
const keyIdOf = (e) => (e.code && e.code in CODEMAP ? e.code : (e.key || "").toLowerCase());
const noteOfKey = (id) => (id in CODEMAP ? CODEMAP[id] : KEYMAP[id]);
const KEY_LABEL = {};
for (const k in KEYMAP) KEY_LABEL[KEYMAP[k]] = k;
const isBlackKey = (m) => [1, 3, 6, 8, 10].includes(m % 12);
let keysEl = null, keyRange = null;
const litKeys = new Set();
const kbHeld = new Set(), ptrs = new Map();

// The page's own notes go to the engine on MIDI channel 2, so they don't
// collide with a MIDI keyboard holding the same key.
const play = (m) => page.sk.midi([0x91, m, 100]);
const unplay = (m) => page.sk.midi([0x81, m, 0]);

/* ---------- the keyboard on screen ---------- */
function buildKeys() {
  const w = keysEl.clientWidth || window.innerWidth;
  const r = w < 620 ? [48, 72] : [48, 84];
  if (keyRange && keyRange[0] === r[0] && keyRange[1] === r[1]) return;
  keyRange = r;
  keysEl.innerHTML = "";
  const whites = [];
  for (let m = r[0]; m <= r[1]; m++) if (!isBlackKey(m)) whites.push(m);
  const W = 100 / whites.length;
  let wi = 0;
  for (let m = r[0]; m <= r[1]; m++) {
    const el = document.createElement("div");
    el.dataset.midi = m;
    const lbl = KEY_LABEL[m] && w >= 620 ? `<span class="lbl">${KEY_LABEL[m]}</span>` : "";
    if (isBlackKey(m)) {
      el.className = "key black";
      const bw = W * 0.6;
      el.style.left = `calc(${wi * W - bw / 2}% - 0.5px)`;
      el.style.width = bw + "%";
    } else {
      el.className = "key white" + (m === splitNote() && m > r[0] ? " split" : "");
      wi++;
    }
    el.innerHTML = lbl;
    keysEl.appendChild(el);
  }
  for (const m of litKeys) markKey(m, true);
}
export function rebuildKeys() { if (keysEl) { keyRange = null; buildKeys(); } }
function markKey(m, on) {
  if (on) litKeys.add(m); else litKeys.delete(m);
  const el = keysEl && keysEl.querySelector(`[data-midi="${m}"]`);
  if (el) el.classList.toggle("down", on);
}

/* ---------- all notes off (D18) ---------- */
export function allNotesOff() {
  kbHeld.clear();
  ptrs.clear();
  page.sk.send("notes.off");
  for (const m of [...litKeys]) markKey(m, false);
}

/* ---------- MIDI controllers (browser) ---------- */
// MIDI Learn: Direct wind (D27) and Vibrato delay (D29) each bind whichever
// control moves next. In a DAW, map controllers with the DAW instead.
const CC_NAMES = { 1: "mod wheel", 2: "breath", 4: "foot pedal", 7: "volume knob", 11: "expression pedal" };
const LEARN = {
  direct: { key: "directCC", def: 7, out: "directCC", btn: "directLearn" },
  vib: { key: "vibCC", def: null, out: "vibCC", btn: "vibLearn", clear: "vibForget", none: "No controller" },
};
const learned = {};
let learning = null;
function setLearned(target, cc) {
  learned[target] = cc;
  pageStore.set(LEARN[target].key, cc);
  learning = null;
  showCC();
}
function showCC() {
  for (const [target, L] of Object.entries(LEARN)) {
    const cc = learned[target], on = learning === target, btn = byId(L.btn);
    byId(L.out).textContent = on ? "Move a knob or slider…" : cc == null ? L.none : "MIDI CC" + cc + (CC_NAMES[cc] ? ` (${CC_NAMES[cc]})` : "");
    btn.textContent = on ? "Cancel" : "Learn";
    btn.classList.toggle("attention", on);
    if (L.clear) byId(L.clear).hidden = cc == null || on;
  }
}
const ccPos = (v, n) => Math.round((v / 127) * n);
// A delay controller: all the way down is Never, all the way up is no delay.
const delayPos = (cc) => Math.round(((1 - Math.min(127, Math.max(0, cc)) / 127) * 2500) / 50) * 50;
// The kit's MIDI tap (API.md §9a): returning true means the page has taken
// the message and the engine won't see it; false passes it on. The page takes
// only the controllers it turns into slider moves; notes, the sustain pedal
// and the pitch wheel go on to the engine.
function onMidiIn(bytes) {
  const [st, d1, d2] = bytes, cmd = st & 0xf0;
  if (cmd !== 0xb0) return false;
  if (learning && d1 < 120) { setLearned(learning, d1); return true; }
  const direct = page.sk.get("wind.direct") >= 0.5;
  if (direct && d1 === learned.direct) { ctl.directAir.set(ccPos(d2, 36)); return true; }
  if (learned.vib != null && d1 === learned.vib) { ctl.vibDelay.set(delayPos(d2)); return true; }
  if (d1 === 1) { ctl.scoopDepth.set(ccPos(d2, 40) * 5); return true; }    // the mod wheel sets Scoop (D28)
  if (d1 === 11 || d1 === 4) { ctl.swell.set(ccPos(d2, 100)); return true; }
  if (d1 === 2) { ctl.directAir.set(ccPos(d2, 36)); return true; }          // a breath controller (D26)
  if (d1 === 7) { ctl.volume.set(ccPos(d2, 100)); return true; }            // with Direct wind off, Volume
  if (d1 === 120 || d1 === 123) { for (const m of [...litKeys]) markKey(m, false); }
  return false;
}

export function setupKeys() {
  const { sk } = page;
  keysEl = byId("keys");
  buildKeys();
  new ResizeObserver(buildKeys).observe(keysEl);
  sk.onMessage("key", (m, on) => markKey(m, on > 0.5));

  /* pointer: press, and slide across keys */
  keysEl.addEventListener("pointerdown", (e) => {
    const k = e.target.closest(".key");
    if (!k) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    keysEl.setPointerCapture(e.pointerId);
    const m = +k.dataset.midi;
    ptrs.set(e.pointerId, m);
    play(m);
  });
  keysEl.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest ? el.closest(".key") : null;
    const m = k && keysEl.contains(k) ? +k.dataset.midi : null, cur = ptrs.get(e.pointerId);
    if (m !== cur) { if (cur != null) unplay(cur); if (m != null) play(m); ptrs.set(e.pointerId, m); }
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const m = ptrs.get(e.pointerId);
    if (m != null) unplay(m);
    ptrs.delete(e.pointerId);
  };
  keysEl.addEventListener("pointerup", endPtr);
  keysEl.addEventListener("pointercancel", endPtr);
  keysEl.addEventListener("lostpointercapture", endPtr);
  keysEl.addEventListener("contextmenu", (e) => e.preventDefault());

  /* computer keys: letter rows play, arrows and Space pump */
  let spaceSide = null;
  const releaseKeys = () => { kbHeld.forEach((id) => unplay(noteOfKey(id))); kbHeld.clear(); };
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { allNotesOff(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === "TEXTAREA" || e.target.isContentEditable || (tag === "INPUT" && !["range", "checkbox"].includes(e.target.type))) return;
    if (tag === "INPUT" && (e.key.startsWith("Arrow") || e.key === " ")) return;   // let sliders use arrows
    if (e.target.closest && e.target.closest(".seq-grid")) return;                 // the sequencer's own keys
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); if (!e.repeat) gateOn(e.key === "ArrowLeft" ? 0 : 1); return; }
    if (e.key === " ") {
      if (tag === "BUTTON") return;
      e.preventDefault();
      if (e.repeat || spaceSide != null) return;
      spaceSide = otherFoot();
      gateOn(spaceSide);
      return;
    }
    const id = keyIdOf(e), m = noteOfKey(id);
    if (m !== undefined) { e.preventDefault(); if (e.repeat || kbHeld.has(id)) return; kbHeld.add(id); play(m); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") gateOff(0);
    else if (e.key === "ArrowRight") gateOff(1);
    else if (e.key === " " && spaceSide != null) { gateOff(spaceSide); spaceSide = null; }
    // A Mac sends no key-up for keys let go while Command is held.
    if (e.key === "Meta") { releaseKeys(); return; }
    const id = keyIdOf(e);
    if (kbHeld.has(id)) { kbHeld.delete(id); unplay(noteOfKey(id)); }
  });
  const letGoAll = () => { releaseKeys(); gateOff(0); gateOff(1); spaceSide = null; };
  window.addEventListener("blur", letGoAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) letGoAll(); });

  byId("panicBtn").addEventListener("click", () => allNotesOff());

  /* MIDI: the kit's Connect MIDI button, and learned controls (browser only) */
  for (const [target, L] of Object.entries(LEARN)) {
    learned[target] = pageStore.get(L.key, L.def);
    byId(L.btn).addEventListener("click", () => {
      learning = learning === target ? null : target;
      showCC();
      if (learning) sk.connectMidi();
    });
    if (L.clear) byId(L.clear).addEventListener("click", () => setLearned(target, null));
  }
  showCC();
  if (sk.host) {
    // In a DAW the host routes MIDI; learning is the DAW's job.
    for (const L of Object.values(LEARN)) {
      byId(L.btn).hidden = true;
      if (L.clear) byId(L.clear).hidden = true;
      byId(L.out).textContent = "Map controllers in your DAW";
    }
  } else {
    sk.onMidi(onMidiIn);
  }
}
