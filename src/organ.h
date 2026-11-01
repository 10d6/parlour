// The organ's maths, ported from reedorgan's js/core (ranks, reeds, wind,
// speech, fan, expression, output, modseq). Pure: no engine, no page.
// docs/decisions.md says why each piece sounds the way it does; the D numbers
// in comments point there.
#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace organ {

constexpr double kPi = 3.14159265358979323846;
constexpr double kInf = std::numeric_limits<double>::infinity();

/* ---------- ranks (core/ranks.js) ---------- */

enum class WaveKind { Reed, Mellow, Bass, Thin };
struct Rank {
  const char* id;
  const char* name;
  const char* feet;
  double mult;
  WaveKind wave;
  double det;
  double level;
  bool celeste;
};
constexpr int kRanks = 5;
inline constexpr std::array<Rank, kRanks> RANKS = {{
    {"bourdon", "Bourdon", "16'", 0.5, WaveKind::Bass, 0, 0.914, false},
    {"diapason", "Diapason", "8'", 1, WaveKind::Reed, 0, 1, false},
    {"melodia", "Melodia", "8'", 1, WaveKind::Mellow, 0, 0.868, false},
    {"celeste", "Celeste", "8'", 1, WaveKind::Reed, 0, 0.75, true},
    {"principal", "Principal", "4'", 2, WaveKind::Thin, 0, 0.5, false},
}};

// Divided stops: the first key of the treble half (none, E|F, B|C).
inline constexpr std::array<int, 3> SPLIT_NOTE = {0, 53, 60};
// Keyboard compass (D19): full range, or a 61-key reed organ, F to F.
inline constexpr std::array<std::array<int, 2>, 2> COMPASS = {{{21, 108}, {29, 89}}};

inline double noteFreq(double m) { return 440.0 * std::pow(2.0, (m - 69) / 12); }

struct WaveSpec { double even, exp; int n; };
inline WaveSpec waveSpec(WaveKind k) {
  switch (k) {
    case WaveKind::Reed: return {0.55, 0.85, 40};
    case WaveKind::Mellow: return {0.4, 1.25, 24};
    case WaveKind::Bass: return {0.5, 1.1, 40};
    case WaveKind::Thin: return {0.7, 1.15, 40};
  }
  return {0.55, 0.85, 40};
}
// Brightness (−1…1) bends the harmonic rolloff (D4, D15).
struct Recipe {
  WaveSpec sp;
  double bright;
  int n;
  double amp(int k) const {
    return ((k % 2) ? 1.0 : sp.even) / std::pow(static_cast<double>(k), std::max(0.3, sp.exp - bright * 0.8));
  }
};
inline Recipe waveRecipe(const Rank& r, double bright) {
  const WaveSpec sp = waveSpec(r.wave);
  return {sp, bright, bright > 0 ? 40 : sp.n};
}
// RMS of a recipe after the browser scales its wave to a peak of 1.
inline double scaledRms(const Recipe& rc) {
  double peak = 0, pow = 0;
  for (int k = 1; k <= rc.n; ++k) pow += rc.amp(k) * rc.amp(k) / 2;
  for (int j = 0; j < 1024; ++j) {
    double x = 0;
    const double ph = 2 * kPi * j / 1024;
    for (int k = 1; k <= rc.n; ++k) x += rc.amp(k) * std::sin(k * ph);
    peak = std::max(peak, std::fabs(x));
  }
  return std::sqrt(pow) / peak;
}
// Gain that keeps a rank as loud as its factory voicing at any brightness (D4).
inline double loudnessComp(const Rank& r, double bright) {
  return scaledRms(waveRecipe(r, 0)) / scaledRms(waveRecipe(r, bright));
}
// Celeste offset in cents so it beats `beat` times a second on any note (D3).
inline double celesteCents(double beat, double f) { return 1200 * std::log2(1 + beat / f); }

/* ---------- individual reeds (core/reeds.js, D7, D14) ---------- */

inline double reedRand(uint32_t seed, int i, int m, int salt) {
  uint32_t h = (seed * 0x9e3779b1u) ^ (static_cast<uint32_t>(i + 1) * 0x85ebca6bu) ^
               (static_cast<uint32_t>(m + 1) * 0xc2b2ae35u) ^ (static_cast<uint32_t>(salt) * 0x27d4eb2fu);
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h = (h ^ (h >> 16)) * 0x45d9f3bu;
  h ^= h >> 16;
  return static_cast<double>(h) / 4294967296.0;
}
inline double reedTri(uint32_t seed, int i, int m, int salt) {
  return reedRand(seed, i, m, salt) + reedRand(seed, i, m, salt + 100) - 1;
}
inline double reedError(uint32_t seed, int i, int m, double spread) { return reedTri(seed, i, m, 1) * spread; }
inline double reedWindResponse(uint32_t seed, int i, int m, double variation) {
  const double p = m + 12 * std::log2(RANKS[static_cast<std::size_t>(i)].mult);
  const double reg = std::clamp((60 - p) / 24, -1.0, 1.0);
  return std::max(0.0, 1 + variation * (0.6 * reedTri(seed, i, m, 2) + 0.4 * reg));
}

struct Tuning {
  std::array<double, kRanks> cents{}, winds{};
  std::array<bool, kRanks> locked{};
};
// Unison pull (D14): the largest group of lockable reeds within `range` cents
// takes its average offset and wind response.
inline Tuning lockReeds(const std::array<double, kRanks>& cents, const std::array<double, kRanks>& winds,
                        const std::array<bool, kRanks>& lockable, double range) {
  Tuning out;
  out.cents = cents;
  out.winds = winds;
  if (!(range > 0)) return out;
  std::array<int, kRanks> idx{};
  int n = 0;
  for (int i = 0; i < kRanks; ++i)
    if (lockable[static_cast<std::size_t>(i)]) idx[static_cast<std::size_t>(n++)] = i;
  // insertion sort by offset, then rank (std::stable_sort may allocate)
  for (int a = 1; a < n; ++a)
    for (int b = a; b > 0; --b) {
      const int x = idx[static_cast<std::size_t>(b - 1)], y = idx[static_cast<std::size_t>(b)];
      const double cx = cents[static_cast<std::size_t>(x)], cy = cents[static_cast<std::size_t>(y)];
      if (cy < cx || (cy == cx && y < x)) std::swap(idx[static_cast<std::size_t>(b - 1)], idx[static_cast<std::size_t>(b)]);
      else break;
    }
  int bestS = 0, bestLen = 0;
  for (int s = 0, e = 0; s < n; ++s) {
    while (e < n && cents[static_cast<std::size_t>(idx[static_cast<std::size_t>(e)])] -
                            cents[static_cast<std::size_t>(idx[static_cast<std::size_t>(s)])] <= range)
      ++e;
    if (e - s > bestLen) { bestLen = e - s; bestS = s; }
  }
  if (bestLen < 2) return out;
  double c = 0, w = 0;
  for (int k = bestS; k < bestS + bestLen; ++k) {
    c += cents[static_cast<std::size_t>(idx[static_cast<std::size_t>(k)])];
    w += winds[static_cast<std::size_t>(idx[static_cast<std::size_t>(k)])];
  }
  c /= bestLen;
  w /= bestLen;
  for (int k = bestS; k < bestS + bestLen; ++k) {
    const auto i = static_cast<std::size_t>(idx[static_cast<std::size_t>(k)]);
    out.cents[i] = c;
    out.winds[i] = w;
    out.locked[i] = true;
  }
  return out;
}

/* ---------- wind (core/wind.js) ---------- */

constexpr double GMAX = 4;
inline double gaugeInches(double p) { return p * GMAX * 0.9; }
constexpr double P_REF = 0.55;
constexpr double PEAK_FLOW = 1.2;
constexpr double HELPER_MAX = 0.6;
constexpr double KNEE = 2 / (4 * 0.9);
constexpr double HEAD = 0.09;
inline double windLevel(double p) {
  auto base = [](double x) { return std::pow(std::max(0.0, x), 1.2); };
  if (p <= KNEE) return base(p);
  const double slope = 1.2 * std::pow(KNEE, 0.2);
  return base(KNEE) + HEAD * std::tanh((p - KNEE) * slope / HEAD);
}
inline double windCents(double p, double sens) { return (P_REF - p) * sens; }
constexpr int EASY_REEDS = 3;
inline double windDrain(int reeds, double swellPos, bool easy) {
  return 0.018 + 0.021 * (easy ? std::min(reeds, EASY_REEDS) : reeds) * (1 + 0.3 * swellPos);
}
constexpr double TMIN = 0.005, TMAX = 30;   // treadle envelope times
inline double windBright(double p) { return p <= KNEE ? p : KNEE + (p - KNEE) * 0.5; }

// One treadle's ADSR (stepEnvelope).
enum class Stage { Idle, Attack, Decay, Sustain, Release };
struct Foot {
  bool gate = false;
  Stage stage = Stage::Idle;
  double lvl = 0, seq = 0, relFrom = 0, boost = 1;
  bool seqDown = false;
  double a = 0.06, d = 0.3, s = 0, r = 0.15;
  double level() const { return std::max(lvl, seq); }
};
inline void stepEnvelope(Foot& P, double dt) {
  switch (P.stage) {
    case Stage::Attack:
      P.lvl += dt / P.a;
      if (P.lvl >= 1) { P.lvl = 1; P.stage = Stage::Decay; }
      break;
    case Stage::Decay:
      if (P.s >= 1) { P.lvl = 1; P.stage = Stage::Sustain; }
      else {
        P.lvl -= dt * (1 - P.s) / P.d;
        if (P.lvl <= P.s) { P.lvl = P.s; P.stage = Stage::Sustain; }
      }
      break;
    case Stage::Sustain: P.lvl = P.s; break;
    case Stage::Release:
      P.lvl -= dt * P.relFrom / P.r;
      if (P.lvl <= 0) { P.lvl = 0; P.stage = Stage::Idle; }
      break;
    case Stage::Idle: break;
  }
}

/* ---------- speech (core/speech.js, D16, D17) ---------- */

inline double windSpeech(double p) {
  return (0.012 + 0.06 * (1 - std::clamp(p, 0.0, 1.0))) / (0.012 + 0.06 * (1 - P_REF));
}
inline double speechTime(double fr, double p, double speech) {
  return speech * windSpeech(p) * std::min(0.2, std::max(0.025, 0.02 + 14 / fr));
}
constexpr double RISE_PER_TAU = 2.59;
inline double onsetTau(double rise) { return rise / RISE_PER_TAU; }
constexpr double BLOOM_LAG = 1.3;
constexpr double TILT_RATIO = 1.5;

/* ---------- the fan (core/fan.js, D8) ---------- */

inline void fanWaveCoefficients(std::vector<float>& re, std::vector<float>& im, int H = 24) {
  const int N = 512;
  std::vector<double> x(N);
  auto wrap = [](double a) { return std::atan2(std::sin(a), std::cos(a)); };
  for (int j = 0; j < N; ++j) {
    const double ph = 2 * kPi * j / N;
    x[static_cast<std::size_t>(j)] = -(std::exp(-std::pow(wrap(ph) / 0.5, 2)) + 0.8 * std::exp(-std::pow(wrap(ph - kPi) / 0.6, 2)));
  }
  double mean = 0, peak = 0;
  for (double v : x) mean += v;
  mean /= N;
  for (double& v : x) { v -= mean; peak = std::max(peak, std::fabs(v)); }
  re.assign(static_cast<std::size_t>(H + 1), 0.f);
  im.assign(static_cast<std::size_t>(H + 1), 0.f);
  for (int k = 1; k <= H; ++k) {
    double c = 0, sn = 0;
    for (int j = 0; j < N; ++j) {
      const double ph = 2 * kPi * k * j / N;
      c += x[static_cast<std::size_t>(j)] * std::cos(ph);
      sn += x[static_cast<std::size_t>(j)] * std::sin(ph);
    }
    re[static_cast<std::size_t>(k)] = static_cast<float>(2 * c / N / peak);
    im[static_cast<std::size_t>(k)] = static_cast<float>(2 * sn / N / peak);
  }
}

/* ---------- expression (core/expression.js, D28, D29) ---------- */

enum ScoopCurve { kEase = 0, kSmooth = 1, kSnap = 2 };
inline double scoopShape(double x, int curve) {
  const double u = std::clamp(x, 0.0, 1.0);
  if (curve == kSmooth) return 1 - u * u * u * (u * (6 * u - 15) + 10);
  if (curve == kSnap) return 1 - u * u * u;
  return (1 - u) * (1 - u);
}
inline double scoopValue(double depth, int curve, double x) { return -depth * scoopShape(x, curve); }
inline double scoopDuration(double time, double rise) { return std::max(time, rise); }
enum ScoopMode { kTop = 0, kLeaps = 1, kAll = 2, kVelocity = 3, kAccent = 4 };
constexpr int KEY_VELOCITY = 100;
constexpr int LEAP = 3;
constexpr double CHORD_WINDOW = 0.035;
inline double scoopDepth(int mode, double depth, int m, bool top, int lastTop, int velocity, int crossover) {
  if (!(depth > 0)) return 0;
  if (mode == kAll) return depth;
  if (mode == kVelocity) return depth * std::clamp(velocity / 127.0, 0.0, 1.0);
  if (mode == kAccent) return velocity >= crossover ? depth : 0;
  if (!top) return 0;
  if (mode == kLeaps) return lastTop >= 0 && m - lastTop >= LEAP ? depth : 0;
  return depth;
}
constexpr double VIB_DELAY_MAX = 2.5;   // seconds; the top of the slider is Never
inline double vibDelaySec(double v) { return v >= VIB_DELAY_MAX - 1e-6 ? kInf : v; }
inline double delayFromCC(int cc) {   // a learned controller: down is Never, up no delay (seconds)
  return std::round((1 - std::clamp(cc, 0, 127) / 127.0) * 2500 / 50) * 50 / 1000.0;
}
inline double vibFade(double u) { u = std::clamp(u, 0.0, 1.0); return u * u * (3 - 2 * u); }
constexpr double VIB_RATE_START = 0.2, VIB_RATE_WANDER = 0.08, VIB_DEPTH_WANDER = 0.25;
inline double vibStartRate(double rate, double natural) { return rate * (1 - VIB_RATE_START * natural); }
constexpr double VIB_COLOUR_DB = 4;
// A slowly wandering value between −1 and 1, looping (wanderCurve).
template <typename Rand>
inline void wanderCurve(std::vector<float>& out, double seconds, double sampleRate, double step, Rand rand) {
  const int n = static_cast<int>(std::lround(seconds * sampleRate));
  const int k = std::max(1, static_cast<int>(std::lround(seconds / step)));
  std::vector<double> pts(static_cast<std::size_t>(k + 1));
  for (int j = 0; j < k; ++j) pts[static_cast<std::size_t>(j)] = rand() * 2 - 1;
  pts[static_cast<std::size_t>(k)] = pts[0];
  out.assign(static_cast<std::size_t>(n), 0.f);
  for (int i = 0; i < n; ++i) {
    const double x = static_cast<double>(i) / n * k;
    const int j = static_cast<int>(std::floor(x));
    const double f = (1 - std::cos(kPi * (x - j))) / 2;
    out[static_cast<std::size_t>(i)] = static_cast<float>(pts[static_cast<std::size_t>(j)] + (pts[static_cast<std::size_t>(j + 1)] - pts[static_cast<std::size_t>(j)]) * f);
  }
}

/* ---------- output (core/output.js, D19, D20) ---------- */

inline double volumeGain(double v) { return (v / 100) * (v / 100); }
constexpr double LIMIT = -4, LIMIT_RATIO = 20;
inline double limiterMakeupDb() { return 0.6 * -LIMIT * (1 - 1 / LIMIT_RATIO); }
inline double softClip(double x) {
  const double a = std::fabs(x);
  return a < 0.9 ? x : (x < 0 ? -1 : 1) * (0.9 + 0.085 * std::tanh((a - 0.9) / 0.085));
}

/* ---------- the modulation sequencer (core/modseq.js, D30–D32) ---------- */

// Rows: sweeps up (linear, slow, fast, s), then sweeps down.
constexpr int kSeqRows = 8;
inline int rowDir(int row) { return row < 4 ? 1 : -1; }
inline int rowCurve(int row) { return row % 4; }   // 0 linear, 1 slow, 2 fast, 3 s
inline double seqShape(double x, int curve) {
  const double u = std::clamp(x, 0.0, 1.0);
  if (curve == 1) return u * u;
  if (curve == 2) return 1 - (1 - u) * (1 - u);
  if (curve == 3) return u * u * (3 - 2 * u);
  return u;
}
// Time signatures: 2/4, 3/4, 4/4, 5/4, 6/8.
struct Meter { int beats, unit; };
inline constexpr std::array<Meter, 5> METERS = {{{2, 4}, {3, 4}, {4, 4}, {5, 4}, {6, 8}}};
constexpr int MAX_BARS = 4;
inline int stepsPerBeat(int meter) { return 16 / METERS[static_cast<std::size_t>(meter)].unit; }
inline int stepsPerBar(int meter) { return METERS[static_cast<std::size_t>(meter)].beats * stepsPerBeat(meter); }
inline int seqSteps(int meter, int bars) { return bars * stepsPerBar(meter); }
// Lanes: left, right, direct, fan, swell; each one's range in its own units.
enum Lane { kLeft = 0, kRight = 1, kDirect = 2, kFan = 3, kSwellLane = 4 };
constexpr int kLanes = 5;
inline constexpr std::array<std::array<double, 2>, kLanes> LANE_RANGE = {{{0, 100}, {0, 100}, {0, 3.6}, {1, 12}, {0, 100}}};
inline double toShare(int lane, double v) {
  const auto& r = LANE_RANGE[static_cast<std::size_t>(lane)];
  return (v - r[0]) / (r[1] - r[0]);
}
inline double fromShare(int lane, double s) {
  const auto& r = LANE_RANGE[static_cast<std::size_t>(lane)];
  return r[0] + s * (r[1] - r[0]);
}
struct SeqNote { int row = 0, start = 0, len = 1; };
inline double seqValue(const std::vector<SeqNote>& notes, double pos, double base, double amount) {
  auto clamp01 = [](double v) { return std::clamp(v, 0.0, 1.0); };
  double v = clamp01(base);
  for (const auto& x : notes) {
    if (pos < x.start) break;
    const double x1 = std::min(1.0, (pos - x.start) / x.len);
    if (x1 < 1) return clamp01(v + rowDir(x.row) * amount * seqShape(x1, rowCurve(x.row)));
    v = clamp01(v + rowDir(x.row) * amount);
  }
  return v;
}
// Seconds per 16th at a tempo in quarter notes (the transport's, in every
// time signature; reedorgan counted eighths in 6/8, P8).
inline double stepSeconds(double bpm) { return 60 / bpm / 4; }

}  // namespace organ
