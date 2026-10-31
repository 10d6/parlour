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
// one of your patches, under its own name.
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
    sk.presets.init();
    for (const [id, v] of Object.entries(res.params)) sk.set(id, v);
    for (const [id, v] of Object.entries(res.custom)) sk.setCustom(id, v);
    const taken = new Set(sk.presets.list().map((e) => e.name));
    let name = res.name;
    for (let k = 2; taken.has(name); k++) name = `${res.name.slice(0, 34)} (${k})`;
    sk.presets.saveAs(name);
    msg.textContent = `Loaded “${name}” from the file.`;
  });
}
