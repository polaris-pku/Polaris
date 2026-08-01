import type { DemoTask, PageKey, Project } from '@/types';
import type { EventChannelStatus } from '@/api/events';
import type { Event as ContractEvent } from '@/api/types';
import type { LiveRunState, LiveTaskState, PendingRunIntent } from '@/store/types';
import type { AgentFileWriteResult } from '@/lib/agentFs';
import type { DockChannel } from '@/lib/glossary';
import { emptyTaskFields } from '@/store/lib/taskSync';

/**
 * 空白启动态：无项目、无任务，停在启动页由用户新建。
 *
 * ⚠️ `resetDemo()` 直接 `set(blankState())` —— 所以这里只放**会话级 UI 态**。
 * 终端会话被抹掉无害：**子进程活在主进程里，不会变成孤儿**，TerminalChannel 挂载时
 * 会调 `syncTerminalSessions()` 从 `term:list` 重新水合（含 ring buffer 回放）。
 * 而**已安装的 Python 运行时清单与选中的解释器不在这里** —— 它们活在
 * `src/lib/pythonRuntime.ts` 的模块级缓存里（真值源是主进程 + settings.json），
 * 否则「重来一次」会把用户刚装的 250MB 运行时从界面上抹掉。
 * Dock 高度也不在这里：它由 `useResizablePane({storageKey:'dock'})` 持久化（两个真相源必然漂移）。
 */
export const blankState = () => ({
  currentPage: 'agents' as PageKey,
  selectedAgentId: null as string | null,
  teamCustomizationEnabled: false,
  isAutoRunning: false,
  tasks: [] as DemoTask[],
  liveTasks: {} as Record<string, LiveTaskState>,
  activeTaskId: null as string | null,
  projects: [] as Project[],
  activeProjectId: null as string | null,
  backendEvents: [] as ContractEvent[],
  eventChannelStatus: 'disconnected' as EventChannelStatus,
  liveRuns: {} as Record<string, LiveRunState>,
  agentFileWrites: {} as Record<string, AgentFileWriteResult>,
  openedFile: null as { projectId: string; path: string } | null,

  // ── Dock / 终端 / 帮助（会话级 UI 态）──
  dockOpen: false,
  dockChannel: 'terminal' as DockChannel,
  evidenceStepId: null as string | null,
  termSessions: [] as TermSession[],
  activeSessionId: null as string | null,
  helpOpen: false,
  helpTopic: null as string | null,
  pendingRunIntent: null as PendingRunIntent | null,

  ...emptyTaskFields(),
});
