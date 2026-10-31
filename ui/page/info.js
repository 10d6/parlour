// Info buttons (D24), from reedorgan's info.js; the choices are page settings (sk.store). Every section marked data-info="key" gets a small "i"
// button beside its heading (the element marked .info-host) that shows or hides
// that section's explanatory text: its .sub and .hint paragraphs, but not those
// of a section nested inside it, which has its own button. The text starts
// hidden; each section's choice is saved under reed-info-<key>.

import { page, pageStore } from './util.js';

export function setupInfo() {
  const sections = [...page.root.querySelectorAll('[data-info]')];
  for (const sec of sections) {
    const own = el => el.closest('[data-info]') === sec;
    const texts = [...sec.querySelectorAll('.sub, .hint')].filter(own);
    const host = [...sec.querySelectorAll('.info-host')].find(own);
    if (!texts.length || !host) continue;
    const key = sec.dataset.info, name = (host.querySelector('label') || host).textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'info-btn'; btn.textContent = 'i';
    btn.dataset.key = key;
    btn.setAttribute('aria-label', `About ${name}`);
    btn.title = 'Show or hide the explanation';
    const show = on => {
      texts.forEach(t => { t.hidden = !on; });
      btn.setAttribute('aria-pressed', String(on));
      sec.classList.toggle('show-info', on);
    };
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();   // inside a <summary>, don't also open or close the drawer
      const on = btn.getAttribute('aria-pressed') !== 'true';
      show(on); pageStore.set('info-' + key, on);
    });
    const label = host.querySelector('label');
    if (label) label.after(btn); else host.appendChild(btn);
    show(pageStore.get('info-' + key, false));
  }
}
