import { useCallback, useEffect, useState } from 'react';
import {
  Settings,
  Boxes,
  KeyRound,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { APP_VERSION } from '@/lib/version';
import { onBackendStatus } from '@/api/events';
import type { BackendStatus } from '@/api/transport';
import { cn } from '@/lib/utils';

/**
 * 设置弹窗。
 *
 * 核心是**认证** —— 这是用户装完应用后唯一必须做的事。
 * 之前这里只是个「关于」框，用户根本不知道自己需要什么 token；提交需求后只看到一个
 * 语焉不详的失败。现在把「用哪家模型 / 要什么 key / 去哪申请」全写在明面上，且随时可改。
 *
 * Claude Code 只会说 Anthropic 的 Messages API —— 不能直接塞一个 DeepSeek 的 key。
 * 但它认 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN，所以任何提供**Anthropic 兼容端点**
 * 的服务都能接。服务商目录由主进程给（见 electron/backendBridge.cjs 的 PROVIDERS）。
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backend = window.desktop?.backend;

  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [providerId, setProviderId] = useState('anthropic');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedConfig, setSavedConfig] = useState<Record<string, DesktopProviderConfig>>({});

  useEffect(() => onBackendStatus(setStatus), []);

  /** 打开弹窗时从主进程拉一次已存配置（key 只回布尔，明文永不回传） */
  const load = useCallback(
    async (pickProvider?: string) => {
      if (!backend) return;
      const s = await backend.getSettings();
      const id = pickProvider ?? s.provider;
      const cfg = s.configured[id];
      setSavedConfig(s.configured);
      setProviderId(id);
      setBaseUrl(cfg?.baseUrl ?? '');
      setModel(cfg?.model ?? '');
      setFastModel(cfg?.fastModel ?? '');
      setKey('');
      setEditingKey(!cfg?.hasKey);
      setReveal(false);
    },
    [backend],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const provider = status?.providers.find((p) => p.id === providerId);
  const saved = savedConfig[providerId];
  const hasSavedKey = !!saved?.hasKey;
  const needsEndpoint = provider ? provider.id !== 'anthropic' : false;

  const save = useCallback(async () => {
    if (!backend || !provider) return;
    setSaving(true);
    try {
      const next = await backend.saveSettings({
        provider: providerId,
        providers: {
          [providerId]: {
            // 不传 key = 保留原值 —— 改模型/端点时不必重新粘一遍 key
            ...(editingKey ? { key: key.trim() } : {}),
            ...(provider.editableBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
            ...(needsEndpoint ? { model: model.trim(), fastModel: fastModel.trim() } : {}),
          },
        },
      });
      setStatus(next);
      await load(providerId);
    } finally {
      setSaving(false);
    }
  }, [
    backend,
    provider,
    providerId,
    editingKey,
    key,
    baseUrl,
    model,
    fastModel,
    needsEndpoint,
    load,
  ]);

  const clearKey = useCallback(async () => {
    if (!backend) return;
    setSaving(true);
    try {
      const next = await backend.saveSettings({ providers: { [providerId]: { key: '' } } });
      setStatus(next);
      await load(providerId);
    } finally {
      setSaving(false);
    }
  }, [backend, providerId, load]);

  const auth = status?.auth;
  const canSave = editingKey ? !!key.trim() : true;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-command/15 text-command-soft">
            <Settings className="h-5 w-5" />
          </div>
          <h2 className="font-display text-base font-semibold text-white">设置</h2>
        </div>

        {backend && provider && auth ? (
          <section className="mt-5 rounded-lg border border-line bg-ink-900/60 p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-command-soft" />
              <h3 className="font-display text-sm font-semibold text-white">模型与认证</h3>
              {auth.ready ? (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> 已就绪
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-human/40 bg-human/10 px-2 py-0.5 text-[10px] text-human-soft">
                  <AlertTriangle className="h-3 w-3" />
                  {auth.incomplete ? '配置不完整' : '未配置'}
                </span>
              )}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Coding agent（Claude Code）已随应用一起安装，你不需要另外安装任何东西。 它只会说
              Anthropic 的 Messages API —— 但任何提供
              <strong className="text-slate-200"> Anthropic 兼容端点 </strong>
              的服务都能接（DeepSeek 官方就有一个）。
            </p>

            {/* 服务商 */}
            <div className="mt-3">
              <label className="callsign mb-1 block text-[9px] text-slate-500">模型服务商</label>
              <div className="grid grid-cols-3 gap-1.5">
                {status.providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void load(p.id)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-[11px] transition-colors',
                      p.id === providerId
                        ? 'border-command bg-command/15 text-command-soft'
                        : 'border-line-bright bg-ink-850 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {p.name}
                    {savedConfig[p.id]?.hasKey && (
                      <span className="ml-1 text-emerald-400" title="已保存 key">
                        ●
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 本机登录态（开发机常见）：如实说明，别让人以为一定要填 key */}
            {auth.hasLocalCredentials && !hasSavedKey && providerId === 'anthropic' && (
              <p className="mt-3 rounded border border-line bg-ink-850 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
                检测到本机已有 Claude Code 登录态，走 Anthropic 官方端点时可直接使用。 填入 key
                会优先用 key（分发给别人时必须填）。
              </p>
            )}

            {/* Key */}
            <div className="mt-3">
              <label className="callsign mb-1 block text-[9px] text-slate-500">
                {provider.keyLabel}
                {provider.keyHint && (
                  <span className="ml-1 normal-case">（{provider.keyHint}）</span>
                )}
              </label>

              {hasSavedKey && !editingKey ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="text-xs text-emerald-100">已保存（存在本机，不回传界面）</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingKey(true);
                      setKey('');
                    }}
                    className="ml-auto shrink-0 text-[11px] text-command-soft underline-offset-2 hover:underline"
                  >
                    更改
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearKey()}
                    disabled={saving}
                    className="shrink-0 text-[11px] text-slate-400 underline-offset-2 hover:text-rose-300 hover:underline disabled:opacity-50"
                  >
                    清除
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type={reveal ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={provider.keyHint || 'API Key'}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-md border border-line-bright bg-ink-850 px-3 py-2 pr-16 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-command"
                  />
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      title={reveal ? '隐藏' : '显示'}
                      className="text-slate-500 hover:text-slate-300"
                    >
                      {reveal ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {hasSavedKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(false);
                          setKey('');
                        }}
                        className="text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 端点（自定义服务商才可改；DeepSeek 固定，只读回显） */}
            {needsEndpoint && (
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className="callsign mb-1 block text-[9px] text-slate-500">
                    Anthropic 兼容端点
                  </label>
                  <input
                    value={provider.editableBaseUrl ? baseUrl : provider.baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    readOnly={!provider.editableBaseUrl}
                    placeholder="https://…/anthropic"
                    spellCheck={false}
                    className={cn(
                      'w-full rounded-md border border-line-bright bg-ink-850 px-3 py-2 font-mono text-xs outline-none placeholder:text-slate-600 focus:border-command',
                      provider.editableBaseUrl ? 'text-slate-100' : 'text-slate-500',
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="callsign mb-1 block text-[9px] text-slate-500">主模型</label>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={provider.defaultModel || 'model-id'}
                      spellCheck={false}
                      className="w-full rounded-md border border-line-bright bg-ink-850 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-command"
                    />
                  </div>
                  <div>
                    <label className="callsign mb-1 block text-[9px] text-slate-500">
                      快速模型（子任务）
                    </label>
                    <input
                      value={fastModel}
                      onChange={(e) => setFastModel(e.target.value)}
                      placeholder={provider.defaultFastModel || 'model-id'}
                      spellCheck={false}
                      className="w-full rounded-md border border-line-bright bg-ink-850 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-command"
                    />
                  </div>
                </div>
                {/* 模型名会变（服务商随时改），所以这里可改，不写死 */}
                <p className="text-[10px] leading-relaxed text-slate-500">
                  模型名以服务商文档为准，会变；这里填的会覆盖默认值。
                </p>
              </div>
            )}

            <div className="mt-3.5 flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void save()}
                disabled={!canSave || saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存并重启后端'}
              </Button>
              {provider.consoleUrl && (
                <a
                  href={provider.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-command-soft hover:underline"
                >
                  去 {provider.consoleName} 申请 key <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              key 存在本机（<code className="font-mono">userData/settings.json</code>，权限 0600），
              只注入 agent 子进程，不会回传界面、不进日志。
            </p>
          </section>
        ) : (
          !backend && (
            <p className="mt-5 rounded-lg border border-line bg-ink-900/60 p-4 text-xs leading-relaxed text-slate-400">
              浏览器环境不接后端，模型与认证仅在桌面版可用（当前走 mock 演示剧本）。
            </p>
          )
        )}

        {/* ── 关于 ── */}
        <div className="mt-5 flex items-center gap-3 rounded-lg border border-line bg-ink-900/40 p-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-command shadow-glow">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-white">Polaris</div>
            <div className="truncate font-mono text-[10px] text-slate-500">
              {navigator.userAgent.includes('Electron') ? 'Electron 桌面端' : '浏览器'}
              {status?.workspace && ` · ${status.workspace}`}
            </div>
          </div>
          <span className="ml-auto shrink-0 rounded-md border border-command/30 bg-command/10 px-2.5 py-1 font-mono text-xs text-command-soft">
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
