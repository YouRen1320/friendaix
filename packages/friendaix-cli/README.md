# friendaix

友人 AI 助手：安全配置 Claude Code、Codex CLI 和 OpenCode，并可完整恢复到配置前状态。

```bash
npx friendaix@latest
```

需要 Node.js 20.12 或更高版本。

## 命令

```bash
friendaix
friendaix configure
friendaix configure --dry-run
friendaix configure --skip-probe
friendaix restore
friendaix sites
friendaix doctor
friendaix --help
friendaix --version
```

API Key 输入不会回显，也不会保存在 `~/.friendaix/state.json`。它会按所选客户端要求写入：

- Claude Code：`~/.claude/settings.json`
- Codex CLI：`~/.codex/auth.json` 和 `~/.codex/config.toml`
- OpenCode：`~/.local/share/opencode/auth.json`，以及 `~/.config/opencode/opencode.json` 或 `opencode.jsonc`

OpenCode 的密钥放在其独立 credential store，普通配置文件不再嵌入 FriendAIX API Key。

所有客户端写入属于同一个事务。FriendAIX 会先备份全部目标；任一写入失败时自动回滚。恢复时，配置前不存在的文件会被删除。若文件在变更预览后被其他程序修改，写入会被拒绝，避免旧计划静默覆盖新内容。符号链接和其他特殊文件也会被拒绝，避免原子替换破坏链接。

`friendaix doctor` 和 `friendaix configure --dry-run` 是只读命令，不执行旧 state 迁移或中断事务恢复。

> 切换 Codex 到 FriendAIX API Key 会替换当前 ChatGPT 登录，并可能禁用依赖 ChatGPT 身份的功能。检测到现有 OAuth token 时，CLI 会在执行前再次确认。

配置后的 API 自检会发送极小请求，可能产生极少量费用。使用 `--skip-probe` 跳过。

源码、迁移说明、安全策略和开发文档见 [FriendAIX 仓库](https://github.com/YouRen1320/friendaix)。

## License

MIT © 2026 YouR.AI

本项目与 Anthropic、OpenAI 或 OpenCode/Anomaly 没有官方隶属或背书关系。
