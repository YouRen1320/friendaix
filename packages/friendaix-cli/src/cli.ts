import { select, isCancel, log } from '@clack/prompts';
import pc from 'picocolors';
import {
  errorMessage,
  recoverInterruptedOperations,
  type AdapterContext,
} from 'friendaix-core';
import { homedir } from 'node:os';
import { renderBanner } from './banner.js';
import { runDoctor } from './flows/doctor.js';
import { runQuickSetup } from './flows/quick-setup.js';
import { runRestoreBackup } from './flows/restore-backup.js';
import { runSelectSite } from './flows/select-site.js';
import { VERSION } from './preset.js';
import { backupDir, migrateLegacyState } from './state.js';
import { ALL_CLIENTS } from './clients.js';

type MenuAction = 'configure' | 'site' | 'restore' | 'doctor' | 'exit';

async function runStartupMaintenance(): Promise<void> {
  const homeDir = homedir();
  const context: AdapterContext = { homeDir };
  const migrated = await migrateLegacyState(homeDir);
  const recovered = await recoverInterruptedOperations({
    backupRoot: backupDir(homeDir),
    allowedPaths: ALL_CLIENTS.flatMap((client) => client.configFiles(context)),
  });
  if (migrated) {
    console.warn(pc.yellow('已从旧 state 中移除重复保存的 API Key。'));
  }
  if (recovered.length > 0) {
    console.warn(
      pc.yellow(`检测到 ${recovered.length} 次中断操作，已自动回滚。`),
    );
  }
}

function printHelp(): void {
  console.log(`friendaix ${VERSION}

安全配置 Claude Code、Codex CLI 和 OpenCode。

用法:
  friendaix                      打开交互主菜单
  friendaix configure            配置所选客户端
  friendaix configure --dry-run  只显示变更计划
  friendaix configure --skip-probe  跳过会产生少量费用的 API 自检
  friendaix restore              恢复事务备份
  friendaix sites                选择默认线路
  friendaix doctor               检查环境、线路和配置
  friendaix --version            显示版本
  friendaix --help               显示帮助
`);
}

async function runInteractiveMenu(): Promise<void> {
  console.log(renderBanner());
  console.log();
  while (true) {
    const action = await select<MenuAction>({
      message: '请选择操作',
      options: [
        { value: 'configure', label: '快速配置' },
        { value: 'site', label: '选择默认线路' },
        { value: 'restore', label: '恢复备份' },
        { value: 'doctor', label: '环境诊断' },
        { value: 'exit', label: '退出' },
      ],
    });
    if (isCancel(action) || action === 'exit') break;
    try {
      if (action === 'configure') await runQuickSetup();
      else if (action === 'site') await runSelectSite();
      else if (action === 'restore') await runRestoreBackup();
      else await runDoctor();
    } catch (error: unknown) {
      log.error(errorMessage(error));
    }
    console.log();
  }
  console.log(pc.dim('Bye 👋'));
}

async function runCommand(args: string[]): Promise<void> {
  const [command, ...flags] = args;
  if (!command) {
    await runStartupMaintenance();
    await runInteractiveMenu();
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
    return;
  }
  await runStartupMaintenance();
  if (command === 'configure') {
    const allowed = new Set(['--dry-run', '--skip-probe']);
    const unknown = flags.filter((flag) => !allowed.has(flag));
    if (unknown.length) throw new Error(`未知参数：${unknown.join(', ')}`);
    console.log(renderBanner());
    console.log();
    await runQuickSetup({
      dryRun: flags.includes('--dry-run'),
      skipProbe: flags.includes('--skip-probe'),
    });
    return;
  }
  if (flags.length) throw new Error(`命令 ${command} 不接受参数。`);
  if (command === 'restore') await runRestoreBackup();
  else if (command === 'sites') await runSelectSite();
  else if (command === 'doctor') await runDoctor();
  else
    throw new Error(`未知命令：${command}。使用 friendaix --help 查看帮助。`);
}

runCommand(process.argv.slice(2)).catch((error: unknown) => {
  console.error(pc.red(`错误：${errorMessage(error)}`));
  process.exitCode = 1;
});
