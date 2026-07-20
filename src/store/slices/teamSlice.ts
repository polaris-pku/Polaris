import { recommendAgents } from '@/data/agentRecommendation';
import type { SliceCreator, TeamSlice } from '@/store/types';
import { extractTaskFields, syncTasks } from '@/store/lib/taskSync';

/** 团队域：Agent 选择与组队定制（团队随任务持久化）。 */
export const createTeamSlice: SliceCreator<TeamSlice> = (set) => ({
  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  assignAgent: (agentId) =>
    set((state) => {
      const already = state.assignedAgentIds.includes(agentId);
      const assignedAgentIds = already
        ? state.assignedAgentIds.filter((id) => id !== agentId)
        : [...state.assignedAgentIds, agentId];
      let stage = state.stage;
      if (state.stage === 'idle' || state.stage === 'team_configured') {
        stage = assignedAgentIds.length >= 3 ? 'team_configured' : 'idle';
      }
      const taskFields = extractTaskFields({ ...state, stage });
      return {
        assignedAgentIds,
        stage,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),

  enableTeamCustomization: () => set({ teamCustomizationEnabled: true }),
  disableTeamCustomization: () => set({ teamCustomizationEnabled: false }),

  resetTeamToRecommended: () =>
    set((state) => {
      // 恢复到"按当前需求推荐"的团队（不再是写死的固定四人）。
      const recommended = recommendAgents(state.taskText).ids;
      let stage = state.stage;
      if (stage === 'idle' || stage === 'team_configured') {
        stage = recommended.length >= 3 ? 'team_configured' : 'idle';
      }
      const patch = {
        assignedAgentIds: [...recommended],
        teamCustomizationEnabled: false,
        stage,
      };
      const taskFields = extractTaskFields({ ...state, ...patch });
      return {
        ...patch,
        tasks: syncTasks(state.tasks, state.activeTaskId, taskFields),
      };
    }),
});
