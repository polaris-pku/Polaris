#!/usr/bin/env bash
# 一键启动开发服务器（使用项目内置的本地 Node 运行时，无需全局安装 Node）
set -e
cd "$(dirname "$0")"
export PATH="$PWD/.node/bin:$PATH"

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi

echo "启动 Polaris -> http://localhost:5173/"
npm run dev
