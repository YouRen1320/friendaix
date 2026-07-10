import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    '--no-audit',
    '--no-fund',
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
  const invalid = spawnSync(node, [cliPath, 'not-a-command'], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: temporaryDirectory },
  });
  if (
    invalid.status === 0 ||
    !invalid.stderr.includes('未知命令：not-a-command')
  ) {
    throw new Error(
      `CLI invalid-command smoke test failed\n${invalid.stdout}\n${invalid.stderr}`,
    );
  }
  writeFileSync(
    join(temporaryDirectory, 'consumer.mts'),
    `import {
  type AdapterPlan,
  readOptionalTextFileWithExpectation,
} from 'friendaix-core';

const read = await readOptionalTextFileWithExpectation('/tmp/example');
const plan: AdapterPlan = {
  clientId: 'example',
  clientName: 'Example',
  warnings: [],
  writes: [{
    clientId: 'example',
    path: '/tmp/example',
    content: read.content ?? '',
    containsSecret: false,
    expected: read.expectation,
  }],
};
void plan;
`,
  );
  writeFileSync(
    join(temporaryDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          types: [],
        },
        files: ['consumer.mts'],
      },
      null,
      2,
    )}\n`,
  );
  run(node, [
    join(process.cwd(), 'node_modules/typescript/bin/tsc'),
    '--project',
    join(temporaryDirectory, 'tsconfig.json'),
  ]);
  console.log(
    `friendaix ${version}: tarball install, CLI, and public types passed`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
