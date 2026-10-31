# Parlour — notes for Claude

Parlour is a synth built on synthkit (the `synthkit/` submodule, pinned).
The owner plays it and gives feedback; Claude writes the code and opens PRs.
The owner tests via the PR's GitHub Pages preview, and installs the plugin zips
from CI at milestones.

## Ground rules

1. **`synthkit/API.md` is the contract.** Work in this repo needs only that
   page plus this repo. Don't read synthkit's source to build the synth; if
   the page is missing something, note it and fix the doc in a synthkit PR.
2. **Don't edit `synthkit/` here.** Kit changes go to the synthkit repo; this
   repo then moves the submodule to the new commit in its own PR.
3. **Real-time safety** (API.md §4a): no allocation, locks, I/O or exceptions
   in `start`, `release`, `render`, `processGlobal`, `processEvents`, `tune`,
   `allocateVoice`. Allocate in `prepare`. No `throw`/`catch` anywhere.
4. **Stable identifiers.** Parameter IDs, `synth.json` `id`, `pluginCode`,
   `vendorCode` and `bundleId` never change once released. Patches store real
   units.
5. **Verify by rendering** before every PR: `--check` passes, and listen to
   (or look at) the renders when the change is audible.
6. Escape hatches and custom state (API.md §4, §5a) are the way to do unusual
   things. A feature moves into the kit when a second synth needs it.
7. **Porting a browser sketch?** Use the Web Audio blocks (`sk::wa`, API.md
   §8a), which match the browser's nodes sample for sample, and compare the
   port's renders with the sketch's. Input from the page that isn't a
   parameter is a message (§9b); a look of the synth's own is `ui/page.js`
   (§9a), with `ui/style.css` for styling either page.

## The organ

Parlour is reedorgan's reed organ ported onto synthkit (P1). The owner reviews
and merges PRs; the PR description is the main communication.

- `docs/decisions.md` lists the owner's preferences and why the sound works
  the way it does (D1–D34 from reedorgan, P1–P7 for the port). Read it before
  changing anything audible, and add an entry for every design choice.
- `docs/architecture.md` covers the files, the messages and meters between
  page and engine, and the signal flow. Keep it current.
- `README.md` is the player-facing description; keep it in step with
  features, and keep the page's "Things to listen for" notes in step too.
- Defaults keep the current sound unless the owner asked for a change.
- For anything audible, measure the rendered audio and put the numbers in the
  PR (D9). The organ's maths lives in `src/organ.h`; the page's sliders keep
  reedorgan's positions and convert to the parameters' real units.
- The page's modules are joined into one scope: top-level names must be
  unique across `ui/page.js` and `ui/page/*.js`.
- PR descriptions say what the player hears or does differently, include
  measurements, and end with "Try after merging". Write them for a reader
  who won't look at the code.

Before a PR, besides `--check` and the browser test:

```
node tests/page-test.cjs build-web/web/parlour.html build-web/page-test   # plays the page, browser and plugin window
node tools/presets.mjs                                                    # after changing ui/page/legacy.js
```

Comparing with reedorgan: serve it (`node scripts/serve.mjs` in a reedorgan
checkout), play both pages in Chromium with the speakers tapped (as
reedorgan's `tests/organ.js` does), and compare level and band powers.

## Fresh workspace

A new session starts without the toolchains. Install them first (Ubuntu; the
same script CI uses):

```
git submodule update --init
synthkit/tools/ci/deps.sh native && synthkit/tools/ci/deps.sh web && synthkit/tools/ci/deps.sh plugin
```

Playwright/Chromium for the browser test: usually preinstalled (try
`NODE_PATH=$(npm root -g)`), else `npm install --no-save playwright@1.48.2 &&
npx playwright install --with-deps chromium`. synthkit's CLAUDE.md has more
(pluginval, a local JUCE checkout).

## Commands

```
cmake -S . -B build -G Ninja && cmake --build build
./build/parlour_render --check . --out build/renders
./build/parlour_render tests/chord.json --out x.wav
./build/parlour_render --params

# browser page (API.md §11)
cmake -S . -B build-web -G Ninja -DCMAKE_TOOLCHAIN_FILE=synthkit/cmake/wasm32-wasi.cmake && cmake --build build-web
node synthkit/web/test/browser-test.cjs build-web/web/parlour.html build-web/test tests/chord.json

# plugins (API.md §12)
cmake -S . -B build-plugin -G Ninja -DSYNTHKIT_PLUGIN=ON -DSYNTHKIT_WEB_UI_DIR=$PWD/build-web/web && cmake --build build-plugin
```

## CI

Every PR: native checks, the browser page (Chromium test + browser-vs-native
comparison), a Pages preview linked on the PR, and plugin builds for Windows,
macOS and Linux (plugin check, pluginval, auval) with a zip per OS. A `v*` tag
publishes a release. The steps live in `synthkit/tools/ci/`.
