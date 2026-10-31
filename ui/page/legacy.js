// Patches from the reedorgan page (.reedorgan.json files, D33) turned into
// Parlour's parameters and custom state. Self-contained, so tools/presets.mjs
// can use it in Node to build the built-in voices from the owner's files.
//
// reedorgan saved slider positions; Parlour's parameters hold real units, so
// each position goes through the slider's own mapping.

const LEGACY_RANKS = ["bourdon", "diapason", "melodia", "celeste", "principal"];
const legacyLog = (lo, hi) => (pos) => lo * Math.pow(hi / lo, pos / 100);
const LEGACY_CHOICES = {
  toneModel: ["tilt", "sweep"],
  voxShape: ["sine", "fan"],
  scoopMode: ["top", "leaps", "all", "velocity", "accent"],
  scoopCurve: ["ease", "smooth", "snap"],
  vibMode: ["top", "all"],
  split: ["none", "ef", "bc"],
  compass: ["full", "organ"],
};
// old key → [parameter, how to convert the saved value]
const LEGACY_PARAMS = {
  directAir: ["wind.air", (v) => v / 10],
  directWind: ["wind.direct", (v) => (v ? 1 : 0)],
  swell: ["swell"],
  reservoir: ["wind.reservoir", legacyLog(0.4, 3)],
  sensitivity: ["wind.drift"],
  driftVariation: ["wind.driftVar"],
  toneModel: ["tone.model", "choice"],
  toneDepth: ["tone.depth"],
  toneQ: ["tone.q", legacyLog(0.5, 8)],
  toneResponse: ["tone.response", legacyLog(0.02, 2)],
  bassCut: ["cab.bass", (v) => (v === 0 ? 5 : 20 * Math.pow(10, v / 100))],
  speech: ["reed.speech", legacyLog(0.5, 4)],
  bloom: ["reed.bloom"],
  scoop: ["reed.glide"],
  reedScatter: ["reed.scatter"],
  reedSeed: ["reed.seed"],
  unisonPull: ["reed.pull"],
  celesteBeat: ["reed.celeste"],
  breath: ["reed.breath"],
  cab: ["cab.mix"],
  room: ["room.mix"],
  thump: ["treadle.noise"],
  voxRate: ["vox.speed"],
  voxShape: ["vox.shape", "choice"],
  voxBlade: ["vox.blade", legacyLog(4000, 600)],
  voxShadow: ["vox.shadow"],
  voxShimmer: ["vox.shimmer"],
  voxStereo: ["vox.stereo"],
  voxWhole: ["vox.whole"],
  voxLid: ["vox.lid"],
  scoopDepth: ["scoop.depth"],
  scoopTime: ["scoop.time", (v) => v / 1000],
  bendRange: ["bendRange"],
  scoopCross: ["scoop.cross"],
  vibDepth: ["vib.depth"],
  vibRate: ["vib.rate"],
  vibDelay: ["vib.delay", (v) => v / 1000],
  vibFade: ["vib.fade", (v) => v / 1000],
  vibNatural: ["vib.natural"],
  vibColour: ["vib.colour"],
  scoopMode: ["scoop.mode", "choice"],
  scoopCurve: ["scoop.curve", "choice"],
  vibMode: ["vib.mode", "choice"],
  autoTempo: ["seq.tempo"],
  helper: ["wind.helper"],
  split: ["stops.split", "choice"],
  compass: ["compass", "choice"],
  easyWind: ["wind.easy", (v) => (v ? 1 : 0)],
  link: ["pedal.link", (v) => (v ? 1 : 0)],
};

export const LEGACY_APP = "parlor-reed-organ";

// {params, custom} from a reedorgan patch's settings. Anything missing is left
// out, so it takes Parlour's default, as reedorgan gave it its factory value.
export function legacySettingsToPatch(settings) {
  const params = {}, custom = {};
  const s = settings || {};
  for (const [key, [id, conv]] of Object.entries(LEGACY_PARAMS)) {
    if (!(key in s)) continue;
    const v = s[key];
    if (conv === "choice") { const i = LEGACY_CHOICES[key].indexOf(v); if (i >= 0) params[id] = i; }
    else if (typeof v === "number" || typeof v === "boolean") params[id] = conv ? conv(v) : v;
  }
  LEGACY_RANKS.forEach((r) => {
    if (typeof s["v-level-" + r] === "number") params[`voice.${r}.level`] = s["v-level-" + r];
    if (typeof s["v-tune-" + r] === "number") params[`voice.${r}.tune`] = s["v-tune-" + r];
  });
  if (LEGACY_RANKS.some((r) => typeof s["v-bright-" + r] === "number")) custom.voicing = { bright: LEGACY_RANKS.map((r) => +s["v-bright-" + r] || 0) };
  if (s.stops && typeof s.stops === "object") {
    for (const h of ["bass", "treble"]) LEGACY_RANKS.forEach((r) => { params[`stop.${h}.${r}`] = s.stops[h] && s.stops[h][r] ? 1 : 0; });
    // reedorgan kept both halves identical when not divided; Parlour's engine reads the treble then.
    if ((s.split || "none") === "none") LEGACY_RANKS.forEach((r) => { params[`stop.treble.${r}`] = params[`stop.bass.${r}`]; });
    params["stop.vox"] = s.stops.vox ? 1 : 0;
    params["stop.sub"] = s.stops.sub ? 1 : 0;
    params["stop.sup"] = s.stops.sup ? 1 : 0;
  }
  const stages = { a: "attack", d: "decay", s: "sustain", r: "release" };
  for (const [key, foot] of [["envL", "left"], ["envR", "right"]]) {
    const e = s[key];
    if (!e || typeof e !== "object") continue;
    for (const [k, name] of Object.entries(stages)) if (typeof e[k] === "number") params[`pedal.${foot}.${name}`] = e[k];
  }
  if (s.seq && typeof s.seq === "object") custom.seq = s.seq;
  return { params, custom };
}

// Reads a .reedorgan.json file: {name, params, custom}, or {error}.
export function readLegacyFile(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { error: "That file isn’t a patch: it can’t be read." }; }
  if (!d || d.app !== LEGACY_APP || d.kind !== "patch" || !d.settings || typeof d.settings !== "object") return { error: "That file isn’t a reedorgan patch. (Parlour’s own patches load with Import, in the patch menu.)" };
  return { name: String(d.name || "Imported patch").replace(/\s+/g, " ").trim().slice(0, 40) || "Imported patch", ...legacySettingsToPatch(d.settings) };
}
