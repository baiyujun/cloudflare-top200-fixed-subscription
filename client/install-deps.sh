#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/lib.sh"

install_with_termux_pkg() {
  pkg update -y
  pkg install -y bash curl jq tar coreutils gawk grep sed procps
}

install_with_apt() {
  sudo apt-get update
  sudo apt-get install -y bash curl jq tar coreutils gawk grep sed
}

install_with_dnf() {
  sudo dnf install -y bash curl jq tar coreutils gawk grep sed
}

install_with_yum() {
  sudo yum install -y bash curl jq tar coreutils gawk grep sed
}

install_with_pacman() {
  sudo pacman -Sy --noconfirm bash curl jq tar coreutils gawk grep sed
}

install_with_brew() {
  brew install jq gawk
}

main() {
  if command -v pkg >/dev/null 2>&1; then
    client_log "检测到 Termux，开始安装依赖..."
    install_with_termux_pkg
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    client_log "检测到 apt-get，开始安装依赖..."
    install_with_apt
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    client_log "检测到 dnf，开始安装依赖..."
    install_with_dnf
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    client_log "检测到 yum，开始安装依赖..."
    install_with_yum
    return 0
  fi

  if command -v pacman >/dev/null 2>&1; then
    client_log "检测到 pacman，开始安装依赖..."
    install_with_pacman
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    client_log "检测到 Homebrew，开始安装依赖..."
    install_with_brew
    return 0
  fi

  client_die "未识别到支持的包管理器。请手动安装：bash curl jq tar gawk grep sed"
}

main "$@"
