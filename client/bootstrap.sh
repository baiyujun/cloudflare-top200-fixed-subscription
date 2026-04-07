#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

CONFIG_PATH="$(client_default_config_path)"

client_log "开始初始化本地 CLI 环境..."
"${SCRIPT_DIR}/install-deps.sh"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp "${SCRIPT_DIR}/config.example.env" "${CONFIG_PATH}"
  client_log "已生成配置文件：${CONFIG_PATH}"
else
  client_log "配置文件已存在：${CONFIG_PATH}"
fi

client_load_config "${CONFIG_PATH}"
client_ensure_cfst

cat <<EOF

初始化完成
- 配置文件：${CONFIG_PATH}
- CFST 路径：${CFST_BIN}

下一步：
1. 编辑 ${CONFIG_PATH}
2. 填写 WORKER_BASE_URL / ADMIN_TOKEN 等配置
3. 执行：cd client && ./run-update.sh
EOF
