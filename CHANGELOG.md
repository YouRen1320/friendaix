# Changelog

本项目遵循 Semantic Versioning。

## [Unreleased]

## [0.3.0] - 2026-07-10

### Added

- 新增可独立复用的 `friendaix-core` 包。
- 新增整次操作事务备份、SHA-256 校验、自动回滚和恢复前安全备份。
- 新增 `--dry-run`、`--skip-probe`、`doctor`、`--help` 和 `--version`。
- 新增临时 HOME 集成测试、跨平台 CI、tarball 烟雾测试和 Trusted Publishing 工作流。

### Changed

- API Key 输入不再回显，FriendAIX state 不再保存密钥。
- 含密钥配置使用 `0600`，状态和备份目录使用 `0700`。
- 服务端模型清单用于 Claude 和 OpenCode 配置以及连接自检。
- Codex provider 现在显式写入与自检相同的可用模型，避免保留不兼容的旧默认模型。
- OpenCode API Key 改存到官方 credential store，并从普通 provider 配置移除。
- 支持保留注释的 `opencode.jsonc`；JSON/JSONC 并存时按客户端优先级更新并清理旧密钥。
- adapter 支持 Claude/Codex/OpenCode 的自定义配置目录、XDG 目录和 Windows `LOCALAPPDATA`。
- Claude 小模型配置改用 `ANTHROPIC_DEFAULT_HAIKU_MODEL`，自检认证与客户端 Bearer 认证保持一致。
- Codex 登录替换变成需要明确确认的破坏性操作。
- 恢复按事务操作工作，并能删除配置前不存在的文件。

### Removed

- 移除未实现的“查看用量”菜单。
- 移除无效的旧按客户端备份写入格式。

### Security

- 修复明文密钥重复保存在 `~/.friendaix/state.json` 的问题。
- 修复新建 Claude/OpenCode 密钥文件默认为 `0644` 的问题。
- 修复部分客户端写入失败仍显示全部成功的问题。
- 新增配置计划 SHA-256 前置条件，避免预览后发生的外部修改被旧计划覆盖。
- 启动恢复会清理中断原子写入遗留的精确 UUID 临时文件，减少含密钥副本残留。
- 拒绝符号链接和其他特殊配置/备份文件，避免原子替换破坏链接或备份内容跳转。
- `doctor` 与 `configure --dry-run` 改为严格只读，不再隐式迁移 state 或恢复中断事务。
- 发布包最低 Node.js 版本调整为 20.12，开发工具链最低为 20.19，并加入独立 tarball 兼容门禁；Prettier 规则纳入仓库，不再依赖维护者机器的全局配置。
- GitHub Actions 固定到完整提交 SHA，并加入 Dependabot、bug report 和 PR 模板。
- 发布流程固定受支持的 npm 版本，补充新 core 包的 Trusted Publishing bootstrap，并增加版本、包内容和生产审计门禁。

## [0.2.3] - 2026-05-14

- 最后一个单包、非事务式 CLI 版本。
