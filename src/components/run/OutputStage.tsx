import { FileCode2, FolderOpen, Hourglass } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { revealAgentFile } from '@/lib/agentFs';
import type { ArtifactFacts } from '@/lib/runFacts';
import type { RunState } from '@/lib/runState';

/**
 * 产出面 —— 中央舞台。
 *
 * ── 它为什么存在 ──
 * 信息架构重排之后，中央舞台**失去了职责**：顶部管状态，右栏管详情，底部 Dock 管原始文本。
 * 剩下一块 500px 的真空。往真空里塞放大的步骤卡、或者把那张「其实是一条直线」的图搬回来，
 * 都只是拿装饰去补结构上的空缺 —— 像素变多了，信息一点没多。
 *
 * 真正的问题是：**整个产品最重要的那个事实（agent 到底写出了什么），此前只是右栏里一个折叠条，
 * 权重和「机器握手」并列。** 最大的区域应该给最大的事实。所以舞台归它。
 *
 * ── 它安静的时候在说什么 ──
 * 产物登记前不虚构文件。实时活动由主句与「当前活动」呈现，流式正文不进入状态事件流。
 *
 * ── 它不做的事 ──
 * 不渲染 L3 入口。原始事件的唯一出口是 Fold 的 `evidence` 行（F3）——
 * 「产出」这一步的事件，从步骤轨点进那张卡、由右栏的 StepFold 给出入口。
 */
export function OutputStage({ facts, state }: { facts: ArtifactFacts; state: RunState }) {
  if (facts.count > 0) return <FileList facts={facts} />;

  if (state === 'running' || state === 'blocked' || state === 'waiting') {
    return (
      <Center>
        <EmptyState
          icon={Hourglass}
          title={state === 'waiting' ? '等待协作完成后交付' : '等待文件交付'}
          hint="审查临时目录中的文件不算交付。通过审查并写入项目目录后，文件会自动出现在这里和左侧列表。"
        />
      </Center>
    );
  }

  if (state === 'completed' || state === 'failed' || state === 'cancelled') {
    return (
      <Center>
        <EmptyState
          icon={FileCode2}
          title="本次没有产出文件"
          hint="后端没有登记文件产物。请查看交付信息与事件流；没有登记不代表磁盘上没有文件。"
        />
      </Center>
    );
  }

  // idle / unsent：主行动区已经在说该做什么了，这里不再重复一遍。
  return null;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

/** agent 真写进工作区的文件。可点的那些能在系统文件管理器里定位到。 */
function FileList({ facts }: { facts: ArtifactFacts }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto py-2">
      <p className="text-body text-fg-muted">
        Agent 写出了 <span className="tabular text-fg-primary">{facts.count}</span> 个文件
      </p>

      {facts.files.length === 0 ? (
        // 有数量、没路径：快照还没到，只有 worktree.materialized 给的那个计数。如实说，不编路径。
        <p className="text-body text-fg-muted">路径要等本次 run 的完整快照到达。</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {facts.files.map((file) => (
            <li key={file.label}>
              {file.absPath ? (
                <button
                  type="button"
                  onClick={() => {
                    revealAgentFile(file.absPath ?? '');
                  }}
                  title={file.absPath}
                  className="group flex w-full items-center gap-2 rounded-panel border border-edge bg-surface-panel px-3 py-2 text-left transition-colors hover:border-edge-strong"
                >
                  <FileCode2 className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
                  <span className="truncate font-mono text-code text-fg-primary">{file.label}</span>
                  <FolderOpen
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              ) : (
                // 后端只给了 worktree 内的引用，定位不到磁盘上的文件 —— 就别做成一个点了没反应的按钮。
                <span
                  title={file.label}
                  className="flex w-full items-center gap-2 rounded-panel border border-edge px-3 py-2"
                >
                  <FileCode2 className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
                  <span className="truncate font-mono text-code text-fg-secondary">
                    {file.label}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
