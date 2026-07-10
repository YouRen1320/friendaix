import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectations = new Map([
  [
    'friendaix-core',
    ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE'],
  ],
  ['friendaix', ['dist/cli.js', 'README.md', 'LICENSE']],
]);

for (const [workspace, requiredFiles] of expectations) {
  const result = spawnSync(
    npm,
    [
      'pack',
      `--workspace=${workspace}`,
      '--dry-run',
      '--json',
      '--ignore-scripts',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `npm pack failed for ${workspace}`);
  }
  const report = JSON.parse(result.stdout)[0];
  const files = new Set(report.files.map((file) => file.path));
  for (const required of requiredFiles) {
    if (!files.has(required)) {
      throw new Error(`${workspace} package is missing ${required}`);
    }
  }
  if (workspace === 'friendaix') {
    const cli = report.files.find((file) => file.path === 'dist/cli.js');
    if (!cli || (cli.mode & 0o111) === 0) {
      throw new Error('friendaix dist/cli.js is not executable');
    }
  }
  console.log(`${workspace}: ${report.entryCount} files, package contents OK`);
}
