# Architecture

## 目标

FriendAIX 将“如何安全修改用户配置”与“FriendAIX 服务的品牌和默认值”分离。

```text
friendaix CLI
  ├─ preset：品牌、站点、provider ID、默认模型
  ├─ flows：交互、确认、状态和 API 探测
  └─ friendaix-core
       ├─ adapters：读取现有配置并生成写入计划
       ├─ transaction：整批写入和失败回滚
       ├─ backup：manifest、校验、恢复和安全备份
       └─ filesystem：私有目录、权限和原子替换
```

## 关键约束

### Adapter 只生成计划

`ClientAdapter.plan()` 可以读取现有客户端配置，但不得写文件、创建备份或调用网络。它返回：

- 将要写入的完整文件内容；
- 是否包含秘密；
- 建议权限；
- 生成计划所依据文件的存在状态和 SHA-256；
- 需要用户确认的警告。

这样 CLI、测试或其他产品可以在执行前展示计划，并统一处理确认。

### 一次配置是一个事务

`applyConfiguration()` 的顺序固定：

1. 检查目标路径没有重复。
2. 快照所有目标，包括“不存在”状态、原权限和哈希。
3. 比较快照与 adapter 计划的前置条件；已变化则不写入并标记为 `rolled-back`。
4. 将 manifest 保持为 `prepared`，每个文件写入前再次检查它没有在快照后变化。
5. 通过同目录临时文件逐个原子替换。
6. 成功后标记为 `applied`。
7. 任一写入失败，只回滚本次已经写过的文件，并标记为 `rolled-back`。

目标配置和备份内容必须是普通文件。符号链接或其他特殊文件会在读取阶段被拒绝，因为基于 rename 的原子替换会把链接本身替换成普通文件；静默改变用户的 dotfiles 拓扑不属于可接受行为。

如果进程在写入期间被强制终止，manifest 会停留在 `prepared`。CLI 下次启动会清理该操作目标旁符合精确 FriendAIX UUID 命名的原子写入临时文件，再创建当前状态安全备份并自动回滚中断操作。

网络自检不属于文件事务。服务端临时不可用不应撤销一个用户已经确认且写入正确的本地配置。

`doctor` 与 `configure --dry-run` 是只读路径，不执行旧 state 迁移或 `prepared` 操作恢复；诊断会报告待恢复操作，正常交互/配置入口再执行自动恢复。

### 恢复也必须可回滚

恢复旧快照前，系统先对当前文件创建 `restore-safety` 快照。恢复失败时用该快照回滚。

恢复 API 要求调用方传入 `allowedPaths`。manifest 中任何不属于 adapter 管理范围的路径都会被拒绝。

### 密钥最少复制

核心库不决定密钥来源。FriendAIX CLI 使用不回显输入，并只把密钥写入所选客户端所需配置。自己的 state 只保存站点和客户端 ID。OpenCode adapter 将密钥放在独立 `auth.json`，provider 和模型放在不含 FriendAIX 密钥的 `opencode.json` 或 `opencode.jsonc`；JSONC 的非受管注释会被保留。

`AdapterContext` 默认只依赖显式 `homeDir`，便于隔离测试。CLI 会额外传入环境快照和平台，使内置 adapter 遵循 Claude/Codex 的自定义目录、OpenCode/XDG 目录和 Windows `LOCALAPPDATA`，同时避免核心库在调用方未授权时隐式读取进程环境。

## 新增品牌 preset

新项目应依赖 `friendaix-core`，并在自己的 CLI 层定义：

- 服务站点和健康检查；
- provider ID 与显示名称；
- 默认/推荐模型；
- API Key 获取入口；
- 错误提示和隐私说明。

不要复制事务或备份实现，也不要把新品牌常量加入 `friendaix-core`。

## 非目标

- 核心库不管理服务端账户、计费或用量。
- 核心库不提供 GUI。
- 核心库不保证第三方网关协议兼容；调用方负责端点探测。
- 首个 0.3 版本不实现动态下载第三方 adapter 的插件市场。
