import { useCallback, useEffect, useState } from 'react';
import { Play, Square, TriangleAlert, X } from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { selectedRuntime, usePythonState } from '@/lib/pythonRuntime';
import { terminalAvailable, terminalPlatform } from '@/lib/pythonTerminal';
import { stopButtonLabel, stopButtonTitle, stopSignalOf } from '@/lib/terminalExit';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TerminalFrame } from '@/components/dock/TerminalFrame';
import { TerminalStatusLine } from '@/components/dock/TerminalStatusLine';
import { cn } from '@/lib/utils';

const SOURCE_LABEL: Record<PyRuntime['source'], string> = {
  managed: 'Polaris 托管',
  system: '系统安装',
  manual: '手动指定',
};

/**
 * Dock 的「终端」频道。
 *
 * 管道式终端（`child_process` + `python -u`），**不是 PTY** —— 代价与能力都如实写在界面上：
 * stdin 是通的（`input()` 能打字、REPL 走 `python -i -u`），但 Windows 上没有真正的中断信号。
 *
 * 【R3/I5】这里只有用户手势能起进程：点 tab 上的「打开交互式 Python」，或从文件树/文件页点 ▶。
 * **没有第三种，尤其没有任何事件驱动的自动运行。**
 */
export function TerminalChannel() {
  const sessions = useDemoStore((s) => s.termSessions);
  const activeSessionId = useDemoStore((s) => s.activeSessionId);
  const syncTerminalSessions = useDemoStore((s) => s.syncTerminalSessions);
  const selectSession = useDemoStore((s) => s.selectSession);
  const closeSession = useDemoStore((s) => s.closeSession);
  const signalSession = useDemoStore((s) => s.signalSession);
  const startRepl = useDemoStore((s) => s.startTerminalRepl);
  const setDockChannel = useDemoStore((s) => s.setDockChannel);
  const project = useDemoStore((s) => s.projects.find((p) => p.id === s.activeProjectId));

  const python: PyState = usePythonState();
  const runtime: PyRuntime | null = selectedRuntime(python);
  const platform = terminalPlatform();

  /**
   * 输出被截断的会话。`TermSession` 里没有这个字段（主进程推的是一条 `truncated` 事件），
   * 它是会话级的呈现态，留在组件里就够了。
   */
  const [truncated, setTruncated] = useState<Record<string, boolean>>({});
  const markTruncated = useCallback((sessionId: string) => {
    setTruncated((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: true }));
  }, []);

  // 挂载即水合：子进程活在主进程里，resetDemo / 重挂载都不会让它变孤儿 ——
  // 但渲染层的会话清单是空的，必须从 term:list 拉回来（含 ring buffer 回放）。
  useEffect(() => {
    void syncTerminalSessions();
  }, [syncTerminalSessions]);

  if (!terminalAvailable()) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-void">
        <p className="text-body text-fg-muted">终端仅在桌面版可用。</p>
      </div>
    );
  }

  const active = sessions.find((s) => s.sessionId === activeSessionId) ?? null;

  return (
    <div className="flex h-full flex-col bg-surface-void">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-edge bg-surface-deck px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-chip px-2 py-0.5 text-body',
                s.sessionId === activeSessionId
                  ? 'bg-surface-raised text-fg-primary'
                  : 'text-fg-muted hover:text-fg-secondary',
              )}
            >
              <button
                type="button"
                onClick={() => selectSession(s.sessionId)}
                className="w-32 truncate text-left"
              >
                {s.title}
              </button>
              <button
                type="button"
                aria-label={`关闭 ${s.title}`}
                onClick={() => void closeSession(s.sessionId)}
                className="text-fg-faint hover:text-fg-primary"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2"
            onClick={() => void startRepl()}
          >
            打开交互式 Python
          </Button>
        </div>

        {active?.status === 'running' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-danger"
            title={stopButtonTitle(platform)}
            onClick={() => void signalSession(active.sessionId, stopSignalOf(platform))}
          >
            <Square className="h-3 w-3" aria-hidden />
            {stopButtonLabel(platform)}
          </Button>
        )}
      </div>

      {active ? (
        <>
          <div className="min-h-0 flex-1">
            <TerminalFrame session={active} onTruncated={markTruncated} />
          </div>
          <TerminalStatusLine
            session={active}
            truncated={!!truncated[active.sessionId]}
            platform={platform}
          />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
          <EmptyState
            icon={Play}
            title="还没有运行中的终端"
            hint="在左侧文件树里选一个 .py 文件，点行尾的 ▶ 运行。stdin 是通的：input() 可以打字，交互式解释器走 python -i -u。"
            action={
              <Button variant="secondary" size="sm" onClick={() => void startRepl()}>
                打开交互式 Python
              </Button>
            }
          />

          <div className="w-full max-w-md border-t border-edge pt-3">
            {runtime ? (
              <dl className="flex flex-col gap-1">
                <div className="flex items-baseline gap-3">
                  <dt className="w-20 shrink-0 text-body text-fg-muted">当前解释器</dt>
                  <dd className="min-w-0 flex-1 truncate text-body text-fg-secondary">
                    Python {runtime.version} · {SOURCE_LABEL[runtime.source]}
                  </dd>
                  <button
                    type="button"
                    onClick={() => setDockChannel('runtimes')}
                    className="shrink-0 text-body text-command hover:text-command-soft"
                  >
                    更改
                  </button>
                </div>
                <div className="flex items-baseline gap-3">
                  <dt className="w-20 shrink-0 text-body text-fg-muted">工作目录</dt>
                  <dd className="min-w-0 flex-1 truncate font-mono text-code text-fg-muted">
                    {project?.rootPath ?? `polaris-workspace/${project?.name ?? 'default'}`}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-body text-human">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                  还没有 Python，运行前需要先装一个。
                </p>
                <Button variant="secondary" size="sm" onClick={() => setDockChannel('runtimes')}>
                  安装 Python
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
