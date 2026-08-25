import { getTransport } from './transport';
import type {
  MemoryAgentMetaPatch,
  MemoryAgentStatus,
  MemoryCreateAgentSpec,
  MemoryCreateSkillInput,
  MemoryExperienceListFilter,
  MemoryExperienceWritePatch,
  MemoryMarketSearchQuery,
  MemoryPersonaPatch,
  MemoryReindexOptions,
  MemoryRetireOptions,
  MemorySearchOptions,
  MemorySkillListFilter,
  MemorySkillWritePatch,
  MemoryUserRating,
} from './types/memory';

/**
 * memory.* 的门面：UI 一律走这里，不直接 getTransport().call。
 * 每个方法都不写返回类型，让 RpcMethodMap 推导 result，也不吞 BackendError。
 * 参数名对外 camelCase、上线 snake_case，可选项一律条件展开，避免把 undefined 塞进 params。
 */
export const memoryApi = {
  getCapabilities: () => getTransport().call('memory.getCapabilities', {}),
  listAgents: (status?: MemoryAgentStatus) =>
    getTransport().call('memory.listAgents', status ? { status } : {}),
  getAgent: (roleId: string) => getTransport().call('memory.getAgent', { role_id: roleId }),
  listSkills: (roleId: string, filter?: MemorySkillListFilter) =>
    getTransport().call('memory.listSkills', { role_id: roleId, ...(filter ?? {}) }),
  listExperiences: (roleId: string, filter?: MemoryExperienceListFilter) =>
    getTransport().call('memory.listExperiences', { role_id: roleId, ...(filter ?? {}) }),
  listMaintenance: (roleId?: string) =>
    getTransport().call('memory.listMaintenance', roleId ? { role_id: roleId } : {}),
  promoteSkills: (roleId: string, requestedBy?: string) =>
    getTransport().call('memory.promoteSkills', {
      role_id: roleId,
      ...(requestedBy ? { requested_by: requestedBy } : {}),
    }),

  /**
   * 显式晋升一条经验为待审核技能（与批量 promoteSkills 互补）。
   * 后端只收 **positive 且尚未晋升** 的经验，其余抛错；产出 review_status='pending'，
   * 仍要走 approveSkill / rejectSkill。
   */
  promoteExperience: (roleId: string, experienceId: string) =>
    getTransport().call('memory.promoteExperience', {
      role_id: roleId,
      experience_id: experienceId,
    }),

  // ── agent 生命周期 ──
  createAgent: (spec: MemoryCreateAgentSpec) => getTransport().call('memory.createAgent', spec),
  updateAgent: (roleId: string, patch: MemoryAgentMetaPatch) =>
    getTransport().call('memory.updateAgent', { role_id: roleId, ...patch }),
  /**
   * 硬删除，不可撤销。后端 schema 是 z.literal(true)：`confirm` 必须显式为 true，
   * 删未退休的 Agent 还要再显式给 `force: true`。这里刻意不给默认值 ——
   * 二次确认属于 UI，门面替调用方补一个 confirm 等于替他按下删除键。
   */
  deleteAgent: (roleId: string, confirmation: { confirm: true; force?: true }) =>
    getTransport().call('memory.deleteAgent', {
      role_id: roleId,
      confirm: confirmation.confirm,
      ...(confirmation.force ? { force: confirmation.force } : {}),
    }),
  /** 退休是软操作（reason 默认 manual、replacement 默认 none），与 deleteAgent 不是一回事。 */
  retireAgent: (roleId: string, options?: MemoryRetireOptions) =>
    getTransport().call('memory.retireAgent', { role_id: roleId, ...(options ?? {}) }),
  /** 只出建议不落库；不传 roleId 就是全量扫描。 */
  retirementScan: (roleId?: string) =>
    getTransport().call('memory.retirementScan', roleId ? { role_id: roleId } : {}),

  // ── 技能 ──
  createSkill: (input: MemoryCreateSkillInput) => getTransport().call('memory.createSkill', input),
  updateSkill: (roleId: string, skillId: string, patch: MemorySkillWritePatch) =>
    getTransport().call('memory.updateSkill', { role_id: roleId, skill_id: skillId, ...patch }),
  deleteSkill: (roleId: string, skillId: string) =>
    getTransport().call('memory.deleteSkill', { role_id: roleId, skill_id: skillId }),

  // ── 市场与评审 ──
  marketSearch: (query: MemoryMarketSearchQuery) =>
    getTransport().call('memory.marketSearch', query),
  /** 结果信封键是保留字，消费处写 `result.import`。重复引入是幂等的（created 为 false）。 */
  marketImport: (roleId: string, sourceSkillId: string) =>
    getTransport().call('memory.marketImport', {
      role_id: roleId,
      source_skill_id: sourceSkillId,
    }),
  publishSkillToMarket: (roleId: string, skillId: string) =>
    getTransport().call('memory.publishSkillToMarket', { role_id: roleId, skill_id: skillId }),
  listPendingReviews: () => getTransport().call('memory.listPendingReviews', {}),
  approveSkill: (roleId: string, skillId: string, reviewedBy?: string) =>
    getTransport().call('memory.approveSkill', {
      role_id: roleId,
      skill_id: skillId,
      ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
    }),
  rejectSkill: (roleId: string, skillId: string, reviewedBy?: string) =>
    getTransport().call('memory.rejectSkill', {
      role_id: roleId,
      skill_id: skillId,
      ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
    }),

  // ── 经验 ──
  updateExperience: (roleId: string, experienceId: string, patch: MemoryExperienceWritePatch) =>
    getTransport().call('memory.updateExperience', {
      role_id: roleId,
      experience_id: experienceId,
      ...patch,
    }),
  deleteExperience: (roleId: string, experienceId: string) =>
    getTransport().call('memory.deleteExperience', {
      role_id: roleId,
      experience_id: experienceId,
    }),
  listExperiencesBySourceTask: (taskId: string) =>
    getTransport().call('memory.listExperiencesBySourceTask', { task_id: taskId }),
  /** rating 是枚举，不是自由文本；评分会回写经验置信度与仍处于 pending 的缓冲区快照。 */
  rateTask: (roleId: string, taskId: string, rating: MemoryUserRating, note?: string) =>
    getTransport().call('memory.rateTask', {
      role_id: roleId,
      task_id: taskId,
      rating,
      ...(note ? { note } : {}),
    }),

  // ── persona ──
  /** 补丁字段允许空串（后端没加 min(1)），传 '' 就是清空该段文字。 */
  updatePersona: (roleId: string, patch: MemoryPersonaPatch) =>
    getTransport().call('memory.updatePersona', { role_id: roleId, ...patch }),
  regeneratePersona: (roleId: string) =>
    getTransport().call('memory.regeneratePersona', { role_id: roleId }),

  // ── 缓冲区与维护 ──
  getBufferState: (roleId: string) =>
    getTransport().call('memory.getBufferState', { role_id: roleId }),
  /** seq 必须是正整数；查不到那一条时 result.buffer 整个键消失，不是错误。 */
  getPendingBuffer: (roleId: string, seq: number) =>
    getTransport().call('memory.getPendingBuffer', { role_id: roleId, seq }),
  /** 把死信恢复成 pending 重新入队，返回的是调度证据，不是提取结果。 */
  retryExtraction: (roleId: string, seq: number) =>
    getTransport().call('memory.retryExtraction', { role_id: roleId, seq }),

  // ── 检索与总览 ──
  /** 唯一没有信封的 memory 方法：result 顶层就是 { skills, experiences }。 */
  searchMemory: (roleId: string, query: string, options?: MemorySearchOptions) =>
    getTransport().call('memory.searchMemory', {
      role_id: roleId,
      query,
      ...(options ?? {}),
    }),
  getOverview: () => getTransport().call('memory.getOverview', {}),

  // ── 向量索引 ──
  /**
   * 重算存量 `description_embedding`。换 embedding 模型后必须跑一次，否则
   * 语义检索拿旧模型的向量比新模型的 query，相似度是没有意义的。
   *
   * 不传 `roleId` 是全量（含市场池）。`force` 不传时只补「为空或维度不匹配」的记录——
   * **同维度换模型（比如 3-small → 3-large 都降到 1536）必须显式传 `force: true`**，
   * 否则维度看着是对的，一条都不会重算。
   */
  reindex: (options?: MemoryReindexOptions) =>
    getTransport().call('memory.reindex', {
      ...(options?.roleId !== undefined ? { role_id: options.roleId } : {}),
      ...(options?.force !== undefined ? { force: options.force } : {}),
    }),
};
