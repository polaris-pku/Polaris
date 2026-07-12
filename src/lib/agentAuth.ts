/**
 * agent 认证的展示信息。
 *
 * 存在的理由：用户装完应用后，**根本不知道自己需要哪个 token、去哪拿**。
 * 之前的表现是：提交需求 → agent 起不来 → 界面显示一个语焉不详的失败。
 * 所以这里把「要什么 key / 长什么样 / 去哪申请」全部写在明面上。
 *
 * agent 清单由主进程给（随包分发了哪些，见 electron/backendBridge.cjs 的 AGENTS）——
 * 不列没打进包的 agent，别让用户选一个跑不起来的东西。
 */
export type AgentAuthInfo = {
  /** 这个 agent 要哪种 key */
  keyLabel: string;
  /** 去哪申请 */
  consoleUrl: string;
  consoleName: string;
  /** key 长什么样（帮用户确认自己粘对了） */
  keyHint: string;
};

const AUTH_INFO: Record<string, AgentAuthInfo> = {
  claude: {
    keyLabel: 'Anthropic API Key',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleName: 'Anthropic Console',
    keyHint: '以 sk-ant- 开头',
  },
  gemini: {
    keyLabel: 'Google AI Studio API Key',
    consoleUrl: 'https://aistudio.google.com/apikey',
    consoleName: 'Google AI Studio',
    keyHint: '以 AIza 开头',
  },
  codex: {
    keyLabel: 'OpenAI API Key',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleName: 'OpenAI Platform',
    keyHint: '以 sk- 开头',
  },
};

/** 未登记的 agent：不编造申请地址，只说它认哪个环境变量。 */
export function authInfoOf(agentId: string, envVar: string): AgentAuthInfo {
  return (
    AUTH_INFO[agentId] ?? {
      keyLabel: `${envVar} 的值`,
      consoleUrl: '',
      consoleName: '',
      keyHint: '',
    }
  );
}
