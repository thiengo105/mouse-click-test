/**
 * Collects Tauri's raw build output into `dist/` under a consistent name.
 *
 * Tauri is invoked with `--no-bundle` on Windows and `--bundles app` on macOS,
 * because the goal is portable artifacts: a bare exe and a zipped .app, not an
 * MSI or a DMG.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const target = process.argv[2];

if (!target) {
  console.error('usage: node tools/package.mjs <rust-target-triple>');
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
const releaseDir = path.join(root, 'src-tauri', 'target', target, 'release');

if (process.platform === 'darwin') {
  const app = path.join(releaseDir, 'bundle', 'macos', 'Mouse Click Test.app');
  if (!fs.existsSync(app)) throw new Error(`missing bundle: ${app}`);

  const arch = target.startsWith('universal') ? 'universal' : target.split('-')[0];
  const out = path.join(dist, `MouseClickTest-${version}-mac-${arch}.zip`);
  fs.rmSync(out, { force: true });

  // ditto rather than zip: it preserves the bundle's symlinks and resource
  // forks, which a plain zip mangles.
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, out], { stdio: 'inherit' });
  report(out);
} else if (process.platform === 'win32') {
  const exe = path.join(releaseDir, 'mouse-click-test.exe');
  if (!fs.existsSync(exe)) throw new Error(`missing binary: ${exe}`);

  const arch = target.startsWith('aarch64') ? 'arm64' : 'x64';
  const out = path.join(dist, `MouseClickTest-${version}-win-${arch}.exe`);
  fs.copyFileSync(exe, out);
  report(out);
} else {
  console.error(`unsupported platform: ${process.platform} (macOS and Windows only)`);
  process.exit(1);
}

function report(file) {
  const mb = fs.statSync(file).size / 1024 / 1024;
  console.log(`${path.relative(root, file)}  ${mb.toFixed(1)} MB`);
}
