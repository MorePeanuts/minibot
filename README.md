# MiniBot

一个用现代 TypeScript 全栈技术构建的 LLM Agent 产品：类 ChatGPT 的对话界面、联网搜索、在隔离 Docker 沙箱里执行 `bash / ls / grep / find / read / write / edit`，支持注册登录、API Key 配置、新建 / 重命名 / 归档 / 删除对话、**从任意消息 fork 出新对话**、重新生成、停止生成等功能。

| 能力       | 实现                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| 模型       | DeepSeek `deepseek-flash`（默认）/ `deepseek-v4-pro`，可调思考强度               |
| 智能体编排 | [pi-agent](https://github.com/earendil-works/pi)（`pi-agent-core` + `pi-ai`）    |
| 联网       | DeepSeek Search / Fetch API（`web_search`、`web_fetch` 工具）                    |
| 代码执行   | 每个对话一个独立 Docker 容器，复用 `pi-coding-agent` 的工具实现，仅替换 I/O 后端 |
| 前端       | Next.js 16 App Router + React 19 + Tailwind v4 + shadcn/ui + AI SDK `useChat`    |
| 后端       | Next.js Route Handlers + Server Actions                                          |
| 认证       | Better Auth（邮箱 + 密码，会话 Cookie）                                          |
| 数据库     | PostgreSQL 18 + Drizzle ORM（类型安全 SQL + 迁移）                               |
| 部署       | Docker Compose（Postgres、迁移任务、Docker API 代理、沙箱镜像、Web）             |
| 工程化     | pnpm workspace + Turborepo、ESLint、Prettier、Vitest、Playwright、Husky、CI      |

---

## 快速开始

### 方式一：Docker Compose 一键部署

```bash
cp .env.example .env
# 生成两个随机密钥填入 .env
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY

docker compose up -d --build
open http://localhost:3000
```

注册账号后在左下角菜单 **Settings** 中填入 DeepSeek API Key（也可在 `.env` 中设置 `DEEPSEEK_API_KEY` 作为全站默认 Key）。

### 方式二：本地开发

前置：Node ≥ 22.19（推荐 24，见 `.nvmrc`）、pnpm 11（`corepack enable`）、Docker。

```bash
pnpm install
cp .env.example .env            # 填好两个密钥
docker compose up -d db         # 只启动 Postgres
pnpm db:migrate                 # 执行数据库迁移
pnpm sandbox:build              # 构建沙箱镜像 minibot-sandbox:latest
pnpm dev                        # http://localhost:3000（热更新）
```

> 本地开发时 Web 进程直接通过 `/var/run/docker.sock` 管理沙箱容器；Compose 部署时通过受限的 docker-socket-proxy。

---

## 架构

```
┌──────────────────────── Browser ────────────────────────┐
│ React 19 · shadcn/ui · AI SDK useChat (SSE)             │
└───────────────┬─────────────────────────┬───────────────┘
   Server Actions (CRUD)          POST /api/chat (UI message stream)
┌───────────────▼─────────────────────────▼───────────────┐
│ apps/web  (Next.js)                                     │
│  ├─ server/services   conversations · settings          │
│  ├─ server/chat       run-chat → pi Agent → event-mapper│
│  └─ server/auth       Better Auth                       │
└──────┬──────────────────────┬───────────────────┬───────┘
       │                      │                   │
┌──────▼──────┐   ┌───────────▼─────────┐  ┌──────▼─────────────┐
│ @minibot/db │   │ @minibot/agent      │  │ @minibot/sandbox   │
│ Drizzle +   │   │ pi Agent, prompt,   │  │ dockerode: 每个对话│
│ PostgreSQL  │   │ tools, DeepSeek API │──▶ 一个加固的容器     │
└─────────────┘   └─────────────────────┘  └────────────────────┘
```

### 目录结构

```
.
├── apps/web/                 Next.js 应用（UI + API）
│   ├── src/app/              路由：(auth) 登录注册、(chat) 聊天、api/*
│   ├── src/actions/          Server Actions（zod 校验 + 鉴权）
│   ├── src/components/       chat/ sidebar/ settings/ auth/ ui/(shadcn)
│   ├── src/lib/chat/         纯函数：pi 消息 ⇄ UI 消息转换（有单测）
│   ├── src/server/           仅服务端代码（import "server-only"）
│   └── e2e/                  Playwright 端到端测试
├── packages/
│   ├── db/                   Drizzle schema、客户端、SQL 迁移
│   ├── agent/                MiniBot Agent：模型、系统提示词、工具
│   └── sandbox/              Docker 沙箱生命周期管理
├── docker/sandbox/           沙箱镜像（Debian + bash/python/ripgrep/fd/git）
├── docker-compose.yml
└── turbo.json                任务编排（build/lint/typecheck/test，带缓存）
```

内部包采用 **"Just-in-Time Packages"** 模式：直接导出 TS 源码、由 Next.js `transpilePackages` 编译，免去每个包单独构建的步骤。包之间单向依赖（`web → agent → sandbox`，`web → db`），`agent` 不感知 HTTP / 数据库，`sandbox` 不感知 LLM。

### 一次对话请求的生命周期

1. `useChat` 发送 `{ trigger, conversationId, message }`（只发增量，历史以服务端为准）。
2. `run-chat.ts`：鉴权 → 读取用户设置（解密 API Key）→ 单对话并发锁 → 写入用户消息。
3. 用数据库中的完整历史创建 pi `Agent`，`agent.continue()` 开始推理 / 调用工具循环。
4. `event-mapper.ts` 将 pi 的 `AgentEvent` 翻译成 AI SDK 的 UI Message Stream（SSE），前端零定制渲染文本、思考过程、工具调用和流式工具输出。
5. 每条消息在 `message_end` 时立即落库（JSONB 原样保存 pi 消息），中断 / 崩溃也不丢进度；客户端断开或点"停止" → `agent.abort()`。
6. 首轮对话并行生成标题；结束后 `router.refresh()` 刷新侧边栏。

**Fork** 以 UI 消息为锚点：复制该轮及之前的所有消息行到新对话，并把沙箱 `/workspace` 一并拷贝过去。

### 沙箱安全

- 每个对话一个容器，`CapDrop: ALL`、`no-new-privileges`、非 root 用户（uid 1000）、内存 / CPU / PID 上限；
- 默认 `SANDBOX_NETWORK=none` 完全断网（需要 pip/curl 时设为 `bridge`）；
- 空闲 15 分钟自动停止，删除对话时删除容器；
- Compose 部署中 Web 容器**拿不到原始 docker.sock**，只能通过 [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) 访问容器 / exec / 镜像 API。
- 命令超时或被中止时，杀掉整个进程组（`setsid` + `kill -- -PGID`），不会遗留后台进程。

---

## 开发规范

| 命令                                  | 作用                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                            | 启动开发服务器                                        |
| `pnpm check`                          | 格式检查 + lint + 类型检查 + 测试（提交前跑一遍）     |
| `pnpm test`                           | Vitest 单元测试（沙箱集成测试在有 Docker 时自动运行） |
| `pnpm --filter @minibot/web test:e2e` | Playwright 端到端测试（需先 `pnpm dev`）              |
| `pnpm db:generate`                    | 修改 schema 后生成 SQL 迁移                           |
| `pnpm db:migrate` / `db:studio`       | 执行迁移 / 打开 Drizzle Studio                        |

- **Git**：[Conventional Commits](https://www.conventionalcommits.org/)（commitlint 在 `commit-msg` 钩子中校验），`pre-commit` 钩子用 lint-staged 只检查暂存文件。
- **类型安全**：`strict` + `noUncheckedIndexedAccess`；环境变量经 zod 校验（`src/env.ts`），所有外部输入（请求体、Server Action 参数）都经 zod 解析。
- **边界清晰**：服务端模块 `import "server-only"`，防止被打包进浏览器；客户端只能从 `@minibot/agent/catalog` 引入无依赖的常量。
- **供应链**：pnpm 默认禁止依赖的 install 脚本（`allowBuilds` 白名单）并拒绝过新的版本（`minimumReleaseAge`）。

## 给 Go 开发者的对照

| Go 生态                      | 本项目                                         |
| ---------------------------- | ---------------------------------------------- |
| go modules / go.work         | pnpm workspace（`pnpm-workspace.yaml`）        |
| Makefile / mage              | Turborepo（`turbo.json`，带增量缓存）          |
| gofmt / golangci-lint        | Prettier / ESLint（typescript-eslint）         |
| `go test`                    | Vitest；E2E 用 Playwright                      |
| sqlc / gorm + golang-migrate | Drizzle ORM（schema 即类型）+ drizzle-kit 迁移 |
| `net/http` handler / gin     | Next.js Route Handler（`app/api/**/route.ts`） |
| html/template + HTMX         | React Server Components + Server Actions       |
| struct tag 校验 (validator)  | zod schema（同时得到运行时校验与静态类型）     |
| context.Context 取消         | `AbortSignal`                                  |

## 环境变量

见 [`.env.example`](.env.example)。必填：`BETTER_AUTH_SECRET`、`ENCRYPTION_KEY`、`DATABASE_URL`（Compose 自动注入）。
