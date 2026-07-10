import { homedir } from 'node:os';
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  password,
  select,
  spinner,
} from '@clack/prompts';
import pc from 'picocolors';
import {
  applyConfiguration,
  errorMessage,
  pathExists,
  type AdapterContext,
  type AdapterPlan,
  type ConfigureInput,
} from 'friendaix-core';
import { fetchModels, probeClaude, probeCodex, probeOpenCode } from '../api.js';
import { ALL_CLIENTS } from '../clients.js';
import { claudeModels, resolveModels } from '../models.js';
import { TOKEN_PORTAL_URL } from '../preset.js';
import { chooseSite, pingAll } from '../sites.js';
import { backupDir, readState, writeState } from '../state.js';

export interface QuickSetupOptions {
  dryRun?: boolean;
  skipProbe?: boolean;
  homeDir?: string;
}

export async function runQuickSetup(
  options: QuickSetupOptions = {},
): Promise<void> {
  const homeDir = options.homeDir ?? homedir();
  const context: AdapterContext = { homeDir };
  const state = await readState(homeDir);
  intro(pc.cyan(options.dryRun ? ' 配置预览（不会写入） ' : ' 快速配置 '));

  const speedSpinner = spinner();
  speedSpinner.start('正在检查线路');
  const results = await pingAll();
  speedSpinner.stop('线路检查完成');
  note(
    results
      .map((result) =>
        result.ok
          ? `  ${pc.green('✓')} ${result.site.name}  ${pc.dim(`${result.latencyMs}ms`)}`
          : `  ${pc.red('✗')} ${result.site.name}  ${pc.red(result.error ?? '不可达')}`,
      )
      .join('\n'),
    '线路状态',
  );

  const selectedSite = chooseSite(results, state.selectedSite);
  if (!selectedSite) {
    cancel('没有可用线路，未修改任何配置。');
    return;
  }
  log.success(`使用 ${selectedSite.site.name} (${selectedSite.latencyMs}ms)`);

  const installation = new Map(
    await Promise.all(
      ALL_CLIENTS.map(
        async (client) =>
          [client.id, await client.isInstalled(context)] as const,
      ),
    ),
  );
  const previousClients = state.clientsConfigured?.filter((id) =>
    ALL_CLIENTS.some((client) => client.id === id),
  );
  const detectedClients = ALL_CLIENTS.filter((client) =>
    installation.get(client.id),
  ).map((client) => client.id);
  const selected = await multiselect({
    message: '选择要配置的工具 [空格选择 / Enter 确认]',
    options: ALL_CLIENTS.map((client) => ({
      value: client.id,
      label: client.name,
      hint: installation.get(client.id) ? '检测到配置目录' : '尚未检测到',
    })),
    initialValues: previousClients?.length
      ? previousClients
      : detectedClients.length
        ? detectedClients
        : ALL_CLIENTS.map((client) => client.id),
    required: true,
  });
  if (isCancel(selected)) {
    cancel('已取消，未修改任何配置。');
    return;
  }
  const selectedIds = selected as string[];

  note(
    `密钥只会写入所选客户端的配置文件，不再保存到 FriendAIX state。\n获取地址：${pc.cyan(TOKEN_PORTAL_URL)}`,
    'API Key',
  );
  const apiKey = await password({
    message: '请输入 API Key（输入不会回显）',
    mask: '•',
    validate: (value) =>
      (value ?? '').trim().length >= 10 ? undefined : 'API Key 太短了',
  });
  if (isCancel(apiKey)) {
    cancel('已取消，未修改任何配置。');
    return;
  }
  const key = (apiKey ?? '').trim();

  const modelSpinner = spinner();
  modelSpinner.start('正在读取服务端模型清单');
  const models = await fetchModels(selectedSite.site.baseUrl, key);
  modelSpinner.stop(
    models
      ? `读取到 ${models.length} 个模型`
      : '无法读取模型清单，将使用兼容默认值',
  );

  let selectedClaudeModel: string | undefined;
  if (selectedIds.includes('claude') && models) {
    const candidates = claudeModels(models);
    if (candidates.length > 0) {
      const selection = await select<string>({
        message: 'Claude Code 默认对话模型',
        options: candidates.map((model) => ({
          value: model.id,
          label: model.displayName ?? model.id,
        })),
        initialValue: candidates[0]?.id,
      });
      if (isCancel(selection)) {
        cancel('已取消，未修改任何配置。');
        return;
      }
      selectedClaudeModel = selection;
    }
  }
  const resolvedModels = resolveModels(models, selectedClaudeModel);

  const plans: AdapterPlan[] = [];
  for (const id of selectedIds) {
    const client = ALL_CLIENTS.find((candidate) => candidate.id === id);
    if (!client) continue;
    const modelInput: ConfigureInput = {
      baseUrl: selectedSite.site.baseUrl,
      apiKey: key,
      availableModels: models ?? undefined,
      ...(id === 'claude'
        ? {
            primaryModel: resolvedModels.claudePrimary,
            smallModel: resolvedModels.claudeSmall,
          }
        : id === 'opencode'
          ? {
              primaryModel: resolvedModels.openCodePrimary,
              smallModel: resolvedModels.openCodeSmall,
            }
          : {}),
    };
    plans.push(await client.plan(modelInput, context));
  }

  const destructiveWarnings = plans
    .flatMap((plan) => plan.warnings)
    .filter((warning) => warning.destructive);
  if (destructiveWarnings.length > 0) {
    note(
      destructiveWarnings.map((warning) => `• ${warning.message}`).join('\n'),
      '需要确认的登录变更',
    );
    const approved = await confirm({
      message: '确认执行以上变更？所有旧文件会先进入事务备份。',
    });
    if (isCancel(approved) || !approved) {
      cancel('已取消，未修改任何配置。');
      return;
    }
  }

  const planLines: string[] = [];
  for (const plan of plans) {
    for (const write of plan.writes) {
      planLines.push(
        `  ${(await pathExists(write.path)) ? '修改' : '新建'}  ${write.path}`,
      );
    }
  }
  note(planLines.join('\n'), options.dryRun ? '变更预览' : '即将写入');
  if (options.dryRun) {
    outro(pc.green('预览完成，没有写入文件。'));
    return;
  }

  const applySpinner = spinner();
  applySpinner.start('正在创建事务备份并写入配置');
  let backup;
  try {
    backup = await applyConfiguration(plans, {
      backupRoot: backupDir(homeDir),
    });
    applySpinner.stop(`${pc.green('✓')} 配置写入完成`);
  } catch (error: unknown) {
    applySpinner.stop(`${pc.red('✗')} ${errorMessage(error)}`);
    throw error;
  }

  if (!options.skipProbe) {
    note(
      '以下自检会向所选模型发送一个极小请求，可能产生极少量 API 费用。',
      '连接自检',
    );
    for (const id of selectedIds) {
      const probeSpinner = spinner();
      const name = ALL_CLIENTS.find((client) => client.id === id)?.name ?? id;
      probeSpinner.start(`自检 ${name}`);
      const result =
        id === 'claude'
          ? await probeClaude(
              selectedSite.site.baseUrl,
              key,
              resolvedModels.claudePrimary,
            )
          : id === 'codex'
            ? await probeCodex(
                selectedSite.site.baseUrl,
                key,
                resolvedModels.codexProbe,
              )
            : await probeOpenCode(
                selectedSite.site.baseUrl,
                key,
                resolvedModels.openCodePrimary,
              );
      probeSpinner.stop(
        result.ok
          ? `${pc.green('✓')} ${name} 自检通过 (HTTP ${result.status})`
          : `${pc.yellow('⚠')} ${name} 自检未通过：${result.hint}`,
      );
    }
  }

  await writeState(
    {
      selectedSite: selectedSite.site.id,
      clientsConfigured: selectedIds,
    },
    homeDir,
  );
  outro(`${pc.green('配置完成 ✓')}\n备份：${pc.dim(backup.directory)}`);
}
