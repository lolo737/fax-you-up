#!/usr/bin/env node
/**
 * Sanity-checks every HTML page in public/:
 *  - internal href/src targets exist (or are a known /api/ route)
 *  - in-page #anchors exist
 *  - each page has <title>, meta description, lang, viewport, exactly one <h1>
 *  - images have alt text; no inline style="" (the CSP forbids it)
 *  - every page in sitemap.xml exists
 * Exits non-zero on any problem. No dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const fnDir = path.join(root, 'netlify', 'functions');

const apiRoutes = new Set(
  fs
    .readdirSync(fnDir)
    .map((f) => fs.readFileSync(path.join(fnDir, f), 'utf8').match(/path:\s*'([^']+)'/))
    .filter(Boolean)
    .map((m) => m[1]),
);

const htmlFiles = fs.readdirSync(pub).filter((f) => f.endsWith('.html'));
const problems = [];
let linkCount = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(pub, file), 'utf8');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const where = (msg) => problems.push(`${file}: ${msg}`);

  if (!/<html lang="[a-z]{2}/.test(html)) where('missing <html lang>');
  if (!/<title>[^<]{5,}<\/title>/.test(html)) where('missing or empty <title>');
  if (!/<meta name="description" content="[^"]{20,}"/.test(html)) where('missing meta description');
  if (!/<meta name="viewport"/.test(html)) where('missing viewport meta');
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) where(`expected exactly one <h1>, found ${h1s}`);
  if (/\sstyle="/.test(html)) where('inline style="" found (blocked by CSP)');
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) where(`<img> without alt: ${m[0].slice(0, 60)}`);

  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    linkCount++;
    if (/^(https?:|mailto:|tel:|data:)/.test(url)) continue;
    if (url.startsWith('#')) {
      if (url.length > 1 && !ids.has(url.slice(1))) where(`broken anchor ${url}`);
      continue;
    }
    const clean = url.split(/[?#]/)[0];
    if (clean.startsWith('/api/')) {
      if (!apiRoutes.has(clean)) where(`link to unknown API route ${clean}`);
      continue;
    }
    const target = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
    const abs = path.join(clean.startsWith('/') ? pub : path.dirname(path.join(pub, file)), target);
    if (!fs.existsSync(abs)) where(`broken link ${url}`);
  }
}

// JS modules imported by pages must exist and import only existing files.
for (const f of fs.readdirSync(path.join(pub, 'js'))) {
  const src = fs.readFileSync(path.join(pub, 'js', f), 'utf8');
  for (const m of src.matchAll(/from '(\.\/[^']+)'/g)) {
    if (!fs.existsSync(path.join(pub, 'js', m[1]))) problems.push(`js/${f}: missing import ${m[1]}`);
  }
  for (const m of src.matchAll(/'(\/api\/[a-z-]+)/g)) {
    if (!apiRoutes.has(m[1])) problems.push(`js/${f}: calls unknown API route ${m[1]}`);
  }
}

// i18n: every language file has the same keys as English.
const i18nDir = path.join(pub, 'i18n');
const en = JSON.parse(fs.readFileSync(path.join(i18nDir, 'en.json'), 'utf8'));
for (const f of fs.readdirSync(i18nDir)) {
  const d = JSON.parse(fs.readFileSync(path.join(i18nDir, f), 'utf8'));
  for (const k of Object.keys(en)) if (!(k in d)) problems.push(`i18n/${f}: missing key ${k}`);
}
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(pub, file), 'utf8');
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) if (!(m[1] in en)) problems.push(`${file}: unknown i18n key ${m[1]}`);
}

const sitemap = fs.readFileSync(path.join(pub, 'sitemap.xml'), 'utf8');
for (const m of sitemap.matchAll(/<loc>https?:\/\/[^/]+\/([^<]*)<\/loc>/g)) {
  const f = m[1] || 'index.html';
  if (!fs.existsSync(path.join(pub, f))) problems.push(`sitemap.xml lists missing page ${f}`);
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${htmlFiles.length} pages, ${linkCount} links/assets, ${apiRoutes.size} API routes, ${Object.keys(en).length} i18n keys — all present and correct.`);
