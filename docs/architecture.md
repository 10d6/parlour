# Architecture

How Parlour is put together. For *why* it sounds the way it does, see
[decisions.md](decisions.md) (D1–D34 from reedorgan, P1–P7 for the port).
Parlour is a synth on synthkit: `synthkit/API.md` is the contract it's built on.

## Files

| Path | What it is |
| --- | --- |
| `synth.json` | Identity (`parlour`, plugin code `Prlr`, vendor `Tend`: permanent) and kit features: 64 voices, poly only, no kit envelopes. |
| `src/organ.h` | The organ's maths, from reedorgan's `js/core`: ranks and harmonic recipes, brightness compensation, Celeste, per-reed scatter and wind response, Unison pull (`lockReeds`), wind curves and treadle envelopes, speech times, the fan wave, scoop and vibrato curves, the output stage, the sequencer's shapes and timing. |
| `src/Synth.cpp` | The engine: parameters, custom state (`seq`, `voicing`), mod sources and messages; key handling (couplers, sustain, Expression); the wind loop, treadles and sequencer; the global sound graph; and the voice (one key, five reeds). |
| `ui/page.html` | The cabinet's markup, from reedorgan's `index.html`. `data-mount` places the kit's preset bar and Connect MIDI button. |
| `ui/page.js` | `mount(sk, root)`: places the kit's parts and runs each module's setup. Also *Load reedorgan patch…*. |
| `ui/page/util.js` | The bridge (`page.sk`), element lookup, sliders/selects/checkboxes bound to parameters, page settings (`sk.store`). |
| `ui/page/controls.js` | Every slider and setting, with reedorgan's positions and readouts; the rank-voicing drawer. |
| `ui/page/stops.js` | The stop rail and divided stops. |
| `ui/page/keys.js` | The on-screen keyboard, computer keys, All notes off, MIDI controllers and Learn (browser). |
| `ui/page/treadles.js` | The pedals and their envelope pictures; the treadle messages. |
| `ui/page/seq.js`, `ui/page/seqcore.js` | The sequencer's piano roll and its pattern maths; the tempo (own slider or the DAW's). |
| `ui/page/wind.js` | The gauge, readouts and status line. |
| `ui/page/info.js` | The info buttons (D24). |
| `ui/page/legacy.js` | reedorgan patch files → parameters and custom state. Also used by `tools/presets.mjs`. |
| `ui/style.css` | reedorgan's `css/organ.css`, plus the kit's colour variables and the two-line name board. |
| `presets/` | `init.json` (Factory) and the built-in voices. |
| `tools/presets.mjs`, `tools/reedorgan-patches/` | Builds the built-in voices from the owner's reedorgan patch files. |
| `tests/*.json` | Render scenarios (API.md §10). `tests/page-test.cjs` plays the page in Chromium, in the browser and as a plugin window. |

The page's modules are joined into one scope when packed (API.md §9a), so
top-level names must be unique across `ui/page.js` and `ui/page/*.js`.

## Between the page and the engine

The page changes the sound only through the kit's bridge:

- **Parameters** (`sk.set`): every slider, select, stop knob and checkbox. IDs
  are permanent once released. Values are real units (seconds, Hz, %, cents);
  the page converts from reedorgan's slider positions.
- **Custom state** (`sk.setCustom`): `seq` (the sequencer pattern, in
  reedorgan's format) and `voicing` (`{bright: [5 values]}`; loading it builds
  the rank waves, P7).
- **Messages to the engine**: `treadle.left`, `treadle.right` (`[1]` down,
  `[0]` up), `clock.own` (`[1]`: the sequencer keeps its own tempo; the
  browser page sends it, P3), `notes.off`.
- **Messages from the engine**: `key` `[note, 1|0]` (light the key, coupled
  octaves included), `pedal.stage` `[foot, stage, relFrom]` (0 idle,
  1 attack, 2 decay, 3 sustain, 4 release), `wind.status` `[code]` (the line
  under the gauge; the texts are in `wind.js`).
- **Mod sources** (meters, `sk.onMeter`): `wind.pressure` (0–1), `wind.reeds`,
  `wind.use` (per second), `pedal.left`/`pedal.right` (how far down, 0–1),
  `flow.left`/`flow.right`, `seq.free`/`seq.keys` (the treadle and key-driven
  passes' position, 0–1, or −1 when stopped), `vox.fan` (fan speed).
- The page's own keys play on **MIDI channel 2** (P4).

## Signal flow

The same graph as reedorgan's (its `architecture.md` has the diagram), built
from synthkit's Web Audio blocks:

```
per key:  5 × [ wa::Oscillator (rank wave) → wa::BiquadFilter highshelf at 1.5 × f → g × on ] × stop gain (bass/treble half)
          (mono, summed into the voice buffer's left channel)
global:   swell lowpass → cabinet-bass highpass → × wind gain → + breath noise (bandpass) → × (1 + tremolo)
          → fan stage: lowpass (blade size) | upper band → + reflection (modulated wa::Delay) → × shadow → wa::StereoPanner
          → body EQ (peaking 230 Hz, 1.1 kHz; highshelf 6 kHz) → cabinet convolver (dry/wet) → room convolver (dry/wet)
          → compressor → × Volume (+ treadle thumps) → limiter → 2× oversampled soft-clip shaper → kit output
```

Detune on each reed adds: its settled offset (tuning, Celeste, scatter, Unison
pull; glides in from Speech glide sharp), the wind's pitch × its own response,
the pitch wheel, the key's scoop and its vibrato. Each reed's shelf gain adds
Tone bloom, the wind's tilt and the vibrato's Voice colour.

## Each control block (32 samples)

1. `processEvents`: page messages; recouple if a coupler or the compass
   changed; MIDI (keys → `press`/`release` → coupled `NoteOn`/`NoteOff`,
   sustain, CC overrides in a DAW).
2. The voices render (each counts itself and its drawn reeds for the wind).
3. `processGlobal` (reedorgan's `frame()`): the sequencer's lanes; the swell
   lid; treadle strokes from the sequencer; foot envelopes; inflow and drain;
   the reservoir or Direct wind; `applyWind`, `applyVox`, the mixes and
   Volume as smoothed targets; then the global graph sample by sample; then
   the meters, stage and status messages.
