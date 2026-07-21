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
    experiences: experienceResult.experiences,
  };
}

export async function loadMemoryAgents(): Promise<Agent[]> {
  const { agents } = await getTransport().call<ListAgentsResult>('memory.listAgents', {});
  return Promise.all(agents.map(loadMemoryAgent));
}
