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
- 需要用户确认的警告。

这样 CLI、测试或其他产品可以在执行前展示计划，并统一处理确认。

### 一次配置是一个事务

`applyConfiguration()` 的顺序固定：

1. 检查目标路径没有重复。
2. 快照所有目标，包括“不存在”状态、原权限和哈希。
3. 将 manifest 标记为 `prepared`。
4. 通过同目录临时文件逐个原子替换。
5. 成功后标记为 `applied`。
6. 任一写入失败，按快照恢复或删除本次新建文件，并标记为 `rolled-back`。

如果进程在写入期间被强制终止，manifest 会停留在 `prepared`。CLI 下次启动会先创建当前状态安全备份，再自动回滚这些中断操作。

网络自检不属于文件事务。服务端临时不可用不应撤销一个用户已经确认且写入正确的本地配置。

### 恢复也必须可回滚

恢复旧快照前，系统先对当前文件创建 `restore-safety` 快照。恢复失败时用该快照回滚。

恢复 API 要求调用方传入 `allowedPaths`。manifest 中任何不属于 adapter 管理范围的路径都会被拒绝。

### 密钥最少复制

核心库不决定密钥来源。FriendAIX CLI 使用不回显输入，并只把密钥写入所选客户端所需配置。自己的 state 只保存站点和客户端 ID。

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
