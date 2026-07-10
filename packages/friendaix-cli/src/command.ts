import { isCancel, log, select } from '@clack/prompts';
import { errorMessage, recoverInterruptedOperations } from 'friendaix-core';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { needsStartupMaintenance, parseCliArgs } from './args.js';
import { renderBanner } from './banner.js';
import { adapterContext, ALL_CLIENTS } from './clients.js';
import { runDoctor } from './flows/doctor.js';
import { runQuickSetup } from './flows/quick-setup.js';
import { runRestoreBackup } from './flows/restore-backup.js';
import { runSelectSite } from './flows/select-site.js';
import { VERSION } from './preset.js';
import { backupDir, migrateLegacyState } from './state.js';

type MenuAction = 'configure' | 'site' | 'restore' | 'doctor' | 'exit';

async function runStartupMaintenance(): Promise<void> {
  const homeDir = homedir();
  const context = adapterContext(homeDir);
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

export async function runCommand(args: string[]): Promise<void> {
  const command = parseCliArgs(args);
  if (command.action === 'help') {
    printHelp();
    return;
  }
  if (command.action === 'version') {
    console.log(VERSION);
    return;
  }

  if (needsStartupMaintenance(command)) await runStartupMaintenance();
  if (command.action === 'menu') {
    await runInteractiveMenu();
    return;
  }
  if (command.action === 'configure') {
    console.log(renderBanner());
    console.log();
    await runQuickSetup({
      dryRun: command.dryRun,
      skipProbe: command.skipProbe,
    });
    return;
  }
  if (command.action === 'restore') await runRestoreBackup();
  else if (command.action === 'sites') await runSelectSite();
  else await runDoctor();
}
