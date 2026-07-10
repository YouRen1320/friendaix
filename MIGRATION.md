# Migrating from 0.2.x to 0.3.0

0.3.0 是一次有意的破坏性整理，目标是修复密钥重复保存和不完整恢复问题。

最低运行版本从旧版的 Node.js 20 提升到 Node.js 20.12。仓库开发工具链需要 Node.js 20.19，但发布 tarball 会单独验证 20.12 运行兼容性。

## 状态文件

0.2.x 可能在 `~/.friendaix/state.json` 中保存 `apiKey`。0.3.0 在运行配置、恢复、线路选择或诊断命令时会删除该字段，并将文件权限设为 `0600`。

FriendAIX 不会删除所选客户端自己的密钥配置，因为这些客户端仍需要凭证才能运行。

OpenCode 的 FriendAIX API Key 会从 `~/.config/opencode/opencode.json` 或 `opencode.jsonc` 迁移到 OpenCode 的独立凭据文件 `~/.local/share/opencode/auth.json`。如果 JSON 与 JSONC 并存，会更新高优先级 JSONC，并清除旧 JSON 中的 FriendAIX 明文密钥；其他 provider 配置、注释和凭据保持不变，涉及的文件都会进入同一次事务备份。

## 备份格式

0.2.x 使用以下形式：

```text
~/.friendaix/backups/<client>-<timestamp>/
```

这种格式没有记录“文件原来不存在”，因此不能保证完整恢复。0.3.0 不继续写入或自动解释该格式，也不会删除旧目录。

0.3.0 使用带 `manifest.json` 的整次操作快照。只有 0.3.0 快照会出现在新恢复菜单中。

如需读取旧备份，可临时运行：

```bash
npx friendaix@0.2.3
```

注意：旧版无法删除首次运行时新建的文件。重要配置建议直接从旧备份目录手动核对恢复。

## Codex 登录

配置 FriendAIX provider 会把 Codex 从 ChatGPT 登录切换到 API Key 登录。0.3.0 会在检测到 OAuth token 时要求二次确认，并把原 `auth.json` 纳入事务备份。

## 回滚

如 0.3.0 尚未成功配置，可继续使用 0.2.3。若 0.3.0 已成功配置，优先使用 0.3.0 的 `friendaix restore` 恢复事务快照，再决定是否运行旧版本。
