// Plays Parlour's own page in headless Chromium the way a player would, and
// checks it responds: stops, keys and couplers, treadles, the gauge, the
// sequencer, presets and loading a reedorgan patch file. Black-box, like
// reedorgan's tests: it uses only ids, aria-labels, readouts and the sound.
//
//   node tests/page-test.cjs build-web/web/parlour.html [out dir]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const [htmlPath, outDir = "page-test"] = process.argv.slice(2);
let failures = 0;
const check = (ok, what) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  // Tap the speakers: an analyser on whatever reaches the destination.
  await page.addInitScript(() => {
    const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "destination").get;
    Object.defineProperty(BaseAudioContext.prototype, "destination", {
      configurable: true,
      get() {
        if (!this.__tap) {
          const dest = real.call(this);
          const tap = new GainNode(this, { channelCount: 2, channelCountMode: "explicit" });
          const an = new AnalyserNode(this, { fftSize: 2048 });
          tap.connect(dest); tap.connect(an);
          Object.defineProperty(tap, "maxChannelCount", { get: () => dest.maxChannelCount });
          this.__tap = tap; window.__an = an;
        }
        return this.__tap;
      },
    });
    window.__rms = () => { const a = window.__an; if (!a) return 0; const x = new Float32Array(a.fftSize); a.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
  });
  await page.goto("file://" + path.resolve(htmlPath));
  await page.waitForTimeout(1200);
  const text = (sel) => page.locator(sel).first().textContent();
  const pressed = (label) => page.getByRole("button", { name: label, exact: true }).first().getAttribute("aria-pressed");
  const lit = (m) => page.locator(`#keys [data-midi="${m}"]`).evaluate((el) => el.classList.contains("down"));

  check((await text(".plate-name")) === "Parlour" && (await text(".plate-tag")) === "a reed organ simulator", "the name board reads Parlour, a reed organ simulator");
  check((await text("#status")) === "Press a key to start", "the status line asks for a key");

  // Stops
  await page.getByRole("button", { name: "Bourdon 16′", exact: true }).click();
  await page.waitForTimeout(100);
  check((await pressed("Bourdon 16′")) === "true", "drawing the Bourdon draws it");

  // A key sounds, lights, and lets go
  await page.keyboard.down("q");
  await page.waitForTimeout(700);
  check(await lit(60), "Q lights middle C");
  const rms = await page.evaluate(() => window.__rms());
  check(rms > 0.01, `a held key sounds (RMS ${rms.toFixed(3)})`);
  check(!/Press a key/.test(await text("#status")), `the status line moves on ("${await text("#status")}")`);
  await page.keyboard.up("q");
  await page.waitForTimeout(300);
  check(!(await lit(60)), "letting go of Q lets middle C up");

  // Couplers pull down the octave key, and Esc lets everything go
  await page.getByRole("button", { name: "Super octave coupler", exact: true }).click();
  await page.keyboard.down("z");
  await page.waitForTimeout(400);
  check((await lit(48)) && (await lit(60)), "with Super Octave drawn, Z holds C3 and C4");
  await page.keyboard.press("Escape");
  await page.keyboard.up("z");
  await page.waitForTimeout(300);
  check(!(await lit(48)) && !(await lit(60)), "Esc lets every key up");
  await page.getByRole("button", { name: "Super octave coupler", exact: true }).click();

  // Treadles
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(300);
  const flow = await text("#flowL");
  check(/attack|decay|sustain/.test(flow), `holding ← works the left treadle ("${flow}")`);
  await page.keyboard.up("ArrowLeft");

  // Direct wind moves the gauge
  await page.click("#directOn");
  await page.evaluate(() => { const s = document.querySelector("#airAmt"); s.value = "36"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(900);
  const gauge = await text("#rWind");
  check(parseFloat(gauge) > 3.3, `Direct wind at 3.6″ fills the gauge (${gauge})`);
  await page.click("#directOn");

  // The sequencer: placing a note adds it to the pattern
  const before = await page.locator("#seqGrid .seq-note").count();
  await page.locator('#seqGrid .seq-cell[data-row="up-s"][data-step="12"]').click();
  await page.waitForTimeout(200);
  check((await page.locator("#seqGrid .seq-note").count()) === before + 1, "tapping the piano roll places a sweep");

  // A built-in voice loads (Lay Still uses Direct wind and the Vox Humana)
  const sel = page.locator(".patch-kit select").first();
  const values = await sel.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
  const lay = values.find(([, t]) => /Lay Still/.test(t));
  check(!!lay, "Lay Still is in the patch menu");
  if (lay) {
    await sel.selectOption(lay[0]);
    await page.waitForTimeout(300);
    check((await page.isChecked("#directOn")) && (await pressed("Vox Humana tremolo")) === "true", "loading Lay Still turns on Direct wind and draws the Vox Humana");
  }

  // A reedorgan patch file becomes one of your patches
  await page.setInputFiles("#patchOldFile", path.resolve(__dirname, "../tools/reedorgan-patches/vocal-lead.reedorgan.json"));
  await page.waitForTimeout(500);
  check(/Loaded/.test(await text("#patchMsg")), `Load reedorgan patch… loads a file ("${await text("#patchMsg")}")`);

  // Info buttons
  await page.locator('[data-info="adjust"] .info-btn').first().click();
  check(await page.locator('[data-info="adjust"] > .sub').first().isVisible(), "an info button shows its section's explanation");

  await page.screenshot({ path: path.join(outDir, "page.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(sideways <= 0, `on a phone the page doesn't scroll sideways (${sideways}px)`);
  await page.screenshot({ path: path.join(outDir, "phone.png"), fullPage: false });

  check(errors.length === 0, "no errors" + (errors.length ? ": " + errors.join(" | ") : ""));

  // A real browser's autoplay rule: a context made without a click starts
  // suspended, and resume() only works during a click or key press (a waiting
  // resume() finishes once a later one does). Headless Chromium doesn't
  // enforce this, so it's emulated: the first click on a key must make sound.
  const strict = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await strict.addInitScript(() => {
    const Orig = window.AudioContext, realResume = Orig.prototype.resume;
    window.__ctxs = [];
    window.AudioContext = class extends Orig {
      constructor(...a) { super(...a); window.__ctxs.push(this); this.__waiting = []; if (!navigator.userActivation.isActive) this.suspend(); }
      resume() {
        if (!navigator.userActivation.isActive) return new Promise((r) => this.__waiting.push(r));
        return realResume.call(this).then(() => { this.__waiting.splice(0).forEach((r) => r()); });
      }
    };
  });
  await strict.goto("file://" + path.resolve(htmlPath));
  await strict.waitForTimeout(1200);
  const states = () => strict.evaluate(() => window.__ctxs.map((c) => c.state));
  check(!(await states()).includes("running"), "with a browser's autoplay rule, nothing starts before a click");
  await strict.locator('#keys [data-midi="60"]').dispatchEvent("pointerdown", { pointerId: 1, button: 0, pointerType: "mouse", isPrimary: true });
  await strict.mouse.click(600, 600);
  await strict.keyboard.down("q");
  await strict.waitForTimeout(900);
  check((await states()).includes("running") && !/Press a key/.test(await strict.textContent("#status")), `with a browser's autoplay rule, playing starts the organ (${(await states()).join(",")}; "${await strict.textContent("#status")}")`);
  await strict.keyboard.up("q");

  // The same page as a plugin window, with a stand-in for the plugin's web
  // view bridge (as synthkit's web/test/plugin-ui-test.cjs does).
  const plug = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const perr = [];
  plug.on("pageerror", (e) => perr.push(e.message));
  plug.on("console", (m) => { if (m.type() === "error" && !/fonts|ERR_|net::|Failed to load/.test(m.text())) perr.push(m.text()); });
  await plug.addInitScript(() => {
    window.__skHost = { format: "VST3", host: "Test host", state: { patch: { synth: "parlour", name: "Factory", params: {} }, ui: { current: { kind: "factory", name: "Factory" }, dirty: false } }, store: {} };
    const listeners = new Map();
    window.__sent = [];
    window.__JUCE__ = { backend: {
      addEventListener: (id, fn) => { if (!listeners.has(id)) listeners.set(id, []); listeners.get(id).push(fn); },
      emitEvent: (id, payload) => window.__sent.push(JSON.parse(JSON.stringify({ id, ...payload }))),
    } };
  });
  await plug.goto("file://" + path.resolve(htmlPath));
  await plug.waitForTimeout(1200);
  check(await plug.locator("#tempoField").isHidden() && await plug.locator("#tempoHostField").isVisible(), "in a DAW the sequencer shows the DAW's tempo, not its own slider");
  check(await plug.locator("#directLearn").isHidden(), "in a DAW the Learn buttons give way to the DAW's own MIDI mapping");
  const bootSent = await plug.evaluate(() => window.__sent.slice());
  check(!bootSent.some((m) => m.t === "msg" && m.i === 2), "in a DAW, the page leaves the sequencer on the DAW's tempo");
  await plug.evaluate(() => { window.__sent.length = 0; });
  await plug.getByRole("button", { name: "Celeste 8\u2032", exact: true }).click();
  await plug.keyboard.down("ArrowRight");
  await plug.waitForTimeout(200);
  await plug.keyboard.up("ArrowRight");
  const sentAll = await plug.evaluate(() => window.__sent);
  // Parameters and messages go to the plugin by index: the synth declares
  // treadle.left, treadle.right, clock.own, … in that order.
  check(sentAll.filter((m) => m.t === "param").length >= 1, "in a DAW, drawing a stop reaches the plugin");
  check(sentAll.some((m) => m.t === "msg" && m.i === 1 && m.v[0] === 1) && sentAll.some((m) => m.t === "msg" && m.i === 1 && m.v[0] === 0), "in a DAW, the treadles reach the plugin");
  check(perr.length === 0, "plugin window: no errors" + (perr.length ? ": " + perr.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `FAILED: ${failures}` : "OK");
  process.exit(failures ? 1 : 0);
})();
