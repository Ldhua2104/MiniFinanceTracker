# 数据库拆分与用户文件存储

## 本次结构调整

原先 `workspaces` 文档同时保存账户、分类、预算和交易数组，用户资料与头像 Base64 则放在 `users` 中。本次将业务数据改为按用户拆分到独立 MongoDB 集合，并将用户资料与认证信息拆开：

- `users` 只保存登录身份、安全状态和密码哈希。
- `userprofiles` 保存用户名、头像文件路径、默认币种、时区和邮件提醒偏好。
- `accounts`、`categories`、`budgets`、`transactions` 各自保存独立业务记录；每条记录包含 `userId` 和前端稳定的字符串 `id`。
- `workspaces` 保留每个用户一条元数据记录，目前只负责 revision 与 schemaVersion。
- 图片文件移出 MongoDB，服务器只保存其受保护的 API 路径。

工作区 HTTP 接口仍接收和返回前端使用的完整快照。后端在读取时从多个集合组合响应，在保存时按用户及稳定 `id` 替换相应集合中的数据，并记录工作区 revision。匿名用户仍只在浏览器本地存储数据，不会创建服务器记录。

## 每用户文件目录

服务器目录：

```text
backend/storage/users/{userId}/
├── uploads/   # 交易备注图片
└── avatars/   # 头像图片
```

新建账户时会创建两个子目录；上传时也会按需创建。`userId` 始终来自已认证会话，文件访问路由不会接受客户端传来的用户目录。交易图片接口保留现有 URL 形式 `/api/v1/auth/transaction-images/{filename}`，只是文件迁至 `uploads/`。头像路径以 `/api/v1/auth/avatars/{filename}` 返回；读取头像需要登录，并且服务器会确认文件名与该用户的头像资料一致。

头像和交易图片均限制在 5 MB 以内，服务器会检查图片签名。`userprofiles.avatarPath`、`transactions.noteImage` 保存路径，不再保存图片 Base64 内容。旧交易图片迁移时复制到新位置，旧目录保留，便于回退。

生产环境需要将 `backend/storage/` 配置为持久化存储；运行多个后端实例时，各实例应挂载同一个共享存储，否则实例间无法读取彼此保存的图片。

## 集合职责

| 集合 | 职责 | 常用关联 / 索引 |
| --- | --- | --- |
| `users` | 邮箱、密码哈希、角色、账户状态、会话版本、邮箱验证状态 | 邮箱唯一 |
| `userprofiles` | 用户名、头像路径、默认币种、时区、邮件提醒偏好 | `userId` 唯一 |
| `accounts` | 账户名称、币种、初始余额及展示顺序 | `userId + id` 唯一 |
| `categories` | 收入来源和支出分类，含归档状态、颜色、展示顺序 | `userId + id` 唯一；同用户同类型名称唯一 |
| `budgets` | 月预算金额、币种、卡片颜色及其支出分类 | `userId + id` 唯一；同用户每个分类至多一个预算 |
| `transactions` | 收支金额、类型、账户、分类、日期时间、备注、自动重复规则和图片路径 | `userId + id` 唯一；日期、分类、账户和重复任务查询索引 |
| `workspaces` | 工作区同步 revision 与数据 schema 版本，不再承载业务数组 | `userId` 唯一 |
| `aisettings` | 用户自带模型供应商、模型分配及经服务端加密的 API Key | `userId` 唯一；密钥不返回前端 |
| `aianalyses` | AI 分析任务状态、分析月份、输入摘要与结果 | 用户、月份、数据 revision |
| `notifications` | 预算提醒等用户通知及已读状态 | `userId`、预算关联 |
| `emailjobs` | 邮件通知的排队状态、重试次数和幂等键 | 通知关联、幂等键唯一 |
| `emailverifications` | 邮箱验证的哈希验证码、到期时间和尝试次数 | `userId`、到期时间 |

业务金额继续以字符串形式保存（例如 `"200.00"`），避免本次拆分同时改变金额精度和 API 表达。账户、分类、预算与交易内部仍有 MongoDB `_id`，接口使用由应用生成的字符串 `id` 关联记录，复合索引均带 `userId`，避免跨用户关联。

## 数据迁移

当前数据库是 MongoDB，因此 SQL 脚本不适用。本仓库提供 Node/Mongoose 迁移程序：`backend/src/db/migrate-workspaces.js`。程序默认 dry-run，只检查引用、已有目标数据冲突、图片和头像格式并输出迁移计数，不写入数据库或文件。

建议先暂停后端服务和所有数据库写入，并备份数据库与 `backend/storage/transaction-images/`。先运行迁移预演，再更新集合校验器（旧版预算校验器仍要求 `month`），之后提交迁移并建立新索引：

```powershell
cd backend
npm run db:migrate-workspaces
npm run db:indexes -- --validators-only
npm run db:migrate-workspaces -- --commit
npm run db:indexes
```

`db:indexes -- --validators-only` 只更新集合校验器，不会启动索引构建；最后的 `db:indexes` 再为拆分后的集合建立索引。后端关闭了启动时的自动建索引，以避免与迁移命令争用 MongoDB 索引构建。首次迁移后启动新版服务，检查用户资料、工作区 API、图片访问和每类记录数量。确认新集合数据完整后，可选择移除 `workspaces` 中的旧数组以及 `users` 中的旧资料字段：

```powershell
npm run db:migrate-workspaces -- --commit --strip-legacy
```

`--strip-legacy` 必须与 `--commit` 一起使用。脚本不会删除原交易图片文件；确认备份和运行状态稳定后，再按保留策略清理 `backend/storage/transaction-images/`。迁移过程中若目标集合已有不同内容，或旧数据引用缺失，程序会停止并报告冲突，不会静默覆盖。可重复运行未清理旧数组的迁移；目标数据必须与来源一致。`--strip-legacy` 应在确认迁移成功后作为最后一步执行。

该迁移脚本只移动每个 workspace 当前的记录，不会把不同月份的历史预算合并成同分类的多个预算；如果旧集合中同一用户、同一分类存在多个预算，脚本会停止并报告。迁移前应先人工确定合并后的月预算金额。

## 部署与回滚说明

1. 备份 MongoDB 和服务器图片目录。
2. 部署新后端代码后先运行 dry-run，解决所有报告的冲突。
3. 使用 `--commit` 写入独立集合并复制图片，验证后端读取与图片权限。
4. 确认无误后再使用 `--strip-legacy` 清理旧嵌入字段。
5. 保留旧图片目录一段观察期；回滚时部署旧版代码并从数据库备份恢复旧 workspace 数据。

工作区快照保存由多次集合写操作组成，不依赖 MongoDB replica set 事务，因此一次写入途中数据库故障可能留下部分更新。失败时应重新读取客户端当前工作区并重新保存；监控 `workspaces.revision` 与业务集合数据，必要时由备份恢复。
