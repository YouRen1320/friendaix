import { spawnSync } from 'node:child_process';

// Execute npm's JavaScript entrypoint so package checks do not depend on a platform shell.
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Run package checks through the npm script');
}
const expectations = new Map([
  [
    'friendaix-core',
    ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE'],
  ],
  ['friendaix', ['dist/cli.js', 'README.md', 'LICENSE']],
]);

for (const [workspace, requiredFiles] of expectations) {
  const result = spawnSync(
    process.execPath,
    [
      npmCli,
      'pack',
      `--workspace=${workspace}`,
      '--dry-run',
      '--json',
      '--ignore-scripts',
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${result.error ?? ''}\n${result.stderr || `npm pack failed for ${workspace}`}`,
    );
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
