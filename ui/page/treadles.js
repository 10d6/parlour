// The two treadles (reedorgan's treadles.js). Holding one sends a message to
// the engine (API.md §9b), which runs the foot's envelope and the reservoir;
// the page draws the pedals and the envelope pictures from what it reports.
import { page, byId, bindCheck } from "./util.js";

const TMIN = 0.005, TMAX = 30;
const toTime = (x) => TMIN * Math.pow(TMAX / TMIN, x / 1000);
const toSliderPos = (t) => Math.round((1000 * Math.log(t / TMIN)) / Math.log(TMAX / TMIN));
const fmtT = (t) => (t < 1 ? Math.round(t * 1000) + " ms" : t < 10 ? t.toFixed(2) + " s" : t.toFixed(1) + " s");
const STAGES = ["idle", "attack", "decay", "sustain", "release"];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// {side, name, foot (param prefix), down, stage, relFrom, lvl, flow, el, shape, dot, flowEl, inputs, outs}
export const ped = [
  { side: "L", name: "Left", foot: "left", down: false, stage: 0, relFrom: 0, lvl: 0, flow: 0 },
  { side: "R", name: "Right", foot: "right", down: false, stage: 0, relFrom: 0, lvl: 0, flow: 0 },
];
let lastFoot = null;
const env = (P) => ({
  a: page.sk.get(`pedal.${P.foot}.attack`), d: page.sk.get(`pedal.${P.foot}.decay`),
  s: page.sk.get(`pedal.${P.foot}.sustain`), r: page.sk.get(`pedal.${P.foot}.release`),
});

export function gateOn(i) {
  const P = ped[i];
  if (P.down) return;
  P.down = true;
  lastFoot = i;
  if (P.el) P.el.setAttribute("aria-pressed", "true");
  page.sk.send("treadle." + P.foot, 1);
}
export function gateOff(i) {
  const P = ped[i];
  if (!P.down) return;
  P.down = false;
  if (P.el) P.el.setAttribute("aria-pressed", "false");
  page.sk.send("treadle." + P.foot, 0);
}
// Space pumps the foot that didn't go last.
export const otherFoot = () => (lastFoot === 0 ? 1 : 0);

// Envelope picture: segment widths on a log-ish scale so 5 ms and 30 s both read.
const segW = (t) => 8 + (46 * Math.log10(1 + t * 20)) / Math.log10(1 + TMAX * 20);
function geom(P) {
  const p = env(P), wa = segW(p.a), wd = segW(p.d), ws = 36, wr = segW(p.r);
  const k = 212 / (wa + wd + ws + wr);
  const x0 = 4, xa = x0 + wa * k, xd = xa + wd * k, xs = xd + ws * k, xr = xs + wr * k;
  return { x0, xa, xd, xs, xr, y: (l) => 58 - 50 * l, s: p.s };
}
function drawShape(P) {
  const g = geom(P), ys = g.y(g.s);
  P.shape.setAttribute("points", `${g.x0},58 ${g.xa.toFixed(1)},8 ${g.xd.toFixed(1)},${ys.toFixed(1)} ${g.xs.toFixed(1)},${ys.toFixed(1)} ${g.xr.toFixed(1)},58`);
}
function placeDot(P) {
  const st = STAGES[P.stage];
  if (st === "idle") { P.dot.setAttribute("opacity", "0"); return; }
  const g = geom(P), s = g.s, lvl = Math.min(1, P.envLvl);
  let x;
  if (st === "attack") x = g.x0 + (g.xa - g.x0) * lvl;
  else if (st === "decay") x = g.xa + (g.xd - g.xa) * (s >= 1 ? 1 : Math.min(1, (1 - lvl) / (1 - s)));
  else if (st === "sustain") x = (g.xd + g.xs) / 2;
  else x = g.xs + (g.xr - g.xs) * (P.relFrom > 0 ? 1 - lvl / P.relFrom : 1);
  P.dot.setAttribute("cx", x.toFixed(1));
  P.dot.setAttribute("cy", g.y(lvl).toFixed(1));
  P.dot.setAttribute("opacity", "1");
}

function buildFoot(P, i, feetEl) {
  const { sk } = page, s = P.side;
  const wrap = document.createElement("div");
  wrap.className = "foot";
  wrap.innerHTML = `
    <button class="treadle" id="t${s}" type="button" aria-pressed="false" aria-label="${P.name} treadle, hold to pump"><span class="carpet">${P.name}</span></button>
    <div class="rail env">
      <div class="env-top"><p class="rail-label">${P.name} foot</p><span class="env-flow" id="flow${s}">idle</span></div>
      <svg viewBox="0 0 220 64" aria-hidden="true">
        <line x1="4" y1="58" x2="216" y2="58" stroke="#5a4028" stroke-width="1"/>
        <polyline id="shape${s}" fill="rgba(201,160,82,.14)" stroke="#c9a052" stroke-width="1.6" stroke-linejoin="round"/>
        <circle id="dot${s}" r="4" fill="#eee3c6" stroke="#1c110b" stroke-width="1.5" cx="4" cy="58" opacity="0"/>
      </svg>
      <div class="env-grid">
        <label for="a${s}">Attack</label><input type="range" id="a${s}" min="0" max="1000"><output id="ao${s}"></output>
        <label for="d${s}">Decay</label><input type="range" id="d${s}" min="0" max="1000"><output id="do${s}"></output>
        <label for="s${s}">Sustain</label><input type="range" id="s${s}" min="0" max="100"><output id="so${s}"></output>
        <label for="r${s}">Release</label><input type="range" id="r${s}" min="0" max="1000"><output id="ro${s}"></output>
      </div>
    </div>`;
  feetEl.appendChild(wrap);
  P.el = wrap.querySelector(".treadle");
  P.shape = wrap.querySelector("#shape" + s);
  P.dot = wrap.querySelector("#dot" + s);
  P.flowEl = wrap.querySelector("#flow" + s);
  const stages = { a: "attack", d: "decay", s: "sustain", r: "release" };
  for (const [k, name] of Object.entries(stages)) {
    const input = wrap.querySelector(`#${k}${s}`), out = wrap.querySelector(`#${k}o${s}`);
    const param = `pedal.${P.foot}.${name}`;
    const isLevel = k === "s";
    sk.onParam(param, (v) => {
      input.value = String(isLevel ? Math.round(v * 100) : toSliderPos(v));
      out.textContent = isLevel ? Math.round(v * 100) + "%" : fmtT(v);
      drawShape(P);
    });
    input.addEventListener("input", () => {
      const v = isLevel ? +input.value / 100 : toTime(+input.value);
      sk.set(param, v);
      // Same envelope for both feet: the other foot follows.
      if (sk.get("pedal.link") >= 0.5) sk.set(`pedal.${ped[1 - i].foot}.${name}`, v);
    });
    input.addEventListener("pointerdown", () => sk.gesture(param, true));
    input.addEventListener("change", () => sk.gesture(param, false));
  }
  P.el.addEventListener("pointerdown", (e) => { e.preventDefault(); try { P.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } gateOn(i); });
  const up = () => gateOff(i);
  P.el.addEventListener("pointerup", up);
  P.el.addEventListener("pointercancel", up);
  P.el.addEventListener("lostpointercapture", up);
  P.el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) gateOn(i); } });
  P.el.addEventListener("keyup", (e) => { if (e.key === "Enter") { e.stopPropagation(); gateOff(i); } });
}

export function setupTreadles() {
  const { sk } = page;
  const feetEl = byId("feet");
  ped.forEach((P, i) => buildFoot(P, i, feetEl));
  bindCheck("link", "pedal.link", (on) => {
    // Linking copies the left foot's envelope to the right.
    if (!on) return;
    for (const name of ["attack", "decay", "sustain", "release"]) {
      const v = sk.get(`pedal.left.${name}`);
      if (sk.get(`pedal.right.${name}`) !== v) sk.set(`pedal.right.${name}`, v);
    }
  });
  // What the engine reports: each pedal's travel and airflow, and each foot's envelope stage.
  ped.forEach((P) => {
    P.envLvl = 0;
    sk.onMeter("pedal." + P.foot, (v) => { P.lvl = v; });
    sk.onMeter("flow." + P.foot, (v) => { P.flow = v; });
  });
  sk.onMessage("pedal.stage", (foot, stage, relFrom) => {
    const P = ped[foot | 0];
    if (!P) return;
    P.stage = stage | 0;
    P.relFrom = relFrom;
  });
  const draw = () => {
    for (const P of ped) {
      const lvl = P.lvl || 0;
      if (reduceMotion) P.el.style.filter = `brightness(${1 + lvl * 0.35})`;
      else P.el.style.transform = `perspective(400px) rotateX(${(lvl * 24).toFixed(1)}deg)`;
      P.envLvl = lvl;
      placeDot(P);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  setInterval(() => {
    for (const P of ped) {
      const st = STAGES[P.stage];
      const stage = st !== "idle" ? st : P.lvl > 0 ? "sequencer" : null;
      P.flowEl.textContent = stage ? stage + " · " + (P.flow || 0).toFixed(2) + "/s" : "idle";
    }
  }, 100);
}
