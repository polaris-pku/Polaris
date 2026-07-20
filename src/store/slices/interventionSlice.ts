import { findFileOp } from '@/data/fileops';
import type { InterventionSlice, SliceCreator } from '@/store/types';
import { flushAgentWritesForNode, writeTargetOf } from '@/store/lib/agentWrites';
import { insertFileNode } from '@/store/lib/fileTree';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';

/**
 * 介入域：文件写权限确认。
 *
 * 「注入业务规则」（`addInterventionRule`）随 mock 推进引擎一起删除 —— 它把下游节点标成
 * 「已被介入」，而那条链路上没有任何东西会读这个标记，界面上也早已没有入口。
 * `interventionRules` 字段保留（多处读取并写进导出的运行记录），但恒为空数组。
 */
export const createInterventionSlice: SliceCreator<InterventionSlice> = (set, get) => ({
  resolveFilePermission: (toolEventId, outcome) => {
    set((state) => {
      const filePermissionOutcomes = {
        ...(state.filePermissionOutcomes ?? {}),
        [toolEventId]: outcome,
      };
      const taskFields = extractTaskFields({ ...state, filePermissionOutcomes });
      return {
        filePermissionOutcomes,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    });
    // 人机确认已记录；若选择为"允许"，把挂起的那条写操作真正落盘
    const found = findFileOp(toolEventId);
    if (!found) return;
    const state = get();
    flushAgentWritesForNode(
      found.nodeId,
      state.filePermissionOutcomes ?? {},
      state.agentFileWrites,
      writeTargetOf(state.projects.find((p) => p.id === state.activeProjectId)),
      state.recordAgentFileWrite,
    );
  },

  recordAgentFileWrite: (toolEventId, result) =>
    set((state) => {
      const agentFileWrites = { ...state.agentFileWrites, [toolEventId]: result };
      if (result.status !== 'written' || !state.activeProjectId) return { agentFileWrites };
      // 写成功：把文件挂进当前项目的文件树，让 IDE 侧栏同步看到 agent 产出。
      // 标 origin='demo'：这条链路走的是 mock 剧本（桌面壳代 A 落盘），
      // 与后端真实 run 的产物落在同一个工作区里，不标就分不清谁写的。
      const op = findFileOp(toolEventId)?.op;
      const parts = op?.path.split('/').filter(Boolean) ?? [];
      if (parts.length === 0) return { agentFileWrites };
      return {
        agentFileWrites,
        projects: state.projects.map((p) =>
          p.id === state.activeProjectId
            ? { ...p, files: insertFileNode(p.files, parts, false, 'demo') }
            : p,
        ),
      };
    }),
});
