import { useEffect, useMemo, useState } from 'react';
import { FileCode2, FolderOpen, HardDrive, Loader2, Play, Sparkles, X } from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { agentContentForPath } from '@/data/fileops';
import { readProjectTextFile, revealAgentFile } from '@/lib/agentFs';
import { writeTargetOf } from '@/store/lib/agentWrites';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * 文件查看页（只读观测）。
 *
 * 内容来源按可信度降级：
 *   1. 磁盘真实内容（桌面版，经 fs:readTextFile 同一授权模型读取）——「磁盘内容」；
 *   2. agent 生成内容（浏览器环境 / 尚未落盘时回退到观测流里的 content）——「Agent 生成（未落盘）」；
 *   3. 都没有 → 磁盘上确实没有这些字节。
 * 只读不写：编辑不在本页职责内（文件写入是 agent 经 Driver 的事）。
 */

type ViewState =
  | { kind: 'loading' }
  | { kind: 'disk'; content: string; absPath: string }
  | { kind: 'agent'; content: string; diskError?: string }
  | { kind: 'empty'; diskError?: string };

const isPython = (path: string) => /\.py$/i.test(path);

export function FileViewer() {
  const openedFile = useDemoStore((s) => s.openedFile);
  const projects = useDemoStore((s) => s.projects);
  const closeFile = useDemoStore((s) => s.closeFile);
  const agentFileWrites = useDemoStore((s) => s.agentFileWrites);
  const startTerminalRun = useDemoStore((s) => s.startTerminalRun);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });

  const project = projects.find((p) => p.id === openedFile?.projectId);
  // 落盘完成条数：写入发生后自动重读磁盘，让查看页从 agent 生成内容无缝切到磁盘内容
  const writtenCount = useMemo(
    () => Object.values(agentFileWrites).filter((r) => r.status === 'written').length,
    [agentFileWrites],
  );

  useEffect(() => {
    if (!openedFile) return;
    let alive = true;
    setView({ kind: 'loading' });
    void (async () => {
      const res = await readProjectTextFile(writeTargetOf(project), openedFile.path);
      if (!alive) return;
      if (res.ok) {
        setView({ kind: 'disk', content: res.content, absPath: res.absPath });
        return;
      }
      const generated = agentContentForPath(openedFile.path);
      if (generated != null) setView({ kind: 'agent', content: generated, diskError: res.error });
      else setView({ kind: 'empty', diskError: res.error });
    })();
    return () => {
      alive = false;
    };
    // project 引用随 store 更新而变，仅以身份字段为依赖，避免无关状态触发重读
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedFile?.projectId, openedFile?.path, project?.rootPath, project?.name, writtenCount]);

  if (!openedFile) {
    return (
      <div className="flex h-full items-center justify-center text-body text-fg-muted">
        未打开文件 · 在左侧文件树中选择一个文件
      </div>
    );
  }

  const content = view.kind === 'disk' || view.kind === 'agent' ? view.content : null;
  const lines = content != null ? content.split('\n') : [];
  const runnable = isPython(openedFile.path);

  /**
   * 【R3 / I5 —— 用户手势】只有这次点击能启动终端。
   * 运行根与 agent 的写入根同源（writeTargetOf）：agent 写哪 = 这里读哪 = 终端跑哪。
   */
  const runThisFile = () => {
    void startTerminalRun({ ...writeTargetOf(project), relPath: openedFile.path });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部：路径 + 来源 + 操作 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-surface-deck/70 px-4 py-2">
        <FileCode2 className="h-4 w-4 shrink-0 text-command-soft" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-body text-fg-primary">{openedFile.path}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-meta text-fg-muted">
            <span className="truncate">{project?.name ?? '未知项目'}</span>
            {view.kind === 'disk' && <span className="truncate text-fg-faint">{view.absPath}</span>}
          </div>
        </div>

        {view.kind === 'disk' && (
          <>
            <Badge variant="ok" className="shrink-0">
              <HardDrive className="h-3 w-3" /> 磁盘内容
            </Badge>
            <button
              type="button"
              title="在文件管理器中定位"
              onClick={() => revealAgentFile(view.absPath)}
              className="shrink-0 rounded-chip border border-edge-strong p-1.5 text-fg-secondary transition-colors hover:border-command hover:text-fg-primary"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {view.kind === 'agent' && (
          <Badge
            variant="command"
            className="shrink-0"
            title={view.diskError ? `磁盘读取：${view.diskError}` : undefined}
          >
            <Sparkles className="h-3 w-3" /> Agent 生成（未落盘）
          </Badge>
        )}

        {runnable && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={runThisFile}
            title="在终端里运行"
            className="shrink-0"
          >
            <Play className="h-3.5 w-3.5" /> 运行
          </Button>
        )}

        <span className="shrink-0 text-meta text-fg-faint">只读</span>
        <button
          type="button"
          title="关闭"
          onClick={closeFile}
          className="shrink-0 rounded-chip p-1.5 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-auto bg-surface-void">
        {view.kind === 'loading' && (
          <div className="flex h-full items-center justify-center gap-2 text-body text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> 读取中…
          </div>
        )}

        {content != null && (
          <table className="w-full border-collapse font-mono text-code">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="align-top hover:bg-surface-deck/60">
                  <td className="w-10 select-none border-r border-edge px-2 text-right text-meta text-fg-faint tabular">
                    {i + 1}
                  </td>
                  <td className="whitespace-pre px-3 text-fg-secondary">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {view.kind === 'empty' && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <FileCode2 className="h-8 w-8 text-fg-faint" />
            <div className="text-body text-fg-muted">此文件没有可展示的内容</div>
            <div className={cn('max-w-md px-6 font-mono text-meta text-fg-faint')}>
              {view.diskError ? `磁盘读取：${view.diskError}` : '磁盘上没有对应的字节'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
