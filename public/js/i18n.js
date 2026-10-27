/* Tiny i18n layer. English ships in the HTML (best for SEO); other languages
   are swapped in client-side from /i18n/<lang>.json for elements carrying
   data-i18n="key". Adding a language = one JSON file + one entry below. */
const SUPPORTED = ['en', 'de'];
const FALLBACK = 'en';
let dict = {};
let english = {};

export function currentLang() {
  let saved = null;
  try { saved = localStorage.getItem('fyu.lang'); } catch { /* private mode */ }
  if (saved && SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || FALLBACK).slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : FALLBACK;
}

export function t(key, vars = {}) {
  const s = dict[key] ?? english[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

async function load(lang) {
  const res = await fetch(`/i18n/${lang}.json`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`i18n ${lang} ${res.status}`);
  return res.json();
}

export async function initI18n() {
  const lang = currentLang();
  try {
    english = await load('en');
    dict = lang === 'en' ? english : await load(lang);
  } catch {
    dict = {};
  }
  document.documentElement.lang = lang;
  if (lang !== 'en') {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = dict[el.dataset.i18n];
      if (v) el.textContent = v;
    });
  }
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    b.addEventListener('click', () => {
      try { localStorage.setItem('fyu.lang', b.dataset.lang); } catch { /* ignore */ }
      location.reload();
    });
  });
  return lang;
}
