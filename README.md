# Parlour
<sub>a reed organ simulator</sub>

A playable, foot-pumped reed organ for the browser and for your DAW (VST3 and
AU). The wind supply is simulated: the treadles fill a reservoir, playing
drains it, and the pressure changes the organ's loudness, brightness, pitch and
how quickly notes speak.

Parlour is the reed organ from [reedorgan](https://github.com/10d6/reedorgan),
ported onto [synthkit](https://github.com/10d6/synthkit): the same sound, the
same cabinet, now also a plugin.

**Play it:** https://10d6.github.io/parlour/ (each pull request gets its own
preview link, posted on the PR).

**In your DAW:** each CI run has a **plugin-windows**, **plugin-macos** and
**plugin-linux** download (Checks → CI → Summary → Artifacts). Unzip it and
follow `INSTALL.md` inside. On Windows, copy the `.vst3` folder to
`C:\Program Files\Common Files\VST3\` and rescan in Live. Tagging a version
(`v0.2.0`) publishes the zips as a release. The plugin window is the same
cabinet as the browser page. In a DAW:

- the sequencer follows the song's tempo (the Tempo slider is only in the browser);
- MIDI comes from the track; map other controllers with the DAW's own MIDI
  mapping (the mod wheel, breath, volume and expression controllers already
  work as below);
- your saved patches are shared by every copy of Parlour on the computer, and
  the sound is saved with your project.

## Playing

| What | How |
| --- | --- |
| Play notes | Click or touch the keys, or use the computer keyboard: `Z`–`M` for the low octave, `Q`–`U` and up for the middle |
| Pump | The **modulation sequencer**'s treadle patterns pump for you from the first touch (on by default), in time with its own tempo in the browser or the song's tempo in a DAW. Or hold the Left and Right treadles, or hold `←` `→` (alternating fills fastest). `Space` pumps the next foot |
| Steady wind | Tick **Easy wind** (in Treadles) so chords and extra stops use no more air than three notes. Or raise the sequencer's tempo or add treadle strokes, or raise **Helper pump** under Adjustments (2% by default). If you play more than the wind supplies, it slowly runs out |
| Swell | Move the **Knee swell** slider, or use a MIDI expression pedal (CC11 or CC4) |
| Volume | The **Volume** slider. Above 100% a limiter keeps loud chords clean |
| Patches | The **Patch** bar across the top saves the whole sound by name: stops, voicing, wind, fan, Expression, the sequencer and Volume. Besides **Factory**, three voices come with the organ: **Lay Still**, **Reed Choir** and **Vocal Lead**. **Save** keeps changes to one of yours; **More** has Save as new…, Rename, Delete, Export to file and Import from file…. A dot by the name means there are unsaved changes. The organ opens with the sound you last played. **Load reedorgan patch…** brings in a patch downloaded from the earlier reed organ page |
| Direct wind | Tick **Direct wind** (top right) and its slider sets the air in the reservoir by itself; the treadles (yours or the sequencer's) and playing no longer change it. Your MIDI keyboard's volume knob (CC7) or a breath controller (CC2) moves it; **Learn** binds any other knob. With Direct wind off, the volume knob sets Volume |
| Stuck note | **All notes off** (top right), or `Esc` |
| Explanations | Tap the small **i** beside any heading to show or hide what its controls do |
| MIDI keyboard | In the browser, click **Connect MIDI** (top right). Works in Chrome, Edge, Opera and Firefox. In a DAW, the track's MIDI plays it. Responds to notes, the pitch wheel, the mod wheel (CC1, sets Scoop), the sustain pedal (CC64), expression (CC11/CC4), volume (CC7), breath (CC2) and all-notes-off |

## What's in it

- **Five ranks of free reeds**: Bourdon 16′, Diapason 8′, Melodia 8′, Celeste 8′
  and Principal 4′. Even the mellow Melodia and the deep Bourdon keep a reed's
  buzz in their 2nd and 3rd harmonics. The Celeste is tuned to beat at the same
  rate on every note.
- **Reeds that speak**: each note's onset swells in S-shaped, the way a reed's
  swing grows. Low reeds take longer to get going than high ones (about 160 ms
  at the bottom, 20 ms at the top), and low wind slows them all. Each note
  starts nearly a pure tone and its buzz fills in as it speaks (*Tone bloom*).
- **Divided stops**: optionally split every rank into bass and treble halves, at
  E | F below middle C (the traditional American split) or at middle C.
- **Octave couplers**: Sub Octave and Super Octave pull down the keys an octave
  below or above, so each coupled note sounds with the stops drawn in its own
  half. Drawing one while holding a chord brings the octave in straight away.
- **Vox Humana** fan. As on a real reed organ, the fan stirs the sound just
  outside the reeds, so it only affects the upper harmonics: *Blade shadow*
  (flicker as blades pass), *Shimmer* (phasing from reflections off the moving
  blades) and *Stereo sweep*, all above a frequency set by *Blade size*. The
  fundamentals, and so the overall loudness, stay steady. Its controls fold
  away under the stops and open when you draw the stop. *Smooth* or *Spinning
  fan* shape; the fan spins up when the stop is drawn and coasts down when it's
  retired. The earlier whole-sound tremolo is still there as *Whole-sound
  wobble* and *Lid wobble*, off by default.
- A continuous **knee swell** that opens the lid gradually for a louder
  (about 6 dB), brighter sound that uses more wind.
- **Cabinet bass**: the case can't radiate the deepest notes, so the bass is
  reedy rather than booming. Turn it down or Off for a deeper bass.
- **Keyboard compass**: Full range (every MIDI note, A0 to C8) or a real reed
  organ's 61 keys, F to F, where couplers fall silent past the ends.
- **Easy wind**: the bellows charge for no more than three notes on one stop,
  so full chords and stop changes don't need harder pumping. The sound is the
  same; off by default.
- **Treadle envelopes**: each foot has its own attack, decay, sustain and release
  for the airflow, from 5 ms up to 30 s.
- **Wind behaviour**: loudness rises up to about 2″ on the gauge and then levels
  off. Low wind sounds darker and creeps sharp; high wind sounds brighter and
  sinks slightly flat, as free reeds do, and the relief valve vents when the
  reservoir is full.
- **Adjustments**: reservoir size, pitch drift with pressure, reed speech
  speed, speech glide (notes start a touch sharp and settle), Celeste beat
  rate, Cabinet and Room reverb, breath noise level and treadle noise level.
- **Individual reeds**: every reed (each rank on each key) has its own small,
  random tuning error (*Reed scatter*) and its own response to the wind (*Drift
  variation*, larger for low reeds). Beats between keys differ and shift as the
  wind moves, so no pattern settles in. *Fit a new set of reeds* draws a fresh
  set.
- **Unison pull**: reeds on the same key that sound in unison or octaves, and
  are tuned within a few cents of each other, pull into step and sound as one
  instead of beating slowly, as reeds sharing one wind chest tend to. The
  Celeste never locks. Each reed also starts at its own point in its swing.
- **Wind tone**: how the wind colours the sound. *Natural tilt* (the default)
  shifts the balance of upper harmonics against the fundamental, as a real reed
  does, measured from each reed's own pitch so it works the same on every note; *Filter sweep* is the original moving lowpass. Depth, resonance (Q) and
  response time are adjustable.
- **Expression** (off by default): playing gestures from singing, horns and
  blues harmonica rather than from the reed organ itself. *Scoop* starts a note
  up to a whole tone below and slides up into it, landing exactly in tune at
  the end of *Scoop time*; every reed on the key, and its coupled octaves,
  bends together. By default only the top voice scoops, so a melody bends over
  a steady chord; or only on leaps up, every note, by MIDI velocity, or only
  accents struck past a *Crossover* velocity. *Ease in*, *S-curve* or *Late
  snap* shapes. **Delayed vibrato** waits for the note to settle and then grows
  in, as a singer's does, so long notes bloom and quick ones stay plain. It
  goes to the top voice and moves with the melody; *Natural variation* lets it
  start slow and wander slightly; *Voice colour* brightens and darkens the tone
  with the pitch. Its delay can be set by hand or by any MIDI knob or pedal
  (*Learn*), so pushing a controller up brings vibrato in on a held note. The
  MIDI pitch wheel bends everything by up to *Bend range*, and the mod wheel
  sets Scoop.
- **Modulation sequencer**: piano rolls that move the treadles, Direct wind,
  the Vox Humana fan's speed and the knee swell in time, one pattern for each,
  all playing together. Rows are sweep shapes, up or down along Linear, Slow
  start, Fast start or S-curve; columns are 16th notes over 1 to 4 bars of
  2/4, 3/4, 4/4, 5/4 or 6/8, at a tempo from 30 to 200 bpm in the browser; in a DAW it follows the song's tempo. Tap to place a
  shape, drag its ends to stretch it, Backspace to remove it. Each note moves
  its control by that pattern's *Amount* from wherever the last one left it,
  stopping at the ends of its range.
  - **The treadle patterns pump the organ** (on by default): a sweep up presses
    the pedal, a sweep down lets it up. They start with the first touch and
    keep going, like a player's feet; the default is one bar of 4/4 at 100
    bpm, right on beat 1, left on beat 2, a half-note rest. They rest while
    Direct wind is on.
  - The other patterns (off by default) start on the first note of a phrase,
    or on each note, and loop while you hold keys. Turning one on turns on
    what it moves: Direct wind, or the Vox Humana stop.
- **Rank voicing**: a drawer under Adjustments with level, fine tuning (±20
  cents) and brightness for each rank, plus a button to restore the factory
  voicing. Brightness reshapes the rank's harmonics and is level-matched, so it
  changes the tone rather than the volume.

Your patches are kept in the browser (or, in a DAW, shared by every copy of Parlour on the computer), and Export to file saves one as a file. The learned MIDI controls and which panels are open are remembered on their own.

## How the repository works

Parlour is a synth on [synthkit](https://github.com/10d6/synthkit) (the
`synthkit/` submodule, pinned). Clone with `--recursive`.

| | |
|---|---|
| `src/Synth.cpp` | the engine: parameters, voices (five reeds each), couplers, Expression, the wind loop, the sequencer, and the sound graph built from synthkit's Web Audio blocks |
| `src/organ.h` | the organ's maths (ranks, reeds, wind, speech, fan, expression, output, sequencer), ported from reedorgan's `js/core` |
| `ui/page.html`, `ui/page.js`, `ui/page/*.js`, `ui/style.css` | the cabinet: the page in the browser and the plugin's window |
| `presets/` | Factory and the built-in voices (`node tools/presets.mjs` rebuilds the voices from `tools/reedorgan-patches/`) |
| `tests/*.json` | render scenarios, checked natively in CI; `tests/page-test.cjs` plays the page in Chromium |
| `docs/` | `architecture.md` (how it's built) and `decisions.md` (why it sounds the way it does) |

```
cmake -S . -B build -G Ninja && cmake --build build
./build/parlour_render --check . --out build/renders      # every check; WAVs into build/renders
```

The browser page and the plugins are built as in synthkit: see `CLAUDE.md`.
Every pull request runs the native checks, the page in Chromium (compared with
the native engine), the page test, a Pages preview, and plugin builds for
Windows, macOS and Linux.
