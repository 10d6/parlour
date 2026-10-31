// The wind gauge, its readouts and the status line under it (reedorgan's
// wind-loop.js). The reservoir itself runs in the engine; the page reads its
// mod sources ("wind.pressure", "wind.reeds", "wind.use") and status messages.
import { page, byId } from "./util.js";

const GAUGE_MAX = 4;
const STATUS = [
  ["Press a key to start", true],
  ["Sequencer moving the wind", true],
  ["Direct wind", true],
  ["Relief valve venting", false],
  ["Out of wind. Pump!", false],
  ["Wind is low", false],
  ["Helper can’t keep up; wind falling", false],
  ["Sequencer pumping", true],
  ["Helper pumping", true],
  ["Keep pumping to hold the wind", true],
];
export const wind = { pressure: 0.5, reeds: 0, use: 0.018 };

function drawGauge() {
  const g = byId("ticks");
  let s = "";
  for (let i = 0; i <= GAUGE_MAX * 4; i++) {
    const v = i / 4, a = Math.PI * (1 - v / GAUGE_MAX), major = i % 4 === 0;
    const r1 = major ? 70 : 76, r2 = 84;
    const x1 = 100 + r1 * Math.cos(a), y1 = 112 - r1 * Math.sin(a), x2 = 100 + r2 * Math.cos(a), y2 = 112 - r2 * Math.sin(a);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#3a2416" stroke-width="${major ? 2 : 1}"/>`;
    if (major) {
      const xr = 100 + 58 * Math.cos(a), yr = 112 - 58 * Math.sin(a) + 4;
      s += `<text x="${xr.toFixed(1)}" y="${yr.toFixed(1)}" text-anchor="middle" font-family="IM Fell English SC, Georgia, serif" font-size="13" fill="#3a2416">${v}</text>`;
    }
  }
  g.innerHTML = s;
  const a0 = Math.PI * (1 - 3.6 / GAUGE_MAX);
  byId("redzone").setAttribute("d", `M${(100 + 80 * Math.cos(a0)).toFixed(1)} ${(112 - 80 * Math.sin(a0)).toFixed(1)} A80 80 0 0 1 180 112`);
}

export function setupWind() {
  const { sk } = page;
  drawGauge();
  const needle = byId("needle"), status = byId("status");
  const rWind = byId("rWind"), rPitch = byId("rPitch"), rReeds = byId("rReeds"), rUse = byId("rUse");
  sk.onMeter("wind.pressure", (p) => {
    if (!Number.isFinite(p)) return;
    wind.pressure = p;
    needle.setAttribute("transform", `rotate(${(-90 + 180 * p * 0.9).toFixed(1)} 100 112)`);
  });
  sk.onMeter("wind.reeds", (v) => { wind.reeds = v; });
  sk.onMeter("wind.use", (v) => { wind.use = v; });
  sk.onMessage("wind.status", (code) => {
    const [text, ok] = STATUS[code | 0] || STATUS[0];
    status.textContent = text;
    status.classList.toggle("ok", ok);
  });
  setInterval(() => {
    const p = wind.pressure;
    rWind.textContent = (p * GAUGE_MAX * 0.9).toFixed(1) + "″";
    const c = Math.round((0.55 - p) * sk.get("wind.drift"));
    rPitch.textContent = (c > 0 ? "+" : c < 0 ? "−" : "") + Math.abs(c) + " ¢";
    rReeds.textContent = String(Math.round(wind.reeds));
    rUse.textContent = (wind.use || 0).toFixed(2) + "/s";
  }, 100);
}
