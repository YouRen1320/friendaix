# FriendAIX

FriendAIX 是一个安全配置 Claude Code、Codex CLI 和 OpenCode 的交互式命令行工具，同时提供可复用的事务配置核心库。

```bash
npx friendaix@latest
```

> 当前仓库中的 0.3.0 尚未发布到 npm。npm `latest` 在正式发布前仍指向 0.2.3。

## 为什么有两个包

| 包                                               | 用途                                             |
| ------------------------------------------------ | ------------------------------------------------ |
| [`friendaix`](./packages/friendaix-cli)          | FriendAIX 品牌、站点、模型选择和交互式 CLI       |
| [`friendaix-core`](./packages/configurator-core) | 可复用的客户端 adapter、原子写入、事务备份和恢复 |

品牌、服务地址和默认模型只存在于 CLI preset；文件事务和客户端配置能力可以被其他项目直接复用。

## CLI 用法

CLI 运行需要 Node.js 20.12 或更高版本。

```bash
friendaix                       # 交互主菜单
friendaix configure             # 配置客户端
friendaix configure --dry-run   # 只查看文件变更，不写入或执行启动恢复
friendaix configure --skip-probe # 跳过 API 自检
friendaix restore               # 恢复事务备份
friendaix sites                 # 选择默认线路
friendaix doctor                # 只读环境诊断
friendaix --help
friendaix --version
```

配置步骤：

1. 检查线路并使用已保存的健康默认线路。
2. 选择客户端。
3. 通过不回显的密码输入框输入 API Key。
4. 从服务端读取可用模型，避免写入不存在的硬编码模型。
5. 展示完整文件计划；替换 Codex ChatGPT 登录等破坏性变更需要再次确认。
6. 创建整次操作事务备份并原子写入所有文件。
7. 可选地发送极小 API 请求做连接自检。

## 会修改哪些文件

| 客户端      | 文件                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/settings.json`                                                                   |
| Codex CLI   | `~/.codex/auth.json`、`~/.codex/config.toml`                                                |
| OpenCode    | `~/.local/share/opencode/auth.json`、`~/.config/opencode/opencode.json` 或 `opencode.jsonc` |

表中是默认位置。CLI 同时遵循 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`OPENCODE_CONFIG_DIR`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME` 和 Windows `LOCALAPPDATA`；自定义目录必须是绝对路径。

FriendAIX 自己只保存非敏感状态到 `~/.friendaix/state.json`。API Key 不会保存在 FriendAIX state 中。

事务备份位于 `~/.friendaix/backups/<operation-id>/`：

- `manifest.json` 记录目标文件原来是否存在、权限和 SHA-256。
- 已存在文件的原内容存放在私有 `files/` 目录。
- 原来不存在的文件在恢复时会被删除，而不是遗留在用户目录中。
- 恢复前会再备份一次当前状态，恢复失败会尝试自动回滚。
- adapter 读取文件时会记录 SHA-256；应用计划前若文件已被其他程序修改，FriendAIX 会拒绝覆盖并要求重新生成计划。

在 POSIX 系统上，含密钥的配置文件、state 和备份使用 `0600`，FriendAIX 状态及备份目录使用 `0700`。Windows 上 Node.js 的 `chmod` 不能表达完整 NTFS ACL，文件会继承当前用户目录的访问控制。

为避免原子替换破坏 dotfiles 管理关系，0.3.0 只修改普通文件；如果受管配置路径是符号链接或其他特殊文件，FriendAIX 会拒绝写入并保留原状。请直接配置链接指向的真实文件，或在运行前改回普通文件。

## 安全和数据流

- FriendAIX 不包含遥测。
- API Key 只发送给所选 FriendAIX API 站点，并写入所选客户端的官方配置位置。
- `/models` 请求用于读取模型清单。
- 配置自检会发送一个极小请求，可能产生极少量 API 费用；可用 `--skip-probe` 跳过。
- `doctor` 和 `configure --dry-run` 不执行 state 迁移或中断事务恢复；普通配置、恢复、线路和交互菜单启动时才执行维护。
- Codex 如果当前使用 ChatGPT 登录，切换到 FriendAIX API Key 会移除本地 OAuth token。CLI 会在执行前明确提示，事务备份可恢复原 `auth.json`。
- OpenCode 密钥写入其独立 credential store，普通 `opencode.json` 只保存 provider、地址和模型。
- OpenCode 同时存在 JSON 与 JSONC 时会更新高优先级的 JSONC，并从旧 JSON 中移除 FriendAIX 明文密钥；其他 JSONC 注释保持不变。
- 不要提交 `~/.claude`、`~/.codex`、`~/.config/opencode`、`~/.local/share/opencode` 或 `~/.friendaix` 中的任何文件。

安全问题请参阅 [SECURITY.md](./SECURITY.md)，从 0.2 升级请参阅 [MIGRATION.md](./MIGRATION.md)。

## 开发

开发和完整测试需要 Node.js 20.19 或更高版本（当前 Vite/Vitest/ESLint 工具链要求）；CI 另用已构建 tarball 验证 Node.js 20.12 运行兼容性。

```bash
npm ci
npm run check
npm test
npm run build
npm run pack:check
npm run smoke
```

测试全部使用临时 HOME，不会读取或修改开发者的真实 AI 客户端配置。

架构和扩展方式见 [docs/architecture.md](./docs/architecture.md)，贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 发布

包发布通过 `.github/workflows/publish.yml` 使用 npm Trusted Publishing/OIDC，不在仓库或本地 `.npmrc` 保存长期写入 token。正式启用前，维护者需要：

1. 创建 `YouRen1320/friendaix` 公共仓库。
2. 创建受保护的 GitHub `npm` environment。
3. `friendaix` 已存在，可直接在 npm 配置 Trusted Publisher：工作流文件名 `publish.yml`、environment `npm`、allowed action 选择 `npm publish`。
4. npm 只允许给已存在的包配置 Trusted Publisher。首次创建 `friendaix-core` 时，在仓库的临时 clone 中把 core 版本改成 `0.3.0-bootstrap.0`，使用账号 2FA 手工发布到 `bootstrap` tag；不要在正式工作树中改版本，也不要把 token 写进仓库。
5. 为已创建的 `friendaix-core` 配置与第 3 步相同的 Trusted Publisher。确认两个包的 trust 后，再创建 `v0.3.0` GitHub Release；工作流会先发布 core，再发布 CLI。

首次 bootstrap 示例（只在临时 clone 中执行）：

```bash
npm ci
npm run build --workspace=friendaix-core
npm pkg set version=0.3.0-bootstrap.0 --workspace=friendaix-core
npm publish --workspace=friendaix-core --access public --tag bootstrap
```

发布工作流固定使用 npm 11.18.0，校验三处版本、包内容、公共类型、生产依赖审计和完整测试后才执行 `npm publish`。

## License

[MIT](./LICENSE) © 2026 YouR.AI

FriendAIX 是独立开源项目，与 Anthropic、OpenAI 或 OpenCode/Anomaly 没有官方隶属或背书关系。Claude Code、Codex、OpenCode 及相关名称归各自权利人所有。
