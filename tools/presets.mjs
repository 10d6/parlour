// Builds the built-in voices in presets/ from the owner's reedorgan patch
// files (tools/reedorgan-patches/), through the same conversion the page's
// "Load reedorgan patch…" uses (ui/page/legacy.js).
//
//   node tools/presets.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { readLegacyFile } from "../ui/page/legacy.js";

const dir = new URL("./reedorgan-patches/", import.meta.url);
for (const file of readdirSync(dir).sort()) {
  const res = readLegacyFile(readFileSync(new URL(file, dir), "utf8"));
  if (res.error) throw new Error(`${file}: ${res.error}`);
  const out = { synthkit: 1, synth: "parlour", patchVersion: 2, name: res.name, author: "Parlour", tags: [], tempo: res.tempo, params: res.params, custom: res.custom };
  const name = file.replace(".reedorgan.json", ".json");
  writeFileSync(new URL(`../presets/${name}`, import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log(`presets/${name}: ${res.name}, ${Object.keys(res.params).length} params`);
}
