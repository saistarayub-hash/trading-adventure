'use strict';
/* tools/make-mobile.js — export the companion as a static web app for Capacitor.
 *
 *   node tools/make-mobile.js
 *
 * Copies exactly the files the companion UI needs into mobile/www/ (Capacitor's
 * webDir), renaming companion.html to index.html because that is the entry point
 * a WebView loads. All references inside the UI are relative, so the copy works
 * untouched — no bundler, no build step, no dependencies.
 *
 * The exported app is a *client*: on first launch open Settings and enter your
 * companion server URL (+ token if it is not on your LAN). Everything else —
 * the curriculum, quizzes, the offline coach, the camera capture — runs on the
 * phone itself.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'mobile', 'www');

const FILES = [
  ['companion.html', 'index.html'],
  ['companion.css', 'companion.css'],
  ['companion.js', 'companion.js'],
  ['ai.js', 'ai.js'],
  ['manifest.webmanifest', 'manifest.webmanifest'],
  ['sw.js', 'sw.js']
];

const ENGINE = ['embed.js', 'chunk.js', 'bm25.js', 'vision.js', 'curriculum.js', 'distill.js', 'coach.js'];
const ICONS = ['pwa-192.png', 'pwa-512.png', 'pwa-maskable-192.png', 'pwa-maskable-512.png'];

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return path.relative(ROOT, to);
}

function main() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });

  const written = [];
  for (const [src, dst] of FILES) {
    written.push(copy(path.join(ROOT, src), path.join(WWW, dst)));
  }
  for (const f of ENGINE) {
    written.push(copy(path.join(ROOT, 'engine', f), path.join(WWW, 'engine', f)));
  }
  for (const f of ICONS) {
    written.push(copy(path.join(ROOT, 'companion', 'packaging', f), path.join(WWW, 'companion', 'packaging', f)));
  }

  // Prove the export is self-contained: every relative reference in the entry
  // page must exist inside www/.
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const refs = Array.from(html.matchAll(/(?:src|href)="([^"#?]+)"/g))
    .map((m) => m[1])
    .filter((u) => !/^https?:/i.test(u));
  const missing = refs.filter((r) => !fs.existsSync(path.join(WWW, r)));
  console.log('Exported ' + written.length + ' files to mobile/www/');
  for (const w of written) console.log('  ' + w);
  if (missing.length) {
    console.error('\nExport is NOT self-contained, missing: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('\nSelf-contained: all ' + refs.length + ' relative references resolve inside www/.');
  console.log('Next: cd mobile && npm install && npx cap add android && npx cap sync && npx cap open android');
}

main();
