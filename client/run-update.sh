#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

CONFIG_PATH="${1:-$(client_default_config_path)}"
client_load_config "${CONFIG_PATH}"

if [[ -n "${http_proxy:-}${https_proxy:-}${HTTP_PROXY:-}${HTTPS_PROXY:-}" ]]; then
  client_warn "检测到代理环境变量。为了获得当前设备当前网络的真实测速结果，建议关闭代理后再运行。"
fi

client_require_command curl
client_require_command jq
client_require_command awk
client_require_command sed
client_require_command grep
client_require_command tee

client_ensure_cfst

WORK_DIR="$(client_prepare_workdir)"
TMP_ROOT="$(mktemp -d "${WORK_DIR}/run.XXXXXX")"
trap 'rm -rf "${TMP_ROOT}"' EXIT

CANDIDATE_FILE="${TMP_ROOT}/candidates.txt"
RESULT_FILE="${TMP_ROOT}/result.csv"
CFST_LOG_FILE="${TMP_ROOT}/cfst.log"
PREFERRED_FILE="${TMP_ROOT}/preferred.txt"
PAYLOAD_FILE="${TMP_ROOT}/payload.json"
RESPONSE_FILE="${TMP_ROOT}/response.json"

client_build_candidate_file "${CANDIDATE_FILE}" "${TMP_ROOT}"

CANDIDATE_COUNT="$(client_estimate_candidate_count "${CANDIDATE_FILE}")"
RAW_SOURCE_COUNT="$(awk 'NF { count++ } END { print count + 0 }' "${CANDIDATE_FILE}")"

client_log "候选文件已生成：${CANDIDATE_FILE}"
client_log "候选输入行数：${RAW_SOURCE_COUNT}"
client_log "候选池估算总数：${CANDIDATE_COUNT}"
client_log "目标 TopN：${TOP_N}"

client_run_cfst "${CANDIDATE_FILE}" "${RESULT_FILE}" "${CFST_LOG_FILE}"

TESTED_COUNT="$(client_count_tested_results "${RESULT_FILE}")"
client_extract_preferred_from_result "${RESULT_FILE}" "${PREFERRED_FILE}" "${TEST_PORT}"
PREFERRED_COUNT="$(client_count_preferred "${PREFERRED_FILE}")"

if [[ "${PREFERRED_COUNT}" -le 0 ]]; then
  client_die "CFST 没有输出任何可用结果，请检查 TEST_URL / TEST_PORT / 网络环境。"
fi

client_build_update_payload "${PREFERRED_FILE}" "${PAYLOAD_FILE}" "${CANDIDATE_COUNT}" "${TESTED_COUNT}" "${UPDATE_SOURCE}"
client_post_update_payload "${PAYLOAD_FILE}" "${RESPONSE_FILE}"

FIXED_AUTO_URL="$(jq -r '.fixedUrls.auto // .status.fixedUrls.auto // ""' "${RESPONSE_FILE}")"
FIXED_TARGET_URL="$(jq -r --arg output "${OUTPUT_FORMAT}" '.fixedUrls[$output] // .status.fixedUrls[$output] // .fixedUrls.auto // .status.fixedUrls.auto // ""' "${RESPONSE_FILE}")"

client_log "测速成功数：${TESTED_COUNT}"
client_log "最终写入数量：${PREFERRED_COUNT}"
client_log "固定订阅地址：${FIXED_TARGET_URL:-${FIXED_AUTO_URL}}"

printf '\n'
printf '更新成功\n'
printf '候选池总数：%s\n' "${CANDIDATE_COUNT}"
printf '测速成功数：%s\n' "${TESTED_COUNT}"
printf '最终 Top%s 数量：%s\n' "${TOP_N}" "${PREFERRED_COUNT}"
printf '固定订阅：%s\n' "${FIXED_TARGET_URL:-${FIXED_AUTO_URL}}"
printf '下一步：回到订阅客户端点击“更新订阅”。\n'
