#!/usr/bin/env bash

set -euo pipefail

CLIENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${CLIENT_DIR}/.." && pwd)"
CLIENT_BIN_DIR="${CLIENT_DIR}/bin"

client_log() {
  printf '[client] %s\n' "$*"
}

client_warn() {
  printf '[client][warn] %s\n' "$*" >&2
}

client_die() {
  printf '[client][error] %s\n' "$*" >&2
  exit 1
}

client_require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || client_die "缺少依赖命令：${command_name}"
}

client_is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

client_trim() {
  printf '%s' "${1:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

client_default_config_path() {
  printf '%s/config.env' "${CLIENT_DIR}"
}

client_detect_platform() {
  case "$(uname -s)" in
    Linux) printf 'linux' ;;
    Darwin) printf 'darwin' ;;
    *)
      client_die "run-update.sh 仅支持 Linux / macOS / Termux。Windows 请使用 client/run-update.ps1"
      ;;
  esac
}

client_detect_arch() {
  case "$(uname -m)" in
    aarch64|arm64) printf 'arm64' ;;
    armv7l|armv7*) printf 'armv7' ;;
    armv6l|armv6*) printf 'armv6' ;;
    armv5*|arm) printf 'armv5' ;;
    x86_64|amd64) printf 'amd64' ;;
    i386|i686) printf '386' ;;
    *)
      client_die "当前架构暂不支持自动安装 CFST：$(uname -m)"
      ;;
  esac
}

client_load_config() {
  local config_path="${1:-$(client_default_config_path)}"
  [[ -f "${config_path}" ]] || client_die "配置文件不存在：${config_path}"

  set -a
  # shellcheck disable=SC1090
  . "${config_path}"
  set +a

  WORKER_BASE_URL="$(client_trim "${WORKER_BASE_URL:-}")"
  ADMIN_TOKEN="$(client_trim "${ADMIN_TOKEN:-}")"

  [[ -n "${WORKER_BASE_URL}" ]] || client_die "缺少 WORKER_BASE_URL"
  [[ -n "${ADMIN_TOKEN}" ]] || client_die "缺少 ADMIN_TOKEN"

  WORKER_BASE_URL="${WORKER_BASE_URL%/}"
  TOP_N="${TOP_N:-200}"
  OUTPUT_FORMAT="${OUTPUT_FORMAT:-clash}"
  CANDIDATE_SOURCE_MODE="${CANDIDATE_SOURCE_MODE:-cfst_ipv4_ranges}"
  KEEP_ORIGINAL_HOST="${KEEP_ORIGINAL_HOST:-true}"
  DLS="${DLS:-0}"
  CFST_RELEASE_API="${CFST_RELEASE_API:-https://api.github.com/repos/XIU2/CloudflareSpeedTest/releases/latest}"
  CFST_BIN="${CFST_BIN:-${CLIENT_BIN_DIR}/cfst}"
  CFST_IP_FILE="${CFST_IP_FILE:-${REPO_ROOT}/public/seed/ip.txt}"
  CFST_IPV6_FILE="${CFST_IPV6_FILE:-${REPO_ROOT}/public/seed/ipv6.txt}"
  ENABLE_IPV6="${ENABLE_IPV6:-false}"
  LATENCY_THREADS="${LATENCY_THREADS:-200}"
  LATENCY_PING_COUNT="${LATENCY_PING_COUNT:-4}"
  DOWNLOAD_TEST_COUNT="${DOWNLOAD_TEST_COUNT:-${TOP_N}}"
  DOWNLOAD_TEST_SECONDS="${DOWNLOAD_TEST_SECONDS:-10}"
  TEST_PORT="${TEST_PORT:-443}"
  TEST_URL="${TEST_URL:-}"
  USE_HTTPING="${USE_HTTPING:-false}"
  HTTPING_STATUS_CODE="${HTTPING_STATUS_CODE:-}"
  LATENCY_UPPER_MS="${LATENCY_UPPER_MS:-9999}"
  LATENCY_LOWER_MS="${LATENCY_LOWER_MS:-0}"
  LOSS_RATE_UPPER="${LOSS_RATE_UPPER:-1.00}"
  MIN_SPEED_MBPS="${MIN_SPEED_MBPS:-0}"
  CF_COLO_FILTER="${CF_COLO_FILTER:-}"
  UPDATE_SOURCE="${UPDATE_SOURCE:-local-cli-optimize}"
  CLIENT_WORKDIR="${CLIENT_WORKDIR:-${CLIENT_DIR}/.work}"
  CFST_EXTRA_ARGS="${CFST_EXTRA_ARGS:-}"

  export WORKER_BASE_URL ADMIN_TOKEN TOP_N OUTPUT_FORMAT CANDIDATE_SOURCE_MODE
  export KEEP_ORIGINAL_HOST DLS CFST_RELEASE_API CFST_BIN CFST_IP_FILE CFST_IPV6_FILE ENABLE_IPV6
  export LATENCY_THREADS LATENCY_PING_COUNT DOWNLOAD_TEST_COUNT DOWNLOAD_TEST_SECONDS TEST_PORT
  export TEST_URL USE_HTTPING HTTPING_STATUS_CODE LATENCY_UPPER_MS LATENCY_LOWER_MS LOSS_RATE_UPPER
  export MIN_SPEED_MBPS CF_COLO_FILTER UPDATE_SOURCE CLIENT_WORKDIR CFST_EXTRA_ARGS REPO_ROOT CLIENT_BIN_DIR
}

client_install_cfst() {
  client_require_command curl
  client_require_command jq
  client_require_command tar

  mkdir -p "${CLIENT_BIN_DIR}"

  local release_json asset_name download_url tmp_root archive_path
  local platform arch
  platform="$(client_detect_platform)"
  arch="$(client_detect_arch)"
  asset_name="cfst_${platform}_${arch}.tar.gz"
  tmp_root="$(mktemp -d)"
  release_json="${tmp_root}/release.json"
  archive_path="${tmp_root}/${asset_name}"

  client_log "查询 CloudflareSpeedTest 最新版本..."
  curl -fsSL "${CFST_RELEASE_API}" -o "${release_json}"
  download_url="$(
    jq -r --arg asset "${asset_name}" '.assets[] | select(.name == $asset) | .browser_download_url' "${release_json}" \
      | head -n 1
  )"
  [[ -n "${download_url}" && "${download_url}" != "null" ]] || client_die "未找到适配当前平台的 CFST 发行包：${asset_name}"

  client_log "下载 ${asset_name} ..."
  curl -fsSL "${download_url}" -o "${archive_path}"
  tar -xzf "${archive_path}" -C "${tmp_root}"
  [[ -f "${tmp_root}/cfst" ]] || client_die "CFST 压缩包解压后未找到 cfst 可执行文件。"

  install -m 0755 "${tmp_root}/cfst" "${CFST_BIN}"
  rm -rf "${tmp_root}"
  client_log "CFST 已安装到 ${CFST_BIN}"
}

client_ensure_cfst() {
  if [[ -x "${CFST_BIN}" ]]; then
    return 0
  fi
  client_install_cfst
}

client_prepare_workdir() {
  mkdir -p "${CLIENT_WORKDIR}"
  printf '%s\n' "${CLIENT_WORKDIR}"
}

client_fetch_source_to_file() {
  local source="$1"
  local destination="$2"

  if [[ -z "${source}" ]]; then
    : > "${destination}"
    return 0
  fi

  if [[ "${source}" =~ ^https?:// ]]; then
    curl -fsSL "${source}" -o "${destination}"
    return 0
  fi

  if [[ -f "${source}" ]]; then
    cp "${source}" "${destination}"
    return 0
  fi

  printf '%s\n' "${source}" > "${destination}"
}

client_is_ip_token() {
  local token
  token="$(client_trim "${1:-}")"
  [[ -n "${token}" ]] || return 1
  [[ "${token}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]] && return 0
  [[ "${token}" =~ : ]] && return 0
  return 1
}

client_append_text_candidates() {
  local input_file="$1"
  local output_file="$2"

  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line token
    line="$(client_trim "${raw_line}")"
    [[ -n "${line}" ]] || continue
    IFS=',; ' read -r -a tokens <<< "${line}"
    for token in "${tokens[@]}"; do
      token="$(client_trim "${token}")"
      if client_is_ip_token "${token}"; then
        printf '%s\n' "${token}" >> "${output_file}"
      fi
    done
  done < "${input_file}"
}

client_append_csv_candidates() {
  local input_file="$1"
  local output_file="$2"

  awk -F',' -v dls="${DLS}" '
    function trim(value) {
      gsub(/^[ \t"\r]+|[ \t"\r]+$/, "", value)
      return value
    }
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        column = trim($i)
        lower = tolower(column)
        if (lower == "ip地址" || lower == "ip" || lower == "address") ip_index = i
        if (lower == "速度(mb/s)" || lower == "下载速度(mb/s)" || lower == "speed(mb/s)" || lower == "speed") speed_index = i
      }
      next
    }
    NF > 0 {
      host = trim(ip_index ? $ip_index : $1)
      speed = speed_index ? trim($speed_index) + 0 : dls + 1
      if (host != "" && speed >= dls) {
        print host
      }
    }
  ' "${input_file}" | while IFS= read -r token; do
    if client_is_ip_token "${token}"; then
      printf '%s\n' "${token}" >> "${output_file}"
    fi
  done
}

client_append_config_sources() {
  local raw_sources="$1"
  local mode="$2"
  local output_file="$3"
  local tmp_root="$4"
  local index=0

  [[ -n "${raw_sources}" ]] || return 0

  while IFS= read -r source || [[ -n "${source}" ]]; do
    source="$(client_trim "${source}")"
    [[ -n "${source}" ]] || continue
    local fetched_file="${tmp_root}/source-${mode}-${index}.txt"
    client_fetch_source_to_file "${source}" "${fetched_file}"
    if [[ "${mode}" == "csv" ]]; then
      client_append_csv_candidates "${fetched_file}" "${output_file}"
    else
      client_append_text_candidates "${fetched_file}" "${output_file}"
    fi
    index=$((index + 1))
  done < <(printf '%s\n' "${raw_sources}" | tr ',;' '\n')
}

client_build_candidate_file() {
  local destination="$1"
  local tmp_root="$2"
  : > "${destination}"

  case "${CANDIDATE_SOURCE_MODE}" in
    cfst_ipv4_ranges|hybrid)
      [[ -f "${CFST_IP_FILE}" ]] || client_die "默认 IPv4 候选文件不存在：${CFST_IP_FILE}"
      cat "${CFST_IP_FILE}" >> "${destination}"
      ;;
    custom_only)
      ;;
    *)
      client_die "不支持的 CANDIDATE_SOURCE_MODE：${CANDIDATE_SOURCE_MODE}"
      ;;
  esac

  if client_is_true "${ENABLE_IPV6}" && [[ -f "${CFST_IPV6_FILE}" ]]; then
    cat "${CFST_IPV6_FILE}" >> "${destination}"
  fi

  local add_file="${tmp_root}/add.txt"
  printf '%s\n' "${ADD:-}" > "${add_file}"
  client_append_text_candidates "${add_file}" "${destination}"
  client_append_config_sources "${ADDAPI:-}" "text" "${destination}" "${tmp_root}"
  client_append_config_sources "${ADDCSV:-}" "csv" "${destination}" "${tmp_root}"

  awk 'NF { if (!seen[$0]++) print $0 }' "${destination}" > "${destination}.dedupe"
  mv "${destination}.dedupe" "${destination}"
}

client_estimate_candidate_count() {
  local candidate_file="$1"
  awk '
    function trim(value) {
      gsub(/^[ \t\r]+|[ \t\r]+$/, "", value)
      return value
    }
    function pow2(exponent, result, i) {
      result = 1
      for (i = 0; i < exponent; i++) result *= 2
      return result
    }
    {
      line = trim($0)
      if (line == "") next
      if (line ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/) {
        split(line, parts, "/")
        prefix = parts[2] + 0
        if (prefix < 24) total += pow2(24 - prefix)
        else total += 1
        next
      }
      total += 1
    }
    END {
      print total + 0
    }
  ' "${candidate_file}"
}

client_run_cfst() {
  local candidate_file="$1"
  local result_file="$2"
  local log_file="$3"
  local -a args

  mkdir -p "$(dirname "${result_file}")"
  args=(
    -f "${candidate_file}"
    -o "${result_file}"
    -p 0
    -n "${LATENCY_THREADS}"
    -t "${LATENCY_PING_COUNT}"
    -dn "${DOWNLOAD_TEST_COUNT}"
    -dt "${DOWNLOAD_TEST_SECONDS}"
    -tp "${TEST_PORT}"
    -tll "${LATENCY_LOWER_MS}"
    -tl "${LATENCY_UPPER_MS}"
    -tlr "${LOSS_RATE_UPPER}"
  )

  if [[ "$(printf '%.2f' "${MIN_SPEED_MBPS}")" != "0.00" ]]; then
    args+=( -sl "${MIN_SPEED_MBPS}" )
  fi
  if [[ -n "${TEST_URL}" ]]; then
    args+=( -url "${TEST_URL}" )
  fi
  if client_is_true "${USE_HTTPING}"; then
    args+=( -httping )
  fi
  if [[ -n "${HTTPING_STATUS_CODE}" ]]; then
    args+=( -httping-code "${HTTPING_STATUS_CODE}" )
  fi
  if [[ -n "${CF_COLO_FILTER}" ]]; then
    args+=( -cfcolo "${CF_COLO_FILTER}" )
  fi
  if [[ -n "${CFST_EXTRA_ARGS}" ]]; then
    # shellcheck disable=SC2206
    local extra_args=( ${CFST_EXTRA_ARGS} )
    args+=( "${extra_args[@]}" )
  fi

  client_log "开始在当前设备网络下测速：${CFST_BIN} ${args[*]}"
  "${CFST_BIN}" "${args[@]}" | tee "${log_file}"
}

client_extract_preferred_from_result() {
  local result_file="$1"
  local preferred_file="$2"
  local port="${3:-${TEST_PORT}}"

  [[ -f "${result_file}" ]] || client_die "CFST 结果文件不存在：${result_file}"
  : > "${preferred_file}"

  awk -F',' '
    function trim(value) {
      gsub(/^[ \t"\r]+|[ \t"\r]+$/, "", value)
      return value
    }
    NR == 1 { next }
    NF > 0 {
      host = trim($1)
      colo = trim($7)
      if (host != "") {
        if (colo == "" || colo == "N/A") colo = "CFST"
        gsub(/[^A-Za-z0-9._-]/, "-", colo)
        print host "," colo
      }
    }
  ' "${result_file}" | head -n "${TOP_N}" | while IFS=',' read -r host colo; do
    printf '%s:%s#%s\n' "${host}" "${port}" "${colo}" >> "${preferred_file}"
  done
}

client_count_preferred() {
  local preferred_file="$1"
  if [[ ! -f "${preferred_file}" ]]; then
    printf '0\n'
    return 0
  fi
  awk 'NF { count++ } END { print count + 0 }' "${preferred_file}"
}

client_count_tested_results() {
  local result_file="$1"
  if [[ ! -f "${result_file}" ]]; then
    printf '0\n'
    return 0
  fi
  awk 'NR > 1 && NF { count++ } END { print count + 0 }' "${result_file}"
}

client_build_update_payload() {
  local preferred_file="$1"
  local payload_file="$2"
  local candidate_count="$3"
  local tested_count="$4"
  local source_name="$5"
  local last_optimized_at

  last_optimized_at="$(($(date +%s) * 1000))"
  jq -n \
    --rawfile preferred "${preferred_file}" \
    --arg source "${source_name}" \
    --arg candidateMode "local-cli" \
    --argjson lastOptimizedAt "${last_optimized_at}" \
    --argjson candidateCount "${candidate_count}" \
    --argjson testedCount "${tested_count}" \
    '{
      preferredIps: ($preferred | split("\n") | map(select(length > 0))),
      source: $source,
      candidateMode: $candidateMode,
      lastOptimizedAt: $lastOptimizedAt,
      candidateCount: $candidateCount,
      testedCount: $testedCount
    }' > "${payload_file}"
}

client_post_update_payload() {
  local payload_file="$1"
  local response_file="$2"
  local http_code

  http_code="$(
    curl -sS \
      -o "${response_file}" \
      -w '%{http_code}' \
      -X POST \
      "${WORKER_BASE_URL}/api/update-preferred" \
      -H 'content-type: application/json' \
      -H "authorization: Bearer ${ADMIN_TOKEN}" \
      --data "@${payload_file}"
  )"

  if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
    client_die "Worker 更新失败，HTTP ${http_code}：$(cat "${response_file}")"
  fi

  local ok
  ok="$(jq -r '.ok' "${response_file}")"
  [[ "${ok}" == "true" ]] || client_die "Worker 更新失败：$(cat "${response_file}")"
}
