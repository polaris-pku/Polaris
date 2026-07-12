import type { DemoTask, PageKey, Project } from '@/types';
import type { EventChannelStatus } from '@/api/events';
import type { Event as ContractEvent } from '@/api/types';
import type { LiveRunState } from '@/store/types';
import type { AgentFileWriteResult } from '@/lib/agentFs';
import { emptyTaskFields } from '@/store/lib/taskSync';

/** 空白启动态：无项目、无任务，停在启动页由用户新建。 */
export const blankState = () => ({
  currentPage: 'agents' as PageKey,
  selectedAgentId: null as string | null,
  teamCustomizationEnabled: false,
  isAutoRunning: false,
  tasks: [] as DemoTask[],
  activeTaskId: null as string | null,
  projects: [] as Project[],
  activeProjectId: null as string | null,
  backendEvents: [] as ContractEvent[],
  eventChannelStatus: 'disconnected' as EventChannelStatus,
  liveRun: null as LiveRunState | null,
  agentFileWrites: {} as Record<string, AgentFileWriteResult>,
  openedFile: null as { projectId: string; path: string } | null,
  ...emptyTaskFields(),
});
