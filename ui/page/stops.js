// The stop rail (reedorgan's stops.js): draw knobs for each rank, per half
// when the stops are divided, the Vox Humana and the couplers. Every knob is
// a toggle parameter (stop.bass.<rank>, stop.treble.<rank>, stop.vox, …).
import { page, byId, bindSelect } from "./util.js";
import { RANK_LIST } from "./controls.js";
import { rebuildKeys } from "./keys.js";

const SPLIT_CAPTIONS = {
  ef: { bass: "Bass · up to E below middle C", treble: "Treble · from F below middle C" },
  bc: { bass: "Bass · below middle C", treble: "Treble · from middle C" },
};
let stopsEl = null, splitSel = null, stopsQueued = false;
const isOn = (id) => page.sk.get(id) >= 0.5;
const flip = (id) => page.sk.set(id, isOn(id) ? 0 : 1);

function knob(nm, ft, param, label, onClick, fx) {
  const b = document.createElement("button");
  b.className = "stop" + (fx ? " fx" : "");
  b.type = "button";
  b.setAttribute("aria-pressed", isOn(param) ? "true" : "false");
  b.setAttribute("aria-label", label);
  b.innerHTML = `<span class="nm">${nm}</span><span class="ft">${ft}</span>`;
  b.addEventListener("click", onClick);
  return b;
}
function stopGroup(caption, knobs) {
  const g = document.createElement("div");
  g.className = "stop-group";
  if (caption) { const p = document.createElement("p"); p.className = "group-label"; p.textContent = caption; g.appendChild(p); }
  const row = document.createElement("div");
  row.className = "stops";
  knobs.forEach((k) => row.appendChild(k));
  g.appendChild(row);
  return g;
}
// Drawing the Vox Humana opens its controls (D25).
export function drawVox() {
  if (!isOn("stop.vox")) page.sk.set("stop.vox", 1);
  byId("voxPanel").open = true;
}
function renderStops() {
  stopsQueued = false;
  const split = splitSel.value, divided = split !== "none";
  stopsEl.innerHTML = "";
  stopsEl.classList.toggle("divided", divided);
  const vox = knob("Vox Humana", "tremolo", "stop.vox", "Vox Humana tremolo", () => { if (isOn("stop.vox")) page.sk.set("stop.vox", 0); else drawVox(); }, true);
  const sub = knob("Sub Octave", "coupler", "stop.sub", "Sub octave coupler", () => flip("stop.sub"), true);
  const sup = knob("Super Octave", "coupler", "stop.sup", "Super octave coupler", () => flip("stop.sup"), true);
  if (!divided) {
    // Not divided: one knob per rank sets both halves (the engine follows the treble).
    const ks = RANK_LIST.map((r) => knob(r.nm, r.ft, `stop.treble.${r.id}`, `${r.nm} ${r.ft}`, () => {
      const v = isOn(`stop.treble.${r.id}`) ? 0 : 1;
      page.sk.set(`stop.bass.${r.id}`, v);
      page.sk.set(`stop.treble.${r.id}`, v);
    }));
    stopsEl.appendChild(stopGroup("", [...ks, vox, sub, sup]));
    return;
  }
  for (const h of ["bass", "treble"]) {
    const ks = RANK_LIST.map((r) => knob(r.nm, r.ft, `stop.${h}.${r.id}`, `${h === "bass" ? "Bass" : "Treble"} ${r.nm} ${r.ft}`, () => flip(`stop.${h}.${r.id}`)));
    stopsEl.appendChild(stopGroup(SPLIT_CAPTIONS[split][h], ks));
  }
  stopsEl.appendChild(stopGroup("Whole keyboard", [vox, sub, sup]));
}
const queueStops = () => { if (!stopsQueued) { stopsQueued = true; queueMicrotask(renderStops); } };

export function splitNote() {
  const v = splitSel ? splitSel.value : "none";
  return v === "ef" ? 53 : v === "bc" ? 60 : 0;
}

export function setupStops() {
  const { sk } = page;
  stopsEl = byId("stops");
  splitSel = byId("split");
  bindSelect("split", "stops.split", () => { queueStops(); rebuildKeys(); });
  // Undividing keeps any rank drawn in either half.
  splitSel.addEventListener("change", () => {
    if (splitSel.value !== "none") return;
    for (const r of RANK_LIST) {
      const on = isOn(`stop.bass.${r.id}`) || isOn(`stop.treble.${r.id}`) ? 1 : 0;
      sk.set(`stop.bass.${r.id}`, on);
      sk.set(`stop.treble.${r.id}`, on);
    }
  });
  for (const h of ["bass", "treble"]) for (const r of RANK_LIST) sk.onParam(`stop.${h}.${r.id}`, queueStops);
  for (const id of ["stop.vox", "stop.sub", "stop.sup"]) sk.onParam(id, queueStops);
  renderStops();
}
