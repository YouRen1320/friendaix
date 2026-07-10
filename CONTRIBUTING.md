# Contributing

感谢参与 FriendAIX。

## 开始之前

1. 对重大架构或用户配置格式变更，先创建 issue 说明目标、迁移和回滚方案。
2. 不要在 issue、测试 fixture 或提交历史中加入真实 API Key、OAuth token 或用户配置。
3. adapter 必须保持纯计划模式：读取并返回 `AdapterPlan`，不直接写文件。

## 本地开发

需要 Node.js 20.19 或更高版本。

```bash
npm ci
npm run check
npm test
npm run build
npm run pack:check
npm run smoke
```

测试必须使用临时 HOME。任何需要真实客户端或真实 API 的验证都应明确标注为手工测试，不得成为默认测试的一部分。

## Pull request 要求

- 说明行为变化、风险、迁移方式和回滚方式。
- 为配置合并、幂等性、权限、备份与恢复增加回归测试。
- 更新 README、MIGRATION 或 CHANGELOG 中对应内容。
- 不混入与当前变更无关的重构。

## 发布

只有维护者可以发布。发布通过 GitHub Release 触发 `publish.yml`，先发布 `friendaix-core`，再发布 `friendaix`。新包首次建立 Trusted Publisher 的 bootstrap 流程见 README。禁止把 npm 写入 token 提交到仓库或长期保存在项目 `.npmrc`。
