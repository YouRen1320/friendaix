# Security Policy

## Supported versions

正式发布后，仅最新 minor 版本接收安全修复。0.2.x 及更早版本的备份和密钥处理存在已知限制，不再维护。

## Reporting a vulnerability

请不要为未修复的漏洞创建公开 issue。请通过 GitHub Security Advisories 的 **Report a vulnerability** 私下报告，并包含：

- 受影响版本和操作系统；
- 可复现步骤；
- 可能被读取、覆盖或泄露的文件；
- 如果已知，建议的缓解措施。

维护者确认问题前，请勿提交真实 API Key、`auth.json`、备份目录或其他凭证。

## Security model

FriendAIX 会修改用户级 AI 客户端配置，因此以下行为被视为安全边界：

- 密钥输入不得回显；
- FriendAIX state 不得保存 API Key；
- POSIX 上含密钥文件和备份权限必须是 `0600`；Windows 使用当前用户目录 ACL；
- 每次多客户端写入必须是可回滚事务；
- 计划生成后发生变化的配置文件不得被旧计划静默覆盖；
- 配置目标和备份内容必须是普通文件，不跟随符号链接；
- 中断事务恢复必须清理受管目标旁遗留的 FriendAIX 原子写入临时文件；
- 恢复目标必须属于 adapter 声明的允许路径；
- npm 发布必须使用 Trusted Publishing/OIDC 和 provenance。

FriendAIX 无法保护已经被其他程序读取的明文客户端配置，也无法保证第三方 API 网关或客户端本身的数据处理方式。
