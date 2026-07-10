import { homedir } from 'node:os';
import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
} from '@clack/prompts';
import pc from 'picocolors';
import {
  errorMessage,
  restoreOperation,
  restoreOriginal,
  scanBackups,
  type AdapterContext,
} from 'friendaix-core';
import { ALL_CLIENTS } from '../clients.js';
import { backupDir } from '../state.js';

type RestoreAction = 'original' | 'operation' | 'back';

function allowedConfigPaths(context: AdapterContext): string[] {
  return ALL_CLIENTS.flatMap((client) => client.configFiles(context));
}

export async function runRestoreBackup(homeDir = homedir()): Promise<void> {
  const context: AdapterContext = { homeDir };
  const root = backupDir(homeDir);
  intro(pc.cyan(' 恢复配置 '));

  const backups = (await scanBackups(root)).filter(
    ({ manifest }) =>
      manifest.kind === 'configuration' && manifest.status === 'applied',
  );
  if (backups.length === 0) {
    note(
      `没有可恢复的 0.3 版事务备份。\n目录：${root}\n\n0.2 及更早版本的旧目录不会被删除，请参阅迁移说明手动处理。`,
      '没有备份',
    );
    outro('返回');
    return;
  }

  const action = await select<RestoreAction>({
    message: '选择恢复方式',
    options: [
      {
        value: 'original',
        label: '恢复所有受管文件到最早记录状态',
        hint: '原来不存在的文件会被删除',
      },
      {
        value: 'operation',
        label: '恢复到某次配置操作之前',
        hint: `${backups.length} 个可用快照`,
      },
      { value: 'back', label: '返回' },
    ],
  });
  if (isCancel(action) || action === 'back') {
    outro('返回');
    return;
  }

  let selectedDirectory: string | undefined;
  if (action === 'operation') {
    const selected = await select<string>({
      message: '选择配置操作',
      options: [...backups].reverse().map(({ directory, manifest }) => ({
        value: directory,
        label: new Date(manifest.createdAt).toLocaleString(),
        hint: manifest.clients
          .map(
            (id) => ALL_CLIENTS.find((client) => client.id === id)?.name ?? id,
          )
          .join('、'),
      })),
    });
    if (isCancel(selected)) {
      cancel('已取消，未修改任何配置。');
      return;
    }
    selectedDirectory = selected;
  }

  note(
    action === 'original'
      ? '将组合每个受管文件的最早快照。原来不存在的文件会被删除。恢复前会再创建一份当前状态安全备份。'
      : '将恢复所选操作开始前的完整状态。恢复前会再创建一份当前状态安全备份。',
    '恢复计划',
  );
  const approved = await confirm({ message: '确认执行恢复？' });
  if (isCancel(approved) || !approved) {
    cancel('已取消，未修改任何配置。');
    return;
  }

  const restoreSpinner = spinner();
  restoreSpinner.start('正在创建安全备份并恢复');
  try {
    const options = {
      backupRoot: root,
      allowedPaths: allowedConfigPaths(context),
    };
    const result =
      action === 'original'
        ? await restoreOriginal(options)
        : await restoreOperation(selectedDirectory!, options);
    restoreSpinner.stop(`${pc.green('✓')} 恢复完成`);
    note(
      [
        `恢复文件：${result.restored.length}`,
        `删除新建文件：${result.removed.length}`,
        `恢复前安全备份：${result.safetyBackup.directory}`,
      ].join('\n'),
      '恢复结果',
    );
    outro(pc.green('配置已恢复。'));
  } catch (error: unknown) {
    restoreSpinner.stop(`${pc.red('✗')} ${errorMessage(error)}`);
    throw error;
  }
}
