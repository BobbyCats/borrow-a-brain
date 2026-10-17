#!/bin/sh
# One entry for installed source and standalone packages. No PATH mutation.
set -eu
bab_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ -f "$bab_dir/bin/bab" ]; then
  exec "$bab_dir/bin/bab" "$@"
fi
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '借个脑子缺少运行环境：请由安装 Agent 取得匹配平台的独立包；没有对应独立包时，从 Node.js 官网准备 Node.js 22+ 后重试。' >&2
  exit 78
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  printf '%s\n' '借个脑子需要 Node.js 22+：请由安装 Agent 准备兼容版本，或使用匹配平台的独立包。' >&2
  exit 78
fi
exec node "$bab_dir/scripts/run.mjs" "$@"
