import { getTransport } from '@/api/transport';
import type {
  AgentBoardAgentView,
  AgentBoardListItem,
  ExperienceView,
  SkillView,
} from '@/api/types/agent';
import type { Agent } from '@/types';

type ListAgentsResult = { agents: AgentBoardListItem[] };
type GetAgentResult = { agent: AgentBoardAgentView };
type ListSkillsResult = { skills: SkillView[] };
type ListExperiencesResult = { experiences: ExperienceView[] };

async function loadMemoryAgent(item: AgentBoardListItem): Promise<Agent> {
  const transport = getTransport();
  const params = { role_id: item.role_id };
  const [detail, skillResult, experienceResult] = await Promise.all([
    transport.call<GetAgentResult>('memory.getAgent', params),
    transport.call<ListSkillsResult>('memory.listSkills', params),
    transport.call<ListExperiencesResult>('memory.listExperiences', params),
  ]);
  const readableExperiences = experienceResult.experiences.filter(isReadableExperience);

  return {
    id: detail.agent.role_id,
    role_id: detail.agent.role_id,
    name: detail.agent.name,
    status: detail.agent.status,
    tags: detail.agent.tags ?? [],
    created_at: detail.agent.created_at,
    persona: detail.agent.persona,
    metrics: detail.agent.metrics.raw,
    skills: skillResult.skills,
    experiences: readableExperiences,
  };
}

/** B 的回退提取器会生成驱动状态回执；它们是运行日志，不是可迁移经验。 */
function isReadableExperience(experience: ExperienceView): boolean {
  return !/^Driver\s+(?:succeeded|failed)\s*\(driver_result[_-][^)]+\)\.?$/i.test(
    experience.description.trim(),
  );
}

export async function loadMemoryAgents(): Promise<Agent[]> {
  const { agents } = await getTransport().call<ListAgentsResult>('memory.listAgents', {});
  return Promise.all(agents.map(loadMemoryAgent));
}
