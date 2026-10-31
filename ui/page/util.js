// Shared by the page's modules: the bridge, element lookup, and sliders,
// selects and switches bound to the synth's parameters.
//
// The page's modules are joined into one scope when the page is packed
// (API.md §9a), so every top-level name here and in the other files is unique.

export const page = { sk: null, root: null };
export const byId = (id) => page.root.querySelector("#" + id);

export const logMap = (lo, hi) => (pos) => lo * Math.pow(hi / lo, pos / 100);
export const logPos = (lo, hi) => (v) => (100 * Math.log(v / lo)) / Math.log(hi / lo);
export const signed = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);

// Binds an <input type=range> (id ends in Amt, its <output> in Out) to a
// parameter. The slider works in positions, as on the reedorgan page; toValue
// and toPos convert to and from the parameter's real units. fmt(pos, value)
// is the readout. Returns {el, value (real units), set(pos)}.
export function bindSlider(id, param, { fmt = (p) => String(p), toValue = (p) => p, toPos = (v) => v, onChange, out: outId } = {}) {
  const { sk } = page;
  const el = byId(id), out = byId(outId || id.replace("Amt", "Out"));
  const s = { el, param, value: sk.get(param) };
  const show = (v) => { s.value = v; if (out) out.textContent = fmt(+el.value, v); };
  let dragging = false;
  sk.onParam(param, (v) => {
    if (!dragging) el.value = String(toPos(v));
    show(v);
    if (onChange) onChange(v);
  });
  el.addEventListener("pointerdown", () => { dragging = true; sk.gesture(param, true); });
  const end = () => { if (dragging) { dragging = false; sk.gesture(param, false); } };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("change", end);
  el.addEventListener("input", () => { sk.set(param, toValue(+el.value)); });
  s.set = (pos) => { el.value = String(pos); sk.set(param, toValue(+el.value)); };
  return s;
}

// A <select> whose options, in order, are a choice parameter's values.
export function bindSelect(id, param, onChange) {
  const { sk } = page;
  const el = byId(id);
  const values = [...el.options].map((o) => o.value);
  sk.onParam(param, (v) => {
    el.value = values[Math.round(v)] ?? values[0];
    if (onChange) onChange(el.value);
  });
  el.addEventListener("change", () => sk.set(param, Math.max(0, values.indexOf(el.value))));
  return { el, values, get value() { return values[Math.round(sk.get(param))]; } };
}

// A checkbox bound to a toggle parameter.
export function bindCheck(id, param, onChange) {
  const { sk } = page;
  const el = byId(id);
  sk.onParam(param, (v) => { el.checked = v >= 0.5; if (onChange) onChange(el.checked); });
  el.addEventListener("change", () => sk.set(param, el.checked ? 1 : 0));
  return el;
}

// The page's own settings (open drawers, learned controls): never in patches.
export const pageStore = {
  get: (k, d) => { try { return page.sk.store.get(k, d); } catch (e) { return d; } },
  set: (k, v) => { try { page.sk.store.set(k, v); } catch (e) { /* ignore */ } },
};

// A <details> drawer that remembers whether it's open.
export function rememberOpen(id, key) {
  const el = byId(id);
  el.open = !!pageStore.get(key, false);
  el.addEventListener("toggle", () => pageStore.set(key, el.open));
  return el;
}
