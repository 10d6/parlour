// Every slider and setting on the page, bound to the synth's parameters
// (reedorgan's controls.js). The sliders keep reedorgan's positions and
// readouts; the parameters hold real units (API.md §5).
import { page, byId, logMap, logPos, signed, bindSlider, bindSelect, bindCheck, rememberOpen } from "./util.js";

export const RANK_LIST = [
  { id: "bourdon", nm: "Bourdon", ft: "16′" },
  { id: "diapason", nm: "Diapason", ft: "8′" },
  { id: "melodia", nm: "Melodia", ft: "8′" },
  { id: "celeste", nm: "Celeste", ft: "8′" },
  { id: "principal", nm: "Principal", ft: "4′" },
];
const HELPER_RATE = 0.6;   // reservoir units a second at 100%
export const ctl = {};

const fmtX = (_, x) => x.toFixed(x < 0.95 ? 2 : 1) + "×";
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + " kHz" : Math.round(f / 10) * 10 + " Hz");
const fmtMs = (v) => (v < 1000 ? v + " ms" : (v / 1000).toFixed(2) + " s");
const pct = (off) => (v) => (v === 0 ? off : v + "%");
const ms = { toValue: (p) => p / 1000, toPos: (v) => Math.round(v * 1000) };
const logOf = (lo, hi) => ({ toValue: logMap(lo, hi), toPos: (v) => Math.round(logPos(lo, hi)(v)) });
const capital = (s) => s[0].toUpperCase() + s.slice(1);

const TONE_MODELS = {
  tilt: "Upper harmonics grow and fade against the fundamental as the wind changes, the way a reed responds to pressure. The filter edge stays put, so there is no wah.",
  sweep: "A lowpass filter whose cutoff follows the wind. Dramatic, and at high depth or resonance it sounds like a wah.",
};
const VOX_SHAPES = {
  sine: "A smooth, even sway. The fan turns only while the stop is drawn, takes a moment to spin up and coasts to a stop.",
  fan: "Two blades sweep past the reed cells, so the upper harmonics dip briefly with each pass instead of swaying evenly. The blades aren’t quite matched, which gives a slight lilt.",
};

export function setupControls() {
  const { sk } = page;

  /* ---- top bar, swell and wind ---- */
  ctl.volume = bindSlider("volumeAmt", "volume", { fmt: (v) => (v === 0 ? "Silent" : v + "%") });
  ctl.directAir = bindSlider("airAmt", "wind.air", { fmt: (v) => (v / 10).toFixed(1) + "″", toValue: (p) => p / 10, toPos: (v) => Math.round(v * 10) });
  bindCheck("directOn", "wind.direct", (on) => { ctl.directAir.el.disabled = !on; });
  ctl.swell = bindSlider("swellAmt", "swell", { fmt: (v) => (v === 0 ? "Closed" : v === 100 ? "Full" : v + "%") });
  ctl.res = bindSlider("resAmt", "wind.reservoir", { fmt: fmtX, ...logOf(0.4, 3) });
  ctl.sens = bindSlider("sensAmt", "wind.drift", { fmt: (v) => v + " ¢" });
  ctl.driftVar = bindSlider("driftVarAmt", "wind.driftVar", { fmt: pct("None") });
  ctl.helper = bindSlider("helper", "wind.helper", { out: "helperOut", fmt: (v) => (v === 0 ? "Off" : v + "% · " + ((v / 100) * HELPER_RATE).toFixed(2) + "/s") });

  /* ---- wind tone ---- */
  bindSelect("toneModel", "tone.model", (v) => { byId("toneModelSub").textContent = TONE_MODELS[v]; });
  ctl.toneDepth = bindSlider("toneDepthAmt", "tone.depth", { fmt: pct("None") });
  ctl.toneQ = bindSlider("toneQAmt", "tone.q", { fmt: (_, q) => "Q " + q.toFixed(2), ...logOf(0.5, 8) });
  ctl.toneResp = bindSlider("toneRespAmt", "tone.response", {
    fmt: (_, t) => (t < 0.1 ? Math.round(t * 1000) + " ms" : t < 1 ? Math.round(t * 100) * 10 + " ms" : t.toFixed(1) + " s"),
    ...logOf(0.02, 2),
  });
  // Cabinet bass (D19): 20–200 Hz on a log scale; the bottom of the slider is Off.
  ctl.bassCut = bindSlider("bassCutAmt", "cab.bass", {
    fmt: (v, f) => (v === 0 ? "Off" : "below " + Math.round(f) + " Hz"),
    toValue: (p) => (p === 0 ? 5 : 20 * Math.pow(10, p / 100)),
    toPos: (f) => (f <= 5.01 ? 0 : Math.max(1, Math.round(100 * Math.log10(f / 20)))),
  });

  /* ---- reeds ---- */
  ctl.speech = bindSlider("speechAmt", "reed.speech", { fmt: fmtX, ...logOf(0.5, 4) });
  ctl.bloom = bindSlider("bloomAmt", "reed.bloom", { fmt: (v) => (v === 0 ? "Off" : v + " dB") });
  ctl.glide = bindSlider("scoopAmt", "reed.glide", { fmt: (v) => (v === 0 ? "None" : v + " ¢") });
  ctl.scatter = bindSlider("scatterAmt", "reed.scatter", { fmt: (v) => (v === 0 ? "Perfect" : "±" + v.toFixed(1) + " ¢") });
  byId("newReeds").addEventListener("click", () => {
    const seed = Math.round(sk.get("reed.seed"));
    sk.set("reed.seed", (seed % 100000) + 1 + Math.floor(Math.random() * 997));
  });
  ctl.pull = bindSlider("pullAmt", "reed.pull", { fmt: (v) => (v === 0 ? "Off" : v.toFixed(1) + " ¢") });
  ctl.beat = bindSlider("beatAmt", "reed.celeste", { fmt: (v) => v.toFixed(1) + " /s" });
  ctl.breath = bindSlider("breathAmt", "reed.breath", { fmt: pct("Off") });
  bindSelect("compass", "compass");

  /* ---- rank voicing: level, fine tuning and brightness per rank ---- */
  const grid = byId("voicingGrid");
  for (const r of RANK_LIST) {
    const c = capital(r.id), card = document.createElement("div");
    card.className = "rank-card";
    card.innerHTML = `
    <p class="rank-name">${r.nm} <span>${r.ft}</span></p>
    <div class="field"><div class="field-head"><label for="lv${c}Amt">Level</label><output id="lv${c}Out" for="lv${c}Amt"></output></div>
      <input type="range" id="lv${c}Amt" min="0" max="150" step="5"></div>
    <div class="field"><div class="field-head"><label for="tu${c}Amt">Tuning</label><output id="tu${c}Out" for="tu${c}Amt"></output></div>
      <input type="range" id="tu${c}Amt" min="-20" max="20" step="0.5"></div>
    <div class="field"><div class="field-head"><label for="br${c}Amt">Brightness</label><output id="br${c}Out" for="br${c}Amt"></output></div>
      <input type="range" id="br${c}Amt" min="-100" max="100" step="5"></div>`;
    grid.appendChild(card);
  }
  // Brightness rebuilds the rank's waveform in the engine, so it's sent when
  // you let go of the slider (custom state "voicing", not a parameter).
  const brightEls = RANK_LIST.map((r) => byId(`br${capital(r.id)}Amt`));
  const brightFmt = (v) => (v === 0 ? "Factory" : signed(v));
  const showBright = () => brightEls.forEach((el) => { byId(el.id.replace("Amt", "Out")).textContent = brightFmt(+el.value); });
  const sendBright = () => sk.setCustom("voicing", { bright: brightEls.map((el) => +el.value) });
  sk.onCustom("voicing", (v) => {
    const b = (v && v.bright) || [];
    brightEls.forEach((el, i) => { el.value = String(b[i] ?? 0); });
    showBright();
  });
  brightEls.forEach((el) => { el.addEventListener("input", showBright); el.addEventListener("change", sendBright); });
  ctl.voicing = RANK_LIST.map((r) => {
    const c = capital(r.id);
    return {
      level: bindSlider(`lv${c}Amt`, `voice.${r.id}.level`, { fmt: (v) => (v === 0 ? "Silent" : v + "%") }),
      tune: bindSlider(`tu${c}Amt`, `voice.${r.id}.tune`, { fmt: (v) => (v === 0 ? "0 ¢" : signed(v, 1) + " ¢") }),
    };
  });
  byId("voicingReset").addEventListener("click", () => {
    ctl.voicing.forEach((v) => { v.level.set(100); v.tune.set(0); });
    brightEls.forEach((el) => { el.value = "0"; });
    showBright();
    sendBright();
  });
  rememberOpen("voicing", "voicingOpen");
  rememberOpen("voxPanel", "voxOpen");
  rememberOpen("exprPanel", "exprOpen");

  /* ---- cabinet, room and treadle noise ---- */
  ctl.cab = bindSlider("cabAmt", "cab.mix", { fmt: pct("Off") });
  ctl.room = bindSlider("roomAmt", "room.mix", { fmt: pct("Off") });
  ctl.thump = bindSlider("thumpAmt", "treadle.noise", { fmt: pct("Off") });

  /* ---- Vox Humana fan ---- */
  ctl.voxRate = bindSlider("voxRate", "vox.speed", { fmt: (v) => (+v).toFixed(1) + " Hz", out: "voxOut" });
  bindSelect("voxShape", "vox.shape", (v) => { byId("voxSub").textContent = VOX_SHAPES[v]; });
  // bigger blades reach further down the spectrum: 4 kHz (small) to 600 Hz (large)
  ctl.voxBlade = bindSlider("voxBladeAmt", "vox.blade", { fmt: (_, f) => "above " + fmtHz(f), ...logOf(4000, 600) });
  ctl.voxShadow = bindSlider("voxShadowAmt", "vox.shadow", { fmt: pct("None") });
  ctl.voxShim = bindSlider("voxShimmerAmt", "vox.shimmer", { fmt: pct("None") });
  ctl.voxStereo = bindSlider("voxStereoAmt", "vox.stereo", { fmt: pct("Off") });
  ctl.voxWhole = bindSlider("voxWholeAmt", "vox.whole", { fmt: pct("Off") });
  ctl.voxLid = bindSlider("voxLidAmt", "vox.lid", { fmt: pct("Off") });

  /* ---- Expression (D28, D29) ---- */
  ctl.scoopDepth = bindSlider("scoopDepthAmt", "scoop.depth", { fmt: (v) => (v === 0 ? "Off" : v === 100 ? "a semitone" : v === 200 ? "a whole tone" : v + " ¢") });
  ctl.scoopTime = bindSlider("scoopTimeAmt", "scoop.time", { fmt: (v) => v + " ms", ...ms });
  ctl.bendRange = bindSlider("bendRangeAmt", "bendRange", { fmt: (v) => (v === 0 ? "Off" : "±" + v + (v === 1 ? " semitone" : " semitones")) });
  ctl.scoopCross = bindSlider("scoopCrossAmt", "scoop.cross", { fmt: (v) => "velocity " + v });
  bindSelect("scoopMode", "scoop.mode", (v) => { ctl.scoopCross.el.disabled = v !== "accent"; });
  bindSelect("scoopCurve", "scoop.curve");
  ctl.vibDepth = bindSlider("vibDepthAmt", "vib.depth", { fmt: (v) => (v === 0 ? "Off" : "±" + v + " ¢") });
  ctl.vibRate = bindSlider("vibRateAmt", "vib.rate", { fmt: (v) => (+v).toFixed(1) + " Hz" });
  ctl.vibDelay = bindSlider("vibDelayAmt", "vib.delay", { fmt: (v) => (v >= 2500 ? "Never" : fmtMs(v)), ...ms });
  ctl.vibFade = bindSlider("vibFadeAmt", "vib.fade", { fmt: (v) => (v === 0 ? "At once" : fmtMs(v)), ...ms });
  ctl.vibNatural = bindSlider("vibNaturalAmt", "vib.natural", { fmt: pct("Off") });
  ctl.vibColour = bindSlider("vibColourAmt", "vib.colour", { fmt: pct("Off") });
  bindSelect("vibMode", "vib.mode");

  /* ---- the treadles' Easy wind ---- */
  bindCheck("easyWind", "wind.easy");
}
