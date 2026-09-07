# FriendAIX 发布清单

本清单用于准备并发布 `friendaix` 与 `friendaix-core`。两个包必须使用相同版本，并通过同一 GitHub Release 发布。

## 1. 准备发布 PR

1. 从最新 `main` 创建发布分支。
2. 同步更新根目录、`friendaix` 与 `friendaix-core` 三个 `package.json` 的版本。
3. 运行 `npm install --package-lock-only`，确认 `package-lock.json` 中三个工作区版本一致。
4. 把 `CHANGELOG.md` 的 Unreleased 内容归入带日期的新版本章节，说明用户可见变化、安全修复和破坏性变化。
5. 如有兼容性或配置格式变化，同步更新 `README.md` 与 `MIGRATION.md`。

发布 PR 必须通过以下命令：

```bash
npm ci
npm run check
npm test
npm run build
npm run pack:check
npm run smoke
npm audit --omit=dev --audit-level=high
```

`pack:check` 负责核对包文件清单；`smoke` 会从本地 tarball 安装两个包，并检查 CLI 版本、帮助信息与核心库公共类型。

## 2. 发布前确认

- 发布 PR 已合并到 `main`，且合并提交上的完整 CI 通过。
- `npm view friendaix@<版本> version` 与 `npm view friendaix-core@<版本> version` 均确认该版本尚未被占用。
- npm 中两个包的 Trusted Publisher 仍指向 `YouRen1320/friendaix`、`publish.yml` 和 `npm` environment。
- GitHub 的 `npm` environment 保护规则与审批人符合当前维护策略。
- 本次是正式版本；预发布版本需要先单独设计 dist-tag 与工作流策略，不能直接使用当前发布流程。

## 3. 创建正式 Release

1. 在 `main` 中目标提交上创建 `v<版本>` 标签。
2. 创建非草稿、非预发布的 GitHub Release，标题使用 `FriendAIX v<版本>`。
3. Release 说明从 CHANGELOG 提炼，至少包含变化、迁移、安全影响和回滚方式。
4. 发布后观察“发布 npm 包”工作流；它会确认标签提交属于 `main`，再依次发布 `friendaix-core` 和 `friendaix`。

不要在本地使用长期 npm token 发布，也不要重新移动已有版本标签。

## 4. 发布后验证

```bash
npm view friendaix version dist-tags --json
npm view friendaix-core version dist-tags --json
npx friendaix@<版本> --version
```

确认两包版本与 `latest`、GitHub Release、仓库三处版本完全一致，并检查 npm 页面是否显示 provenance。若第二个包发布失败，不要修改或覆盖已发布版本；保留现场，修复发布条件后再决定补发或提升补丁版本。

## 5. 回滚原则

npm 已发布版本不可覆盖。发现严重问题时：

1. 先在 GitHub Release 和 README 标记已知问题。
2. 必要时把 npm `latest` 临时切回最近可用版本，但不要删除历史版本。
3. 从 `main` 创建修复分支，发布新的补丁版本。
4. 代码回滚使用普通 PR，不移动旧标签，也不复用旧版本号。
