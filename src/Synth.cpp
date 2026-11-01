// Parlour: a reed organ simulator. A port of reedorgan (a Web Audio sketch)
// onto synthkit. The sound graph is the sketch's, node for node, built from
// the kit's Web Audio blocks (sk::wa, API.md §8a); the wind loop that ran on
// the page's animation frames runs here, once per control block.
//
//   per key:   5 reeds (one per rank): oscillator → tone shelf → speech envelope
//              → that rank's stop (bass or treble half)
//   global:    swell lowpass → cabinet bass highpass → wind gain → tremolo (+ breath
//              noise) → Vox Humana fan stage → body EQ → cabinet → room → compressor
//              → Volume (+ treadle thumps) → limiter → soft-clip ceiling
//
// The page (ui/page.js) sends the treadles and a few other things as messages
// (API.md §9b) and reads the wind from the mod sources declared below.
#include <synthkit/synth.h>

#include <atomic>
#include <map>
#include <memory>
#if !defined(__wasi__)
#include <mutex>
#endif

#include "organ.h"

using namespace sk;
using organ::kRanks;

struct Parlour;

namespace {

constexpr double SWELL_CLOSED = 0.75, SWELL_OPEN = 1.5;   // D21
const double MASTER = 0.8 * std::pow(10.0, -organ::limiterMakeupDb() / 20);   // D20

// An exponential approach, as AudioParam.setTargetAtTime, stepped over dt.
inline void approach(double& v, double target, double dt, double tau) {
  v = tau <= 0 ? target : target + (v - target) * std::exp(-dt / tau);
}
inline void approach(float& v, double target, double dt, double tau) {
  double d = v;
  approach(d, target, dt, tau);
  v = static_cast<float>(d);
}

/* ---------- custom state: the sequencer (D30–D32) ---------- */

const char* const ROW_IDS[organ::kSeqRows] = {"up-linear", "up-slow", "up-fast", "up-s", "down-linear", "down-slow", "down-fast", "down-s"};
const char* const METER_IDS[5] = {"2/4", "3/4", "4/4", "5/4", "6/8"};
const char* const LANE_IDS[organ::kLanes] = {"left", "right", "direct", "fan", "swell"};

struct SeqLane {
  bool on = false;
  float amount = 0.25f;
  std::vector<organ::SeqNote> notes;
};
struct Seq {
  int meter = 2, bars = 1, trigger = 0;   // trigger: 0 first note, 1 each note
  std::array<SeqLane, organ::kLanes> lanes;
};
std::vector<organ::SeqNote> stroke(int start) {   // a quarter-note treadle stroke
  return {{2, start, 1}, {6, start + 1, 2}};
}
Seq defaultSeq() {
  Seq s;
  const std::vector<organ::SeqNote> swell = {{3, 0, 8}, {7, 8, 8}};
  s.lanes[organ::kLeft] = {true, 1, stroke(4)};
  s.lanes[organ::kRight] = {true, 1, stroke(0)};
  for (int i = organ::kDirect; i < organ::kLanes; ++i) s.lanes[static_cast<std::size_t>(i)] = {false, 0.25f, swell};
  return s;
}
// Notes kept on known rows, inside n steps, in order, never overlapping.
std::vector<organ::SeqNote> cleanNotes(std::vector<organ::SeqNote> src, int n) {
  std::stable_sort(src.begin(), src.end(), [](auto& a, auto& b) { return a.start < b.start; });
  std::vector<organ::SeqNote> out;
  for (auto& x : src) {
    const int start = std::max(0, x.start), end = std::min(n, x.start + x.len);
    if (end <= start || (!out.empty() && start < out.back().start + out.back().len)) continue;
    out.push_back({x.row, start, end - start});
  }
  return out;
}
void saveSeq(const Seq& s, Json& j) {
  j["meter"] = METER_IDS[s.meter];
  j["bars"] = s.bars;
  j["trigger"] = s.trigger ? "each" : "first";
  Json lanes = Json::object();
  for (int i = 0; i < organ::kLanes; ++i) {
    const auto& L = s.lanes[static_cast<std::size_t>(i)];
    Json lj = Json::object(), notes = Json::array();
    lj["on"] = L.on;
    lj["amount"] = L.amount;
    for (auto& x : L.notes) {
      Json nj = Json::object();
      nj["row"] = ROW_IDS[x.row];
      nj["start"] = x.start;
      nj["len"] = x.len;
      notes.push(nj);
    }
    lj["notes"] = notes;
    lanes[LANE_IDS[i]] = lj;
  }
  j["lanes"] = lanes;
}
void loadSeq(const Json& j, Seq& s) {
  const Seq def = defaultSeq();
  s = def;
  for (int k = 0; k < 5; ++k)
    if (j["meter"].string() == METER_IDS[k]) s.meter = k;
  const double bars = j["bars"].number(1);
  if (bars >= 1 && bars <= organ::MAX_BARS && bars == std::floor(bars)) s.bars = static_cast<int>(bars);
  s.trigger = j["trigger"].string() == "each" ? 1 : 0;
  const int n = organ::seqSteps(s.meter, s.bars);
  for (int i = 0; i < organ::kLanes; ++i) {
    const Json& lj = j["lanes"][LANE_IDS[i]];
    auto& L = s.lanes[static_cast<std::size_t>(i)];
    if (lj.isNull()) { L.notes = cleanNotes(L.notes, n); continue; }
    if (lj["on"].isBool()) L.on = lj["on"].boolean();
    const double a = lj["amount"].number(-1);
    if (a >= 0 && a <= 1) L.amount = static_cast<float>(a);
    if (lj["notes"].isArray()) {
      std::vector<organ::SeqNote> notes;
      for (auto& nj : lj["notes"].items()) {
        int row = -1;
        for (int r = 0; r < organ::kSeqRows; ++r)
          if (nj["row"].string() == ROW_IDS[r]) row = r;
        if (row < 0 || !nj["start"].isNumber() || !nj["len"].isNumber()) continue;
        notes.push_back({row, static_cast<int>(nj["start"].number()), static_cast<int>(nj["len"].number())});
      }
      L.notes = std::move(notes);
    }
    L.notes = cleanNotes(L.notes, n);
  }
}

/* ---------- custom state: rank brightness and the waves made from it (D4) ---------- */

std::atomic<double> gSampleRate{48000};

struct Voicing {
  std::array<float, kRanks> bright{};   // −100…100, 0 = factory
  std::array<float, kRanks> comp{1, 1, 1, 1, 1};
  std::array<std::shared_ptr<const wa::PeriodicWave>, kRanks> waves{};
  double sr = 0;   // the sample rate the waves were built for
};

// Waves are kept once built, by rank, brightness and sample rate, so loading
// a patch doesn't rebuild them. Building allocates, so it happens only where
// custom state loads (never on the audio thread) and in prepare.
std::shared_ptr<const wa::PeriodicWave> rankWave(int i, float bright, double sr) {
#if !defined(__wasi__)
  static std::mutex mutex;
  std::lock_guard<std::mutex> lock(mutex);
#endif
  static std::map<std::pair<int, int>, std::shared_ptr<const wa::PeriodicWave>> cache;
  static double cacheRate = 0;
  if (sr != cacheRate) { cache.clear(); cacheRate = sr; }
  const auto key = std::make_pair(i, static_cast<int>(std::lround(bright)));
  auto it = cache.find(key);
  if (it != cache.end()) return it->second;
  const organ::Recipe rc = organ::waveRecipe(organ::RANKS[static_cast<std::size_t>(i)], key.second / 100.0);
  std::vector<float> re(static_cast<std::size_t>(rc.n + 1), 0.f), im(static_cast<std::size_t>(rc.n + 1), 0.f);
  for (int k = 1; k <= rc.n; ++k) im[static_cast<std::size_t>(k)] = static_cast<float>(rc.amp(k));
  auto w = std::make_shared<wa::PeriodicWave>();
  w->build(sr, re.data(), im.data(), rc.n + 1);
  cache[key] = w;
  return w;
}
void buildVoicing(Voicing& v, double sr) {
  for (int i = 0; i < kRanks; ++i) {
    const auto k = static_cast<std::size_t>(i);
    v.comp[k] = static_cast<float>(organ::loudnessComp(organ::RANKS[k], std::lround(v.bright[k]) / 100.0));
    v.waves[k] = rankWave(i, v.bright[k], sr);
  }
  v.sr = sr;
}

}  // namespace

/* ======================================================================== */

struct ParlourVoice : Voice {
  explicit ParlourVoice(Parlour& s) : synth(s) {}
  void prepare(const PrepareInfo& info) override;
  void start(const NoteOn& n, const StartInfo& s) override;
  void release() override;
  void render(VoiceContext& ctx, Buffer& out) override;
  bool active() const override;

  Parlour& synth;
  struct Reed {
    wa::Oscillator osc;
    wa::BiquadFilter shelf;
    double det = 0, detTarget = 0, detTau = 0.04;   // settled offset in cents (glides, retunes)
    double wind = 1, windTarget = 1;                 // this reed's response to the wind's pitch
    double shelfDb = 0, shelfTau = 0.05;             // Tone bloom (D17)
    double g = 0, on = 0, kOn = 0;                   // speech envelope (D16): g carries the release
    double fr = 0;                                   // frequency before detune
    int delay = 0;                                   // samples before the reed starts (D14)
    bool rendered = false;
  };
  std::array<Reed, kRanks> reeds;
  double sr = 48000, t = 0, f = 440;
  float amp = 0.11f;
  int key = 60, half = 1;
  bool released = false;
  double gTarget = 0, kG = 0;
  uint32_t gen = 0, tuningGen = 0;
  // Scoop (D28)
  double scoopDepth = 0, scoopDur = 0, unscoopAt = -1, unscoopFrom = 0;
  int scoopCurve = 0;
  // Delayed vibrato (D29)
  bool vib = false, vibDropped = false, vibStarted = false;
  double vibStart = organ::kInf, vibFadeLen = 0.5, vibPhase = 0, vibRate = 5.5, vibRateTau = 0.1, vibLastRate = -1;
  double vibEnv = 0, vibDepth = 0, vibColour = 0, vibRw = 0, vibDw = 0;

  double scoopAt(double tt) const;
  double vibLfoAt(double phase) const { return std::sin(2 * organ::kPi * phase); }
};

struct Parlour : Synth {
  /* ---- parameters ---- */
  Param volume, direct, directAir, swell, reservoir, sens, driftVar, helper, easyWind;
  Param toneModel, toneDepth, toneQ, toneResp, bassCut;
  Param speech, bloom, glide, scatter, seed, pull, celeste, breath, compass, split;
  std::array<std::array<Param, kRanks>, 2> stop;   // [bass, treble][rank]
  Param stopVox, stopSub, stopSup;
  std::array<Param, kRanks> rankLevel, rankTune;
  Param cabMix, roomMix, thumpMix;
  Param voxRate, voxShape, voxBlade, voxShadow, voxShimmer, voxStereo, voxWhole, voxLid;
  Param scoopDepthP, scoopTime, scoopMode, scoopCurveP, scoopCross;
  Param vibDepthP, vibRateP, vibDelay, vibFadeP, vibModeP, vibNatural, vibColourP;
  Param pedalLink;
  std::array<std::array<Param, 4>, 2> pedal;   // [left, right][a, d, s, r]
  Param bendRange;

  Custom<Seq> seq;
  Custom<Voicing> voicing;
  ModSource srcPressure, srcReeds, srcDrain, srcPedalL, srcPedalR, srcFlowL, srcFlowR, srcSeqFree, srcSeqKeys, srcFan;
  MessageId msgTreadleL, msgTreadleR, msgPanic, msgKey, msgStage, msgStatus;

  void defineParams(ParamBuilder& b) override {
    using organ::RANKS;
    volume = b.add("volume").name("Volume").range(0, 150).def(100).unit("%").group("Output");
    direct = b.add("wind.direct").name("Direct Wind").toggle().def(0).group("Wind");
    directAir = b.add("wind.air").name("Direct Wind Air").range(0, 3.6).def(2).step(0.1).unit("in").group("Wind")
                    .cc(2);   // a breath controller (D26)
    swell = b.add("swell").name("Knee Swell").range(0, 100).def(0).step(1).unit("%").group("Wind")
                .cc(11).cc(4);   // an expression or foot pedal
    reservoir = b.add("wind.reservoir").name("Reservoir Size").range(0.4, 3).log().def(0.4 * std::pow(7.5, 0.45)).unit("x").group("Wind");
    sens = b.add("wind.drift").name("Pitch Drift").range(0, 25).def(10).step(1).unit("ct").group("Wind");
    driftVar = b.add("wind.driftVar").name("Drift Variation").range(0, 100).def(40).unit("%").group("Wind");
    helper = b.add("wind.helper").name("Helper Pump").range(0, 100).def(2).step(1).unit("%").group("Wind");
    easyWind = b.add("wind.easy").name("Easy Wind").toggle().def(0).group("Wind");
    toneModel = b.add("tone.model").name("Tone Model").choices({"Natural tilt", "Filter sweep"}).group("Wind tone");
    toneDepth = b.add("tone.depth").name("Tone Depth").range(0, 150).def(60).unit("%").group("Wind tone");
    toneQ = b.add("tone.q").name("Tone Resonance").range(0.5, 8).log().def(0.5 * std::pow(16.0, 0.12)).group("Wind tone");
    toneResp = b.add("tone.response").name("Tone Response").range(0.02, 2).log().def(0.02 * std::pow(100.0, 0.55)).unit("s").group("Wind tone");
    bassCut = b.add("cab.bass").name("Cabinet Bass").range(5, 200).log().def(20 * std::pow(10.0, 0.6)).unit("Hz").group("Case and room");
    speech = b.add("reed.speech").name("Speech Speed").range(0.5, 4).log().def(0.5 * std::pow(8.0, 0.33)).unit("x").group("Reeds");
    bloom = b.add("reed.bloom").name("Tone Bloom").range(0, 30).def(18).step(1).unit("dB").group("Reeds");
    glide = b.add("reed.glide").name("Speech Glide").range(0, 40).def(5).step(1).unit("ct").group("Reeds");
    scatter = b.add("reed.scatter").name("Reed Scatter").range(0, 5).def(1).step(0.1).unit("ct").group("Reeds");
    seed = b.add("reed.seed").name("Reed Set").range(1, 200000).def(1).integer().hidden().group("Reeds");
    pull = b.add("reed.pull").name("Unison Pull").range(0, 10).def(3).step(0.5).unit("ct").group("Reeds");
    celeste = b.add("reed.celeste").name("Celeste Beat").range(0.5, 6).def(1.5).step(0.1).unit("/s").group("Reeds");
    breath = b.add("reed.breath").name("Breath Noise").range(0, 300).def(100).step(5).unit("%").group("Case and room");
    compass = b.add("compass").name("Keyboard Compass").choices({"Full range", "Reed organ"}).group("Reeds");
    split = b.add("stops.split").name("Divided Stops").choices({"Not divided", "E | F", "B | C"}).group("Stops");
    const char* halves[2] = {"bass", "treble"};
    const char* halfNames[2] = {"Bass", "Treble"};
    for (int h = 0; h < 2; ++h)
      for (int i = 0; i < kRanks; ++i) {
        const auto& r = RANKS[static_cast<std::size_t>(i)];
        const bool drawn = i == 1 || i == 2;   // Diapason and Melodia, as the organ comes
        stop[static_cast<std::size_t>(h)][static_cast<std::size_t>(i)] =
            b.add(std::string("stop.") + halves[h] + "." + r.id).name(std::string(halfNames[h]) + " " + r.name).toggle().def(drawn ? 1 : 0).group("Stops");
      }
    stopVox = b.add("stop.vox").name("Vox Humana").toggle().def(0).group("Stops");
    stopSub = b.add("stop.sub").name("Sub Octave").toggle().def(0).group("Stops");
    stopSup = b.add("stop.sup").name("Super Octave").toggle().def(0).group("Stops");
    for (int i = 0; i < kRanks; ++i) {
      const auto& r = RANKS[static_cast<std::size_t>(i)];
      rankLevel[static_cast<std::size_t>(i)] = b.add(std::string("voice.") + r.id + ".level").name(std::string(r.name) + " Level").range(0, 150).def(100).step(5).unit("%").group("Rank voicing");
      rankTune[static_cast<std::size_t>(i)] = b.add(std::string("voice.") + r.id + ".tune").name(std::string(r.name) + " Tuning").range(-20, 20).def(0).step(0.5).unit("ct").group("Rank voicing");
    }
    cabMix = b.add("cab.mix").name("Cabinet").range(0, 100).def(45).step(1).unit("%").group("Case and room");
    roomMix = b.add("room.mix").name("Room").range(0, 100).def(30).step(1).unit("%").group("Case and room");
    thumpMix = b.add("treadle.noise").name("Treadle Noise").range(0, 100).def(30).step(1).unit("%").group("Case and room");
    voxRate = b.add("vox.speed").name("Fan Speed").range(1, 12).def(9).step(0.1).unit("Hz").group("Vox Humana");
    voxShape = b.add("vox.shape").name("Fan Shape").choices({"Smooth", "Spinning fan"}).group("Vox Humana");
    voxBlade = b.add("vox.blade").name("Blade Size").range(600, 4000).log().def(4000 * std::pow(0.15, 0.52)).unit("Hz").group("Vox Humana");
    voxShadow = b.add("vox.shadow").name("Blade Shadow").range(0, 100).def(50).step(1).unit("%").group("Vox Humana");
    voxShimmer = b.add("vox.shimmer").name("Shimmer").range(0, 100).def(10).step(1).unit("%").group("Vox Humana");
    voxStereo = b.add("vox.stereo").name("Stereo Sweep").range(0, 100).def(0).step(1).unit("%").group("Vox Humana");
    voxWhole = b.add("vox.whole").name("Whole-sound Wobble").range(0, 60).def(0).step(1).unit("%").group("Vox Humana");
    voxLid = b.add("vox.lid").name("Lid Wobble").range(0, 100).def(0).step(1).unit("%").group("Vox Humana");
    scoopDepthP = b.add("scoop.depth").name("Scoop").range(0, 200).def(0).step(5).unit("ct").group("Expression")
                      .cc(1);   // the mod wheel (D28)
    scoopTime = b.add("scoop.time").name("Scoop Time").range(0.04, 0.3).def(0.12).step(0.01).unit("s").group("Expression");
    scoopMode = b.add("scoop.mode").name("Scoop On").choices({"Top voice", "Top voice, leaps up", "Every note", "Every note, by velocity", "Accents"}).group("Expression");
    scoopCurveP = b.add("scoop.curve").name("Scoop Curve").choices({"Ease in", "S-curve", "Late snap"}).group("Expression");
    scoopCross = b.add("scoop.cross").name("Crossover").range(1, 127).def(90).integer().group("Expression");
    vibDepthP = b.add("vib.depth").name("Vibrato").range(0, 100).def(0).step(2).unit("ct").group("Expression");
    vibRateP = b.add("vib.rate").name("Vibrato Rate").range(3, 8).def(5.5).step(0.1).unit("Hz").group("Expression");
    vibDelay = b.add("vib.delay").name("Vibrato Delay").range(0, 2.5).def(0.4).step(0.05).unit("s").group("Expression");
    vibFadeP = b.add("vib.fade").name("Vibrato Fade In").range(0, 1.5).def(0.5).step(0.05).unit("s").group("Expression");
    vibModeP = b.add("vib.mode").name("Vibrato On").choices({"Top voice", "Every note"}).group("Expression");
    vibNatural = b.add("vib.natural").name("Natural Variation").range(0, 100).def(50).step(5).unit("%").group("Expression");
    vibColourP = b.add("vib.colour").name("Voice Colour").range(0, 100).def(30).step(5).unit("%").group("Expression");
    pedalLink = b.add("pedal.link").name("Same Envelope For Both Feet").toggle().def(1).hidden().group("Treadles");
    const char* feet[2] = {"left", "right"};
    const char* footNames[2] = {"Left", "Right"};
    const char* stages[4] = {"attack", "decay", "sustain", "release"};
    const char* stageNames[4] = {"Attack", "Decay", "Sustain", "Release"};
    const double defs[4] = {0.06, 0.3, 0, 0.15};
    for (int f = 0; f < 2; ++f)
      for (int k = 0; k < 4; ++k) {
        const std::string id = std::string("pedal.") + feet[f] + "." + stages[k], nm = std::string(footNames[f]) + " Foot " + stageNames[k];
        auto& slot = pedal[static_cast<std::size_t>(f)][static_cast<std::size_t>(k)];
        if (k == 2) slot = b.add(id).name(nm).range(0, 1).def(0).group("Treadles");
        else slot = b.add(id).name(nm).range(organ::TMIN, organ::TMAX).log().def(defs[k]).unit("s").group("Treadles");
      }
  }
  void defineCustom(CustomBuilder& b) override {
    seq = b.add<Seq>("seq", {.save = saveSeq, .load = loadSeq, .initial = defaultSeq()});
    voicing = b.add<Voicing>("voicing", {
        .save = [](const Voicing& v, Json& j) {
          j["bright"] = std::array<double, kRanks>{v.bright[0], v.bright[1], v.bright[2], v.bright[3], v.bright[4]};
        },
        .load = [](const Json& j, Voicing& v) {
          for (int i = 0; i < kRanks; ++i)
            v.bright[static_cast<std::size_t>(i)] = static_cast<float>(std::clamp(j["bright"][i].number(0), -100.0, 100.0));
          buildVoicing(v, gSampleRate.load());
        },
        .initial = {},
    });
  }
  void defineModSources(ModSourceBuilder& b) override {
    srcPressure = b.add("wind.pressure").name("Wind Pressure");
    srcReeds = b.add("wind.reeds").name("Reeds Sounding");
    srcDrain = b.add("wind.use").name("Wind Use");
    srcPedalL = b.add("pedal.left").name("Left Treadle");
    srcPedalR = b.add("pedal.right").name("Right Treadle");
    srcFlowL = b.add("flow.left").name("Left Treadle Flow");
    srcFlowR = b.add("flow.right").name("Right Treadle Flow");
    srcSeqFree = b.add("seq.free").name("Treadle Pattern Position").bipolar();
    srcSeqKeys = b.add("seq.keys").name("Key Pattern Position").bipolar();
    srcFan = b.add("vox.fan").name("Fan Speed");
  }
  void defineMessages(MessageBuilder& b) override {
    msgTreadleL = b.add("treadle.left");   // page → engine: [1] pressed, [0] let up
    msgTreadleR = b.add("treadle.right");
    msgPanic = b.add("notes.off");         // page → engine: All notes off
    msgKey = b.add("key");                 // engine → page: [note, 1|0] a key (or coupled key) went down or up
    msgStage = b.add("pedal.stage");       // engine → page: [foot, stage, relFrom]
    msgStatus = b.add("wind.status");      // engine → page: [code], the line under the gauge
  }
  std::unique_ptr<Voice> makeVoice() override { return std::make_unique<ParlourVoice>(*this); }

  // Patch version 2 (P8): the sequencer's tempo moved from the seq.tempo
  // parameter to the patch's own tempo (features.tempoInPatch).
  void migratePatch(int fromVersion, PatchData& p) override {
    if (fromVersion < 2 && p.hasParam("seq.tempo")) {
      Json& j = p.json();
      if (!j["tempo"].isObject()) {
        Json t = Json::object();
        t["bpm"] = p.param("seq.tempo");
        t["timeSig"] = std::array<int, 2>{4, 4};
        j["tempo"] = t;
      }
      p.removeParam("seq.tempo");
    }
  }

  /* ---- shared with the voices ---- */
  double sr = 48000, now = 0;                 // seconds since the engine started
  double pressure = 0.5, tonePress = 0.5, swellPos = 0, reliefT = 0;
  double windPitch = 0, tiltDb = 0;           // smoothed, read by the voices
  std::array<std::array<double, kRanks>, 2> bus{}, busPrev{};   // each half's stop gains
  std::array<std::shared_ptr<const wa::PeriodicWave>, kRanks> prepWaves{};
  std::vector<float> rateWander, depthWander;  // shared vibrato wander (D29), 3 kHz loops
  uint32_t tuningGen = 1;
  int sounding = 0, reedsSounding = 0;         // counted by the voices each block
  float bendCents = 0;
  struct NoteState {
    uint32_t gen = 0;
    float cents = 0, dur = 0;
    int curve = 0;
    bool vib = false, unscoop = false, drop = false;
  };
  std::array<NoteState, 128> notes{};
  uint32_t nextGen = 1;

  const wa::PeriodicWave* waveFor(int i) const {
    const Voicing& v = voicing.read();
    const auto k = static_cast<std::size_t>(i);
    return v.sr == sr && v.waves[k] ? v.waves[k].get() : prepWaves[k].get();
  }
  bool stopOn(int h, int i, const float* vals) const;
  double wanderAt(const std::vector<float>& w, double tt) const {
    if (w.empty()) return 0;
    const double x = std::fmod(tt * 3000, static_cast<double>(w.size()));
    const auto i = static_cast<std::size_t>(x);
    const double fr = x - std::floor(x);
    return w[i] + (w[(i + 1) % w.size()] - w[i]) * fr;
  }
  int halfOf(int m, int splitChoice) const { return m < organ::SPLIT_NOTE[static_cast<std::size_t>(splitChoice)] ? 0 : 1; }

  // What the voices read each block (written in processGlobal / processEvents).
  struct Live {
    float speech = 1, glide = 5, bloom = 18, vibDepth = 0, vibRate = 5.5f, vibDelay = 0.4f, vibFade = 0.5f, vibNatural = 0.5f, vibColour = 0.3f;
    int split = 0;
    std::array<double, kRanks> tune{};
    double celeste = 1.5, scatter = 1, pull = 3, driftVar = 0.4;
    uint32_t seed = 1;
    std::array<std::array<bool, kRanks>, 2> stops{};
  } live;

  organ::Tuning keyTuning(double f, int m, int h) const {
    std::array<double, kRanks> cents{}, winds{};
    std::array<bool, kRanks> lockable{};
    for (int i = 0; i < kRanks; ++i) {
      const auto k = static_cast<std::size_t>(i);
      const auto& r = organ::RANKS[k];
      cents[k] = (r.celeste ? organ::celesteCents(live.celeste, f * r.mult) : r.det) + live.tune[k] + organ::reedError(live.seed, i, m, live.scatter);
      winds[k] = organ::reedWindResponse(live.seed, i, m, live.driftVar);
      lockable[k] = !r.celeste && live.stops[static_cast<std::size_t>(h)][k];
    }
    return organ::lockReeds(cents, winds, lockable, live.pull);
  }

  /* ---- global graph ---- */
  wa::BiquadFilter swellF, bassCutF, fanLow, noiseBp;
  std::array<wa::BiquadFilter, 2> body1, body2, shelfF;
  wa::Oscillator lfo, lfoPan;
  wa::PeriodicWave sineWave, fanWave, cosWave;
  wa::Delay refl;
  wa::Convolver cabConv, roomConv;
  wa::DynamicsCompressor comp, limiter;
  std::array<wa::WaveShaper, 2> ceiling;
  std::vector<float> noise;
  std::size_t noiseIdx = 0;
  // smoothed graph values
  double windGain = 0, noiseGain = 0, swellFreq = 2300, swellQ = 0.7;
  double fanFreq = 9 * 0.25, fanLowFreq = 1490, lfoShadow = 0, reflGain = 0, lfoRefl = 0, lfoPanAmt = 0, lfoAmp = 0, lfoFilt = 0;
  double cabDry = 1, cabWet = 0, roomWet = 0, masterGain = MASTER, bassCutHz = 80;
  int lastShape = -1;
  struct Thump { double t = -1, level = 0, phase = 0; };
  std::array<Thump, 4> thumps{};

  /* ---- the wind, treadles and sequencer ---- */
  std::array<organ::Foot, 2> feet{};
  int lastSide = -1;
  bool started = false;
  double t0 = -1, free0 = -1, lastStep = 0;   // sequencer pass starts (seconds), and the step length they were set with
  double statusT = 0;
  int status = -1;
  std::array<int, 2> sentStage{-1, -1};
  std::array<double, 2> sentRel{-1, -1};

  /* ---- keys: couplers, sustain, expression ---- */
  struct Press { int count = 0; std::array<int, 3> notes{}; };
  std::array<std::array<Press, 4>, 128> presses{};
  std::array<int, 128> pressCount{};
  std::array<int, 128> refs{};
  std::array<std::array<bool, 128>, 2> midiHeld{}, sustained{};
  bool sustain = false;
  int topKey = -1, topBefore = -1;
  double topAt = -1e9;
  Press topSet{}, vibSet{};
  bool hasTopSet = false, hasVibSet = false;
  bool lastSub = false, lastSup = false;
  int lastCompass = 0;

  void prepare(const PrepareInfo& info) override;
  void processEvents(EventContext& ctx) override;
  void processGlobal(GlobalContext& ctx, Buffer& io) override;

  // key handling (keys.js)
  bool inCompass(int n, int c) const { return n >= organ::COMPASS[static_cast<std::size_t>(c)][0] && n <= organ::COMPASS[static_cast<std::size_t>(c)][1]; }
  Press couplesFor(int m, EventContext& ctx) const {
    Press p;
    const int c = ctx.choice(compass);
    auto add = [&](int n) { if (inCompass(n, c)) p.notes[static_cast<std::size_t>(p.count++)] = n; };
    add(m);
    if (ctx.on(stopSub)) add(m - 12);
    if (ctx.on(stopSup)) add(m + 12);
    return p;
  }
  int playedKeys() const {
    int n = 0;
    for (int c : pressCount) n += c > 0;
    return n;
  }
  void noteOn(EventContext& ctx, int n, int sample, const NoteState* ex, float vel);
  void noteOff(EventContext& ctx, int n, int sample);
  void press(EventContext& ctx, int m, int velocity, int sample);
  void release(EventContext& ctx, int m, int sample);
  void recouple(EventContext& ctx);
  void allNotesOff(EventContext& ctx);
  void gateOn(int side, double level);
  void gateOff(int side);
  void thump(double level);
  bool lanePlaying(const Seq& s, int lane, bool directOn, bool voxOn) const;
};

bool Parlour::stopOn(int h, int i, const float*) const { return live.stops[static_cast<std::size_t>(h)][static_cast<std::size_t>(i)]; }

/* ---------- preparing ---------- */

void Parlour::prepare(const PrepareInfo& info) {
  sr = info.sampleRate;
  gSampleRate.store(sr);
  bendRange = info.param("bendRange");
  {
    // Fallback waves at this sample rate, for the brightness in the patch now
    // (the patch may have loaded before the sample rate was known).
    Voicing v = voicing.read();
    buildVoicing(v, sr);
    prepWaves = v.waves;
  }
  dsp::Rng rng(20240611);
  auto rand = [&] { return rng.uniform(); };
  organ::wanderCurve(rateWander, 23, 3000, 0.45, rand);
  organ::wanderCurve(depthWander, 29, 3000, 0.6, rand);

  // LFO waves: a sine, the two-bladed fan (D8) and a cosine for the pan.
  sineWave.build(sr, wa::PeriodicWave::Basic::Sine);
  std::vector<float> re, im;
  organ::fanWaveCoefficients(re, im);
  fanWave.build(sr, re.data(), im.data(), static_cast<int>(re.size()), true);
  const float cre[2] = {0, 1}, cim[2] = {0, 0};
  cosWave.build(sr, cre, cim, 2, true);
  lfo.prepare(sr);
  lfo.setWave(&sineWave);
  lfo.reset(0);
  lfoPan.prepare(sr);
  lfoPan.setWave(&cosWave);
  lfoPan.reset(0);

  swellF.prepare(sr); swellF.setType(wa::BiquadFilter::Type::Lowpass);
  bassCutF.prepare(sr); bassCutF.setType(wa::BiquadFilter::Type::Highpass);
  fanLow.prepare(sr); fanLow.setType(wa::BiquadFilter::Type::Lowpass);
  noiseBp.prepare(sr); noiseBp.setType(wa::BiquadFilter::Type::Bandpass);
  noiseBp.set(2600, 0.8f);
  for (int c = 0; c < 2; ++c) {
    body1[static_cast<std::size_t>(c)].prepare(sr); body1[static_cast<std::size_t>(c)].setType(wa::BiquadFilter::Type::Peaking); body1[static_cast<std::size_t>(c)].set(230, 1, 3);
    body2[static_cast<std::size_t>(c)].prepare(sr); body2[static_cast<std::size_t>(c)].setType(wa::BiquadFilter::Type::Peaking); body2[static_cast<std::size_t>(c)].set(1100, 1.4f, 2);
    shelfF[static_cast<std::size_t>(c)].prepare(sr); shelfF[static_cast<std::size_t>(c)].setType(wa::BiquadFilter::Type::Highshelf); shelfF[static_cast<std::size_t>(c)].set(6000, 1, -7);
  }
  refl.prepare(sr, 0.01);
  comp.prepare(sr);
  comp.set(-16, 30, 4, 0.01f, 0.2f);
  limiter.prepare(sr);
  limiter.set(static_cast<float>(organ::LIMIT), 0, static_cast<float>(organ::LIMIT_RATIO), 0.002f, 0.15f);
  std::vector<float> curve(2049);
  for (int i = 0; i < 2049; ++i) curve[static_cast<std::size_t>(i)] = static_cast<float>(organ::softClip(i / 2048.0 * 2 - 1));
  for (auto& w : ceiling) { w.setCurve(curve.data(), 2049); w.setOversample(wa::WaveShaper::Oversample::X2); }

  // The room: 1.8 s of decaying stereo noise (impulse(1.8, 3)).
  {
    const int len = static_cast<int>(std::floor(sr * 1.8));
    std::vector<float> l(static_cast<std::size_t>(len)), r(static_cast<std::size_t>(len));
    for (int c = 0; c < 2; ++c) {
      auto& d = c ? r : l;
      for (int i = 0; i < len; ++i) d[static_cast<std::size_t>(i)] = static_cast<float>((rng.uniform() * 2 - 1) * std::pow(1 - static_cast<double>(i) / len, 3));
    }
    const float* ch[2] = {l.data(), r.data()};
    roomConv.setImpulse(ch, 2, len, sr);
  }
  // The cabinet: early reflections between the panels, a short dense tail the
  // wood darkens, and the panels' resonances (cabinetIR).
  {
    const int len = static_cast<int>(std::floor(sr * 0.2));
    const double taps[13][2] = {{.0017, .75}, {.0029, .6}, {.0035, .55}, {.0046, .45}, {.0052, .4}, {.0064, .36}, {.0071, .32},
                                {.0087, .27}, {.0099, .24}, {.0116, .2}, {.0128, .17}, {.0145, .14}, {.0174, .11}};
    std::vector<float> l(static_cast<std::size_t>(len)), r(static_cast<std::size_t>(len));
    for (int c = 0; c < 2; ++c) {
      auto& d = c ? r : l;
      const double spread = c ? 1.06 : 1;
      d[0] = 1;
      for (int k = 0; k < 13; ++k) {
        const int idx = static_cast<int>(std::floor(taps[k][0] * spread * sr));
        if (idx < len) d[static_cast<std::size_t>(idx)] += static_cast<float>(taps[k][1] * (k % 3 == 2 ? -1 : 1));
      }
      for (int i = 0; i < len; ++i) {
        const double tt = i / sr;
        d[static_cast<std::size_t>(i)] += static_cast<float>((rng.uniform() * 2 - 1) * 0.28 * std::exp(-tt / 0.032) +
                                                             std::sin(2 * organ::kPi * 148 * tt) * 0.12 * std::exp(-tt / 0.06) +
                                                             std::sin(2 * organ::kPi * 310 * tt + 1) * 0.06 * std::exp(-tt / 0.04));
      }
      float y = 0;
      for (int i = 0; i < len; ++i) { y += 0.55f * (d[static_cast<std::size_t>(i)] - y); d[static_cast<std::size_t>(i)] = y; }
    }
    const float* ch[2] = {l.data(), r.data()};
    cabConv.setImpulse(ch, 2, len, sr);
  }
  // Breath noise: 2 s of white noise, looped.
  noise.resize(static_cast<std::size_t>(sr * 2));
  for (auto& x : noise) x = static_cast<float>(rng.uniform() * 2 - 1);
}

/* ---------- keys (keys.js): couplers, sustain and expression ---------- */

void Parlour::noteOn(EventContext& ctx, int n, int sample, const NoteState* ex, float vel) {
  if (n < 21 || n > 108) return;
  started = true;
  auto& r = refs[static_cast<std::size_t>(n)];
  if (r > 0) { ++r; return; }
  r = 1;
  NoteState s = ex ? *ex : NoteState{};
  s.gen = nextGen++;
  s.unscoop = s.drop = false;
  notes[static_cast<std::size_t>(n)] = s;
  MidiEvent e = NoteOn{n, vel};
  e.sample = sample;
  ctx.out(e);
  ctx.post(msgKey, {static_cast<float>(n), 1});
}
void Parlour::noteOff(EventContext& ctx, int n, int sample) {
  auto& r = refs[static_cast<std::size_t>(n)];
  if (r <= 0) return;
  if (--r > 0) return;
  MidiEvent e = NoteOff{n};
  e.sample = sample;
  ctx.out(e);
  ctx.post(msgKey, {static_cast<float>(n), 0});
}
void Parlour::press(EventContext& ctx, int m, int velocity, int sample) {
  const double tnow = now + std::max(0, sample) / sr;
  // the key-driven sequencer lanes start on the first note of a phrase (D30)
  const Seq& sq = seq.read();
  if (playedKeys() == 0 || sq.trigger == 1 || t0 < 0) t0 = tnow;
  const Press set = couplesFor(m, ctx);
  // Expression (expressionFor): the top voice, the chord window, scoop depth.
  bool top = true;
  for (int k = 0; k < 128; ++k)
    if (k != m && pressCount[static_cast<std::size_t>(k)] > 0 && k >= m) top = false;
  int prev = topKey;
  if (top && topKey >= 0 && topKey < m && tnow - topAt < organ::CHORD_WINDOW) {
    prev = topBefore;
    if (hasTopSet)
      for (int k = 0; k < topSet.count; ++k) notes[static_cast<std::size_t>(topSet.notes[static_cast<std::size_t>(k)])].unscoop = true;
  }
  const int mode = ctx.choice(scoopMode);
  NoteState ex;
  ex.cents = static_cast<float>(organ::scoopDepth(mode, ctx.get(scoopDepthP), m, top, prev, velocity, static_cast<int>(ctx.get(scoopCross))));
  if (top) { topBefore = prev; topKey = m; topAt = tnow; hasTopSet = false; }
  ex.dur = static_cast<float>(organ::scoopDuration(ctx.get(scoopTime), organ::speechTime(organ::noteFreq(m), pressure, ctx.get(speech))));
  ex.curve = ctx.choice(scoopCurveP);
  const int vibMode = ctx.choice(vibModeP);
  ex.vib = ctx.get(vibDepthP) > 0 && (vibMode == 1 || top);
  if (top && vibMode == 0 && hasVibSet) {
    for (int k = 0; k < vibSet.count; ++k) notes[static_cast<std::size_t>(vibSet.notes[static_cast<std::size_t>(k)])].drop = true;
    hasVibSet = false;
  }
  for (int k = 0; k < set.count; ++k) noteOn(ctx, set.notes[static_cast<std::size_t>(k)], sample, &ex, velocity / 127.f);
  // a re-used note keeps its own Expression; mark the sets by note anyway
  if (top && (mode == organ::kTop || mode == organ::kLeaps)) { topSet = set; hasTopSet = true; }
  if (top && ex.vib) { vibSet = set; hasVibSet = true; }
  auto& pc = pressCount[static_cast<std::size_t>(m)];
  if (pc < 4) presses[static_cast<std::size_t>(m)][static_cast<std::size_t>(pc++)] = set;
}
void Parlour::release(EventContext& ctx, int m, int sample) {
  auto& pc = pressCount[static_cast<std::size_t>(m)];
  if (pc <= 0) return;
  auto& list = presses[static_cast<std::size_t>(m)];
  const Press first = list[0];
  for (int k = 1; k < pc; ++k) list[static_cast<std::size_t>(k - 1)] = list[static_cast<std::size_t>(k)];
  --pc;
  for (int k = 0; k < first.count; ++k) noteOff(ctx, first.notes[static_cast<std::size_t>(k)], sample);
  if (playedKeys() == 0) t0 = -1;   // letting go of everything stops the key-driven lanes
}
void Parlour::recouple(EventContext& ctx) {
  for (int m = 0; m < 128; ++m)
    for (int p = 0; p < pressCount[static_cast<std::size_t>(m)]; ++p) {
      Press& set = presses[static_cast<std::size_t>(m)][static_cast<std::size_t>(p)];
      const Press want = couplesFor(m, ctx);
      auto has = [](const Press& s, int n) {
        for (int k = 0; k < s.count; ++k) if (s.notes[static_cast<std::size_t>(k)] == n) return true;
        return false;
      };
      Press next;
      for (int k = 0; k < set.count; ++k) {
        const int n = set.notes[static_cast<std::size_t>(k)];
        if (has(want, n)) next.notes[static_cast<std::size_t>(next.count++)] = n;
        else noteOff(ctx, n, -1);
      }
      for (int k = 0; k < want.count; ++k) {
        const int n = want.notes[static_cast<std::size_t>(k)];
        if (!has(set, n) && next.count < 3) { next.notes[static_cast<std::size_t>(next.count++)] = n; noteOn(ctx, n, -1, nullptr, 0.8f); }
      }
      set = next;
    }
}
void Parlour::allNotesOff(EventContext& ctx) {
  for (int n = 0; n < 128; ++n)
    if (refs[static_cast<std::size_t>(n)] > 0) { refs[static_cast<std::size_t>(n)] = 1; noteOff(ctx, n, -1); }
  pressCount.fill(0);
  for (auto& h : midiHeld) h.fill(false);
  for (auto& s : sustained) s.fill(false);
  sustain = false;
  topKey = topBefore = -1;
  topAt = -1e9;
  hasTopSet = hasVibSet = false;
  t0 = -1;
}

/* ---------- the treadles (treadles.js) ---------- */

void Parlour::thump(double level) {
  if (level <= 0) return;
  for (auto& th : thumps)
    if (th.t < 0) { th = {0, level, 0}; return; }
}
void Parlour::gateOn(int side, double level) {
  auto& P = feet[static_cast<std::size_t>(side)];
  if (P.gate) return;
  P.gate = true;
  P.boost = side != lastSide ? 1 : 0.45;   // alternating feet fills the feeders better
  lastSide = side;
  P.stage = organ::Stage::Attack;
  thump(level);
}
void Parlour::gateOff(int side) {
  auto& P = feet[static_cast<std::size_t>(side)];
  if (!P.gate) return;
  P.gate = false;
  if (P.lvl > 0) { P.stage = organ::Stage::Release; P.relFrom = P.lvl; }
  else P.stage = organ::Stage::Idle;
}

void Parlour::processEvents(EventContext& ctx) {
  for (auto& msg : ctx.messages()) {
    if (msg.is(msgTreadleL) || msg.is(msgTreadleR)) {
      const int side = msg.is(msgTreadleL) ? 0 : 1;
      if (msg.value() > 0.5f) gateOn(side, ctx.get(thumpMix) / 100);
      else gateOff(side);
    } else if (msg.is(msgPanic)) {
      allNotesOff(ctx);
    }
  }
  // Couplers drawn or retired, or the compass changed, move held keys (recouple).
  const bool sub = ctx.on(stopSub), sup = ctx.on(stopSup);
  const int cmp = ctx.choice(compass);
  if (sub != lastSub || sup != lastSup || cmp != lastCompass) {
    lastSub = sub; lastSup = sup; lastCompass = cmp;
    recouple(ctx);
  }
  for (auto& e : ctx.in()) {
    const int src = e.channel == 0 ? 0 : 1;   // the page's own keys play on channel 2
    if (e.isNoteOn()) {
      auto& held = midiHeld[static_cast<std::size_t>(src)][static_cast<std::size_t>(e.note)];
      if (held) continue;
      held = true;
      auto& sus = sustained[static_cast<std::size_t>(src)][static_cast<std::size_t>(e.note)];
      if (sus) { sus = false; continue; }   // still sounding from the damper
      press(ctx, e.note, std::clamp(static_cast<int>(std::lround(e.vel * 127)), 1, 127), e.sample);
    } else if (e.isNoteOff()) {
      auto& held = midiHeld[static_cast<std::size_t>(src)][static_cast<std::size_t>(e.note)];
      if (!held) continue;
      held = false;
      if (sustain) sustained[static_cast<std::size_t>(src)][static_cast<std::size_t>(e.note)] = true;
      else release(ctx, e.note, e.sample);
    } else if (e.type == MidiEvent::Type::CC) {
      const int v127 = static_cast<int>(std::lround(e.value * 127));
      if (e.cc == 64) {   // sustain holds the played keys, coupled octaves and all
        sustain = v127 >= 64;
        if (!sustain)
          for (int s = 0; s < 2; ++s)
            for (int n = 0; n < 128; ++n)
              if (sustained[static_cast<std::size_t>(s)][static_cast<std::size_t>(n)]) {
                sustained[static_cast<std::size_t>(s)][static_cast<std::size_t>(n)] = false;
                release(ctx, n, e.sample);
              }
        continue;
      }
      if (e.cc == 120 || e.cc == 123) { allNotesOff(ctx); ctx.out(e); continue; }
      // The volume knob (D27) moves Direct wind while it's on, Volume
      // otherwise (100% at the top). The other controllers are declared on
      // their parameters (cc(), P8).
      if (e.cc == 7) {
        if (ctx.on(direct)) ctx.setParam(directAir, std::round(v127 / 127.f * 36) / 10);
        else ctx.setParam(volume, std::round(v127 / 127.f * 100));
      }
      ctx.out(e);
    } else {
      ctx.out(e);
    }
  }
}

bool Parlour::lanePlaying(const Seq& s, int lane, bool directOn, bool voxOn) const {
  const auto& L = s.lanes[static_cast<std::size_t>(lane)];
  if (!L.on) return false;
  const bool freeLane = lane == organ::kLeft || lane == organ::kRight;
  if ((freeLane ? free0 : t0) < 0) return false;
  if (freeLane) return !directOn;
  if (lane == organ::kDirect) return directOn;
  if (lane == organ::kFan) return voxOn;
  return true;
}

/* ---------- each block: the wind loop (wind-loop.js) and the graph ---------- */

void Parlour::processGlobal(GlobalContext& ctx, Buffer& io) {
  const int n = io.frames;
  const double dt = n / sr;
  const Seq& sq = seq.read();
  const Voicing& vc = voicing.read();

  // What the voices read next block.
  live.speech = ctx.get(speech);
  live.glide = ctx.get(glide);
  live.bloom = ctx.get(bloom);
  live.vibDepth = ctx.get(vibDepthP);
  live.vibRate = ctx.get(vibRateP);
  live.vibDelay = ctx.get(vibDelay);
  live.vibFade = ctx.get(vibFadeP);
  live.vibNatural = ctx.get(vibNatural) / 100;
  live.vibColour = ctx.get(vibColourP) / 100;
  live.split = ctx.choice(split);
  {
    Live prev = live;
    for (int i = 0; i < kRanks; ++i) live.tune[static_cast<std::size_t>(i)] = ctx.get(rankTune[static_cast<std::size_t>(i)]);
    live.celeste = ctx.get(celeste);
    live.scatter = ctx.get(scatter);
    live.pull = ctx.get(pull);
    live.driftVar = ctx.get(driftVar) / 100;
    live.seed = static_cast<uint32_t>(std::max(1.f, ctx.get(seed)));
    for (int h = 0; h < 2; ++h)
      for (int i = 0; i < kRanks; ++i) {
        // Not divided: both halves follow the treble stops.
        const int from = live.split == 0 ? 1 : h;
        live.stops[static_cast<std::size_t>(h)][static_cast<std::size_t>(i)] = ctx.on(stop[static_cast<std::size_t>(from)][static_cast<std::size_t>(i)]);
      }
    if (prev.tune != live.tune || prev.celeste != live.celeste || prev.scatter != live.scatter || prev.pull != live.pull ||
        prev.driftVar != live.driftVar || prev.seed != live.seed || prev.stops != live.stops)
      ++tuningGen;
  }
  bendCents = static_cast<float>(ctx.get(bendRange) * 100);

  // Each half's stop gains (applyStops): rank level × voicing × brightness comp.
  busPrev = bus;
  for (int h = 0; h < 2; ++h)
    for (int i = 0; i < kRanks; ++i) {
      const auto k = static_cast<std::size_t>(i);
      const double target = live.stops[static_cast<std::size_t>(h)][k] ? organ::RANKS[k].level * ctx.get(rankLevel[k]) / 100 * vc.comp[k] : 0;
      approach(bus[static_cast<std::size_t>(h)][k], target, dt, 0.04);
      if (bus[static_cast<std::size_t>(h)][k] < 1e-7 && target == 0) bus[static_cast<std::size_t>(h)][k] = 0;
    }

  const bool directOn = ctx.on(direct), voxOn = ctx.on(stopVox);
  const double directAirIn = ctx.get(directAir);
  const double swellSet = ctx.get(swell) / 100;
  const double voxSpeed = ctx.get(voxRate);

  // The modulation sequencer (seqTick). The treadle lanes run from the first
  // touch; the others from the keys. Its tempo is the transport's: the DAW's
  // in a plugin, and in the browser the tempo control, saved in the patch
  // (P3, P8). It counts quarter notes in every time signature.
  const double stepSec = organ::stepSeconds(ctx.transport().bpm);
  if (lastStep > 0 && stepSec != lastStep) {   // a tempo change keeps both clocks' place
    if (t0 >= 0) t0 = now - (now - t0) / lastStep * stepSec;
    if (free0 >= 0) free0 = now - (now - free0) / lastStep * stepSec;
  }
  lastStep = stepSec;
  if ((sq.lanes[organ::kLeft].on || sq.lanes[organ::kRight].on) && !directOn) { if (free0 < 0) free0 = now; }
  else free0 = -1;
  const int steps = organ::seqSteps(sq.meter, sq.bars);
  std::array<double, organ::kLanes> mod{};
  std::array<bool, organ::kLanes> playing{};
  auto posOf = [&](double start) { return std::fmod(std::max(0.0, now - start) / stepSec, static_cast<double>(steps)); };
  for (int l = 0; l < organ::kLanes; ++l) {
    playing[static_cast<std::size_t>(l)] = lanePlaying(sq, l, directOn, voxOn);
    if (!playing[static_cast<std::size_t>(l)]) continue;
    const double start = (l <= organ::kRight) ? free0 : t0;
    const double base = l == organ::kDirect ? directAirIn : l == organ::kFan ? voxSpeed : l == organ::kSwellLane ? swellSet * 100 : 0;
    const auto& L = sq.lanes[static_cast<std::size_t>(l)];
    mod[static_cast<std::size_t>(l)] = organ::fromShare(l, organ::seqValue(L.notes, posOf(start), organ::toShare(l, base), L.amount));
  }
  ctx.setSource(srcSeqFree, free0 >= 0 ? static_cast<float>(posOf(free0) / steps) : -1.f);
  ctx.setSource(srcSeqKeys, t0 >= 0 ? static_cast<float>(posOf(t0) / steps) : -1.f);

  // the swell lid swings toward the knee lever; it follows the sequencer more closely
  const bool seqSwell = playing[organ::kSwellLane];
  swellPos += ((seqSwell ? mod[organ::kSwellLane] / 100 : swellSet) - swellPos) * std::min(1.0, dt / (seqSwell ? 0.04 : 0.12));
  const int sound = sounding, reeds = reedsSounding;
  sounding = reedsSounding = 0;
  const bool easy = ctx.on(easyWind);
  const double drain = organ::windDrain(reeds, swellPos, easy);

  // the sequencer's treadle lanes press the pedals (seqPedal)
  for (int side = 0; side < 2; ++side) {
    auto& P = feet[static_cast<std::size_t>(side)];
    const double lvl = playing[static_cast<std::size_t>(side)] ? mod[static_cast<std::size_t>(side)] / 100 : 0;
    if (lvl > 0.02 && !P.seqDown) {
      P.seqDown = true;
      if (!P.gate) { P.boost = side != lastSide ? 1 : 0.45; lastSide = side; thump(ctx.get(thumpMix) / 100); }
    } else if (lvl < 0.01) P.seqDown = false;
    P.seq = lvl;
    P.a = ctx.get(pedal[static_cast<std::size_t>(side)][0]);
    P.d = ctx.get(pedal[static_cast<std::size_t>(side)][1]);
    P.s = ctx.get(pedal[static_cast<std::size_t>(side)][2]);
    P.r = ctx.get(pedal[static_cast<std::size_t>(side)][3]);
  }
  double inflow = 0;
  for (auto& P : feet) {
    organ::stepEnvelope(P, dt);
    inflow += P.level() * organ::PEAK_FLOW * P.boost * (1 - std::min(1.0, pressure) * 0.5);
  }
  const double help = ctx.get(helper) / 100 * organ::HELPER_MAX;
  inflow += help * std::clamp((0.8 - pressure) / 0.12, 0.0, 1.0);

  if (directOn) {
    // Direct wind (D26): the slider (or the sequencer, D30) sets the pressure.
    const bool seqDirect = playing[organ::kDirect];
    const double target = seqDirect ? mod[organ::kDirect] / 3.6 : directAirIn / (organ::GMAX * 0.9);
    pressure += (target - pressure) * std::min(1.0, dt / (seqDirect ? 0.025 : 0.06));
    reliefT = 0;
  } else {
    pressure += (inflow - drain) * dt / ctx.get(reservoir);
    if (pressure > 1) { pressure = 1; reliefT = 0.7; }
    pressure = std::max(0.0, pressure);
    reliefT = std::max(0.0, reliefT - dt);
  }
  tonePress += (pressure - tonePress) * std::min(1.0, dt / ctx.get(toneResp));

  // applyWind: loudness, the lid or the tilt, pitch drift, breath noise.
  const double p = pressure;
  const double speak = p < 0.04 ? 0 : std::min(1.0, (p - 0.04) / 0.12);
  const double bRef = organ::windBright(organ::P_REF), dBright = (organ::windBright(tonePress) - bRef) * ctx.get(toneDepth) / 100;
  const double windGain0 = windGain, noise0 = noiseGain;
  approach(windGain, speak * organ::windLevel(p) * 1.7 * (SWELL_CLOSED + (SWELL_OPEN - SWELL_CLOSED) * swellPos), dt, 0.03);
  approach(swellQ, ctx.get(toneQ), dt, 0.05);
  if (ctx.choice(toneModel) == 1) {
    approach(swellFreq, 450 + 4200 * std::pow(std::max(0.0, bRef + dBright), 1.4) * (1 + 0.7 * swellPos), dt, 0.04);
    approach(tiltDb, 0, dt, 0.05);
  } else {
    approach(swellFreq, 2300 * (1 + 1.4 * swellPos), dt, 0.04);
    approach(tiltDb, std::max(-24.0, 18 * dBright), dt, 0.04);
  }
  approach(windPitch, organ::windCents(p, ctx.get(sens)), dt, 0.05);
  approach(noiseGain, 0.025 * p * std::min(1.0, sound / 3.0) * ctx.get(breath) / 100, dt, 0.05);

  // applyVox: the fan spins up when drawn and coasts down when retired; the
  // sequencer (D31) drives its speed closely while it plays.
  const int shape = ctx.choice(voxShape);
  if (shape != lastShape) { lfo.setWave(shape == 1 ? &fanWave : &sineWave); lastShape = shape; }
  const double tc = voxOn ? 0.4 : 0.9;
  const bool seqFan = playing[organ::kFan];
  const double lfoFreq = (seqFan ? mod[organ::kFan] : voxSpeed) * (shape == 1 ? 0.5 : 1);
  approach(fanFreq, voxOn ? lfoFreq : lfoFreq * 0.25, dt, seqFan ? 0.03 : voxOn ? 0.5 : 1.2);
  approach(fanLowFreq, ctx.get(voxBlade), dt, 0.05);
  const double shadow0 = lfoShadow, refl0 = reflGain, lrefl0 = lfoRefl, pan0 = lfoPanAmt, amp0 = lfoAmp;
  approach(lfoShadow, voxOn ? ctx.get(voxShadow) / 100 * 0.5 : 0, dt, tc);
  approach(reflGain, voxOn ? ctx.get(voxShimmer) / 100 * 0.7 : 0, dt, tc);
  approach(lfoRefl, voxOn ? 0.00015 : 0, dt, tc);
  approach(lfoPanAmt, voxOn ? ctx.get(voxStereo) / 100 * 0.8 : 0, dt, tc);
  approach(lfoAmp, voxOn ? ctx.get(voxWhole) / 100 : 0, dt, tc);
  approach(lfoFilt, voxOn ? ctx.get(voxLid) * 4 : 0, dt, tc);
  ctx.setSource(srcFan, static_cast<float>(fanFreq * (shape == 1 ? 2 : 1)));

  // applyMix and applyOutput
  const double cabDry0 = cabDry, cabWet0 = cabWet, roomWet0 = roomWet, master0 = masterGain;
  const double c = ctx.get(cabMix) / 100, r = ctx.get(roomMix) / 100;
  approach(cabWet, c * 1.1, dt, 0.05);
  approach(cabDry, 1 - c * 0.45, dt, 0.05);
  approach(roomWet, r * 0.7, dt, 0.05);
  approach(masterGain, MASTER * organ::volumeGain(ctx.get(volume)), dt, 0.03);
  approach(bassCutHz, ctx.get(bassCut) <= 5.01f ? 5.0 : ctx.get(bassCut), dt, 0.03);

  // The graph, sample by sample. The voices left their mono sum in io.left.
  swellF.set(static_cast<float>(swellFreq), static_cast<float>(swellQ));
  bassCutF.set(static_cast<float>(bassCutHz), -3.01f);
  fanLow.set(static_cast<float>(fanLowFreq), 0.5f);
  const bool lidWobble = std::fabs(lfoFilt) > 1e-3;
  const float inv = 1.f / static_cast<float>(n);
  for (int j = 0; j < n; ++j) {
    const float u = (j + 1) * inv;
    auto lerp = [u](double a, double b) { return static_cast<float>(a + (b - a) * u); };
    const float lv = lfo.next(static_cast<float>(fanFreq));
    const float pv = lfoPan.next(static_cast<float>(fanFreq));
    if (lidWobble) swellF.set(static_cast<float>(swellFreq), static_cast<float>(swellQ), 0, lv * static_cast<float>(lfoFilt));
    float y = bassCutF.process(swellF.process(io.left[j])) * lerp(windGain0, windGain);
    const float nz = noiseBp.process(noise[noiseIdx]) * lerp(noise0, noiseGain);
    if (++noiseIdx >= noise.size()) noiseIdx = 0;
    y = (y + nz) * (1 + lv * lerp(amp0, lfoAmp));
    // the fan stage: low band straight through, upper band shadowed, reflected and panned
    const float low = fanLow.process(y), hi = y - low;
    const float d = refl.process(hi, 0.00025f + pv * lerp(lrefl0, lfoRefl));
    const float sh = (hi + d * lerp(refl0, reflGain)) * (1 + lv * lerp(shadow0, lfoShadow));
    float pl = 0, pr = 0;
    wa::StereoPanner::processMono(pv * lerp(pan0, lfoPanAmt), sh, pl, pr);
    float L = low + pl, R = low + pr;
    L = shelfF[0].process(body2[0].process(body1[0].process(L)));
    R = shelfF[1].process(body2[1].process(body1[1].process(R)));
    // cabinet (dry + boxy reflections), then room (dry + long tail)
    float cl = L, cr = R;
    cabConv.process(cl, cr);
    const float cd = lerp(cabDry0, cabDry), cw = lerp(cabWet0, cabWet);
    const float sl = L * cd + cl * cw, srr = R * cd + cr * cw;
    float rl = sl, rr = srr;
    roomConv.process(rl, rr);
    const float rw = lerp(roomWet0, roomWet);
    float ol = sl * 0.85f + rl * rw, orr = srr * 0.85f + rr * rw;
    comp.process(ol, orr);
    // treadle thumps go in at the Volume stage
    float th = 0;
    for (auto& t : thumps) {
      if (t.t < 0) continue;
      const double fq = t.t < 0.08 ? 90 * std::pow(0.5, t.t / 0.08) : 45;
      const double g0 = 0.085 * t.level, g = t.t < 0.1 ? g0 * std::pow(0.0001 / g0, t.t / 0.1) : 0.0001;
      th += static_cast<float>(std::sin(2 * organ::kPi * t.phase) * g);
      t.phase += fq / sr;
      t.t += 1 / sr;
      if (t.t >= 0.12) t.t = -1;
    }
    const float mg = lerp(master0, masterGain);
    ol = (ol + th) * mg;
    orr = (orr + th) * mg;
    limiter.process(ol, orr);
    io.left[j] = ceiling[0].process(ol);
    io.right[j] = ceiling[1].process(orr);
  }
  swellF.flush(); bassCutF.flush(); fanLow.flush(); noiseBp.flush();
  for (int ch = 0; ch < 2; ++ch) { body1[static_cast<std::size_t>(ch)].flush(); body2[static_cast<std::size_t>(ch)].flush(); shelfF[static_cast<std::size_t>(ch)].flush(); }

  // Meters for the page's gauge and readouts.
  ctx.setSource(srcPressure, static_cast<float>(pressure));
  ctx.setSource(srcReeds, static_cast<float>(reeds));
  ctx.setSource(srcDrain, static_cast<float>(drain));
  ctx.setSource(srcPedalL, static_cast<float>(feet[0].level()));
  ctx.setSource(srcPedalR, static_cast<float>(feet[1].level()));
  ctx.setSource(srcFlowL, static_cast<float>(feet[0].level() * organ::PEAK_FLOW * feet[0].boost));
  ctx.setSource(srcFlowR, static_cast<float>(feet[1].level() * organ::PEAK_FLOW * feet[1].boost));
  for (int side = 0; side < 2; ++side) {
    const auto& P = feet[static_cast<std::size_t>(side)];
    const int st = static_cast<int>(P.stage);
    if (st != sentStage[static_cast<std::size_t>(side)] || (st == 4 && P.relFrom != sentRel[static_cast<std::size_t>(side)])) {
      if (ctx.post(msgStage, {static_cast<float>(side), static_cast<float>(st), static_cast<float>(P.relFrom)})) {
        sentStage[static_cast<std::size_t>(side)] = st;
        sentRel[static_cast<std::size_t>(side)] = P.relFrom;
      }
    }
  }
  // The status line under the gauge, ten times a second.
  statusT += dt;
  if (statusT > 0.1) {
    statusT = 0;
    const bool pumping = playing[organ::kLeft] || playing[organ::kRight];
    int code;
    if (!started) code = 0;
    else if (directOn) code = playing[organ::kDirect] ? 1 : 2;
    else if (reliefT > 0) code = 3;
    else if (pressure < 0.05 && sound) code = 4;
    else if (pressure < 0.2) code = 5;
    else if (!pumping && help > 0 && help < drain && sound && inflow < drain) code = 6;
    else code = pumping ? 7 : help > 0 ? 8 : 9;
    if (code != status && ctx.post(msgStatus, {static_cast<float>(code)})) status = code;
  }
  now += dt;
}

/* ---------- a voice: one key, five reeds (audio.js noteOn) ---------- */

void ParlourVoice::prepare(const PrepareInfo& info) {
  sr = info.sampleRate;
  for (auto& r : reeds) {
    r.osc.prepare(sr);
    r.shelf.prepare(sr);
    r.shelf.setType(wa::BiquadFilter::Type::Highshelf);
  }
}

void ParlourVoice::start(const NoteOn& n, const StartInfo&) {
  key = n.note;
  released = false;
  t = 0;
  f = organ::noteFreq(key);
  amp = static_cast<float>(0.11 * std::max(0.55, 1 - (key - 48) * 0.006));
  const auto& L = synth.live;
  half = synth.halfOf(key, L.split);
  const auto& ns = synth.notes[static_cast<std::size_t>(key)];
  gen = ns.gen;
  scoopDepth = ns.cents;
  scoopDur = std::max(1e-3f, ns.dur);
  scoopCurve = ns.curve;
  unscoopAt = -1;
  vib = ns.vib;
  vibDropped = vibStarted = false;
  vibStart = organ::kInf;
  vibPhase = 0;
  vibEnv = 0;
  vibLastRate = -1;
  vibDepth = L.vibDepth;
  vibColour = L.vibColour * organ::VIB_COLOUR_DB;
  vibRw = L.vibRate * organ::VIB_RATE_WANDER * L.vibNatural;
  vibDw = L.vibDepth * organ::VIB_DEPTH_WANDER * L.vibNatural;
  vibRate = organ::vibStartRate(L.vibRate, L.vibNatural);
  gTarget = amp;
  const organ::Tuning tun = synth.keyTuning(f, key, half);
  tuningGen = synth.tuningGen;
  dsp::Rng& rng = this->rng();
  for (int i = 0; i < kRanks; ++i) {
    auto& r = reeds[static_cast<std::size_t>(i)];
    const auto& rk = organ::RANKS[static_cast<std::size_t>(i)];
    r.fr = f * rk.mult;
    // a free reed starts near its natural pitch and settles a little flat (D13)
    r.detTarget = tun.cents[static_cast<std::size_t>(i)];
    r.det = r.detTarget + L.glide;
    r.detTau = 0.04 * L.speech;
    r.wind = r.windTarget = tun.winds[static_cast<std::size_t>(i)];
    const double tau = organ::onsetTau(organ::speechTime(r.fr, synth.pressure, L.speech));
    r.kOn = 1 - std::exp(-1 / (tau * sr));
    r.g = r.on = 0;
    r.shelfDb = -L.bloom;
    r.shelfTau = tau * organ::BLOOM_LAG;
    // start phase (D14): locked reeds nearly together, free ones anywhere
    const double cyc = tun.locked[static_cast<std::size_t>(i)] ? 0.1 + (rng.uniform() - 0.5) * 0.2 : rng.uniform();
    r.delay = static_cast<int>(std::lround(cyc / r.fr * sr));
    r.osc.setWave(synth.waveFor(i));
    r.osc.reset(0);
    r.shelf.reset();
    r.rendered = false;
  }
  kG = reeds[0].kOn;   // unused until release
}

void ParlourVoice::release() {
  if (released) return;
  released = true;
  gTarget = 0;
  kG = 1 - std::exp(-1 / (0.05 * sr));
}

bool ParlourVoice::active() const {
  if (!released) return true;
  for (const auto& r : reeds)
    if (r.g > 1e-5) return true;
  return false;
}

double ParlourVoice::scoopAt(double tt) const {
  if (scoopDepth <= 0) return 0;
  if (unscoopAt >= 0 && tt >= unscoopAt) {
    const double x = (tt - unscoopAt) / 0.015;
    return x >= 1 ? 0 : unscoopFrom * (1 - x);
  }
  return tt >= scoopDur ? 0 : organ::scoopValue(scoopDepth, scoopCurve, tt / scoopDur);
}

void ParlourVoice::render(VoiceContext& ctx, Buffer& out) {
  const int n = out.frames;
  const double dt = n / sr;
  const auto& L = synth.live;
  auto& ns = synth.notes[static_cast<std::size_t>(key)];
  const bool mine = ns.gen == gen;
  if (!released) { ++synth.sounding; for (int i = 0; i < kRanks; ++i) synth.reedsSounding += L.stops[static_cast<std::size_t>(half)][static_cast<std::size_t>(i)]; }

  // A note that turned out to be part of a chord gives up its scoop (unscoop).
  if (mine && ns.unscoop && unscoopAt < 0 && t < scoopDur && !released) { unscoopFrom = scoopAt(t); unscoopAt = t; }
  // When the top voice moves on, the old top note's vibrato fades (dropVibrato).
  if (mine && ns.drop && vib && !vibDropped) vibDropped = true;

  // Retuning: tuning, Celeste, scatter, Unison pull, drift variation, new reeds
  // and drawn stops move sounding reeds (retune).
  if (tuningGen != synth.tuningGen && !released) {
    tuningGen = synth.tuningGen;
    const organ::Tuning tun = synth.keyTuning(f, key, half);
    for (int i = 0; i < kRanks; ++i) {
      auto& r = reeds[static_cast<std::size_t>(i)];
      if (tun.cents[static_cast<std::size_t>(i)] != r.detTarget) { r.detTarget = tun.cents[static_cast<std::size_t>(i)]; r.detTau = 0.08; }
      r.windTarget = tun.winds[static_cast<std::size_t>(i)];
    }
  }

  // Delayed vibrato (scheduleVib).
  double vib0 = 0, vib1 = 0, col = 0;
  if (vib) {
    const double nat = L.vibNatural;
    approach(vibDepth, L.vibDepth, dt, 0.03);
    approach(vibDw, L.vibDepth * organ::VIB_DEPTH_WANDER * nat, dt, 0.03);
    approach(vibRw, L.vibRate * organ::VIB_RATE_WANDER * nat, dt, 0.03);
    approach(vibColour, L.vibColour * organ::VIB_COLOUR_DB, dt, 0.03);
    if (!vibStarted && !vibDropped && !released) {
      const double land = scoopDepth > 0 ? scoopDur : 0, delay = organ::vibDelaySec(L.vibDelay);
      vibRate = organ::vibStartRate(L.vibRate, nat);
      if (delay != organ::kInf && t >= land + delay) {
        vibStarted = true;
        vibStart = t;
        vibFadeLen = std::max(0.02, static_cast<double>(L.vibFade));
        vibRateTau = vibFadeLen / 2;   // speeds up to its rate as it grows
        vibLastRate = L.vibRate;
      }
    }
    if (vibStarted) {
      if (L.vibRate != vibLastRate) { vibRateTau = 0.1; vibLastRate = L.vibRate; }
      approach(vibRate, L.vibRate, dt, vibRateTau);
      if (!vibDropped) vibEnv = organ::vibFade((t - vibStart) / vibFadeLen);
    }
    if (vibDropped) approach(vibEnv, 0, dt, 0.05);
    const double freq = vibRate + synth.wanderAt(synth.rateWander, synth.now) * vibRw;
    const double depth = vibDepth + synth.wanderAt(synth.depthWander, synth.now) * vibDw;
    const double l0 = vibLfoAt(vibPhase);
    vibPhase += freq * dt;
    vibPhase -= std::floor(vibPhase);
    const double l1 = vibLfoAt(vibPhase);
    vib0 = l0 * vibEnv * depth;
    vib1 = l1 * vibEnv * depth;
    col = l0 * vibEnv * vibColour;
  }

  const double bend = ctx.bend() * synth.bendCents;
  const double sc0 = scoopAt(t), sc1 = scoopAt(t + dt);
  const double wp = synth.windPitch, tilt = synth.tiltDb;
  const auto& busA = synth.busPrev[static_cast<std::size_t>(half)];
  const auto& busB = synth.bus[static_cast<std::size_t>(half)];
  const float inv = 1.f / static_cast<float>(n);
  float* o = out.left;

  for (int i = 0; i < kRanks; ++i) {
    auto& r = reeds[static_cast<std::size_t>(i)];
    const double det0 = r.det, wind0 = r.wind;
    approach(r.det, r.detTarget, dt, r.detTau);
    approach(r.wind, r.windTarget, dt, 0.08);
    const double shelf0 = r.shelfDb;
    approach(r.shelfDb, 0, dt, r.shelfTau);
    const double ba = busA[static_cast<std::size_t>(i)], bb = busB[static_cast<std::size_t>(i)];
    if (ba <= 0 && bb <= 0) {
      // A stop that's off: the reed keeps its place (envelope and start time)
      // without being heard, so drawing the stop brings it in at once.
      const double gt = released ? 0 : amp, kg = released ? kG : r.kOn;
      r.g = gt + (r.g - gt) * std::pow(1 - kg, n);
      r.on = 1 + (r.on - 1) * std::pow(1 - r.kOn, n);
      r.delay = std::max(0, r.delay - n);
      r.rendered = false;
      continue;
    }
    if (!r.rendered) { r.shelf.reset(); r.rendered = true; }
    r.osc.setWave(synth.waveFor(i));
    const double c0 = det0 + wind0 * wp + bend + sc0 + vib0;
    const double c1 = r.det + r.wind * wp + bend + sc1 + vib1;
    const float hz0 = static_cast<float>(r.fr * std::exp2(c0 / 1200)), hz1 = static_cast<float>(r.fr * std::exp2(c1 / 1200));
    r.shelf.set(static_cast<float>(r.fr * organ::TILT_RATIO), 1, static_cast<float>(shelf0 + tilt + col));
    const double kg = released ? kG : r.kOn, gt = released ? 0 : amp;
    double g = r.g, on = r.on;
    for (int j = 0; j < n; ++j) {
      const float u = j * inv;
      float x = 0;
      if (r.delay > 0) --r.delay;
      else x = r.osc.next(hz0 + (hz1 - hz0) * u);
      const float y = r.shelf.process(x);
      g += (gt - g) * kg;
      on += (1 - on) * r.kOn;
      o[j] += static_cast<float>(y * g * on * (ba + (bb - ba) * (u + inv)));
    }
    r.g = g;
    r.on = on;
    r.shelf.flush();
  }
  t += dt;
}

SK_SYNTH(Parlour)
