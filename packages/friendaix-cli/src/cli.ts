import { errorMessage } from 'friendaix-core';
import pc from 'picocolors';
import { runCommand } from './command.js';

runCommand(process.argv.slice(2)).catch((error: unknown) => {
  console.error(pc.red(`错误：${errorMessage(error)}`));
  process.exitCode = 1;
});
