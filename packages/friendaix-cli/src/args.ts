export type ParsedCliCommand =
  | { action: 'menu' }
  | { action: 'help' }
  | { action: 'version' }
  | { action: 'configure'; dryRun: boolean; skipProbe: boolean }
  | { action: 'restore' | 'sites' | 'doctor' };

/** Validates arguments before startup maintenance is allowed to touch user files. */
export function parseCliArgs(args: string[]): ParsedCliCommand {
  const [command, ...flags] = args;
  if (!command) return { action: 'menu' };

  if (command === '--help' || command === '-h' || command === 'help') {
    if (flags.length) throw new Error(`命令 ${command} 不接受参数。`);
    return { action: 'help' };
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    if (flags.length) throw new Error(`命令 ${command} 不接受参数。`);
    return { action: 'version' };
  }
  if (command === 'configure') {
    const allowed = new Set(['--dry-run', '--skip-probe']);
    const unknown = flags.filter((flag) => !allowed.has(flag));
    if (unknown.length) throw new Error(`未知参数：${unknown.join(', ')}`);
    return {
      action: 'configure',
      dryRun: flags.includes('--dry-run'),
      skipProbe: flags.includes('--skip-probe'),
    };
  }
  if (command === 'restore' || command === 'sites' || command === 'doctor') {
    if (flags.length) throw new Error(`命令 ${command} 不接受参数。`);
    return { action: command };
  }
  throw new Error(`未知命令：${command}。使用 friendaix --help 查看帮助。`);
}

/** Read-only commands must not trigger migration or interrupted-write recovery. */
export function needsStartupMaintenance(command: ParsedCliCommand): boolean {
  return !(
    command.action === 'help' ||
    command.action === 'version' ||
    command.action === 'doctor' ||
    (command.action === 'configure' && command.dryRun)
  );
}
