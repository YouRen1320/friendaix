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

## 安全边界

- 库不会主动联网，也不收集遥测。
- adapter 只生成配置计划；调用方决定何时展示、确认和执行。
- `applyConfiguration` 会在任何写入前备份全部目标文件。
- 写入使用同目录临时文件和原子替换。
- 任一写入失败会回滚本次已经完成的写入。
- 恢复必须传入 `allowedPaths`，恶意或损坏的 manifest 不能写入任意路径。
- POSIX 上备份文件和 manifest 使用 `0600`，备份目录使用 `0700`；Windows 继承用户目录 ACL。

调用方仍需负责：不回显密钥、确认 adapter 的 destructive warning、保护进程环境，以及向用户解释具体服务的数据流。

## 扩展客户端

实现 `ClientAdapter`：

- `configFiles(context)` 返回 adapter 管理的绝对路径。
- `isInstalled(context)` 只用于 UX 提示。
- `plan(input, context)` 读取现有配置并返回完整 `AdapterPlan`。
- 不要在 `plan` 内写文件或调用外部服务。
- 含密钥的 `PlannedWrite` 必须设置 `containsSecret: true`。

完整设计见仓库的 [`docs/architecture.md`](../../docs/architecture.md)。

## License

MIT © 2026 YouR.AI
