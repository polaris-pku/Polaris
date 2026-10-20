/**
 * LiteLLMToolCallingClient — 支持 tool-calling 的 LiteLLM 适配器
 *
 * 实现 ToolCallingClient 接口，底层使用：
 * - LiteLLMClient（model pool + config，供模型解析）
 * - Vercel AI SDK 的 generateText（直接调用，不自动执行工具）
 *
 * 与 LiteLLMClientAdapter 的区别：
 * - LiteLLMClientAdapter 实现 LlmClient（简单 complete，用于经验提取等）
 * - LiteLLMToolCallingClient 实现 ToolCallingClient（tool-calling，用于 Agent 循环）
 *
 * 为什么直接调用 generateText 而不是 LiteLLMClient.completeWithTools：
 * - Agent 循环需要 LLM 返回原始 tool_calls，由 Agent 手动执行并反馈结果
 * - LiteLLMClient.completeWithTools 基于 AI SDK，会通过 execute handler 自动执行工具
 * - 直接调用 generateText 不传 execute handler，即可让 SDK 返回原始 tool_calls
 *
 * 用法：
 * ```ts
 * const llm = new LiteLLMToolCallingClient();
 * const result = await llm.completeWithTools({
 *   messages: [...],
 *   tools: [...],
 * });
 * ```
 *
 * 环境变量：
 * - LLM_PROVIDER=deepseek + DEEPSEEK_API_KEY → 自动映射为 openai provider + deepseek base URL
 * - 也支持直接设置 OPENAI_API_KEY / ANTHROPIC_API_KEY
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, jsonSchema, type LanguageModel } from 'ai';
import { LiteLLMClient } from '../../litellm';
import { createCredentiallessAnthropicProvider } from '../../litellm/credentialless-anthropic-provider';
import type { Tool, ToolCall } from '../../litellm';
import { recordProxyLlmUsage } from '../../telemetry/llm-usage-ledger';
import type {
  ToolCallingClient,
  ToolCallMessage,
  ToolDefinition,
  ToolCallResult,
} from '../runtime/tool';

// ──────────────────────────────────────────────
// 环境变量加载（与 litellm-client-adapter.ts 共享相同逻辑）
// ──────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // 文件不存在 → 跳过
  }
}

function loadLocalEnv(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(moduleDir, '..', '..', '..');
  const memoryDir = resolve(moduleDir, '..');

  loadEnvFile(resolve(projectRoot, '.env.local'));
  loadEnvFile(resolve(memoryDir, '.env'));

  if (process.env.LLM_PROVIDER === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = process.env.DEEPSEEK_API_KEY;
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = 'https://api.deepseek.com/v1';
    }
  }
}

// ──────────────────────────────────────────────
// Provider 解析（与 LiteLLMClient 内部逻辑一致）
// ──────────────────────────────────────────────

async function resolveProviderModel(
  provider: string,
  modelId: string,
  explicit?: { apiKey?: string; baseUrl?: string },
): Promise<LanguageModel> {
  switch (provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const apiKey = explicit?.apiKey ?? process.env.OPENAI_API_KEY;
      const baseURL = explicit?.baseUrl
        ? normalizeProviderBaseUrl(explicit.baseUrl)
        : process.env.OPENAI_BASE_URL;
      // 显式按当前 env 创建 provider：模块级默认 `openai` 实例在模块加载时
      // 读取 OPENAI_BASE_URL，若当时未设置会被钉死在 api.openai.com。
      return createOpenAI({
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      }).chat(modelId) as LanguageModel;
    }
    case 'anthropic': {
      if (process.env.NEWIDE_LLM_CREDENTIALLESS === '1') {
        const baseURL = process.env.NEWIDE_LLM_BASE_URL?.trim();
        if (!baseURL) throw new Error('Local proxy requires NEWIDE_LLM_BASE_URL');
        return createCredentiallessAnthropicProvider(baseURL).messages(modelId);
      }
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      // 显式凭据优先，且**不再**回落到 DEEPSEEK_API_KEY：那是 OpenAI 协议的 key，
      // 喂给 Anthropic Messages 端点只会得到 401，把它藏起来反而更难排查。
      const apiKey =
        explicit?.apiKey ??
        process.env.ANTHROPIC_AUTH_TOKEN ??
        process.env.ANTHROPIC_API_KEY;
      const baseUrl = explicit?.baseUrl ?? process.env.ANTHROPIC_BASE_URL;
      const baseURL = baseUrl ? normalizeProviderBaseUrl(baseUrl) : undefined;
      return createAnthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      })(modelId) as LanguageModel;
    }
    default:
      throw new Error(
        `LiteLLMToolCallingClient: unknown provider "${provider}". ` +
          `Supported: openai, anthropic.`,
      );
  }
}

/**
 * The SDKs append `/messages` or `/chat/completions`, so preserve provider
 * prefixes such as `/anthropic` and include the version exactly once.
 */
function normalizeProviderBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function preferAnthropicCompat(): boolean {
  const base = process.env.ANTHROPIC_BASE_URL?.trim() ?? '';
  return base.length > 0 && /deepseek|anthropic/i.test(base);
}

// ──────────────────────────────────────────────
// 类型转换帮助函数
// ──────────────────────────────────────────────

/** ToolDefinition[] → Tool[]（结构完全一致） */
function toLiteLLMTools(defs: ToolDefinition[]): Tool[] {
  return defs.map((d) => ({
    type: 'function' as const,
    function: {
      name: d.function.name,
      description: d.function.description,
      parameters: d.function.parameters,
    },
  }));
}

/** AI SDK 的 toolCalls 转内存模块 ToolCall[] */
function toToolCalls(resultToolCalls: unknown[]): ToolCall[] {
  return resultToolCalls.map((tc: unknown) => {
    const t = tc as { toolCallId: string; toolName: string; args?: unknown; input?: unknown };
    const raw = t.args ?? t.input;
    return {
      id: t.toolCallId,
      type: 'function' as const,
      function: {
        name: t.toolName,
        arguments: typeof raw === 'string' ? raw : JSON.stringify(raw),
      },
    };
  });
}

// ──────────────────────────────────────────────
// LiteLLMToolCallingClient
// ──────────────────────────────────────────────

/** 默认 task profile（对应 config/memory-query.yaml） */
const DEFAULT_TASK_NAME = 'memory-query';

export interface LiteLLMToolCallingClientOptions {
  /** LiteLLM 任务类型（默认 'memory-query'，对应 config/memory-query.yaml） */
  taskName?: string;
  /** 是否加载环境变量（默认 true，设为 false 可跳过） */
  loadEnv?: boolean;

  /**
   * 模型名称覆盖（如 'deepseek-v4-flash'）。
   * 只覆盖 provider 与 model；temperature 与 maxTokens 仍按 task profile 解析。
   * （profile 的 timeoutMs / maxRetries 目前未在本客户端生效。）
   * 未传时回退 DEEPSEEK_MODEL，避免 eval 仍打已下线的 deepseek-chat。
   */
  model?: string;
  /**
   * API key override. Only the legacy path without `protocol` updates
   * process.env.OPENAI_API_KEY; explicit protocols pass credentials per request.
   */
  apiKey?: string;
  /**
   * Provider root or versioned base URL, with provider-specific prefixes preserved.
   * Only the legacy path without `protocol` updates process.env.OPENAI_BASE_URL.
   */
  baseUrl?: string;
  /**
   * 显式协议：`anthropic` 走 Messages API，`openai` 走 chat/completions。
   *
   * 传入时它**完全**决定 provider 与凭据落点 —— 不再从 base URL 字样猜协议，也不再
   * 借用 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ANTHROPIC_*` 这些进程级变量。
   * 不传时保持旧行为（读环境变量 + `preferAnthropicCompat` 猜测），供未显式配置的
   * 既有调用方（driver 兜底路径）继续工作。
   */
  protocol?: 'anthropic' | 'openai';
}

export class LiteLLMToolCallingClient implements ToolCallingClient {
  private readonly client: LiteLLMClient;
  private readonly taskName: string;
  private readonly modelOverride: string | undefined;
  /** 显式协议；未设时回退到「读环境变量 + 猜」。 */
  private readonly explicitProtocol: 'anthropic' | 'openai' | undefined;
  private readonly explicitApiKey: string | undefined;
  private readonly explicitBaseUrl: string | undefined;

  constructor(options: LiteLLMToolCallingClientOptions = {}) {
    this.taskName = options.taskName ?? DEFAULT_TASK_NAME;
    this.explicitProtocol = options.protocol;
    this.explicitApiKey = options.apiKey;
    this.explicitBaseUrl = options.baseUrl;

    // 显式 protocol 时**不写** OPENAI_API_KEY / OPENAI_BASE_URL：那会把一份 Anthropic 端点
    // 的凭据写进 OpenAI 的环境槽位，既污染同进程内其它调用方，也会让 provider 解析误判。
    // 凭据改为随请求走（见 resolveProviderModel），只有走旧的环境变量路径才需要写回。
    if (!this.explicitProtocol) {
      if (options.apiKey) {
        process.env.OPENAI_API_KEY = options.apiKey;
      }
      if (options.baseUrl) {
        process.env.OPENAI_BASE_URL = normalizeProviderBaseUrl(options.baseUrl);
      }
    }

    // 加载环境变量（支持 DEEPSEEK_API_KEY → OPENAI_API_KEY 映射）
    if (options.loadEnv !== false) {
      loadLocalEnv();
    }

    this.modelOverride = options.model?.trim() || process.env.DEEPSEEK_MODEL?.trim() || undefined;

    this.client = new LiteLLMClient();
    this.client.registerProvider('openai', async (modelId: string) => {
      const { openai } = await import('@ai-sdk/openai');
      return openai.chat(modelId);
    });
    this.client.loadConfig();
  }

  async completeWithTools(input: {
    messages: ToolCallMessage[];
    tools: ToolDefinition[];
    tool_choice?: 'auto' | 'none';
  }): Promise<ToolCallResult> {
    // 1. 解析模型：
    //    - 传了 modelOverride → 使用 openai provider + 指定 model
    //    - 没传 → 从 LiteLLMClient 的 model pool 按 YAML 配置解析
    //
    // 无论走哪条路，temperature / maxTokens 都取 task profile——modelOverride 只该
    // 覆盖 provider 与 model。此前覆盖分支把两者写死成 0.3 / 2000，使 memory-query.yaml
    // 的 maxTokens 从未生效：长响应被截断在 JSON 字符串中间，经验提取静默降级到规则版。
    let providerName: string;
    let modelId: string;

    const registeredTasks = this.client.modelPool.config.getTasks();
    const resolved = this.client.modelPool.resolve(
      registeredTasks.includes(this.taskName) ? this.taskName : DEFAULT_TASK_NAME,
    );

    if (process.env.NEWIDE_LLM_CREDENTIALLESS === '1') {
      const proxyModel = process.env.NEWIDE_LLM_MODEL?.trim();
      if (!proxyModel) throw new Error('Local proxy requires NEWIDE_LLM_MODEL');
      providerName = 'anthropic';
      modelId = proxyModel;
    } else if (this.explicitProtocol) {
      // 显式协议：调用方已经声明了端点讲哪种协议，这里不再猜、不再回落环境变量。
      providerName = this.explicitProtocol;
      modelId = this.modelOverride ?? resolved.model;
    } else if (this.modelOverride) {
      providerName = preferAnthropicCompat() ? 'anthropic' : 'openai';
      modelId = this.modelOverride;
    } else {
      providerName = resolved.provider;
      modelId = resolved.model;
      if (preferAnthropicCompat() && providerName === 'openai') {
        providerName = 'anthropic';
      }
    }
    const { temperature, maxTokens } = resolved;

    // 2. 解析 provider 得到 AI SDK model 实例
    const model = await resolveProviderModel(
      providerName,
      modelId,
      this.explicitProtocol
        ? {
            ...(this.explicitApiKey ? { apiKey: this.explicitApiKey } : {}),
            ...(this.explicitBaseUrl ? { baseUrl: this.explicitBaseUrl } : {}),
          }
        : undefined,
    );

    // 3. 转换消息：AI SDK v7 要求 system 消息通过 system 参数传入
    const systemParts: string[] = [];
    const nonSystemMessages = input.messages.filter((m) => {
      if (m.role === 'system') {
        systemParts.push(m.content ?? '');
        return false;
      }
      return true;
    });
    // 构建 assistant tool_call_id → toolName 查找表
    const toolCallNameMap = new Map<string, string>();
    for (const m of nonSystemMessages) {
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          toolCallNameMap.set(tc.id, tc.function.name);
        }
      }
    }

    const aiMessages = nonSystemMessages.map((m) => {
      if (m.role === 'tool') {
        // AI SDK v7 的 ToolResultPart: { type, toolCallId, toolName, output: { type, value } }
        const rawContent = m.content ?? '{}';
        let parsed: unknown = rawContent;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          /* 保持原样 */
        }
        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: m.tool_call_id ?? '',
              toolName: toolCallNameMap.get(m.tool_call_id ?? '') ?? 'unknown',
              output: { type: 'json' as const, value: parsed },
            },
          ],
        };
      }

      // assistant 消息：tool_calls 必须放入 content 数组（AI SDK v7 格式）
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const content: Record<string, unknown>[] = [];
        if (m.content) {
          content.push({ type: 'text' as const, text: m.content });
        }
        for (const tc of m.tool_calls) {
          let input: unknown = tc.function.arguments;
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            /* keep string */
          }
          content.push({
            type: 'tool-call' as const,
            toolCallId: tc.id,
            toolName: tc.function.name,
            input,
          });
        }
        return { role: 'assistant' as const, content };
      }

      // user 消息
      return { role: m.role, content: m.content ?? '' };
    });

    // 4. 构建工具定义（不传 execute handler → AI SDK 不自动执行）
    const liteTools = toLiteLLMTools(input.tools);
    const tools: Record<string, unknown> = {};
    for (const t of liteTools) {
      tools[t.function.name] = {
        description: t.function.description,
        inputSchema: jsonSchema(t.function.parameters as Record<string, unknown>),
        // 不传 execute → SDK 只返回 tool_calls，不执行
      };
    }

    // 5. 直接调用 AI SDK generateText（不经过 LiteLLMClient.completeWithTools）
    const generateParams: Record<string, unknown> = {
      model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: aiMessages,
      ...(process.env.NEWIDE_LLM_CREDENTIALLESS === '1' ? {} : { temperature }),
      maxOutputTokens: maxTokens,
    };
    if (liteTools.length > 0) {
      generateParams.tools = tools;
    }
    const result = await generateText(generateParams as Parameters<typeof generateText>[0]);
    await recordProxyLlmUsage({
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
      model: modelId,
      temperature,
      source: 'proxy',
    });
    return {
      content: result.text ?? null,
      tool_calls:
        result.toolCalls && result.toolCalls.length > 0
          ? toToolCalls(result.toolCalls as unknown[])
          : undefined,
    };
  }
}
