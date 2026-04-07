# Local CLI Client

本目录是仓库当前的主方案：在**当前执行设备、当前网络**下运行本地测速与优选，然后只把最终 Top200 推送到 Worker 固定订阅。

支持环境：

- Termux
- Linux
- macOS
- Windows

入口文件：

- `run-update.sh`
  - 适用于 Termux / Linux / macOS
- `run-update.ps1`
  - 适用于 Windows PowerShell
- `bootstrap.sh`
  - Unix 系初始化脚本
- `bootstrap.ps1`
  - Windows 初始化脚本

## Unix / Termux / macOS

```bash
cd client
cp config.example.env config.env
./bootstrap.sh
./run-update.sh
```

## Windows

```powershell
cd client
Copy-Item config.example.env config.env
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
powershell -ExecutionPolicy Bypass -File .\run-update.ps1
```

## 配置说明

至少需要填写：

- `WORKER_BASE_URL`
- `ADMIN_TOKEN`

默认行为：

- `TOP_N=200`
- `CANDIDATE_SOURCE_MODE=cfst_ipv4_ranges`
- 自动下载当前平台对应的 `CloudflareSpeedTest` 可执行文件
- 使用当前设备网络执行本机测速
- 完成后调用 Worker 的 `/api/update-preferred`

## 结果

脚本执行成功后会输出：

- 候选池总数
- 测速成功数
- 最终写入的 Top200 数量
- 固定订阅地址

然后只需要回到订阅客户端点击“更新订阅”。
