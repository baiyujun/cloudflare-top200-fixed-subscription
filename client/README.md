# Local CLI Client

本目录的日常入口已经统一成一个短命令：

- `subup`

支持环境：

- Termux
- Linux
- macOS
- Windows

## 首次初始化

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

`bootstrap` 会自动安装全局短命令：

- Unix：`subup`
- Windows：`subup.cmd` / `subup.ps1`

Windows 虽然安装的是包装入口文件，但日常输入的命令仍然统一为：

- `subup`

安装完成后，用户在任意目录都可以直接输入：

```bash
subup
```

## 日常使用

不再需要：

- `cd client`
- 再执行长脚本名

只需要：

```bash
subup
```

这个命令会自动：

1. 读取配置文件
2. 在当前设备当前网络下执行测速
3. 生成 Top200
4. 调用 Worker 的 `/api/update-preferred`
5. 打印固定订阅地址

## 输出

执行成功后会打印：

- 更新成功 / 失败
- `candidateCount`
- `testedCount`
- `preferredCount`
- 固定订阅四个地址
- 默认推荐订阅地址（Clash）

默认推荐订阅地址优先使用：

- `https://sub.050721.xyz/sub/fixed?target=clash`

## 配置

至少需要填写：

- `WORKER_BASE_URL`
- `ADMIN_TOKEN`

默认：

- `TOP_N=200`
- `CANDIDATE_SOURCE_MODE=cfst_ipv4_ranges`

配置模板见：

- [config.example.env](/home/hjy/cloudflaresub-publish/client/config.example.env)
