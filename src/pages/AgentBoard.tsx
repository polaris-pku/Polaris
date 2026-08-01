import { useEffect, useState } from 'react';
import { AlertTriangle, Brain, Loader2, Sparkles } from 'lucide-react';
import { memoryApi } from '@/api/memory';
import type {
  MemoryCapabilities,
  MemoryMaintenanceEvidence,
  RpcAgentBoardAgentView,
  RpcAgentBoardListItem,
  RpcExperienceView,
  RpcSkillView,
} from '@/api/types/memory';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { SidePanel } from '@/components/SidePanel';

interface AgentDetail {
  agent: RpcAgentBoardAgentView;
  skills: RpcSkillView[];
  experiences: RpcExperienceView[];
  maintenance: MemoryMaintenanceEvidence[];
}

export function AgentBoard() {
  const [capabilities, setCapabilities] = useState<MemoryCapabilities>();
  const [agents, setAgents] = useState<RpcAgentBoardListItem[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>();
  const [detail, setDetail] = useState<AgentDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([memoryApi.getCapabilities(), memoryApi.listAgents()])
      .then(([caps, listed]) => {
        if (!active) return;
        setCapabilities(caps.capabilities);
        setAgents(listed.agents);
        setSelectedRoleId((current) => current ?? listed.agents[0]?.role_id);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRoleId) {
      setDetail(undefined);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void Promise.all([
      memoryApi.getAgent(selectedRoleId),
      memoryApi.listSkills(selectedRoleId),
      memoryApi.listExperiences(selectedRoleId),
      memoryApi.listMaintenance(selectedRoleId),
    ])
      .then(([agent, skills, experiences, maintenance]) => {
        if (!active) return;
        setDetail({
          agent: agent.agent,
          skills: skills.skills,
          experiences: experiences.experiences,
          maintenance: maintenance.maintenance,
        });
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRoleId]);

  const promote = async () => {
    if (!selectedRoleId || promoting) return;
    setPromoting(true);
    setError(undefined);
    try {
      const result = await memoryApi.promoteSkills(selectedRoleId, 'polaris-ui');
      setDetail((current) =>
        current
          ? { ...current, maintenance: [result.maintenance, ...current.maintenance] }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-body text-fg-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在读取 B Memory…
      </div>
    );
  }

  if (error && agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={AlertTriangle} title="B Memory 不可用" hint={error} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-end justify-between border-b border-edge px-6 py-4">
          <div>
            <h1 className="text-title text-fg-primary">Agent Memory</h1>
            <p className="mt-0.5 text-body text-fg-muted">
              来自 PostgreSQL 的长期角色、技能与经验。
            </p>
          </div>
          <EmbeddingBadge capabilities={capabilities} />
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <Panel className="mb-4 flex items-start gap-2 border-human/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-human-soft" />
              <span className="text-body text-fg-secondary">{error}</span>
            </Panel>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {agents.map((agent) => (
              <button
                key={agent.role_id}
                type="button"
                onClick={() => setSelectedRoleId(agent.role_id)}
                className={`rounded-panel border bg-surface-panel p-4 text-left transition-colors hover:border-edge-strong ${
                  selectedRoleId === agent.role_id ? 'border-command/60' : 'border-edge'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-panel border border-edge-strong bg-surface-raised font-mono text-title text-command-soft">
                    {agent.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-title text-fg-primary">{agent.name}</div>
                    <div className="truncate font-mono text-code text-fg-muted">
                      {agent.role_id}
                    </div>
                  </div>
                  <Badge variant={agent.status === 'active' ? 'ok' : 'default'}>
                    {agent.status}
                  </Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-body text-fg-secondary">
                  {agent.persona_summary || '暂无 Persona 摘要'}
                </p>
                <div className="mt-3 flex items-center justify-between text-body text-fg-muted">
                  <div className="flex gap-1.5">
                    {(agent.tags ?? []).slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-chip border border-edge px-1.5 font-mono text-code"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span>
                    技能 {agent.skill_count} · 经验 {agent.experience_count}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <SidePanel
        side="right"
        title="Memory 详情"
        defaultWidth={390}
        minWidth={320}
        maxWidth={600}
        storageKey="agent-memory-detail"
        className="bg-black"
      >
        {detailLoading ? (
          <div className="flex h-full items-center justify-center text-body text-fg-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载详情…
          </div>
        ) : detail ? (
          <div className="space-y-5 p-4">
            <div>
              <h2 className="text-title text-fg-primary">{detail.agent.name}</h2>
              <p className="mt-1 font-mono text-code text-fg-muted">{detail.agent.role_id}</p>
            </div>
            <section>
              <h3 className="mb-2 text-body text-fg-primary">Persona</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-panel border border-edge bg-surface-void p-3 font-mono text-code text-fg-secondary">
                {JSON.stringify(detail.agent.persona, null, 2)}
              </pre>
            </section>
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-body text-fg-primary">Skills · {detail.skills.length}</h3>
                {capabilities?.operations.promote_skills?.status === 'available' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void promote()}
                    disabled={promoting}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {promoting ? '处理中…' : '生成 pending Skill'}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {detail.skills.map((skill) => (
                  <Panel key={skill.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body text-fg-primary">{skill.description}</span>
                      <Badge variant={skill.review_status === 'pending' ? 'human' : 'default'}>
                        {skill.review_status}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-3 text-body text-fg-muted">{skill.content}</p>
                  </Panel>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-body text-fg-primary">
                Experiences · {detail.experiences.length}
              </h3>
              <div className="space-y-2">
                {detail.experiences.map((experience) => (
                  <Panel key={experience.id} className="p-3">
                    <div className="text-body text-fg-primary">{experience.description}</div>
                    <p className="mt-1 line-clamp-3 text-body text-fg-muted">
                      {experience.content}
                    </p>
                  </Panel>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-body text-fg-primary">维护证据</h3>
              <div className="space-y-2">
                {detail.maintenance.map((item) => (
                  <Panel key={item.maintenance_ref} className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-code text-fg-secondary">{item.kind}</span>
                      <Badge variant={item.status === 'completed' ? 'ok' : 'default'}>
                        {item.status}
                      </Badge>
                    </div>
                    {item.kind === 'skill_promotion' && (
                      <p className="mt-1 text-body text-human-soft">
                        生成的 Skill 保持 pending，尚未批准。
                      </p>
                    )}
                  </Panel>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <EmptyState icon={Brain} title="选择一个 Agent" hint="详情与记忆会按需从后端加载。" />
        )}
      </SidePanel>
    </div>
  );
}

function EmbeddingBadge({ capabilities }: { capabilities?: MemoryCapabilities }) {
  const embedding = capabilities?.embedding;
  if (!embedding) return null;
  const degraded = embedding.provider === 'HashEmbeddingProvider';
  return (
    <Badge variant={degraded ? 'human' : 'ok'}>
      {degraded ? 'Hash embedding · degraded' : `${embedding.provider} · ready`}
    </Badge>
  );
}
