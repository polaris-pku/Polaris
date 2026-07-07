import { useEffect, useMemo, useState } from 'react';
import { FileCode2, FolderOpen, HardDrive, Loader2, Sparkles, X } from 'lucide-react';
import { useDemoStore } from '@/store/useDemoStore';
import { agentContentForPath } from '@/data/fileops';
import { readProjectTextFile, revealAgentFile } from '@/lib/agentFs';
import { writeTargetOf } from '@/store/lib/agentWrites';
import { cn } from '@/lib/utils';

/**
 * 文件查看页 · File Viewer（只读观测）。
 *
 * 内容来源按可信度降级：
 *   1. 磁盘真实内容（桌面版，经 fs:readTextFile 同一授权模型读取）——徽标 DISK；
 *   2. agent 生成内容（浏览器环境 / 尚未落盘时回退到观测流里的 content）——徽标 AGENT；
 *   3. 都没有 → 演示占位（mock 文件树里的文件本就没有字节）。
 * E 只读不写：编辑不在本方向职责内（文件写入是 A 经 Driver 的事）。
 */

type ViewState =
  | { kind: 'loading' }
  | { kind: 'disk'; content: string; absPath: string }
  | { kind: 'agent'; content: string; diskError?: string }
  | { kind: 'empty'; diskError?: string };

export function FileViewer() {
  const openedFile = useDemoStore((s) => s.openedFile);
  const projects = useDemoStore((s) => s.projects);
  const closeFile = useDemoStore((s) => s.closeFile);
  const agentFileWrites = useDemoStore((s) => s.agentFileWrites);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });

  const project = projects.find((p) => p.id === openedFile?.projectId);
  // 落盘完成条数：写入发生后自动重读磁盘，让查看页从 AGENT 内容无缝切到 DISK
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
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        未打开文件 · 在左侧文件树中选择一个文件
      </div>
    );
  }

  const content = view.kind === 'disk' || view.kind === 'agent' ? view.content : null;
  const lines = content != null ? content.split('\n') : [];

  return (
    <div className="flex h-full flex-col">
      {/* 头部：路径 + 来源徽标 + 操作 */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-ink-900/70 px-4 py-2.5">
        <FileCode2 className="h-4 w-4 shrink-0 text-command-soft" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] text-slate-100">{openedFile.path}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-slate-500">
            <span className="truncate">{project?.name ?? '未知项目'}</span>
            {view.kind === 'disk' && (
              <span className="truncate text-slate-600">{view.absPath}</span>
            )}
          </div>
        </div>

        {view.kind === 'disk' && (
          <>
            <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[9px] text-emerald-300">
              <HardDrive className="h-3 w-3" /> DISK · 磁盘内容
            </span>
            <button
              type="button"
              title="在文件管理器中定位"
              onClick={() => revealAgentFile(view.absPath)}
              className="shrink-0 rounded-md border border-line-bright p-1.5 text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {view.kind === 'agent' && (
          <span
            className="flex shrink-0 items-center gap-1 rounded bg-command/15 px-1.5 py-0.5 text-[9px] text-command-soft"
            title={view.diskError ? `磁盘读取：${view.diskError}` : undefined}
          >
            <Sparkles className="h-3 w-3" /> AGENT · 生成内容（未读到磁盘）
          </span>
        )}
        <span className="callsign shrink-0 text-[9px] text-slate-600">只读</span>
        <button
          type="button"
          title="关闭"
          onClick={closeFile}
          className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-ink-700 hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-auto bg-ink-950">
        {view.kind === 'loading' && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 读取中…
          </div>
        )}

        {content != null && (
          <table className="w-full border-collapse font-mono text-[12px] leading-[1.7]">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="align-top hover:bg-ink-900/60">
                  <td className="w-10 select-none border-r border-line px-2 text-right text-[10px] text-slate-600 tabular">
                    {i + 1}
                  </td>
                  <td className="whitespace-pre px-3 text-slate-300">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {view.kind === 'empty' && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <FileCode2 className="h-8 w-8 text-slate-700" />
            <div className="text-sm text-slate-500">此文件没有可展示的内容</div>
            <div className={cn('max-w-md px-6 font-mono text-[10px] text-slate-600')}>
              {view.diskError
                ? `磁盘读取：${view.diskError}`
                : '演示文件树中的条目，磁盘上无对应字节'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
