import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const node = process.execPath;
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'friendaix-smoke-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    timeout: 30_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function pack(workspace) {
  const output = run(
    npm,
    [
      'pack',
      `--workspace=${workspace}`,
      `--pack-destination=${temporaryDirectory}`,
      '--json',
      '--ignore-scripts',
    ],
    { cwd: process.cwd() },
  );
  return join(temporaryDirectory, JSON.parse(output)[0].filename);
}

try {
  const corePackage = pack('friendaix-core');
  const cliPackage = pack('friendaix');
  run(npm, ['init', '-y']);
  run(npm, [
    'install',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    corePackage,
    cliPackage,
  ]);
  const cliPackageJson = JSON.parse(
    readFileSync(
      join(temporaryDirectory, 'node_modules/friendaix/package.json'),
    ),
  );
  const cliPath = join(
    temporaryDirectory,
    'node_modules/friendaix/dist/cli.js',
  );
  const version = run(node, [cliPath, '--version']).trim();
  if (version !== cliPackageJson.version) {
    throw new Error(
      `version mismatch: expected ${cliPackageJson.version}, got ${version}`,
    );
  }
  const help = run(node, [cliPath, '--help']);
  if (!help.includes('friendaix configure')) {
    throw new Error('CLI help smoke test failed');
  }
  console.log(
    `friendaix ${version}: tarball install and CLI smoke test passed`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
