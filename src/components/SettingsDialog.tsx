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
import { authInfoOf } from '@/lib/agentAuth';
import { onBackendStatus } from '@/api/events';
import type { BackendStatus } from '@/api/transport';
import { cn } from '@/lib/utils';

/**
 * 设置弹窗。
 *
 * 核心是**认证** —— 这是用户装完应用后唯一必须做的事。
 * 之前这里只是个「关于」框，用户根本不知道自己需要什么 token；提交需求后只看到一个
 * 语焉不详的失败。现在把「要什么 key / 长什么样 / 去哪申请」全写在明面上。
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => onBackendStatus(setStatus), []);

  // 弹窗每次打开都清空输入框：key 永远不回传渲染层，输入框不该残留上次输入
  useEffect(() => {
    if (open) {
      setKey('');
      setReveal(false);
    }
  }, [open]);

  const backend = window.desktop?.backend;
  const auth = status?.auth;
  const agent = status?.agents?.find((a) => a.id === auth?.agentId) ?? status?.agents?.[0];
  const info = agent ? authInfoOf(agent.id, agent.envVar) : null;

  const save = useCallback(async () => {
    if (!backend || !agent) return;
    setSaving(true);
    try {
      // 存完主进程会自动重启后端使 key 生效
      const next = await backend.saveSettings({ apiKeys: { [agent.id]: key.trim() } });
      setStatus(next);
      setKey('');
    } finally {
      setSaving(false);
    }
  }, [backend, agent, key]);

  const clear = useCallback(async () => {
    if (!backend || !agent) return;
    setSaving(true);
    try {
      const next = await backend.saveSettings({ apiKeys: { [agent.id]: '' } });
      setStatus(next);
    } finally {
      setSaving(false);
    }
  }, [backend, agent]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-command/15 text-command-soft">
            <Settings className="h-5 w-5" />
          </div>
          <h2 className="font-display text-base font-semibold text-white">设置</h2>
        </div>

        {/* ── 认证：装完应用唯一必须做的事 ── */}
        {backend && agent && info && auth && (
          <section className="mt-5 rounded-lg border border-line bg-ink-900/60 p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-command-soft" />
              <h3 className="font-display text-sm font-semibold text-white">Agent 认证</h3>
              {auth.ready ? (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> 已就绪
                </span>
              ) : (
                <span className="ml-auto flex items-center gap-1 rounded-full border border-human/40 bg-human/10 px-2 py-0.5 text-[10px] text-human-soft">
                  <AlertTriangle className="h-3 w-3" /> 未配置
                </span>
              )}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              <strong className="text-slate-200">{agent.name}</strong> 已随应用一起安装，
              你不需要另外安装任何东西 —— 只差一个{' '}
              <strong className="text-slate-200">{info.keyLabel}</strong>。
            </p>

            {/* 本机已有登录态（开发机常见）：如实说明，别让人以为一定要填 key */}
            {auth.hasLocalCredentials && !auth.hasKey && (
              <p className="mt-2 rounded border border-line bg-ink-850 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
                检测到本机已有 {agent.name} 的登录态，可以直接使用。 在此填入 API key 会优先使用
                key（分发给别人时必须填）。
              </p>
            )}

            {/* 已配置：给个明确的「已填」态 + 清除入口，而不是一个空输入框让人猜 */}
            {auth.hasKey ? (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-xs text-emerald-100">
                  已保存 {info.keyLabel}（存在本机，不回传、不进日志）
                </span>
                <button
                  type="button"
                  onClick={() => void clear()}
                  disabled={saving}
                  className="ml-auto shrink-0 text-[11px] text-slate-400 underline-offset-2 hover:text-rose-300 hover:underline disabled:opacity-50"
                >
                  清除
                </button>
              </div>
            ) : (
              <div className="mt-3">
                <label className="callsign mb-1 block text-[9px] text-slate-500">
                  {info.keyLabel}
                  {info.keyHint && <span className="ml-1 normal-case">（{info.keyHint}）</span>}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={reveal ? 'text' : 'password'}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save()}
                      placeholder={info.keyHint || agent.envVar}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-md border border-line-bright bg-ink-850 px-3 py-2 pr-9 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-command"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      title={reveal ? '隐藏' : '显示'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {reveal ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void save()}
                    disabled={!key.trim() || saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
                  </Button>
                </div>
              </div>
            )}

            {info.consoleUrl && (
              <a
                href={info.consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-command-soft hover:underline"
              >
                去 {info.consoleName} 申请 key <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              key 存在本机（
              <code className="font-mono">userData/settings.json</code>，权限 0600）， 只注入 agent
              子进程，不会回传界面、不进日志。保存后后端会自动重启使其生效。
            </p>
          </section>
        )}

        {/* 浏览器里没有桌面桥 —— 说清楚为什么没有认证区，而不是留一片空白 */}
        {!backend && (
          <p className="mt-5 rounded-lg border border-line bg-ink-900/60 p-4 text-xs leading-relaxed text-slate-400">
            浏览器环境不接后端，agent 认证仅在桌面版可用（当前走 mock 演示剧本）。
          </p>
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
          <span
            className={cn(
              'ml-auto shrink-0 rounded-md border border-command/30 bg-command/10 px-2.5 py-1 font-mono text-xs text-command-soft',
            )}
          >
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
