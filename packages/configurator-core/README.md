# friendaix-core

`friendaix-core` 是 FriendAIX 提取出的通用配置引擎。它提供 Claude Code、Codex CLI、OpenCode adapter，以及原子写入、事务备份、回滚和恢复能力，不包含 FriendAIX 域名、品牌或交互界面。

## 安装

```bash
npm install friendaix-core
```

需要 Node.js 20.12 或更高版本。

## 示例

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  applyConfiguration,
  createClaudeAdapter,
  restoreOperation,
} from 'friendaix-core';

const context = { homeDir: homedir() };
const adapter = createClaudeAdapter({
  defaultModel: 'claude-sonnet-4-6',
  defaultSmallModel: 'claude-haiku-4-5',
});

const plan = await adapter.plan(
  {
    baseUrl: 'https://gateway.example.com/v1',
    apiKey: process.env.GATEWAY_API_KEY!,
    primaryModel: 'claude-sonnet-4-6',
    smallModel: 'claude-haiku-4-5',
  },
  context,
);

// 应由调用方先展示 plan.writes 和 plan.warnings，并确认破坏性警告。
const backup = await applyConfiguration([plan], {
  backupRoot: join(homedir(), '.my-configurator', 'backups'),
});

// 恢复该次操作开始前的状态。
await restoreOperation(backup.directory, {
  backupRoot: join(homedir(), '.my-configurator', 'backups'),
  allowedPaths: adapter.configFiles(context),
});
```

如果调用进程需要遵循客户端的自定义配置目录，可显式传入环境快照和平台：

```ts
const context = {
  homeDir: homedir(),
  environment: process.env,
  platform: process.platform,
};
```

内置 adapter 会识别 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`OPENCODE_CONFIG_DIR`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`，以及 Windows 的 `LOCALAPPDATA`。覆盖目录必须是绝对路径；不传 `environment` 时不会读取调用进程的环境变量。

## 安全边界

- 库不会主动联网，也不收集遥测。
- adapter 只生成配置计划；调用方决定何时展示、确认和执行。
- `applyConfiguration` 会在任何写入前备份全部目标文件。
- 计划带有 adapter 读取内容的 SHA-256 前置条件；文件在计划后变化时会拒绝覆盖。
- 写入使用同目录临时文件和原子替换。
- 任一写入失败会回滚本次已经完成的写入。
- 恢复必须传入 `allowedPaths`，恶意或损坏的 manifest 不能写入任意路径。
- 配置和备份内容必须是普通文件；符号链接、目录和其他特殊文件会被拒绝，避免链接替换与备份源跳转。
- adapter 会拒绝空密钥、空模型，以及带账号、查询参数或片段的非 HTTP(S) 服务地址。
- POSIX 上备份文件和 manifest 使用 `0600`，备份目录使用 `0700`；Windows 继承用户目录 ACL。

调用方仍需负责：不回显密钥、确认 adapter 的 destructive warning、保护进程环境，以及向用户解释具体服务的数据流。

## 扩展客户端

实现 `ClientAdapter`：

- `configFiles(context)` 返回 adapter 管理的绝对路径。
- `isInstalled(context)` 只用于 UX 提示。
- `plan(input, context)` 读取现有配置并返回完整 `AdapterPlan`。
- 不要在 `plan` 内写文件或调用外部服务。
- 含密钥的 `PlannedWrite` 必须设置 `containsSecret: true`。
- 每个 `PlannedWrite.expected` 必须对应生成内容时读取的同一份原始字节；文本配置可使用核心库导出的 `readOptionalTextFileWithExpectation()`。

自定义 adapter 读取与计划的关键部分如下：

```ts
import { readOptionalTextFileWithExpectation } from 'friendaix-core';

const current = await readOptionalTextFileWithExpectation(configPath);
const nextContent = mergeYourConfig(current.content ?? '');

return {
  clientId: 'my-client',
  clientName: 'My Client',
  warnings: [],
  writes: [
    {
      clientId: 'my-client',
      path: configPath,
      content: nextContent,
      containsSecret: false,
      expected: current.expectation,
    },
  ],
};
```

完整设计见仓库的 [`docs/architecture.md`](https://github.com/YouRen1320/friendaix/blob/main/docs/architecture.md)。

## License

MIT © 2026 YouR.AI
