# git 钩子跑在非交互 shell 里，不会加载 shell 配置 —— 于是 PATH 上是系统默认 Node。
# 本仓要求 Node >= 22.22.1（packages/ 下 A 与 BCD 的 engines），且 pnpm 11 自身要求
# Node >= 22.13：默认 Node 若是 20，钩子里的 pnpm 会直接崩（node:sqlite 不存在）。
# 所以这里按 .nvmrc 切到正确的 Node 版本；没装 nvm 就原样放行（假定 PATH 上已是对的）。
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use >/dev/null 2>&1 || true
fi
