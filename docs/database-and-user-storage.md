# 数据库拆分与用户文件存储

## 本次结构调整

原先 `workspaces` 文档同时保存账户、分类、预算和交易数组，用户资料与头像 Base64 则放在 `users` 中。本次将业务数据改为按用户拆分到独立 MongoDB 集合，并将用户资料与认证信息拆开：

- `users` 只保存登录身份、安全状态和密码哈希。
- `userprofiles` 保存用户名、头像文件路径、默认币种、时区和邮件提醒偏好。
- `accounts`、`categories`、`incomeSources`、`budgets`、`transactions` 各自保存独立业务记录；每条记录包含 `userId` 和前端稳定的字符串 `id`。
- 图片文件移出 MongoDB，服务器只保存其受保护的 API 路径。

认证数据接口接收和返回前端使用的完整记录快照。后端在读取时从多个集合组合响应，在保存时分别更新各业务集合。匿名用户仍只在浏览器本地存储数据，不会创建服务器记录。

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
| `accounts` | 账户名称、备注、币种、初始余额及展示顺序 | `userId + id` 唯一 |
| `categories` | 支出分类，含归档状态、颜色、展示顺序 | `userId + id` 唯一；同用户名称唯一 |
| `incomesources` | 独立维护收入来源，例如工资、奖金、其他 | `userId + id` 唯一；同用户名称唯一 |
| `budgets` | 月预算金额、币种、卡片颜色及其支出分类 | `userId + id` 唯一；同用户每个分类至多一个预算 |
| `transactions` | 收支金额、类型、账户、分类、日期时间、备注、自动重复规则和图片路径 | `userId + id` 唯一；日期、分类、账户和重复任务查询索引 |
| `aisettings` | 用户自带模型供应商、模型分配及经服务端加密的 API Key | `userId` 唯一；密钥不返回前端 |
| `aianalyses` | AI 分析任务状态、分析月份、输入摘要与结果 | 用户、月份、数据 revision |
| `notifications` | 预算提醒等用户通知及已读状态 | `userId`、预算关联 |
| `emailjobs` | 邮件通知的排队状态、重试次数和幂等键 | 通知关联、幂等键唯一 |
| `emailverifications` | 邮箱验证的哈希验证码、到期时间和尝试次数 | `userId`、到期时间 |

业务金额继续以字符串形式保存（例如 `"200.00"`），避免本次拆分同时改变金额精度和 API 表达。账户、支出分类、收入来源、预算与交易内部仍有 MongoDB `_id`，接口使用由应用生成的字符串 `id` 关联记录，复合索引均带 `userId`，避免跨用户关联。前端通过 `/api/v1/auth/data` 接收统一的 `categories` 数组；后端按 `type` 将收入记录存入 `incomesources`，支出记录存入 `categories`。

## 当前运行方式

数据库已拆分为独立集合。账户、分类、收入来源、预算和收支记录分别直接保存在 `accounts`、`categories`、`incomesources`、`budgets` 和 `transactions` 集合中。认证后的数据接口为 `/api/v1/auth/data`，读取时组合各集合数据，写入时分别更新对应集合。

应用和数据库初始化流程不再依赖或创建 `workspaces` 集合。收入来源拆分迁移仅用于将旧 `categories` 集合中的收入来源移动到 `incomesources`；数据迁移完成后无需再运行旧的 workspace 迁移程序。

新增账户字段时，在 `backend/src/models/account.model.js`、`backend/src/routes/auth.routes.js` 和 `backend/src/db/initialize.js` 同步更新模型、接口校验和 MongoDB 校验器。运行 `cd backend; npm run db:indexes -- --validators-only` 可更新现有集合校验器。

MongoDB 校验器有账户备注字段后，应在 `backend` 目录执行：

```powershell
npm run db:indexes -- --validators-only
```

保存操作会依次更新多个集合，不依赖 MongoDB replica set 事务。数据库故障若发生在写入途中，重新登录后可重新保存客户端记录；必要时从备份恢复。
