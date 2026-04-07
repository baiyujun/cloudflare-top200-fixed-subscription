# Cloudflare Top200 Fixed Subscription

基于两个现有开源项目整合而成：

- Project 1: [`cmliu/WorkerVless2sub`](https://github.com/cmliu/WorkerVless2sub)
- Project 2: [`InfiCheesy/cloudflaresub`](https://github.com/InfiCheesy/cloudflaresub)

这个版本的目标只有三个：

1. 把原先所有默认收口到 Top10 / 最优 10 个 IP 的思路，统一改成 Top200 / 最优 200 个 IP。
2. 把 Project 2 改造成固定订阅链接发布器，主流程不再依赖每次生成新的短链。
3. 提供一个真正可部署到 Cloudflare Workers 的网页控制台，点击一次“开始”就会执行优选并覆盖更新固定订阅内容。

## 本次改造后的使用方式

日常使用只有这几步：

1. 打开网页控制台 `/`
2. 点击“开始 Top200 优选”
3. 等待页面提示“已更新成功”
4. 回到 Clash / v2ray / Shadowrocket / Surge 点击“更新订阅”

固定订阅链接始终不变：

- `/sub/fixed`
- `/sub/fixed?target=raw`
- `/sub/fixed?target=clash`
- `/sub/fixed?target=surge`

## Project 1 与 Project 2 的关系

### Project 1 在本项目中的职责

- 保留 `WorkerVless2sub` 的候选池来源思路：
  - `ADD`
  - `ADDAPI`
  - `ADDCSV`
  - `ADDNOTLS`
  - `ADDNOTLSAPI`
  - `DLS`
- 继续沿用“静态地址 + API 地址列表 + CSV 测速结果”的优选模型
- 对 CSV 结果按速度优先、延迟次优进行排序
- 最终结果统一收口到 Top200，而不是 Top10

### Project 2 在本项目中的职责

- 保留原有节点解析能力：
  - `vmess`
  - `vless`
  - `trojan`
  - Base64 订阅展开
- 保留原有订阅渲染能力：
  - Raw
  - Clash
  - Surge
- 保留旧模式兼容：
  - `POST /api/generate`
  - `GET /sub/:id`
- 新增固定订阅模式作为主流程：
  - `POST /api/save-base`
  - `POST /api/start`
  - `POST /api/update-preferred`
  - `GET /api/status`
  - `GET /sub/fixed`

## 与原版的核心区别

- 不再让用户手工粘贴 preferred IP 到生成器里做一次性短链。
- 不再把主流程建立在 `/api/generate -> /sub/:id` 上。
- 不再每次生成新的 shortId 给客户端重新导入。
- 不再引入 `home / mobile / office` 之类的 profile。
- 不再允许“先取 200 再二次挑 10”。
- 固定订阅内容就是最终 Top200 preferredIps。

## 目录结构

```text
cloudflaresub/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  ├─ icons/
│  └─ seed/
│     ├─ addressesapi.txt
│     ├─ addressesipv6api.txt
│     └─ addressescsv.csv
├─ src/
│  ├─ auth.js
│  ├─ core.js
│  ├─ fixed.js
│  ├─ http.js
│  ├─ legacy.js
│  ├─ optimizer.js
│  ├─ storage.js
│  └─ worker.js
├─ tests/
│  ├─ helpers/mock-env.mjs
│  ├─ fixed.test.mjs
│  ├─ frontend.test.mjs
│  ├─ regression-top200.test.mjs
│  └─ smoke.test.mjs
├─ wrangler.toml
├─ package.json
└─ README.md
```

`public/` 里的页面与 seed 候选数据会一起通过 Workers Static Assets 部署到云端。

## 固定订阅模式如何工作

KV 中维护一个固定记录：

```json
{
  "namePrefix": "Default",
  "nodeLinks": "vmess://...\nvless://...",
  "keepOriginalHost": true,
  "preferredIps": [
    "1.2.3.4:443#A",
    "1.2.3.5:443#B"
  ],
  "preferredCount": 200,
  "lastOptimizedAt": 1712345678901,
  "updatedFrom": "project1-web-optimize",
  "latestRunStatus": {
    "state": "success",
    "message": "Top200 优选完成，已更新固定订阅。",
    "preferredCount": 200,
    "candidateCount": 543,
    "tlsMode": "tls"
  }
}
```

读取 `/sub/fixed` 时，Worker 会：

1. 从 KV 读出基础节点
2. 从 KV 读出最新的 200 条 preferredIps
3. 按 Project 2 的 expand / render 逻辑实时渲染为 Raw / Clash / Surge

所以客户端看到的 URL 永远不变，变化的是 KV 中的内容。

## Top10 -> Top200 的实现说明

本项目不再保留任何默认 Top10 收口逻辑，统一使用：

- 常量 `TOP200_LIMIT = 200`
- `/api/start` 强制要求最终候选数不少于 200，否则直接失败
- 成功写入时只会覆盖最新 Top200 preferredIps
- 回归测试明确断言：
  - `/api/start` 返回 `preferredCount === 200`
  - `GET /api/status` 返回 `preferredIps.length === 200`
  - `GET /sub/fixed` 对单基础节点渲染后得到 200 条输出

## 路由说明

### 页面

- `GET /`
  - 控制台页面
  - 保存基础节点
  - 查看固定订阅状态
  - 一键执行 Top200 优选

### 固定订阅模式

- `GET /api/status`
  - 返回当前固定订阅状态
  - 未带管理员鉴权时返回公开摘要
  - 带管理员鉴权时额外返回基础节点与完整 preferredIps

- `POST /api/save-base`
  - 保存基础节点与基础配置

请求体示例：

```json
{
  "namePrefix": "Default",
  "nodeLinks": "vmess://...\nvless://...",
  "keepOriginalHost": true
}
```

- `POST /api/update-preferred`
  - 直接覆盖固定订阅的 preferredIps

请求体示例：

```json
{
  "preferredIps": [
    "1.2.3.4:443#A",
    "1.2.3.5:443#B"
  ],
  "source": "project1-web-optimize",
  "lastOptimizedAt": 1712345678901
}
```

- `POST /api/start`
  - 执行 Project 1 风格的优选流程
  - 自动读取候选池
  - 计算 Top200 preferredIps
  - 直接覆盖写入固定订阅记录

- `GET /sub/fixed`
- `GET /sub/fixed?target=raw`
- `GET /sub/fixed?target=clash`
- `GET /sub/fixed?target=surge`
  - 固定订阅读取入口

### 旧模式兼容

- `POST /api/generate`
- `GET /sub/:id`

这两个接口仍然保留，避免破坏原有短链使用方式，但不再是主流程。

## 鉴权

### 订阅读取鉴权

通过 `SUB_ACCESS_TOKEN` 控制：

- 未配置时：`/sub/fixed` 和 `/sub/:id` 可直接访问
- 已配置时：必须带 `?token=...` 或 `Authorization: Bearer ...`

### 后台写入鉴权

通过 `ADMIN_TOKEN` 控制：

- `POST /api/save-base`
- `POST /api/update-preferred`
- `POST /api/start`

前端不会硬编码 secret。控制台页面使用浏览器 localStorage 保存你手工输入的 `ADMIN_TOKEN`，然后通过 `Authorization: Bearer ...` 调用 API。

## 环境变量

至少建议配置：

- `SUB_STORE`
- `SUB_ACCESS_TOKEN`
- `ADMIN_TOKEN`
- `UI_TITLE`

兼容 Project 1 候选池配置：

- `ADD`
- `ADDAPI`
- `ADDCSV`
- `ADDNOTLS`
- `ADDNOTLSAPI`
- `DLS`
- `CSVREMARK`

说明：

- 如果没有配置 `ADDAPI` / `ADDCSV`，会默认读取 `public/seed/` 内置候选源
- `DLS` 默认值为 `7`
- `CSVREMARK` 默认值为 `1`

## Workers Static Assets 说明

`wrangler.toml` 已配置：

```toml
[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*", "/sub/*"]
```

含义：

- 页面与 seed 数据都由 `public/` 发布
- `/api/*` 与 `/sub/*` 由 Worker 后端优先处理
- 其余静态文件由 `ASSETS` 直接提供

## 部署方式

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV Namespace

在 Cloudflare Dashboard 或 Wrangler 中创建一个 KV：

```bash
npx wrangler kv namespace create SUB_STORE
npx wrangler kv namespace create SUB_STORE --preview
```

然后把得到的 `id` 和 `preview_id` 填到 `wrangler.toml`。

### 3. 配置 Secret / Variables

```bash
npx wrangler secret put SUB_ACCESS_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

可选普通变量：

```bash
npx wrangler secret put UI_TITLE
```

如果你希望覆盖内置候选池，也可以添加：

- `ADD`
- `ADDAPI`
- `ADDCSV`
- `ADDNOTLS`
- `ADDNOTLSAPI`
- `DLS`
- `CSVREMARK`

### 4. 本地调试

```bash
npm run dev
```

### 5. 运行测试

```bash
npm test
```

### 6. 部署

```bash
npm run deploy
```

## 首次配置流程

1. 部署 Worker
2. 打开 `/`
3. 输入 `ADMIN_TOKEN`
4. 在“基础节点配置”里保存你的原始节点
5. 点击“开始 Top200 优选”
6. 把固定订阅链接导入你的客户端

之后的日常更新，只需要：

1. 打开 `/`
2. 点击“开始 Top200 优选”
3. 回到客户端点“更新订阅”

## 免费套餐下的说明与限制

这个实现默认面向 Cloudflare 免费套餐：

- 只需要一个 Worker
- 只需要一个 KV Namespace
- 不依赖 VPS
- 不依赖单独后端服务器
- 优选流程为一次请求内同步执行，适合轻量候选源场景

需要注意：

- 如果你把 `ADDAPI` / `ADDCSV` 指向很多外部源，请控制数量与响应时间
- 免费套餐下不适合把优选流程做成超长时间、超高并发的任务
- 本项目默认内置一份 seed CSV 和 seed TXT，开箱即可产出 Top200

## 测试覆盖

已包含以下测试：

- 节点解析
  - `vmess`
  - `vless`
  - `trojan`
  - Base64 展开
- 固定订阅流程
  - `save-base`
  - `update-preferred`
  - `status`
  - `/sub/fixed`
- 旧模式回归
  - `/api/generate`
  - `/sub/:id`
- Top200 回归
  - `/api/start` 必须写入 200 条 preferredIps
  - `GET /api/status` 必须返回 200 条
  - `GET /sub/fixed` 必须渲染出 200 条
- 前端集成
  - 点击开始后会调用 `/api/start`
  - 成功后会刷新页面状态

## 参考来源

- Project 1: https://github.com/cmliu/WorkerVless2sub
- Project 2: https://github.com/InfiCheesy/cloudflaresub
- 原作者视频: https://youtu.be/E5PI0LsQ43M?si=HJVtHKTlfaSC-yTr
