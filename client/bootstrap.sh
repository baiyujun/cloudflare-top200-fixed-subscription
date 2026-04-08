#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

CONFIG_PATH="$(client_default_config_path)"
INSTALL_DIR="${SUBUP_INSTALL_DIR:-}"

client_log "开始初始化本地 CLI 环境..."
if [[ "${SUBUP_SKIP_DEPS:-0}" != "1" ]]; then
  "${SCRIPT_DIR}/install-deps.sh"
else
  client_warn "已跳过依赖安装（SUBUP_SKIP_DEPS=1）"
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp "${SCRIPT_DIR}/config.example.env" "${CONFIG_PATH}"
  client_log "已生成配置文件：${CONFIG_PATH}"
else
  client_log "配置文件已存在：${CONFIG_PATH}"
fi

client_load_config "${CONFIG_PATH}"
if [[ "${SUBUP_SKIP_CFST:-0}" != "1" ]]; then
  client_ensure_cfst
else
  client_warn "已跳过 CFST 安装（SUBUP_SKIP_CFST=1）"
fi

COMMAND_PATH="$(client_install_unix_subup_command "${INSTALL_DIR}" "${CONFIG_PATH}")"

cat <<EOF

初始化完成
- 配置文件：${CONFIG_PATH}
- CFST 路径：${CFST_BIN}
- 全局命令：${COMMAND_PATH}

下一步：
1. 编辑 ${CONFIG_PATH}
2. 填写 WORKER_BASE_URL / ADMIN_TOKEN 等配置
3. 在任意目录执行：subup

如果当前 shell 还没识别到 subup，请重新打开终端，或执行：
source ~/.profile
EOF
