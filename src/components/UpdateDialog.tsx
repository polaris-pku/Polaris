import { useEffect, useState } from 'react';
import { Sparkles, Download, RotateCw, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

type Phase = 'idle' | 'available' | 'downloading' | 'downloaded';

/**
 * 应用内自动更新弹窗（模态，覆盖在任意界面之上）。
 * 运行中轮询发现新版本 → 弹窗询问是否下载 → 用户确认后下载 → 下载完提示重启。
 * 仅在 Electron 桌面壳中生效（浏览器里 window.desktop 为空，直接不渲染）。
 */
export function UpdateDialog() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState<string | undefined>();
  const [percent, setPercent] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const api = window.desktop?.updates;
    if (!api) return;
    const apply = (e: UpdateEvent) => {
      switch (e.type) {
        case 'available':
          setVersion(e.version);
          setPercent(0);
          setPhase('available');
          setOpen(true);
          break;
        case 'progress':
          setPercent(e.percent);
          setPhase('downloading');
          break;
        case 'downloaded':
          setVersion((v) => e.version ?? v);
          setPhase('downloaded');
          setOpen(true);
          break;
        // checking / not-available / error 不打扰用户
        default:
          break;
      }
    };
    const unsubscribe = api.onEvent(apply);
    // 挂载时补拉一次当前状态：修复启动页因事件早于订阅而不弹窗
    api
      .getState()
      .then((s) => {
        if (s) apply(s);
      })
      .catch(() => {});
    return unsubscribe;
  }, []);

  if (phase === 'idle') return null;

  const label = version ? `v${version}` : '新版本';

  const startDownload = () => {
    setPhase('downloading');
    setPercent(0);
    window.desktop?.updates.download();
  };

  return (
    <>
      {!open && (
        <UpdatePill phase={phase} percent={percent} label={label} onClick={() => setOpen(true)} />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} className="max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-command/15 text-command-soft shadow-glow">
              {phase === 'downloaded' ? (
                <RotateCw className="h-5 w-5" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                {phase === 'downloaded' ? '更新已就绪' : '发现新版本'}
              </h2>
            </div>
          </div>

          {phase === 'available' && (
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              检测到新版本 <span className="font-mono text-command-soft">{label}</span>
              ，是否现在下载？下载在后台进行，完成后可选择重启更新。
            </p>
          )}

          {phase === 'downloading' && (
            <div className="mt-4">
              <p className="text-sm text-slate-300">
                正在下载 <span className="font-mono text-command-soft">{label}</span>…
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-command transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-1 text-right font-mono text-[10px] text-slate-500">{percent}%</div>
            </div>
          )}

          {phase === 'downloaded' && (
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              <span className="font-mono text-command-soft">{label}</span>{' '}
              已下载完成，重启应用即可完成更新。
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            {phase === 'available' && (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  稍后
                </Button>
                <Button variant="primary" onClick={startDownload}>
                  <Download className="h-4 w-4" /> 下载更新
                </Button>
              </>
            )}
            {phase === 'downloading' && (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                后台下载
              </Button>
            )}
            {phase === 'downloaded' && (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  稍后
                </Button>
                <Button variant="primary" onClick={() => window.desktop?.updates.restart()}>
                  <RotateCw className="h-4 w-4" /> 立即重启更新
                </Button>
              </>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** 最小化角标：弹窗关掉后仍能看到下载进度 / 就绪状态，点击可重新展开 */
function UpdatePill({
  phase,
  percent,
  label,
  onClick,
}: {
  phase: Phase;
  percent: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="查看更新"
      className="fixed bottom-4 right-4 z-[100] flex animate-fade-in items-center gap-2 rounded-full border border-line-bright bg-ink-850 px-3.5 py-2 text-xs shadow-lg shadow-black/40 transition-colors hover:border-command/60"
    >
      {phase === 'downloading' ? (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-command-soft" />
          <span className="text-slate-200">下载中</span>
          <span className="font-mono text-command-soft">{percent}%</span>
        </>
      ) : phase === 'downloaded' ? (
        <>
          <RotateCw className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-300">更新就绪</span>
        </>
      ) : (
        <>
          <Download className="h-3.5 w-3.5 text-command-soft" />
          <span className="text-slate-200">有新版本 {label}</span>
        </>
      )}
    </button>
  );
}
