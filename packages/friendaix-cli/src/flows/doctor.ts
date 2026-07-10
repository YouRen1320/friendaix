import { homedir } from 'node:os';
import { intro, note, outro, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { pathExists, scanBackups } from 'friendaix-core';
import { adapterContext, ALL_CLIENTS } from '../clients.js';
import { pingAll } from '../sites.js';
import { backupDir, stateFile } from '../state.js';

function nodeVersionOk(): boolean {
  const [major = 0, minor = 0] = process.versions.node
    .split('.')
    .map((value) => Number.parseInt(value, 10));
  return major > 20 || (major === 20 && minor >= 12);
}

export async function runDoctor(homeDir = homedir()): Promise<void> {
  const context = adapterContext(homeDir);
  intro(pc.cyan(' 环境诊断 '));
  const networkSpinner = spinner();
  networkSpinner.start('检查服务线路');
  const sites = await pingAll();
  networkSpinner.stop('线路检查完成');

  const lines = [
    `${nodeVersionOk() ? pc.green('✓') : pc.red('✗')} Node.js ${process.versions.node}（需要 >=20.12）`,
    `${(await pathExists(stateFile(homeDir))) ? pc.green('✓') : pc.dim('•')} FriendAIX state`,
  ];
  for (const site of sites) {
    lines.push(
      `${site.ok ? pc.green('✓') : pc.red('✗')} ${site.site.name}${site.ok ? ` ${site.latencyMs}ms` : ` ${site.error ?? ''}`}`,
    );
  }
  for (const client of ALL_CLIENTS) {
    const files = client.configFiles(context);
    const existing = (
      await Promise.all(files.map((path) => pathExists(path)))
    ).filter(Boolean).length;
    lines.push(
      `${existing > 0 ? pc.green('✓') : pc.dim('•')} ${client.name} 配置文件 ${existing} 个`,
    );
  }
  const backups = (await scanBackups(backupDir(homeDir))).filter(
    ({ manifest }) => manifest.kind === 'configuration',
  );
  const restorable = backups.filter(
    ({ manifest }) => manifest.status === 'applied',
  ).length;
  const interrupted = backups.filter(
    ({ manifest }) => manifest.status === 'prepared',
  ).length;
  lines.push(`${pc.dim('•')} 可恢复事务快照 ${restorable} 个`);
  if (interrupted > 0) {
    lines.push(
      `${pc.yellow('⚠')} 待恢复的中断操作 ${interrupted} 个（运行交互菜单或配置命令时自动恢复）`,
    );
  }
  note(lines.join('\n'), '诊断结果');
  outro(nodeVersionOk() ? '诊断完成。' : pc.red('请先升级 Node.js。'));
}
