// Parlour's own page (synthkit API.md §9a): reedorgan's walnut cabinet, with
// the kit's preset bar and Connect MIDI button where reedorgan had its own.
// Everything the page changes is a parameter, custom state ("seq",
// "voicing") or a message (the treadles), so the same page works in the
// browser and as the plugin's window.
import { page, byId } from "./page/util.js";
import { setupControls } from "./page/controls.js";
import { setupStops } from "./page/stops.js";
import { setupKeys } from "./page/keys.js";
import { setupTreadles } from "./page/treadles.js";
import { setupSeq } from "./page/seq.js";
import { setupWind } from "./page/wind.js";
import { setupInfo } from "./page/info.js";
import { readLegacyFile } from "./page/legacy.js";

export function mount(sk, root) {
  page.sk = sk;
  page.root = root;
  for (const el of root.querySelectorAll("[data-mount]")) sk.mount(el, el.dataset.mount);
  // synthkit's host bar keeps only what the cabinet doesn't place itself:
  // the prompt to start the sound. The cabinet has its own All notes off, and
  // Space works the treadles.
  sk.hostBar({ panic: false, space: false });
  setupControls();
  setupStops();
  setupKeys();
  setupTreadles();
  setupSeq();
  setupWind();
  setupLegacyImport();
  setupInfo();
}

// Load reedorgan patch…: a file downloaded from the reedorgan page becomes
// one of your patches, under its own name, tempo included.
function setupLegacyImport() {
  const { sk } = page;
  const btn = byId("patchImportOld"), input = byId("patchOldFile"), msg = byId("patchMsg");
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const f = input.files[0];
    input.value = "";
    if (!f) return;
    const res = readLegacyFile(await f.text());
    if (res.error) { msg.textContent = res.error; return; }
    const out = sk.presets.importPatch({ name: res.name, params: res.params, custom: res.custom, tempo: res.tempo, patchVersion: 2 });
    msg.textContent = out.ok ? `Loaded \u201c${out.name}\u201d from the file.` : `Couldn\u2019t load that file: ${out.error}`;
  });
}
