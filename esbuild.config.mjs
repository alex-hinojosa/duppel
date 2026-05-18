import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const target = process.argv[2] || 'content';

// === Step 1: Always build anti-fingerprint.js (shared content script) ===
await esbuild.build({
  entryPoints: ['src/content/anti-fingerprint/index.js'],
  bundle: true,
  outfile: 'anti-fingerprint.js',
  format: 'iife',
  minify: false,
  keepNames: true,
  sourcemap: false,
  target: 'chrome120',
  legalComments: 'inline',
  banner: { js: '// @generated — built from src/content/anti-fingerprint/ by esbuild. DO NOT EDIT.' },
});

if (target === 'content') process.exit(0);

// === Step 2: Assemble platform packages ===

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

// Shared files for both platforms
const SHARED = [
  'anti-fingerprint.js',
  'bridge.js',
  'profiles.js',
  'poisoner.js',
];

function buildChrome() {
  const out = 'build/chrome';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Shared files
  for (const f of SHARED) copyFile(f, path.join(out, f));

  // Chrome-specific
  copyFile('manifest.json', path.join(out, 'manifest.json'));
  copyFile('background.js', path.join(out, 'background.js'));
  copyDir('popup', path.join(out, 'popup'));
  copyDir('icons', path.join(out, 'icons'));
  copyDir('rules', path.join(out, 'rules'));

  console.log(`Chrome build → ${out}/`);
}

function buildFirefox() {
  const out = 'build/firefox';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Shared files
  for (const f of SHARED) copyFile(f, path.join(out, f));

  // Firefox-specific
  copyFile('manifest.firefox.json', path.join(out, 'manifest.json'));
  copyFile('background.firefox.js', path.join(out, 'background.firefox.js'));
  copyFile('web-request-rules.js', path.join(out, 'web-request-rules.js'));
  copyDir('popup', path.join(out, 'popup'));
  copyDir('icons', path.join(out, 'icons'));
  // No rules/ directory — webRequest handles it

  console.log(`Firefox build → ${out}/`);
}

if (target === 'chrome' || target === 'all') buildChrome();
if (target === 'firefox' || target === 'all') buildFirefox();
