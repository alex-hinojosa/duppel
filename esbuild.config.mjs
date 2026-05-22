import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const target = process.argv[2] || 'content';

// === Step 1: Build anti-fingerprint-bootstrap.js (closure-local function for executeScript) ===
// Round 6: the entire anti-fingerprint bundle becomes a named function
// `bootstrapAntiFingerprint(seed)` that background.js passes to
// chrome.scripting.executeScript({ func, args }). No manifest content script.
const result = await esbuild.build({
  entryPoints: ['src/content/anti-fingerprint/bootstrap-entry.js'],
  bundle: true,
  write: false,
  format: 'iife',
  minify: false,
  keepNames: true,
  sourcemap: false,
  target: 'chrome120',
  legalComments: 'inline',
});

// Post-build: strip the esbuild IIFE wrapper, wrap in a named function definition.
// esbuild produces `(() => { ... })();` — we need `function bootstrapAntiFingerprint(seed) { ... }`.
// The `seed` parameter becomes a closure-local variable visible to all bundled code.
//
// The entry point uses an inner IIFE `(function() { ... })();` to allow `return`
// statements. We keep that inner IIFE intact — it becomes the body of
// bootstrapAntiFingerprint. The `seed` variable is visible inside it via closure
// over the outer function's parameter.
let bootstrapCode = result.outputFiles[0].text;

// Strip esbuild's outer IIFE wrapper. Handle both arrow-function and function forms.
// esbuild output: `(() => {\n  ...code...\n})();\n`
bootstrapCode = bootstrapCode
  .replace(/^\(\(\) => \{\n?/, '')          // strip `(() => {\n`
  .replace(/\n?\}\)\(\);\n?$/, '');         // strip `\n})();\n`

const wrappedBootstrap =
  '// @generated — closure-local bootstrap for executeScript injection. DO NOT EDIT.\n' +
  'function bootstrapAntiFingerprint(seed) {\n' +
  bootstrapCode + '\n' +
  '}\n';

fs.writeFileSync('anti-fingerprint-bootstrap.js', wrappedBootstrap);

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
  'anti-fingerprint-bootstrap.js',
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

// Firefox de-scoped from v0.1.0 (Round 9). Files quarantined as .v02.
// Re-enable for v0.2.0 after Firefox seed architecture is unified with Chrome.

if (target === 'chrome' || target === 'all') buildChrome();
