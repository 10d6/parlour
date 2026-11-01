# Decisions

Why the organ works the way it does. Read this before changing the sound or the
project setup. Each entry says what was chosen, why, and what would count as a
reason to revisit it. Newest last. Add an entry with every PR that makes a
design choice.

## Owner's preferences

These come from the owner's own feedback and apply to every change:

- **Natural over exaggerated.** The goal is how a real parlor reed organ sounds and feels. When an effect "seems off", look for how the real mechanism works before tuning numbers.
- **Slow, regular beating is unpleasant.** Beats below about 1 Hz that repeat on every note feel queasy to the owner. Accidental detuning must stay tiny and uncorrelated (see D7).
- **Equal temperament is fine.** Don't change the temperament without being asked.
- **Defaults keep the current sound.** New controls start at a setting that sounds like before, unless the change is a fix the owner asked for. Then the PR says so, and says how to get the old sound back.
- **The owner only reviews and merges PRs.** PR descriptions are the main communication: what the player hears, measurements, and what to try.

## D1. Static files, no build, Pages from the branch (superseded by P1)

**Chosen:** the instrument ships as static files served by GitHub Pages straight from the root of `main` ("Deploy from a branch"), with `.nojekyll`. There's no build step and nothing to install.
**Why:** the owner set Pages to branch deploy. An Actions-based deploy would need a settings change on their side and one more thing to fail. The first Actions workflow failed and was removed in PR #2.
**Revisit if:** the project needs a bundler or generated assets.

## D2. Loudness levels off above 2″

**Chosen:** `windLevel(p)` rises as `p^1.2` up to `KNEE` (2″ on the gauge), then a tanh soft-knee allows only about +1.4 dB more. Brightness above the knee rises at half rate.
**Why:** the owner found the top of the reservoir too loud. On a real organ, the reservoir spring and relief valve cap the pressure, and harder blowing mostly adds buzz rather than volume.

## D3. Celeste beats at a constant rate

**Chosen:** the Celeste's offset is computed per note so it beats at `beatS` beats per second on every key (`celesteCents`), rather than at a fixed number of cents.
**Why:** a fixed cent offset beats slowly in the bass and fast in the treble. Real celestes are regulated toward an even beat.

## D4. Brightness is level-matched

**Chosen:** `rankWave` changes the harmonic rolloff, and `loudComp` rescales the rank's bus gain so its RMS stays constant.
**Why:** `createPeriodicWave` normalizes every wave to the same peak, so a brighter (spikier) wave came out up to 10 dB quieter. After the fix, ±100 brightness stays within 3 dB. The small remaining dip at +100 is the lid filter trimming added top end. (PR #4)

## D5. Couplers pull down keys

**Chosen:** Sub and Super Octave couplers work through `press`/`release`. A coupled note sounds with the stops of its own half (with divided stops), shows as a pressed key, and uses wind like any reed. Toggling a coupler updates held chords (`recouple`).
**Why:** that's what the mechanical coupler does, and it makes divided stops and couplers interact correctly. (PR #4)

## D6. Wind changes the tone by tilting, not sweeping

**Chosen:** default tone model `tilt`. The lid lowpass stays still (only the knee swell moves it), and a high shelf at 1.2 kHz, whose gain follows a smoothed wind pressure (Response, default 250 ms), tilts the harmonics. The original moving lowpass is kept as `sweep`. Depth 100% with a 20 ms response reproduces it.
**Why:** the owner heard a "wah". The sweep moved a lowpass edge from 3.4 kHz down to 450 Hz, below most notes' second harmonic. A real free reed's spectrum only tilts with pressure. Measured on a draining held A4: the sweep lost 42% of its spectral centroid, mostly below 1.5″, while the tilt at 60% loses about half that, spread evenly. Ripple from steady pumping was only about 1% in every model, so big pressure swings were the cause. (PR #5)
**Since D17:** the tilt is applied by a shelf on each reed at 1.5 × its own pitch rather than one shelf at 1.2 kHz, so it shifts every note's harmonics against its own fundamental.

## D7. Each reed has its own tuning error and wind response

**Chosen:** every reed (rank × key) gets an uncorrelated, triangular-distributed tuning error (`reedScatter`, default ±1 cent) and its own sensitivity to the wind's pitch drift (`reedWindResp`, larger for low reeds; Drift variation default 40%). All values come from a hash of rank, key and a saved seed. There are no fixed per-rank detunes.
**Why:** the owner felt ill from slow, regular beats. The cause was (a) Melodia tuned −2 cents against Diapason on every key, giving steady 1.4–11 s beats with the default stops, and (b) a "random" per-key offset from a linear congruential step, which was really a sawtooth. Neighbouring keys were 74% correlated, and nearly every octave was out by about 1.5 cents. Now offsets are uncorrelated, beat periods vary from key to key (some keys have none), and they keep shifting with the wind. Real reeds are tuned at one pressure and each departs from it differently.
**Guidance:** what matters is the beat *rate*, not cents. Accidental detuning should give either effectively no beat, or be deliberate and in the shimmer range (about 2–8 Hz). Making notes "closer" only makes beats slower. (PR #7)

## D8. The Vox Humana is a fan in the sound path

**Chosen:** the fan stage splits the signal at Blade size (default 1.5 kHz) into a low band, which passes untouched, and a complementary upper band (input minus low band, so the two sum exactly). Only the upper band gets the blade shadow (gain dips), shimmer (a reflection with a moving 0.1–0.4 ms delay) and stereo sweep. The earlier whole-signal tremolo is kept as Whole-sound wobble and Lid wobble, off by default and stored under new keys.
**Why:** the owner found the old tremolo too extreme, pulsing everything. On American reed organs the Vox Humana is a fan "made to revolve rapidly by wind pressure" that "disturbs the air near the reeds" ([1911 Britannica](https://en.wikisource.org/wiki/1911_Encyclop%C3%A6dia_Britannica/Harmonium)), unlike valve tremolos that pulse the wind supply ([US 160,605](https://patents.google.com/patent/US160605)). It's driven by its own wind wheel ([US 121,609](https://patents.google.com/patent/US121609A/en)). A few-centimetre blade only shadows or reflects wavelengths about its size, so roughly 1 kHz and up. That last step is physics reasoning, not from the sources.
**Measured** (held A3): bass pulse went from 3.8 dB to 0.1 dB, overall loudness pulse from 3.8 dB to 0.2 dB, and treble flicker from 5.4 dB to 5.9 dB. Stereo sweep at 100% swings the treble 24 dB while the bass stays centred. (PR #8)

## D9. Measure the sound, don't just listen in your head

**Chosen:** sound changes are checked by measuring the rendered audio in headless Chromium: band levels, spectral centroid, envelope depth, stereo balance. Results go in the PR.
**Why:** the measurements caught real problems that reading the code didn't, such as the 10 dB brightness/volume coupling (D4) and the wah's real cause (D6).

## D10. Black-box tests in a real browser

**Chosen:** Playwright tests (`tests/`) that use the organ only through its controls, readouts and speaker output, run in CI on every PR. Sound properties from this log are asserted with tolerances. For example, the Vox Humana bass pulse must be under 0.6 dB with treble flicker of 3–9 dB, Level 50% must equal −6 dB, and Brightness ±100 must stay within 3.5 dB of volume.
**Why:** the measurement scripts used to live only in a session's scratch space and were lost when it ended. Black-box tests also survive refactors: the same tests check that restructuring the code changes nothing. Each test was confirmed to catch a deliberately planted bug, and the timing-sensitive tests passed 3 out of 3 repeated runs.
**Revisit if:** CI time grows past a few minutes, or a sound test proves flaky. Widen the tolerance or measure longer before deleting it.

## D11. Native ES modules, pure maths in `js/core` (superseded by P1, P2)

**Chosen:** the single 1,300-line `index.html` was split into `css/organ.css` and twelve modules under `js/`, loaded by the browser as native ES modules, still with no build step (D1). Pure maths lives in `js/core/` with explicit inputs (seed, spread, brightness…) and no page or audio access, and has unit tests (`tests/unit`). Modules do no work at load time; `main.js` calls each module's setup in a fixed order.
**Why:** each session had to read and exact-match-edit one huge file, and the maths couldn't be tested without pulling functions out of the HTML. A bundler would have needed either committed build output or Actions-based Pages, against D1. The cost is that the page needs HTTP to run locally (`npm run serve`); the owner agreed to that.
**Verified:** all 34 browser tests passed unchanged before and after the split. A side-by-side measurement of the old and new page gave the same Vox Humana, stereo and brightness figures within measurement noise (≤0.2 dB). The unit tests reject the old sawtooth reed generator (D7). `scripts/check.mjs` checks that every import names a real export and every element lookup exists, and it caught each of three planted mistakes.
**Rule:** because `audio.js` and `controls.js` (and `audio.js` and `keys.js`) import each other, nothing may run at module load except definitions that use only `js/core` and `state.js`.

## D12. Free reeds go flat as the wind rises

**Chosen:** the wind's pitch offset is `windCents(p, sens) = (P_REF − p) × sens`: flat above about 2″, sharp below. Pitch drift keeps its default (10 ¢ across the gauge) and each reed's own response (D7) still scales it.
**Why:** the original sign (sharp with more wind) is how flue pipes behave, not free reeds. A free reed blown harder swings wider and spends longer out of its slot, which lowers its frequency; at low wind it sits nearer its natural frequency. Measurements on accordion reeds under suction found the pitch falls almost linearly with blowing pressure, about −2.5 Hz/kPa on a C4 reed (about −16 ¢/kPa), twice that with a nearly closed pallet ([Forum Acusticum 2026](https://dael.euracoustics.org/confs/fa2026/data/articles/000418.pdf)). The gauge spans about 0.9 kPa, so the existing magnitude was already about right; only the direction was wrong.
**Measured** (Melodia A4, scatter off, Pitch drift 25 ¢, wind draining): 2.9″ −5.8 ¢, 2.3″ −2.7 ¢, 1.8″ +0.8 ¢, 1.3″ +4.4 ¢. Before: the same numbers with the opposite sign.
**Revisit if:** the owner prefers the old feel. Setting Pitch drift to 0 removes the drift entirely.

## D13. Notes start slightly sharp and settle (Speech glide)

**Chosen:** each note now starts `scoop` cents *sharp* and settles to pitch with the same time constant as before (40 ms × Speech speed). The slider is relabelled Speech glide and its default drops from 16 ¢ to 5 ¢. The id (`scoopAmt`) and storage key (`scoop`) are unchanged, so a player who had moved the slider keeps their amount, now glided from above.
**Why:** a reed speaks near its natural frequency while its swing is small, and sinks a little as the swing grows to full size (the same effect as D12). A scoop from below is a voice or brass gesture. The glide is small on a real reed, hence the lower default.
**Measured** (Melodia A4, in 25 ms steps from the first sound): 2.9 → 1.6 → 0.9 → 0.5 → 0.2 ¢ at the default. At 16 ¢ it is the mirror image of the old scoop (+9.8 ¢ start, before −9.9 ¢).

## D14. Unison pull, and reeds start at their own phase

**Chosen:** on each key, the drawn non-Celeste ranks (unisons and octaves) whose settled tunings lie within Unison pull (default 3 ¢) of each other lock: they share their average tuning and wind response, so they stay in step as the wind moves (`lockReeds` in `core/reeds.js`). The Celeste never locks. A group needs two drawn reeds; drawing or retiring a stop re-evaluates sounding notes. Each oscillator also starts at its own phase: locked reeds within ±0.1 cycle of each other, free reeds anywhere in their cycle.
**Why:** the owner finds slow beating unpleasant (D7), but with independent ±1 ¢ errors the opening stops, Diapason and Melodia, beat slowly on every key: periods from 2 s to minutes, median about 11 s, with the fundamental swinging up to 9.6 dB because Melodia is nearly all fundamental. Sources this close in pitch on a shared wind supply tend to pull into step; the effect is well documented for organ pipes (the *Mitnahme* effect), and a reed organ's reeds share a single chest. Locking gives that behaviour without new detunes. Every oscillator used to start at phase 0 at the same instant, so each stop combination had the same waveform on every note and every coupled octave started perfectly aligned; real reeds start wherever their swing happens to be. Locked reeds start nearly together so a lucky or unlucky start can't cancel their fundamentals.
**Measured** (default stops, helper 100%): level swing on a held A4 over 6 s, 8.4 dB before, 0.0 dB now (8.6 dB with Unison pull Off). Across the white keys C3–C6 held 4 s each: before, median 3.0 dB, worst 8.4 dB, 8 of 15 keys over 1 dB; now median 0.1 dB, worst 0.2 dB. Celeste with Diapason alone is unchanged (8.2 dB, before 8.7). With Diapason, Melodia and Celeste it is a steady 1.5 Hz shimmer of 4.4 dB instead of the shimmer plus a slow swell (11.7 dB). Twelve strikes of A4 vary by 1.0 dB (before 1.4 dB).
**Test change:** the Sub octave test now measures below 160 Hz (the coupled A2's fundamental) rather than below 400 Hz. With independent start phases the A2's 2nd harmonic can add to or partly cancel A3's fundamental, so the old 400 Hz measurement varied from about 1 to 4.5 dB; it had only passed reliably because both notes used to start perfectly aligned. Below 160 Hz the coupler adds about 23.6 dB.
**Guidance:** reeds on different keys still drift independently with the wind, so chords stay alive (D7). Unison pull at 0 restores free beating; Reed scatter above the pull range unlocks reeds naturally.
**Revisit if:** the owner wants some unison beating back, or the lock should depend on frequency in Hz rather than cents.

## D15. Melodia and Bourdon keep a reed's harmonics

**Chosen:** the Melodia's recipe is now even harmonics 0.4 of odd, rolloff 1/k^1.25, 24 harmonics (was 0.3, 1/k^1.9, 16). The Bourdon has its own `bass` recipe: 0.5, 1/k^1.1, 40 harmonics. Rank levels moved (Melodia 0.9 → 0.868, Bourdon 0.85 → 0.914) so each rank's loudness is unchanged.
**Why:** both ranks were almost pure sine waves, 97% of their power in the fundamental, which sounds like a flute or an electronic organ. A free reed always produces a harmonic-rich pulse; mellow reed stops get their softness from voicing and the reed cell, which round off the top but keep clear low harmonics. The Bourdon's big bass reeds are, if anything, buzzier.
**Measured** (each rank alone on A3, helper 100%): Melodia h2/h3 −17/−13 dB against the fundamental (before −24/−21); Bourdon −10/−8 dB (before −20/−17). Loudness against the Diapason: Melodia +4.6 dB (before +4.8), Bourdon +2.5 dB (before +2.2); the other ranks unchanged.
**Revisit if:** the owner wants a softer Melodia. Its Brightness slider in Rank voicing (level-matched, D4) can take it back towards the old tone.

## D16. Reeds speak S-shaped, low reeds slower

**Chosen:** each reed's onset is the product of two equal exponential rises, (1 − e^(−t/τ))², which starts with zero slope. Its 10–90% rise time is `speechTime(fr, p, speech)`: a fixed 20 ms plus about 14 cycles of the reed's own frequency, kept between 25 and 200 ms, scaled by the same wind factor as before (slower at low wind) and by Speech speed. An A3 reed at the reference wind takes about 84 ms, close to the old single time constant.
**Why:** the onset used one exponential approach for every note, so it started at full speed and took the same time from the bottom of the keyboard to the top. A free reed's swing grows from almost nothing, slowly and then quickly, until it saturates (free-reed simulations and measurements show exactly this exponential growth to a limit, [Forum Acusticum 2023](https://dael.euracoustics.org/confs/fa2023/data/articles/000853.pdf)). Big low reeds take roughly a fixed number of cycles to build up, so they speak noticeably more slowly.
**Measured** (Diapason alone, helper 100%, 10–90% rise): C2 162 ms, A3 61 ms, A5 25 ms, C7 19 ms; before, about 53 ms on every note. Level 10 ms after the start: C2 6%, A3 13%, A5 45%, C7 61% (before about 33% on A3 and above).

## D17. Brightness follows each reed's swing, and the wind tilts each reed's own harmonics

**Chosen:** every reed has its own high-shelf filter at 1.5 × its frequency, between its fundamental and 2nd harmonic. The shelf's gain starts Tone bloom dB down (new slider, default 18 dB) and opens to 0 a little behind the amplitude (time constant 1.3 × the onset's). The wind's tilt (Natural tilt, D6) now feeds the same shelves through one shared source (`tiltDb`) instead of a single high shelf at 1.2 kHz after the rank buses, which is removed. The tilt in dB is unchanged.
**Why:** a reed swinging gently moves almost sinusoidally; the upper harmonics appear as the swing grows ([Forum Acusticum 2023](https://dael.euracoustics.org/confs/fa2023/data/articles/000853.pdf)). Notes used to start at full colour. And a shelf at a fixed 1.2 kHz didn't tilt each note's harmonics against its fundamental, as D6 intended: for low notes it only reached the 6th harmonic and up, and for treble notes it moved the fundamental itself, so the wind changed their loudness rather than their tone.
**Measured** (Diapason alone, helper 100%): h2–h4 against the fundamental in 25 ms steps from the start of A3: −17.6, −11.7, −8.6, −7.1, −6.6 dB, settling at −6.2 dB (before flat at about −7 dB). Wind tone Depth 0 → 150 at full wind: A3 fundamental +0.6 dB and h2–h4 +3.0 dB (before 0.0 and +0.3 dB: the tilt barely touched A3's low harmonics); C6 fundamental +0.6 dB (before +1.2 dB). On a draining A4 at the default Depth, the spectral centroid falls 12% from 2.9″ to 1.3″ (before 10%). At the reference wind the tilt is 0 dB, so the settled tone there is as before; at full wind, low and middle notes are slightly brighter than before because the tilt now reaches their low harmonics.
**Revisit if:** the owner finds the onset darkening too obvious (lower Tone bloom) or the full-wind brightness too strong (lower Wind tone Depth).

## D18. All notes off, and no more stuck computer keys

**Chosen:** an **All notes off** button beside Connect MIDI keyboard, and the Escape key, silence every voice and forget every way a note was held: computer keys, pointers, MIDI keys, notes held by the sustain pedal, and couplers (`allNotesOff` in `keys.js`, `silenceAll` in `audio.js`). MIDI all-notes-off (CC123/CC120) does the same. Computer keys are now tracked by physical key (`KeyboardEvent.code`) rather than the character typed. Letting go of Command releases every computer key, and so does the page being hidden. Mouse presses other than the main button are ignored, a lost pointer capture releases its note, and the right-click menu is suppressed on the keys.
**Why:** the owner reported stuck keys. Two causes were certain from the code: (1) notes were tracked by `e.key`, so holding `2`, `3`, `5`, `6`, `7`, `9`, `0`, `[`, `=` or `]` and then pressing Shift made the key-up arrive as `@`, `#`, `{`… and the note never stopped; (2) a Mac sends no key-up for keys released while Command is held. A right-click or a lost pointer capture could also strand a note. A panic button covers anything else, such as a MIDI keyboard that drops a note-off.
**Tested:** Shift and Command cases, a sustained MIDI note plus held computer keys cleared by the button and by Escape, and normal playing afterwards. The Shift/Command test fails with the old key tracking.

## D19. Cabinet bass roll-off, and an optional reed-organ compass

**Chosen:** a gentle highpass (2nd-order Butterworth) on the reeds before the wind gain, at **Cabinet bass** (default 80 Hz; 20–200 Hz; bottom of the slider is Off). A **Keyboard compass** setting chooses Full range (A0–C8, the default, as before) or Reed organ (61 keys, F1–F6); with Reed organ, MIDI notes and coupled notes outside the compass are silent, as on a real organ where a coupler past the end of the keyboard has nothing to pull.
**Why:** a parlor cabinet radiates very little below about 80–100 Hz, so a real reed organ's bass is reedy and its pitch comes largely from the harmonics; the Bourdon at the bottom of the keyboard used to produce a strong 32–65 Hz fundamental like a subwoofer. The owner wants to keep playing notes no real organ had, so Full range stays the default and Cabinet bass can be turned Off.
**Measured** (Bourdon alone): on C3 (sounding C2, 65 Hz) the level drops 3.5 dB with the default setting, and the share of sound below 100 Hz goes from −1.2 to −3.4 dB; on A3 (sounding A2, 110 Hz) it changes by 0.2 dB. Filter response: −15.9 dB at 32 Hz, −5.1 dB at 65 Hz, −0.6 dB at 130 Hz.
**Note:** Web Audio's lowpass and highpass Q is in decibels, so a flat (Butterworth) response is Q = −3.01, not 0.707; 0.707 gives a small bump above the corner.

## D20. Volume, a limiter and a soft ceiling

**Chosen:** a **Volume** slider (0–150%, squared, so 50% is −12 dB and 150% is +7 dB; 100% is the level before), applied after the existing compressor. After it, a limiter (threshold −4 dB, ratio 20, 2 ms attack) and a soft clip that is unity below ±0.9 and never reaches full scale. The treadle thump now goes through the volume too. The existing compressor is unchanged.
**Why:** the owner asked for a volume control. Measured on `main`, the compressor never took off more than about 1 dB, so it wasn't squashing the dynamics; the real issue was headroom: a 6-note chord with the swell open already peaked at −1.9 dBFS and full organ at −2.6 dBFS, so any volume increase would clip. Chromium's `DynamicsCompressorNode` adds automatic make-up gain (0.6 × the gain it would remove at full scale; +2.28 dB for these settings), which made everything louder in the first measurements; the master gain trims it back out (`limiterMakeupDb`). The compressor isn't a brickwall, so transients could still overshoot to 1.03 (+0.25 dB); the soft clip rounds those off.
**Measured:** below the limit the level is unchanged. Volume 150% with the swell open: 6-note chord peaks −0.4 dBFS, full organ −0.5 dBFS (without the limiter, +7 dB on the −2.5 dBFS peaks measured at 100% would reach about +4.5 dBFS). At the default volume the limiter takes about 1 dB off the loudest open-swell chords and nothing off ordinary playing.

## D21. A wider knee swell

**Chosen:** the knee swell's level goes from 0.75 (closed) to 1.5 (open), on top of the brighter lid; before it was 1.0 to 1.25.
**Why:** closed to open was only about 2.6 dB on one note and 1.1 dB on a chord (the compressor ate most of it), small for a swell lid that covers the reed cells. Raising only the open end would have pushed big open chords into the limiter, so the closed end comes down a little and the open end goes up a little.
**Measured:** one note closed → open: 5.9 dB (before 2.6 dB); 6-note chord: 5.5 dB (before 1.1 dB). Against `main`, the default (closed) sound is about 2.2 dB quieter and fully open about 1.1 dB louder. Volume can make up the difference.

## D22. Pedal autoplay, on by default; helper pump 2%

*Since D32, the pattern editor here is gone: Pedal autoplay is the modulation sequencer's two treadle patterns, with these defaults.*

**Chosen:** a looping treadle pattern that presses and lifts the pedals through the same `gateOn`/`gateOff` as the player's feet, so each stroke uses that foot's envelope, the alternating-feet bonus, the hinge thump and the pedal animation. The pattern is a grid with one cell per beat of the meter (2/4, 3/4, 4/4, 5/4, 6/8; tempo counts the beat unit, so eighths in 6/8), 1 to 4 measures, 30 to 200 bpm. Each cell is Left, Right, Rest or Tie (holds the stroke before it; a tie at the start holds the loop's last stroke). A foot lifts a quarter of a beat (at most 120 ms) before its stroke ends, so repeated strokes on one foot stay separate. Autoplay starts with the audio, on the player's first touch, because browsers allow no sound before that. The owner's defaults: on, one bar of 4/4 at 100 bpm, right and left quarter notes on beats 1 and 2, a half-note rest; helper pump 2% (was 0%). The pattern and on/off are saved under `reed-autoplay`, the tempo under `reed-autoTempo`.
**Why:** the owner asked for it, with these defaults. Driving the existing gates rather than adding a separate air source keeps everything the treadles already do, and lets the player's own feet join in. With autoplay on, the "Helper can't keep up" message is suppressed, because the gaps between strokes would make it flicker on every beat.
**Measured** (wind gauge with default settings and stops, 24 s held, mean and range over the last 12 s): one note 3.5″ (3.3–3.6″); three-note chord 2.1″ (1.8–2.5″), so the strokes ripple the wind by about 0.7″; six-note chord 0.3″ (0.0–0.7″), running out of wind. With Right, Left, Right, Left at 120 bpm: three-note chord 3.6″, six-note chord 2.9″ (2.7–3.0″). With autoplay off and the helper at 2%, a three-note chord is out of wind within 5 s.
**Tests changed:** the shared quiet setup in `tests/organ.js` turns autoplay off, so the steady-wind measurements stay steady.
**Revisit if:** the owner wants eighth-note subdivisions, more than 4 measures (the grid already wraps by measure on narrow screens), or autoplay to stop while the player pumps by hand.

## D23. Easy wind

**Chosen:** an **Easy wind** checkbox in the Treadles heading (off by default, saved as `reed-easyWind`). When it's on, the reservoir drains as if no more than three reeds were sounding (`EASY_REEDS`, the air of three notes on one stop), whatever the number of notes and stops. The open knee swell still draws its extra 30%, and the leak with nothing playing is unchanged. `windDrain(reeds, swellPos, easy)` in `core/wind.js` replaces the inline drain sum. The sound is untouched: every drawn reed still speaks, and the Reeds readout still counts them all; only the Use readout shows the capped draw.
**Why:** the owner wants big chords and stop changes not to force a big change in pumping, and suggested capping the air at three notes on a single stop. Other ways to get a similar effect were considered: scaling the drain by the square root of the reed count (chords still cost more, just less), or a larger reservoir (only delays the drop). The cap is the most predictable: once you're past three reeds, the pumping you need doesn't change at all.
**Measured** (default autoplay, 100 bpm R L rest, helper 2%, 24 s held; mean and range over the last 12 s): one note 3.5″ either way; three-note chord 2.1″ (1.7–2.5″) → 3.4″ (3.2–3.6″); six-note chord 0.3″, running out → 3.4″; six-note chord on full organ (30 reeds) 0.0″ → 3.4″ (3.2–3.6″).
**Revisit if:** the owner wants the cap adjustable, or a softer curve so chords still ask for a little more.

## D24. Layout: a top bar, voicing under the stops, and info buttons

**Chosen:** the instrument's name moves to the left of a top bar, with the wind gauge and its readouts beside it, and Volume, Connect MIDI (Rescan MIDI once connected) and All notes off on the right. The top bar wraps to two rows below 900 px (name on its own row) and to one column below 560 px. The Knee swell stays just above the keyboard. Rank voicing moves directly under the draw stops, above the Vox Humana fan; it stays collapsed by default and still remembers being opened. Every section with explanatory text gets a small brass "i" button beside its heading that shows or hides that section's `.sub` and `.hint` paragraphs (not those of a section nested inside it, which has its own button). Explanations start hidden, and each section's choice is saved (`reed-info-<key>`). The buttons are built by `setupInfo()` in `js/info.js` from `data-info="<key>"` on each section and `.info-host` on its heading.
**Why:** the owner asked for this layout and for the explanations to be toggleable, so the instrument reads as an instrument first, with the help a tap away.
**Revisit if:** first-time players miss the keyboard hint (computer keys, arrows, Esc), which is now behind the Knee swell's info button; it could start shown on a first visit.

## D25. Status under the gauge, a folding Vox Humana panel, the MIDI prompt, new defaults

**Chosen:**
- The wind status line ("Relief valve venting", "Out of wind. Pump!", "Helper can't keep up; wind falling"…) moves from beside the readouts to directly under the gauge, in a box the gauge's width with room for two lines, so a longer message no longer changes the top bar's columns and moves the gauge.
- The Vox Humana fan's controls fold away in a drawer like Rank voicing, closed by default and remembered (`reed-voxOpen`). Drawing the Vox Humana stop opens it; pushing the stop in leaves it as it is.
- **Connect MIDI** has an orange outline and glow (class `attention`) until a MIDI input is listening, and again if every input disconnects.
- New defaults from the owner: fan speed 9 Hz (was 5.6), Blade shadow 50% (was 35%), Shimmer 10% (was 30%), Treadle noise 30% (was 60%).
**Why:** the owner saw the gauge jump when the status changed, and asked for the rest.
**Measured** (D8 method: held A3, Diapason alone, fan spun up, three 2 s runs): old defaults bass 0.1 dB, overall 0.2 dB, treble flicker 6.0 dB; new defaults bass 0.0 dB, overall 0.1 dB, treble flicker 6.1 dB. The deeper blade shadow and the lower shimmer even out, so the flicker is as deep but faster. Treadle noise at 30% is 6 dB quieter.
**Test changed:** the settings test now opens the Vox Humana panel before choosing the fan shape, as a player would, and checks the panel stays open after a reload.

## D26. Direct wind (trial)

**Chosen:** a **Direct wind** switch with a slider in the top bar, under Volume (off by default; slider 0–3.6″ on the gauge, default 2.0″; both saved, as `reed-directWind` and `reed-directAir`). While it's on, the slider sets the reservoir's pressure outright, with a 60 ms glide so a sudden move doesn't click: the treadles, autoplay and the helper pump add no air, playing uses none, and the relief valve never vents. Autoplay rests (its treadles stay still), the status line reads *Direct wind*, and everything that follows the wind (loudness, tone, pitch drift, speech speed, breath noise) follows the slider. A MIDI breath controller (CC2) moves the slider, whether or not Direct wind is on.
**Why:** the owner wants to try controlling the air directly, and may later want the treadles and their controls shown as disabled while it's on. For now the treadles still move when pressed; they just don't affect the wind.
**Revisit if:** the owner keeps it. Then: disable or fold the treadle, autoplay, helper and reservoir controls while it's on, and consider whether the knee swell or an expression pedal should drive it.

## D27. Direct wind from the MIDI volume knob, and MIDI Learn

**Chosen:** while Direct wind is on, the MIDI control bound to it (CC7, a keyboard's volume knob, by default) sets the wind, ahead of any other use of that control. While Direct wind is off, CC7 sets the organ's Volume (127 = 100%). A **Learn** button under the Direct wind slider binds whichever control moves next (CC0–119; it connects MIDI first if needed), shown as "MIDI CC<n>" and saved as `reed-directCC`. The breath controller (CC2) still moves Direct wind too.
**Why:** the owner's MIDI controller has only a volume knob. Most send CC7, but some send another number or nothing over MIDI, so Learn covers those.
**Note:** a learned control that already does something (CC11 is the knee swell, CC64 the sustain pedal) does Direct wind instead while Direct wind is on.

## D28. Expression: a musical scoop and the pitch wheel (off by default)

**Chosen:** an **Expression** drawer under the Vox Humana fan, closed by default (`reed-exprOpen`), with:
- **Scoop** (0–200 ¢, default Off; `reed-scoopDepth`): a note starts this far *below* its pitch and slides up into it. **Scoop time** (40–300 ms, default 120 ms) is when it lands; it never lands before the key's 8′ reed reaches full voice (`scoopDuration`), so pitch and tone arrive together.
- **Scoop on** (`reed-scoopMode`): *Top voice* (default; the highest key held), *Top voice, leaps up* (only when it jumps up a minor third or more), *Every note*, *Every note, by velocity* (MIDI velocity scales the depth; mouse and computer keys count as velocity 100).
- **Curve** (`reed-scoopCurve`): *Ease in*, (1 − x)², fastest at first then settling; *S-curve*, 1 − smootherstep(x), which holds low a moment and then rises. Both arrive with zero slope.
- **Bend range** (0–12 semitones, default ±2; `reed-bendRange`) for the MIDI pitch wheel, which bends every sounding reed. The mod wheel (CC1) sets Scoop.

**How:** one `ConstantSource` per key feeds every reed's `detune` (as `windPitch` does), driven by `setValueCurveAtTime` with a curve that ends at exactly 0, so the whole stop combination bends as one voice and lands exactly in tune. `press()` works out the scoop once per played key and gives the same one to every coupled octave. The pitch wheel is one shared `ConstantSource` (`pitchBend`) into every reed. Pure maths in `core/expression.js`.

**Why:** the owner asked for musical tuning gestures beyond realism, starting with a pitch scoop that sounds intentional, as in contemporary music. This is the first deliberately non-historical feature, so it's fenced off in its own drawer and Off by default; the realistic Speech glide (D13, sharp and settling) is untouched and still applies on top. A scoop *from below* is what D13 rejected as a voice or brass gesture; it's also exactly what a blues harmonica player does with a free reed, starting a note bent and releasing up into it. What separates an intended scoop from a sour note:
- **It lands exactly.** The D13 glide is an exponential (`setTargetAtTime`), which never quite arrives: scaled to a 100 ¢ scoop over 200 ms it would still be 5 ¢ flat at the end. A curve with a defined end arrives and stays.
- **Everything on the key moves together**, including coupled octaves, so intervals never come apart and nothing beats (the owner's main dislike, D7). Coherent movement isn't detuning.
- **It's selective.** Scooping every note of a chord sounds like a warped tape; the default scoops only the top voice, so a melody bends over a steady accompaniment.
- **Chords:** a chord's notes arrive a few milliseconds apart in any order, so a lower note can be the top voice for an instant. When a higher note follows within 35 ms (`CHORD_WINDOW`), the lower one gives up its scoop (slides the rest of the way in 15 ms, while it has barely begun to speak) and doesn't count as the melody's previous note for *leaps up*.

**Measured** (Melodia A3 alone, Reed scatter, Pitch drift, Speech glide and Tone bloom at 0; pitch by autocorrelation of the speaker output):
- Scoop 100 ¢, 120 ms, at 30 / 50 / 70 / 90 / 110 / 130 ms: Ease in −69.6, −49.2, −30.3, −13.9, −5.1, −0.5 ¢; S-curve −95.3, −87.1, −61.1, −32.0, −9.4, −0.5 ¢. From 150 ms on, both read within ±0.02 ¢ of the unscooped note.
- Scoop 100 ¢, 120 ms, from 300 to 500 ms: C2 0.00 to +0.10 ¢ (the tracker is noisier this low), A3 −0.01 to 0.00 ¢, C6 −0.03 to +0.02 ¢.
- Chord window (Scoop 300 ms, A3 sent with a higher key in the same burst): A3 within 0.1 ¢ of pitch by 100 ms; A3 alone is still −35 ¢ then.
- Pitch wheel at ±2 semitones: fully up +200.00 ¢, fully down −200.00 ¢, centred 0.00 ¢.
- Off by default: the existing 58 browser tests pass unchanged.

**Side finding (not changed):** with Tone bloom on (D17), the tracker reads every note about +20 ¢ sharp for its first 50 ms, Expression on or off: the bloom shelf opening shifts the fundamental's phase, which is heard as a small sharp onset, in the same direction as D13's glide. The Expression tests turn Tone bloom off so they measure only the scoop.

**Tests:** `tests/expression.spec.js` (9 tests), and four unit tests. Each was confirmed to catch a planted bug: an exponential tail instead of the curve, coupled octaves not scooping with their key, and no chord window. The new file passed 4 out of 4 repeated runs.

**Revisit if:** the owner wants more gestures from the same drawer: harmonica-style breath bends (Direct wind or CC2 bending down by up to a semitone or more), MPE per-note bends, delayed vibrato on the top voice, falls at release, or adaptive just intonation for held chords (a temperament change, so only if asked).

## D29. Accents, Late snap, and delayed vibrato

**Chosen:** three additions to the Expression drawer (D28), all off by default, so the organ sounds as before. The drawer is now grouped as Scoop, Vibrato and Wheels.
- **Accents, past Crossover** (a new *Scoop on* choice): a note struck at or past the **Crossover** velocity (1–127, default 90; `reed-scoopCross`) scoops the full depth; a softer one doesn't scoop at all. Mouse and computer keys count as velocity 100 (`KEY_VELOCITY`). The Crossover slider is greyed out unless Accents is chosen.
- **Late snap** (a new *Curve*): 1 − x³. It holds below longest (halfway through it is still 7/8 of the way down, against 1/4 for Ease in and 1/2 for S-curve) and speeds up all the way into the note, arriving at three times its average speed: a deliberate flick, where the other two curves settle in with zero slope. It still lands exactly on pitch.
- **Delayed vibrato**: **Vibrato** width (0–±100 ¢, default Off; `reed-vibDepth`), **Rate** (3–8 Hz, default 5.5), **Delay** (0–2.5 s, default 400 ms; the top of the slider is Never), **Fade in** (0–1.5 s, default 500 ms, an S-curve), **Vibrato on** (*Top voice*, default, or *Every note*), **Natural variation** (default 50%), **Voice colour** (default 30%), and **Delay control**: Learn binds any MIDI control to the delay (`reed-vibCC`, none by default), Clear unbinds it.

**How:** each voice that gets vibrato owns a sine LFO → an envelope gain (0 through the delay, then the fade-in curve to 1) → a width gain in cents into all five reeds' `detune`, and → a colour gain in dB into each reed's tone shelf. The delay counts from when the note *lands*: the end of its scoop, or note-on without one. Coupled octaves of a key start identical LFOs at the same instant with the same automation, so they stay in phase. Two slowly wandering buffers (`wanderCurve`: random points 0.45 s and 0.6 s apart joined by cosine curves, looped) are shared by every voice and feed each voice's LFO rate and width.

**Why these qualities:** the owner asked for delayed vibrato with the delay set by hand or by a controller, and for other natural, voice-like qualities that are easy to emulate. Each one is cheap and audible:
- **Delay, then a gradual fade-in.** This is what a singer does: short notes in a quick passage get no vibrato, long notes bloom into it. Counting from the landing means a scooped note arrives, settles, and only then starts to sing.
- **It starts slow and speeds up.** At Natural variation 100% the rate starts 20% slow and reaches the set rate during the fade-in.
- **Rate and width wander.** A voice's vibrato isn't a fixed sine wave; its cycles vary slightly in length and width. At 100% the rate wanders by up to ±8% and the width by up to ±25%. A perfectly regular vibrato is what makes electronic vibrato sound electronic.
- **The colour moves with the pitch.** In a voice, as the pitch rises and falls the harmonics slide across the fixed resonances of the throat and mouth, so the tone brightens and darkens with each cycle. Here Voice colour moves each reed's upper harmonics by up to ±4 dB, in step with the pitch, through the tone shelf each reed already has (D17).
- **It follows the melody.** With *Top voice*, each new top note takes the vibrato over, and the old top note's vibrato fades away in about 150 ms, so one voice sings over the accompaniment instead of a choir of wobbling inner notes.
- **Controller direction.** A learned controller all the way down is Never and all the way up is no delay, so pushing it up brings the vibrato in sooner. A note already held that hasn't started its vibrato is rescheduled from its own landing time, so pushing the controller up while holding a note brings vibrato in on that note. Setting the Delay slider to Never and using the controller makes it a hand-played "vibrato now" control. As with Direct wind's Learn (D27), the move that binds a control doesn't also set the value. A learned control takes precedence over its usual job: learn the mod wheel and it moves the delay instead of setting Scoop.

**Fix (from D28):** a scoop's length was worked out per voice from that voice's own speech time, so on low keys a coupled octave could land at a different moment from the played key and the two pitches came apart briefly. It's now worked out once, for the played key, and shared. Measured on C2 with the Super Octave coupler (Scoop 200 ¢, 40 ms), the worst moment's pitch clarity goes from 0.966 to 0.989.

**Measured** (Melodia A3 alone unless noted; Reed scatter, Pitch drift, Speech glide and Tone bloom at 0; pitch by autocorrelation of the speaker output):
- Vibrato ±40 ¢ with the default delay and fade-in: within 1 ¢ of the note for the first 0.4 s, then growing; ±39 ¢ from about 1.05 s on, at 5.49 Hz (set 5.5).
- Natural variation 0 → 100%: the spread of cycle lengths goes from 2.3 ms (the tracker's own noise) to 8.4 ms; the width over successive 0.4 s stretches is a steady 39 ¢ at 0%, and wanders between 32 and 43 ¢ at 100%.
- Voice colour 0 → 100% (Diapason A3, ±40 ¢): treble (above 2 kHz) flicker 1.7 → 9.5 dB, overall level 0.1 → 3.1 dB, bass 0.05 → 1.4 dB.
- Coupled octaves (Super Octave, ±80 ¢, Natural variation 100%): the sound stays one clear pitch, with median clarity above 0.98.
- Off by default: all 67 browser tests from before pass unchanged.

**Tests:** 11 new browser tests in `tests/expression.spec.js` and 5 unit tests. Each of these planted bugs was caught: coupled octaves' vibratos out of phase, no handover to a new top voice, a controller unable to reschedule a held note, the delay counted from note-on instead of from the landing, and Late snap falling back to Ease in.

**Revisit if:** the owner wants channel aftertouch to deepen the vibrato (natural on keyboards that have it), a choice of vibrato below the note rather than around it (string-style), vibrato rate that rises slightly towards the end of a long note, or harmonica-style breath bends.

## D30. The modulation sequencer, stage 1: Direct wind

**Chosen:** a **Modulation sequencer** drawer under Expression, off by default (`reed-modseq`, drawer state `reed-seqOpen`). It's a piano roll: the columns are 16th notes over **1 or 2 bars**, and the rows are sweep shapes in two groups, **Sweep up** and **Sweep down**, each with **Linear**, **Slow start** (x²), **Fast start** (1 − (1 − x)²) and **S-curve** (smoothstep).
- **Editing:** tapping a square puts a one-16th note of that shape there. One shape plays at a time, so a new note replaces any note covering that step, on any row. Dragging either end of a note stretches or shortens it backwards or forwards, without running into its neighbours or past the pattern's ends.
  - With a note selected: Backspace or Delete removes it, Shift+→ / Shift+← stretch it, and Alt+← / Alt+→ shorten it from the end or the start. These keys are kept from the organ, so they don't pump the treadles; other keys still play notes.
  - **Clear pattern** empties it. Going from 2 bars to 1 keeps what fits.
- **Amount** (0–100%, default 25%; `reed-seqAmount`): how far every note moves its target, as a share of the target's whole range. For Direct wind, 25% is 0.9″ of the 3.6″ scale; the readout shows both.
- **Movement:** each note starts from wherever the last one left the wind, so the movement is continuous; between notes the wind holds still. A sweep that reaches 0″ or 3.6″ stops there, so sweeping up past the top does nothing, and the next sweep down starts from the top.
- **Timing:** 16th notes of Pedal autoplay's tempo (quarter = the tempo, whatever autoplay's meter). A tempo change keeps the pattern's place.
- **Starts on: First note** (default): the pattern starts when a key goes down with no other keys held, and loops while keys are held (the sustain pedal counts as holding). **Each note** restarts it on every key.
- **Each pass starts from the Direct wind slider's setting.** The sequencer moves the sound, not the slider. When you let go of every key, it stops and the wind eases back to the setting. The playhead shows where the pattern is, and the status line reads *Sequencer moving the wind*.
- **Turning it on turns Direct wind on.** It only moves the wind while Direct wind is on; with Direct wind off, the treadles have the wind as usual. The **Moves** menu has only Direct wind for now.
- The default pattern is an S-curve up over the first half bar and back down over the second, so it loops smoothly. It does nothing until the sequencer is turned on.

**How:** pure maths in `core/modseq.js` (`seqValue`, `placeNote`, `resizeNote`, `normaliseSeq`), the editor and transport in `js/modseq.js`. The control loop asks `seqAir()` each frame for the pressure it wants. While the sequencer plays, Direct wind's glide is 25 ms instead of 60 ms, so the curves keep their shape. `press()` and `release()` tell the sequencer when a phrase starts and ends.

**Why:** the owner asked for a modulation mini sequencer with these features, staged so the editor can be reviewed before more targets are added. Their choices on the open questions: the pattern loops while keys are held; every pass starts from the control's own setting (so a loop repeats the same shape rather than climbing to a limit); and later there will be one target at a time, chosen from a menu. The curve names describe what you hear (Slow start, Fast start) rather than animation terms, because the Scoop curves (D28) already use "Ease in" to mean easing into the note.

**Note:** because every pass starts from the setting, a pattern that ends somewhere else jumps back at the loop point, softened only by the 25 ms glide. The default pattern ends where it starts.

**Measured** (wind gauge read every frame; Direct wind at 1.0″, 120 bpm, so one bar is 2 s):
- Default pattern, Amount 25%: 1.00″ at the start, 1.44″ at 0.5 s, 1.90″ at 1.0 s, 1.46″ at 1.5 s, 1.00″ at 2.0 s, and the same on every later bar. After the key is let go, the gauge is back within 0.03″ of 1.0″ in 0.5 s.
- From 3.0″, a Linear sweep up of 0.9″ over four 16ths stops at 3.6″ and holds there through the gap; the following sweep down ends at 2.7″, 0.9″ below the top.
- A whole-bar Linear sweep up with a second key pressed 1.1 s in: with First note it carries on (about 2.35″ at 1.5 s); with Each note it starts again (about 1.36″ at 1.5 s).
- Off by default: all browser tests from before pass unchanged.

**Tests:** `tests/modseq.spec.js` (8 tests) and 7 unit tests. Each of these planted bugs was caught: no limit between notes, notes not building on each other, Each note ignored, not stopping on release, editing keys pumping the treadles, and turning it on without turning Direct wind on.

**Next (stage 2):** Vox Humana fan speed and Knee swell in the Moves menu. Choosing the fan will draw the Vox Humana stop if it's in, as choosing Direct wind turns Direct wind on.

## D31. The modulation sequencer, stage 2: the fan and the swell

**Chosen:** the sequencer's **Moves** menu now has **Direct wind**, **Vox Humana fan speed** and **Knee swell**: one target at a time, as the owner chose. Each works in shares of its own range, and Amount is a share of that range too:
- Direct wind: 0–3.6″ on the gauge.
- Fan speed: 1–12 blade passes a second, the fan's Speed slider range.
- Knee swell: closed to fully open.

The Amount readout shows the chosen target's units: "25% · 0.9″", "25% · 2.8 Hz", "25% of the swell".

- **Turning things on:** turning the sequencer on, or choosing a target while it's on, turns on what it moves. Direct wind switches on; choosing the fan draws the Vox Humana stop (which opens its drawer, D25). Choosing a target while the sequencer is off changes nothing else. The swell has nothing to turn on.
- **When it moves:** the fan only follows the sequencer while the Vox Humana is drawn, just as Direct wind only moves while it's on. Retiring the stop stops the pattern for the fan, and playing doesn't redraw it.
- **The sliders stay put.** As with Direct wind (D30), each pass starts from the target's own setting and the sequencer moves the sound, not the slider.
  - **Fan:** follows the pattern with a 30 ms glide on its speed, so it changes speed smoothly without a jump in its phase. When the pattern stops, it eases back to its Speed slider the way it does when that slider moves.
  - **Swell:** the lid follows the pattern with a 40 ms glide instead of its usual 120 ms swing, so the curves keep their shape. When the pattern stops, it swings back to the knee lever's position as usual.

**How:** `TARGETS` in `js/modseq.js` gives each target its own setting (`base`), when it can move (`ready`) and how to turn it on (`enable`). `seqTick()` replaces `seqAir()` and returns `{target, value}` in the target's units. The control loop sends the fan's value to `setFanSpeed()` (in `audio.js`, which overrides the slider in `lfoFreq` while set), and uses the swell's value for the lid. `drawVox()` in `stops.js` draws the stop as clicking it would. The ranges, conversions and readout are in `core/modseq.js` (`SEQ_TARGET_RANGE`, `toShare`, `fromShare`, `amountText`).

**Measured** (120 bpm; Diapason A3 alone):
- **Fan:** Speed slider at 3 Hz, Amount 50% (5.5 Hz), a Linear sweep up in one 16th and then held. The treble flickers at 8.4 Hz while the pattern plays (3 + 5.5 = 8.5 expected) and at 3 Hz on its own afterwards. The Speed readout still shows 3.0 Hz.
- **Swell:** slider closed, Amount 100%, a sweep up in one 16th. The note is 5.9 dB louder while the pattern plays (fully open is about 6 dB, D21) and back within 1 dB of closed afterwards. The swell readout still says Closed.
- Direct wind behaves exactly as in D30; its tests pass unchanged.

**Tests:** 4 new browser tests in `tests/modseq.spec.js` and 1 unit test. Each of these planted bugs was caught: the fan target not drawing the Vox Humana, the fan's speed never applied, the fan not easing back, the swell ignored, and the fan following the pattern without its stop drawn.

**Test change:** D30's First note / Each note test now checks ranges (2.2–2.6″ carrying on, 1.25–1.55″ restarted) instead of ±0.05″. The pattern climbs 0.9″ a second and the second key is pressed by a separate call a few tens of milliseconds after the first ends, so the old tolerance failed once in testing.

**Test change (D29):** the Natural variation test failed about one run in six while testing this PR. The vibrato's wander is random on every page load, and a 4.2 s window sometimes caught a calm stretch, so the "natural" timing spread came out at only 1.6× the "machine" spread (the test required 2×). It now measures 6.5 s windows and checks a fixed line between the two. Over 16 runs, machine spread was 1.1–4.0 ms and natural 6.4–8.7 ms; the test requires under 5.0 ms and over 5.2 ms. The width check was already reliable and is unchanged. The vibrato itself is unchanged.

## D32. Pedal autoplay folds into the modulation sequencer

**Chosen:** Pedal autoplay is gone. The modulation sequencer takes its place in the Treadles section (no longer a drawer) and does its job, as the owner asked.
- **Lanes:** there's now **a pattern for each thing it moves**: Left treadle, Right treadle, Direct wind, Fan speed and Knee swell, all playing together. A row of tabs picks which pattern the piano roll shows; a lit lamp on a tab means that pattern is playing. Each pattern has its own **Play this pattern** switch and its own **Amount**; Clear pattern clears the one on show.
- **Shared settings:** **Tempo** (moved from autoplay, same store key `reed-autoTempo`), **Time** (2/4, 3/4, 4/4, 5/4 or 6/8; the tempo counts quarter notes, or eighths in 6/8, as autoplay did), **Length** (1–4 bars, as autoplay allowed) and **Starts on**. Changing the time or the number of bars keeps each bar's notes in place in their bar; notes that no longer fit go.
- **The treadle patterns pump the organ:**
  - A sweep up presses that pedal down and a sweep down lets it up. Amount is how far, as a share of a full stroke (100% by default).
  - The air follows the pedal as it does for a foot, including the bonus for alternating feet and the hinge thump at the start of each stroke.
  - Your own feet (treadles, arrow keys, Space) still work alongside; a pedal goes as far down as either of you pushes it. The per-foot envelope sliders now shape only your own presses.
  - The pedals show the sequencer's strokes, and their readouts say "sequencer".
- **The treadles run all the time.** As autoplay did, the treadle patterns start with the first touch and keep pumping between phrases. The other patterns still start on the first note of a phrase (or each note) and loop while keys are held. Each pass of every pattern starts from its control's own setting (a treadle's is "up").
- **Direct wind and the treadles can't both supply the air.** The treadle patterns rest while Direct wind is on, starting again from beat 1 when it's turned off, as autoplay did (D26). Turning a treadle pattern on turns Direct wind off. Turning the Direct wind pattern on turns Direct wind on (so the treadles rest). The fan pattern draws the Vox Humana, as in D31.
- **The status line** reads *Sequencer pumping* where it said *Autoplay pumping*. As before, it doesn't show "Helper can't keep up" while the treadles pump, because the gaps between strokes would make it flicker.

**Defaults (D22 kept):** the treadle patterns are **on**, reproducing autoplay's default: one bar of 4/4 at 100 bpm, right on beat 1, left on beat 2, a half-note rest. A stroke is a Fast start sweep up over one 16th and a Fast start sweep down over the next two (`stroke()`), close to an autoplay stroke with the default foot envelope (60 ms attack, 300 ms decay). The Direct wind, fan and swell patterns are off, with the swell-up-and-back pattern from D30. Helper pump stays 2%.

**Saved settings carry over** (`migrateSaved`, used once, when nothing is saved under the new key `reed-seq`):
- A saved autoplay pattern becomes the treadle patterns: its time, bars and on/off, with a stroke for each Left or Right beat. A tie makes that stroke longer and slower: a quarter of its length pressing, the rest letting up, with a 16th to spare.
- A saved D30/D31 sequencer pattern becomes the lane it moved, with its on/off, its Amount and its Starts on. It was always 4/4, so it's placed bar by bar in the new time.
- The old keys (`reed-autoplay`, `reed-modseq`, `reed-seqAmount`) are left alone.

**Why:** the owner asked for Pedal autoplay to fold into the sequencer, with either treadle a modulation target, the tempo and time signatures in the sequencer, and old tests cleaned up. Their choices on the open questions:
- A pattern per target, played together, because pumping needs both feet, and the swell or fan should be able to move while the treadles pump.
- The treadle patterns on by default, so the organ pumps out of the box as it did.
- The treadles running all the time.
- The sequencer living where autoplay was.

**Measured** (default settings, helper 2%; wind gauge, mean and range over 12 s after 12 s held; D22's autoplay figures in brackets):

| What | Result |
| --- | --- |
| One note | 3.49″, 3.29–3.60 (autoplay: 3.5″, 3.3–3.6) |
| Three-note chord | 2.46″, 2.06–2.86 (autoplay: 2.1″, 1.8–2.5). A sequencer stroke gives about 10% more air than an autoplay stroke, so this holds slightly higher |
| Six-note chord | 0.30″, 0.00–0.76, running out (autoplay: 0.3″, 0.0–0.7) |
| Timing | Right strokes 2.4 s apart (one bar at 100 bpm), left 0.6 s after right |

**Tests removed and replaced:**
- `tests/autoplay.spec.js` and the three D22 unit tests are removed with `js/autoplay.js` and `js/core/autoplay.js`.
- What they checked is now checked on the treadle patterns in `tests/modseq.spec.js`: the defaults, waiting for the first touch, right then left a beat apart every bar, pumping between phrases, holding the wind for one note and running out with the patterns off, and resting under Direct wind.
- New tests cover the time signatures and bars, and carrying over a saved autoplay pattern and tempo and an old sequencer pattern.
- The quiet test setup now turns the two treadle patterns off (`stopPumping`) instead of unticking autoplay.
- The D30/D31 tests choose a lane where they chose a target. The D30 timing and loading unit tests are replaced by D32 ones for time signatures, defaults, strokes, reshaping and carrying over saved settings.

**Planted bugs:** each of these was caught: the treadles pumping only while keys are held, the treadles pumping under Direct wind, sequencer strokes giving no air, a saved autoplay pattern ignored, bars not keeping their notes when the time changes, and a treadle pattern not turning Direct wind off.

**Supersedes:** D22's pattern editor (beats of Left, Right, Rest, Tie). Its defaults and behaviour live on as the treadle patterns.

## D33. Patches, and no more automatic saving of the sound

**Chosen:** the sound is saved by name, as patches, and nothing about it saves itself any more.
- **The patch bar** runs across the top bar: a menu of patches, an *edited* mark, and Save, Save as…, Revert, Rename, Delete, Download and Load file….
- **Factory** is built in, first in the menu, and can't be overwritten, renamed or deleted; Save as… keeps a change to it.
- **Names** are tidied (single spaces, at most 40 characters). Save as… onto an existing name replaces that patch, and its button says *Replace*. Rename can't land on another patch's name. Delete asks first, then loads Factory.
- **A patch is the whole sound:** the drawn stops and couplers and the divided-stops setting (new: stops were never saved before), every sound slider (wind, wind tone, reeds, voicing, case and room, the fan, Expression, Direct wind's level, knee swell), and the sound's other choices:
  - tone model, fan shape, Scoop on, Curve, Vibrato on
  - Direct wind on or off, keyboard compass, helper pump, Easy wind
  - each foot's envelope and whether they're linked
  - the reed set
  - the whole modulation sequencer (time, bars, Starts on, tempo, every lane)
- **Loading a patch applies it at once,** to notes already sounding too. Anything a patch doesn't mention gets the factory setting, so patches keep loading as new controls arrive. Each patch records a version (1).
- **No automatic saving of the sound.** Moving a slider changes the sound but writes nothing. The *edited* mark shows when the sound differs from the patch as loaded or saved (it compares the two four times a second, so stops, sequencer edits and MIDI controls count too); Revert reloads the patch. Which sequencer lane is on show isn't part of the sound and doesn't count.
- **The organ opens with the patch last loaded or saved** (`reed-patch`), or Factory. Reloading without saving brings back the patch as saved.
- **Still remembered automatically** (your setup and the page layout): Volume, the MIDI controls learned for Direct wind and Vibrato delay, which drawers are open, which info explanations are showing, and which sequencer pattern is on show.
- **Files:** Download saves the sound as `<name>.reedorgan.json` (`{app: "parlor-reed-organ", kind: "patch", version, name, settings}`). Load file… adds a patch from one, never overwriting (a taken name becomes "Name (2)"), and loads it. A file that isn't a patch, or comes from a newer version, is refused with a message under the bar.
- **Settings saved before patches** become a patch called **My settings** the first time this version opens, and it opens with that. This only happens if they differ from the factory sound: since D32 every visit saved the sequencer whether or not anything changed, so nearly every browser has some old settings. A saved Pedal autoplay or early sequencer pattern goes through D32's carry-over. The old entries are then deleted, leaving only your setup, the layout, `reed-patches` and `reed-patch`.

**How:**
- Every setting that belongs to the sound registers itself with `patchField(key, {def, get, set, ok, legacy})` in its module's setup. `bindSlider` registers every slider (except the setup ones in `RIG`, which is just Volume) under its old storage key, by slider position. The other choices register where they live (`controls.js`, `stops.js`, `keys.js`, `treadles.js`, `modseq.js`).
- `js/patches.js` keeps the library (`reed-patches`), builds a patch from `snapshot()`, applies one in registration order (the divided-stops setting before the stops), runs the patch bar, and does the carry-over. `setupPatches()` runs after every other module's setup.
- Names, the library, comparing settings and the file format are pure (`core/patches.js`).
- The computer keyboard doesn't play notes while you type in a text box.

**Why:** the owner asked to save patches locally and to stop the automatic saving of every setting. They agreed to the suggestions for the open questions:
- open with the last patch loaded or saved;
- keep remembering the setup and layout automatically;
- include the stops;
- download and load patches as files;
- show an *edited* mark rather than a "Leave site?" warning;
- leave ready-made patches for a later PR.

**Tests changed:**
- Ten tests that changed a sound setting and checked it survived a reload now save a patch first (`savePatch` in `tests/organ.js`), because that's how a setting is kept now. They are the Expression, Easy wind, Direct wind, sequencer and settings tests.
- The settings test is now "settings come back with their saved patch; open drawers are remembered on their own".
- The reed-set test checks the reed set goes into the patch and that `reed-reedSeed` is no longer written.

**New tests:** `tests/patches.spec.js` (8 tests) and 4 unit tests. Each of these planted bugs was caught:
- every slider still saving itself
- stops left out of patches
- always opening with Factory
- old settings not carried over
- the edited mark never showing
- typing a name playing notes
- the lane on show counting as an edit

**Revisit if:** the owner wants ready-made patches shipped alongside Factory, a "Download all" backup, a warning before leaving with unsaved changes, or a patch to switch on a MIDI program change.

## D34. Built-in voices: Lay Still, Reed Choir and Vocal Lead

**Chosen:** three patches the owner made come with the organ, listed with Factory under **Built in** in the patch menu (your own patches follow under **Your patches**). They're the owner's downloaded patch files, unchanged: the settings are in `js/core/presets.js`, and the files themselves are kept in `tests/fixtures/`, where the tests check the two match.
- **Lay Still:** Bourdon and Melodia in the bass, Melodia in the treble (stops divided at E | F), Super Octave and Vox Humana. Direct wind at 1.0″, breathing up and down by 20% each bar (69 bpm), long speech, deep bloom, a big cabinet and room.
- **Reed Choir:** the same, with Diapason in the treble, Sub and Super Octave, no Vox Humana. Delayed vibrato on every note (±14 ¢, after 1.4 s, Natural variation 95%, Voice colour 75%), and a gentler breath on Direct wind (9%) at 74 bpm.
- **Vocal Lead:** Lay Still's stops without the Vox Humana. Vibrato on the top voice (±22 ¢), and a slight swell on Direct wind (5%) at 74 bpm.

**How they behave:**
- **Read-only, like Factory:** Save, Rename and Delete are greyed out, Save as… keeps a change, and their names can't be used for your own patches.
- **Startup:** the organ still opens with Factory, or with whatever you last loaded or saved, built-in voices included.
- **Duplicates in your library:** a patch of your own with a built-in voice's name (as the owner will have, having made them) is dropped if it's identical, since it's now built in. If it differs, it's kept as "Name (2)".
- **Files:** a downloaded built-in voice loads back from its file as a patch of your own ("Reed Choir (2)").

**Why:** the owner asked for these voices to come with the organ.

**Measured** (C-major chord C4–E4–G4 held 3 s, default Volume; level against Factory; then a held A4 for the vibrato):

| Voice | Level vs Factory | Peak | Wind | Vibrato on A4 |
| --- | --- | --- | --- | --- |
| Factory | 0 dB | −9.9 dBFS | 2.7″ | none |
| Lay Still | −11.2 dB | −17.6 dBFS | 1.7″ | ±2.5 ¢ (the breathing wind) |
| Reed Choir | −7.7 dB | −17.5 dBFS | 1.2″ | not measurable (its octave couplers confuse the pitch tracker); set to ±14 ¢ on every note after 1.4 s |
| Vocal Lead | −13.3 dB | −23.6 dBFS | 1.1″ | ±22.9 ¢ (set ±22 ¢) |

They're quieter than Factory because their Direct wind sits around 1″ rather than 2″. That's part of their soft character, so they're shipped as made. Nothing comes near clipping. Each one loads with no *edited* mark, so every setting in them is used as saved.

**Tests:** 5 browser tests and 1 unit test. Each of these planted bugs was caught: built-in voices overwritable, a differing copy of your own lost, the organ unable to open with a built-in voice, and a loaded file taking a built-in voice's name. The D33 tests now expect the built-in voices in the menu.

**To add a voice:** make it in the organ, Download it, add its name and settings to `BUILT_IN` in `js/core/presets.js` and its file to `tests/fixtures/`, and add it to the lists in the D34 tests.

---

# Parlour: the port to synthkit

Entries D1–D34 come from reedorgan and still describe the sound: the port kept
every one of them. File and function names in them are reedorgan's; see
`architecture.md` for where each now lives.

## P1. One engine for the browser and the DAW

**Chosen:** the organ is a synth on synthkit (the `synthkit/` submodule). Its sound, wind loop, sequencer, couplers and Expression run in C++ (`src/Synth.cpp`, with reedorgan's `js/core` maths in `src/organ.h`); the cabinet is the synth's own page (`ui/page.*`). CI builds one HTML file for the browser and VST3/AU plugins whose window is the same page.
**Why:** the owner wants the organ in a DAW (Ableton Live on Windows first). A build step was the price; the owner set aside D1's no-build rule for this.
**Verified:** a single Diapason note on Direct wind matches reedorgan in Chromium harmonic by harmonic (20 harmonics, all within 0.1 dB, same absolute level). A held four-note chord (Factory, treadles pumping) matches in level within 0.5 dB and band by band within 1.5 dB; the wind gauge follows the same course. With four ranks, the fan and the swell open on Direct wind: level within 0.3 dB, every band within 0.7 dB. What's left comes from things that are random in both (reed start phases, the room's noise impulse): the port's room, drawn from a fixed seed, is about 3 dB narrower in stereo between 100 and 400 Hz than reedorgan's average draw, which itself varies by as much from one page load to the next.

## P2. The Web Audio graph, node for node

**Chosen:** every node in reedorgan's graph has its counterpart from synthkit's Web Audio blocks (`sk::wa`), which compute what the browser's nodes compute: per reed an oscillator on the rank's periodic wave and a high shelf; globally the swell lowpass, cabinet-bass highpass, fan stage (lowpass, delay, stereo panner), body EQ, two convolvers, compressor, limiter and the oversampled soft-clip shaper. `setTargetAtTime` ramps are exact exponential steps per block (or per sample for envelopes). What ran on animation frames (the reservoir, treadles, sequencer, `applyWind`) runs once per 32-sample control block.
**Why:** a translation can be checked against the original by measurement (P1), rather than re-voiced by ear.
**Differences:** pitch modulation (detune, scoop, vibrato) is computed per control block and interpolated across it rather than per sample; the reed shelf's gain updates per block. Neither is audible. Reeds on a stop that's off aren't computed (their envelopes and start times still run), which keeps big chords affordable.

## P3. The sequencer follows the DAW's tempo; the browser keeps its own (now through synthkit, P8)

**Chosen:** in a DAW the modulation sequencer runs at the song's tempo, counting quarter notes in every time signature, and the Tempo slider gives way to a readout. In the browser it keeps its own Tempo (30–200 bpm, saved in patches), which counts the beat unit as before (eighths in 6/8). The page tells the engine it has its own clock with the `clock.own` message; without it (a plugin with its window closed, the render tool) the engine follows the transport.
**Why:** the owner doesn't need a separate tempo in a DAW, where the pumping should lock to the song. The browser has no song, and patches made there carry their tempo.

## P4. Couplers, sustain and Expression live in the engine

**Chosen:** `processEvents` does what `press`/`release` did: coupled octaves with reference counts, the compass, the sustain pedal (held keys keep their coupled notes, as before), the top voice, the chord window and the scoop and vibrato decisions. The engine tells the page which keys are down (the `key` message), coupled ones included.
**Why:** so they work from a DAW's MIDI track, not only from the page.
**Page notes:** the page's own keys play on MIDI channel 2, so a MIDI keyboard holding the same key doesn't merge with them.

## P5. MIDI controllers: the page in the browser, the engine in a DAW (superseded by P8)

**Chosen:** in the browser, the page moves the sliders from the mod wheel (Scoop), expression and foot pedals (Knee swell), breath (Direct wind), the volume knob (Direct wind or Volume) and learned controls, as reedorgan did. In a DAW there's no Learn (the DAW maps controllers); the engine applies the same fixed controllers itself, overriding the setting until it's moved.
**Why:** a plugin page never sees MIDI (the host routes it to the engine).

## P6. Patches are synthkit presets; Volume is part of the sound

**Chosen:** the kit's preset bar replaces reedorgan's patch bar (Save, and Save as new…, Rename, Delete, Export and Import under More). Factory, Lay Still, Reed Choir and Vocal Lead are factory presets, built from the owner's own patch files (`tools/presets.mjs`). *Load reedorgan patch…* converts a `.reedorgan.json` file (slider positions to real units) and saves it as one of your patches. Volume is a parameter, so it's saved with the sound.
**Why:** synthkit has no parameters that stay out of patches; in a DAW the project saves everything anyway. Patches saved in the old page's browser storage can't be read from a different address: download them there first.

## P7. Brightness rebuilds its wave off the audio thread

**Chosen:** each rank's brightness is custom state (`voicing`), not a parameter. Changing it builds the rank's new periodic wave where custom state loads (never on the audio thread) and keeps built waves for reuse. The page sends it when you let go of a Brightness slider.
**Why:** building a wave allocates. Brightness changes the sound only once you let go, where reedorgan changed it while dragging.

## P8. The DAW's stand-ins come from synthkit

**Chosen:** Parlour uses synthkit's own versions of what it had built for itself.
- **Tempo:** the sequencer runs at the transport's tempo: the song's in a DAW, and in the browser synthkit's tempo control, which now sits in the sequencer's header (BPM, MIDI clock, beat lights) and is saved with the patch (`features.tempoInPatch`). The `seq.tempo` parameter and the `clock.own` message are gone; patch version 2 moves an old patch's `seq.tempo` into its tempo. The built-in voices keep their tempos (Factory 100, Lay Still 69, Reed Choir and Vocal Lead 74).
- **Controllers:** the mod wheel (Scoop), expression and foot pedals (Knee swell) and breath (Direct wind) are declared on their parameters with `cc()`, and the volume knob's either-or (Direct wind while it's on, Volume otherwise) uses `ctx.setParam`. They work the same in the browser and a DAW, and the sliders, and the DAW's automation, follow. The page keeps only what synthkit can't know: MIDI Learn for Direct wind (when it's not the volume knob) and Vibrato delay, which it takes with `sk.takeMidi`.
- **The host bar** shows the prompt to start the sound above the cabinet until it's running. The cabinet places Connect MIDI and the tempo itself, and keeps its own All notes off.
- **Old patch files** load through `sk.presets.importPatch`, tempo included.
**Why:** the owner wants MIDI and tempo to come out of the box for every synth. Both browser bugs fixed in PRs #2 and #3 came from Parlour's own wiring around these.
**Differences:** the browser tempo counts quarter notes in every time signature, as a DAW does; reedorgan's counted eighths in 6/8, so a 6/8 pattern plays at half the speed it did at the same number. All four built-in voices are in 4/4. A breath or volume controller's moves now glide over 10 ms like a slider's, rather than jumping. Otherwise every scenario renders bit for bit as before.

