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
- Codex 登录替换变成需要明确确认的破坏性操作。
- 恢复按事务操作工作，并能删除配置前不存在的文件。

### Removed

- 移除未实现的“查看用量”菜单。
- 移除无效的旧按客户端备份写入格式。

### Security

- 修复明文密钥重复保存在 `~/.friendaix/state.json` 的问题。
- 修复新建 Claude/OpenCode 密钥文件默认为 `0644` 的问题。
- 修复部分客户端写入失败仍显示全部成功的问题。

## [0.2.3] - 2026-05-14

- 最后一个单包、非事务式 CLI 版本。
