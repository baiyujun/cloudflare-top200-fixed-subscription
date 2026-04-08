# Cloudflare Top200 Fixed Subscription

这个仓库现在的主方案是：

- `Worker = 固定订阅发布层`
- `本地 CLI = 主测速 / 主优选执行端`
- `网页 = 状态页 / 辅助页`

也就是说，真正决定最终 `Top200` 的，不再是网页，也不是 Worker，而是**你当前执行设备、当前网络**下运行的本地命令行。

支持的本地执行环境：

- Termux
- Linux
- macOS
- Windows

固定订阅链接仍然保持不变：

- `/sub/fixed`
- `/sub/fixed?target=raw`
- `/sub/fixed?target=clash`
- `/sub/fixed?target=surge`

你每次只需要：

1. 在本地设备执行一条命令
2. 脚本在当前设备当前网络下完成测速和优选
3. 自动把最终 Top200 推送到 Worker
4. 回到订阅客户端点击“更新订阅”

## 当前架构

### 本地 CLI 负责什么

- 获取候选池
- 在当前设备当前网络下执行真实测速
- 产出最终 Top200
- 调用 Worker 的 `/api/update-preferred`

### Worker 负责什么

- 保存基础节点
- 保存最新 `preferredIps`
- 提供固定订阅输出
- 提供状态查询

### 网页负责什么

- 查看当前 fixed subscription 状态
- 保存基础节点
- 查看固定订阅链接
- 提示使用本地 CLI

网页不再是主优选入口，`/api/start` 只保留为兼容路径，并在状态和返回值中明确标记为 deprecated。

## 目录结构

```text
cloudflare-top200-fixed-subscription/
├─ client/
│  ├─ bootstrap.sh
│  ├─ bootstrap.ps1
│  ├─ install-deps.sh
│  ├─ lib.sh
│  ├─ run-update.sh
│  ├─ run-update.ps1
│  ├─ config.example.env
│  └─ README.md
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ styles.css
│  ├─ icons/
│  └─ seed/
│     ├─ ip.txt
│     ├─ ipv6.txt
│     ├─ addressesapi.txt
│     ├─ addressesipv6api.txt
│     ├─ addressescsv.csv
│     └─ CloudflareSpeedTest.csv
├─ src/
│  ├─ auth.js
│  ├─ candidate-pool.js
│  ├─ core.js
│  ├─ fixed.js
│  ├─ http.js
│  ├─ legacy.js
│  ├─ optimizer.js
│  ├─ storage.js
│  └─ worker.js
├─ tests/
│  ├─ helpers/mock-env.mjs
│  ├─ api-status.test.mjs
│  ├─ candidate-pool.test.mjs
│  ├─ client-cli.test.mjs
│  ├─ fixed-subscription.test.mjs
│  ├─ fixed.test.mjs
│  ├─ frontend.test.mjs
│  ├─ regression-runtime-pool.test.mjs
│  ├─ regression-top200.test.mjs
│  └─ smoke.test.mjs
├─ wrangler.toml
├─ package.json
└─ README.md
```

## 主流程

### Unix / Linux / macOS / Termux

```bash
cd client
cp config.example.env config.env
./bootstrap.sh
```

### Windows

```powershell
cd client
Copy-Item config.example.env config.env
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
```

### 日常使用

1. 首次通过网页或 API 保存基础节点
2. 首次 bootstrap 后，在任意目录执行 `subup`
3. 脚本本机测速并生成最新 Top200
4. 脚本自动调用 `/api/update-preferred`
5. 回到订阅客户端点击“更新订阅”

日常需要记住的命令只有一个：

```bash
subup
```

各平台日常命令统一为：

- Unix / Linux / macOS / Termux：`subup`
- Windows：`subup`

Windows 实际是由 `subup.cmd` / `subup.ps1` 提供入口，但用户日常输入仍然只需要 `subup`。

默认推荐导入的固定订阅地址是：

- `https://sub.050721.xyz/sub/fixed?target=clash`

## 本地 CLI 如何工作

本地 CLI 默认集成了 `CloudflareSpeedTest`：

- 会自动为当前平台下载对应的 CFST 可执行文件
- 默认读取 `public/seed/ip.txt`
- 在当前设备当前网络下做延迟/下载测速
- 默认生成 `Top200`
- 把结果转换为 Worker 所需的 `preferredIps`

默认候选模式：

- `CANDIDATE_SOURCE_MODE=cfst_ipv4_ranges`

这表示脚本主要使用 `CloudflareSpeedTest` 的 Cloudflare IPv4 段作为候选池来源。

可选补充来源：

- `ADD`
- `ADDAPI`
- `ADDCSV`

它们会被当作补充候选输入，但只提取其中的 `IP / CIDR`。域名不会进入 CFST 本机测速流程。

## 为什么现在改成本地 CLI

之前把主流程放在网页 / Worker 里有一个根本问题：

- Worker 或网页看到的不是你手机、你电脑、你当前网络的真实视角

而你真正需要的是：

- 在你**当前设备**
- 通过你**当前网络**
- 测出对你自己最有意义的优选结果

所以这次改造把主职责纠正为：

- 本地 CLI 做测速和优选
- Worker 只做发布

## Worker 路由

### 主路由

- `GET /sub/fixed`
- `GET /sub/fixed?target=raw`
- `GET /sub/fixed?target=clash`
- `GET /sub/fixed?target=surge`
- `POST /api/save-base`
- `POST /api/update-preferred`
- `GET /api/status`

### 兼容路由

- `POST /api/start`
  - 保留兼容
  - 已标记 deprecated
  - 不再作为 README / 页面中的主流程
- `POST /api/generate`
- `GET /sub/:id`

## /api/update-preferred

本地 CLI 最终调用这个接口：

```json
{
  "preferredIps": [
    "1.2.3.4:443#HKG",
    "1.2.3.5:443#LAX"
  ],
  "source": "local-cli-optimize",
  "candidateMode": "local-cli",
  "candidateCount": 5955,
  "testedCount": 218,
  "lastOptimizedAt": 1712345678901
}
```

Worker 会：

1. 覆盖 fixed subscription 对应的 `preferredIps`
2. 保持 `/sub/fixed` 链接不变
3. 在 `/api/status` 中更新最近执行状态

## 状态页定位

`GET /` 现在只负责：

- 查看固定订阅链接
- 查看 `preferredCount / candidateCount / testedCount / lastOptimizedAt`
- 保存基础节点
- 提示使用 `subup`
- 明确推荐默认订阅地址 `https://sub.050721.xyz/sub/fixed?target=clash`

页面不会再把“点击开始优选”作为主流程。

## 环境变量 / 配置

Worker 侧：

- `SUB_STORE`
- `SUB_ACCESS_TOKEN`
- `ADMIN_TOKEN`
- `UI_TITLE`

本地 CLI 侧主要配置见 [client/config.example.env](/home/hjy/cloudflaresub-publish/client/config.example.env)：

- `WORKER_BASE_URL`
- `ADMIN_TOKEN`
- `SUB_ACCESS_TOKEN`
- `TOP_N=200`
- `OUTPUT_FORMAT=clash`
- `CANDIDATE_SOURCE_MODE`
- `ADD`
- `ADDAPI`
- `ADDCSV`
- `DLS`
- `KEEP_ORIGINAL_HOST=true`

以及 CFST 相关参数：

- `LATENCY_THREADS`
- `LATENCY_PING_COUNT`
- `DOWNLOAD_TEST_COUNT`
- `DOWNLOAD_TEST_SECONDS`
- `TEST_PORT`
- `TEST_URL`
- `USE_HTTPING`
- `HTTPING_STATUS_CODE`
- `LATENCY_UPPER_MS`
- `LATENCY_LOWER_MS`
- `LOSS_RATE_UPPER`
- `MIN_SPEED_MBPS`
- `CF_COLO_FILTER`
- `CFST_EXTRA_ARGS`

## 安全说明

- `ADMIN_TOKEN` 只用于写接口：
  - `/api/save-base`
  - `/api/update-preferred`
  - `/api/start`
- `SUB_ACCESS_TOKEN` 只用于订阅读取鉴权
- 不要把这些 token 写死在公开代码里
- `client/config.env` 建议不要提交到 Git

## 与旧网页主方案的区别

- 旧方案：网页 / Worker 负责主优选
- 新方案：本地 CLI 负责主优选

- 旧方案：测速视角偏向云端执行环境
- 新方案：测速视角来自当前执行设备当前网络

- 旧方案：页面像控制台
- 新方案：页面只是状态页和辅助页

## 固定订阅为什么保持不变

固定不变的是 URL：

- `/sub/fixed`

变化的是 Worker KV 中保存的内容：

- 基础节点
- 最新 `preferredIps`
- 最近更新时间
- 最近执行状态

所以客户端不需要重新导入订阅，只要点击“更新订阅”。

## 测试

```bash
npm test
```

当前测试覆盖：

- 协议解析：
  - `vmess`
  - `vless`
  - `trojan`
  - Base64 订阅展开
- fixed subscription 主链路：
  - `save-base`
  - `update-preferred`
  - `status`
  - `/sub/fixed`
  - 固定 URL 不变
- `/api/start` 兼容回归：
  - 仍可用
  - 已标记 deprecated
- 本地 CLI：
  - 配置解析默认值
  - TopN 默认 200
  - payload 生成
  - `subup` 底层 `run-update.sh` 更新请求构造
  - 错误处理

## 部署

### 安装依赖

```bash
npm install
```

### 配置 Cloudflare Worker

1. 创建 KV Namespace
2. 把 KV 绑定填入 `wrangler.toml`
3. 配置 Worker secrets：

```bash
npx wrangler secret put SUB_ACCESS_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

### 本地调试 / 部署

```bash
npm run dev
npm run deploy
```

## 参考项目

- Project 1: https://github.com/cmliu/WorkerVless2sub
- Project 2: https://github.com/InfiCheesy/cloudflaresub
- CloudflareSpeedTest: https://github.com/XIU2/CloudflareSpeedTest
