import * as esbuild from 'esbuild';

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
